import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt } from "../encryption";
import crypto from "crypto";

// Generate a valid 32-byte key as 64 hex chars
const TEST_KEY = crypto.randomBytes(32).toString("hex");
const ALT_KEY = crypto.randomBytes(32).toString("hex");

describe("encryption", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it("encrypts and decrypts a plaintext string round-trip", () => {
    const plaintext = "sk-test-api-key-12345";
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("ciphertext format is iv:authTag:data (three colon-separated hex parts)", () => {
    const ciphertext = encrypt("hello");
    const parts = ciphertext.split(":");
    expect(parts.length).toBe(3);
    // Each part should be valid hex
    for (const part of parts) {
      expect(/^[0-9a-f]+$/.test(part)).toBe(true);
    }
    // IV should be 12 bytes = 24 hex chars
    expect(parts[0].length).toBe(24);
    // Auth tag should be 16 bytes = 32 hex chars
    expect(parts[1].length).toBe(32);
  });

  it("produces unique ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "same-input-different-output";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);

    // Both should decrypt to the same plaintext
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it("different keys produce different ciphertext that cannot cross-decrypt", () => {
    const plaintext = "cross-key-test";
    process.env.ENCRYPTION_KEY = TEST_KEY;
    const c1 = encrypt(plaintext);

    process.env.ENCRYPTION_KEY = ALT_KEY;
    const c2 = encrypt(plaintext);

    expect(c1).not.toBe(c2);

    // Decrypting c1 with ALT_KEY should throw
    expect(() => decrypt(c1)).toThrow();
  });

  it("tampered ciphertext throws on decrypt", () => {
    const ciphertext = encrypt("sensitive-data");
    const parts = ciphertext.split(":");
    // Flip a character in the encrypted data
    const tampered =
      parts[0] + ":" + parts[1] + ":" + "ff" + parts[2].slice(2);
    expect(() => decrypt(tampered)).toThrow();
  });

  it("tampered auth tag throws on decrypt", () => {
    const ciphertext = encrypt("auth-tag-test");
    const parts = ciphertext.split(":");
    // Flip a character in the auth tag
    const tampered =
      parts[0] + ":" + "00" + parts[1].slice(2) + ":" + parts[2];
    expect(() => decrypt(tampered)).toThrow();
  });

  it("handles empty string", () => {
    const ciphertext = encrypt("");
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe("");
  });

  it("handles long payload", () => {
    const long = "a".repeat(10000);
    const ciphertext = encrypt(long);
    expect(decrypt(ciphertext)).toBe(long);
  });

  it("handles UTF-8 characters", () => {
    const unicode = "日本語テスト 🔑 Ñoño";
    const ciphertext = encrypt(unicode);
    expect(decrypt(ciphertext)).toBe(unicode);
  });

  it("throws if ENCRYPTION_KEY is missing", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY must be set");
  });

  it("throws if ENCRYPTION_KEY is wrong length", () => {
    process.env.ENCRYPTION_KEY = "abcd"; // too short
    expect(() => encrypt("test")).toThrow("64 hex characters");
  });

  it("throws on invalid ciphertext format (wrong number of parts)", () => {
    expect(() => decrypt("invalid")).toThrow("Invalid ciphertext format");
    expect(() => decrypt("a:b")).toThrow("Invalid ciphertext format");
    expect(() => decrypt("a:b:c:d")).toThrow("Invalid ciphertext format");
  });
});
