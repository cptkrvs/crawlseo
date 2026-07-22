import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET =
    "test-secret-0123456789abcdef0123456789abcdef";
});

describe("encrypt/decrypt", () => {
  it("round-trips plaintext", async () => {
    const { encrypt, decrypt } = await import("./encryption");
    const secret = JSON.stringify({ accessToken: "abc", refreshToken: "xyz" });
    const enc = encrypt(secret);
    expect(enc).not.toContain("abc");
    expect(enc.split(":")).toHaveLength(3); // iv:ct:tag
    expect(decrypt(enc)).toBe(secret);
  });

  it("produces a fresh IV each time (non-deterministic ciphertext)", async () => {
    const { encrypt } = await import("./encryption");
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag)", async () => {
    const { encrypt, decrypt } = await import("./encryption");
    const [iv, , tag] = encrypt("secret").split(":");
    const forged = `${iv}:${Buffer.from("tampered").toString("base64")}:${tag}`;
    expect(() => decrypt(forged)).toThrow();
  });
});
