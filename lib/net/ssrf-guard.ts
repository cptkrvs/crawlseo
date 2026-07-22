import { lookup } from "dns/promises";

/**
 * SSRF protection for the crawler and any server-side fetch of a
 * user-supplied URL. Blocks loopback, link-local (incl. cloud metadata at
 * 169.254.169.254), private/RFC-1918, CGNAT, and other non-public ranges,
 * and — critically — resolves DNS so a public hostname cannot point at an
 * internal address (DNS-rebinding style bypass).
 */

/** Hostname suffixes / literals that never reach a real fetch. */
const BLOCKED_HOST_SUFFIXES = [".internal", ".local", ".localhost", ".lan"];
const BLOCKED_HOST_LITERALS = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const octet = Number(p);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  const inRange = (base: string, bits: number) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // "this" network
    inRange("10.0.0.0", 8) || // private
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local (cloud metadata)
    inRange("172.16.0.0", 12) || // private
    inRange("192.0.0.0", 24) || // IETF protocol assignments
    inRange("192.168.0.0", 16) || // private
    inRange("198.18.0.0", 15) || // benchmarking
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) // reserved / broadcast
  );
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // strip zone id
  // IPv4-mapped / -compatible (::ffff:a.b.c.d) → check the embedded v4
  const mapped = addr.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  if (addr.startsWith("fe8") || addr.startsWith("fe9")) return true; // link-local fe80::/10
  if (addr.startsWith("fea") || addr.startsWith("feb")) return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA fc00::/7
  if (addr.startsWith("ff")) return true; // multicast
  return false;
}

function isPrivateIP(ip: string, family: number): boolean {
  return family === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** Synchronous, no-DNS check usable in hot paths like normalizeUrl(). */
export function isBlockedHostLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // unwrap [ipv6]
  if (BLOCKED_HOST_LITERALS.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIPv4(host);
  if (host.includes(":")) return isPrivateIPv6(host); // bare IPv6 literal
  return false;
}

/**
 * Full async guard: validates scheme, blocks literal private hosts, then
 * resolves DNS and rejects if ANY resolved address is non-public.
 * Throws on violation; returns normally when the URL is safe to fetch.
 */
export async function assertUrlAllowed(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked non-HTTP(S) URL: ${rawUrl}`);
  }
  const host = u.hostname;
  if (isBlockedHostLiteral(host)) {
    throw new Error(`Blocked internal host: ${host}`);
  }
  // Literal IPs are already validated above; only resolve real hostnames.
  const isLiteralIp =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (isLiteralIp) return;

  let records: { address: string; family: number }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error(`DNS resolution failed for host: ${host}`);
  }
  if (records.length === 0) {
    throw new Error(`No DNS records for host: ${host}`);
  }
  for (const { address, family } of records) {
    if (isPrivateIP(address, family)) {
      throw new Error(
        `Blocked host ${host} resolving to non-public address ${address}`
      );
    }
  }
}

/** Non-throwing convenience wrapper. */
export async function isUrlAllowed(rawUrl: string): Promise<boolean> {
  try {
    await assertUrlAllowed(rawUrl);
    return true;
  } catch {
    return false;
  }
}
