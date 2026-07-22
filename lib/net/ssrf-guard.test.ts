import { describe, it, expect } from "vitest";
import { isBlockedHostLiteral, assertUrlAllowed } from "./ssrf-guard";

describe("isBlockedHostLiteral", () => {
  it("blocks loopback and localhost", () => {
    expect(isBlockedHostLiteral("localhost")).toBe(true);
    expect(isBlockedHostLiteral("127.0.0.1")).toBe(true);
    expect(isBlockedHostLiteral("127.255.255.254")).toBe(true);
  });

  it("blocks the cloud metadata address", () => {
    expect(isBlockedHostLiteral("169.254.169.254")).toBe(true);
  });

  it("blocks RFC-1918 private ranges", () => {
    expect(isBlockedHostLiteral("10.0.0.5")).toBe(true);
    expect(isBlockedHostLiteral("172.16.0.1")).toBe(true);
    expect(isBlockedHostLiteral("172.31.255.255")).toBe(true);
    expect(isBlockedHostLiteral("192.168.1.1")).toBe(true);
  });

  it("blocks internal TLD suffixes and IPv6 loopback", () => {
    expect(isBlockedHostLiteral("db.internal")).toBe(true);
    expect(isBlockedHostLiteral("service.local")).toBe(true);
    expect(isBlockedHostLiteral("::1")).toBe(true);
    expect(isBlockedHostLiteral("[::1]")).toBe(true);
    expect(isBlockedHostLiteral("fd00::1")).toBe(true);
  });

  it("allows public IP and hostname literals", () => {
    expect(isBlockedHostLiteral("8.8.8.8")).toBe(false);
    expect(isBlockedHostLiteral("172.32.0.1")).toBe(false); // just outside 172.16/12
    expect(isBlockedHostLiteral("example.com")).toBe(false);
    expect(isBlockedHostLiteral("acme.co.uk")).toBe(false);
  });
});

describe("assertUrlAllowed", () => {
  it("rejects non-HTTP(S) schemes", async () => {
    await expect(assertUrlAllowed("file:///etc/passwd")).rejects.toThrow();
    await expect(assertUrlAllowed("ftp://example.com")).rejects.toThrow();
  });

  it("rejects internal literal hosts without DNS", async () => {
    await expect(assertUrlAllowed("http://169.254.169.254/")).rejects.toThrow();
    await expect(assertUrlAllowed("http://localhost:8080/")).rejects.toThrow();
    await expect(assertUrlAllowed("http://10.0.0.1/admin")).rejects.toThrow();
  });

  it("allows a public literal IP", async () => {
    await expect(assertUrlAllowed("https://8.8.8.8/")).resolves.toBeUndefined();
  });
});
