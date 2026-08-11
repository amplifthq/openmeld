import { describe, expect, it } from "vitest";
import {
  decryptLarkPlatformCredential,
  encryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "../src/remote-agent/application/lark-platform-credential-crypto";
import {
  decryptSlackBotToken,
  encryptSlackBotToken,
} from "../src/remote-agent/application/slack-token-crypto";

const CRYPTO_KEY = btoa("0123456789abcdef0123456789abcdef");
const OTHER_CRYPTO_KEY = btoa("abcdef0123456789abcdef0123456789");
const CIPHERTEXT_PATTERN = /^aesgcm:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/u;

describe("Lark-platform credential crypto", () => {
  it("round-trips a credential through the shared AES-GCM format", async () => {
    const encryptedCredential = await encryptLarkPlatformCredential({
      credential: "app-secret-value",
      credentialName: "app secret",
      cryptoKey: CRYPTO_KEY,
    });

    expect(LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION).toBe(1);
    expect(encryptedCredential).toMatch(CIPHERTEXT_PATTERN);
    await expect(
      decryptLarkPlatformCredential({
        credentialName: "app secret",
        cryptoKey: CRYPTO_KEY,
        encryptedCredential,
      })
    ).resolves.toBe("app-secret-value");
  });

  it("fails closed for a wrong key or malformed ciphertext", async () => {
    const encryptedCredential = await encryptLarkPlatformCredential({
      credential: "app-secret-value",
      credentialName: "app secret",
      cryptoKey: CRYPTO_KEY,
    });

    await expect(
      decryptLarkPlatformCredential({
        credentialName: "app secret",
        cryptoKey: OTHER_CRYPTO_KEY,
        encryptedCredential,
      })
    ).rejects.toThrow("Lark-platform app secret decryption failed");
    await expect(
      decryptLarkPlatformCredential({
        credentialName: "app secret",
        cryptoKey: CRYPTO_KEY,
        encryptedCredential: "plaintext-secret",
      })
    ).rejects.toThrow("Lark-platform app secret ciphertext is invalid");
  });

  it("keeps the existing Slack ciphertext contract after extracting reuse", async () => {
    const encryptedBotToken = await encryptSlackBotToken({
      botToken: "xoxb-existing-contract",
      cryptoKey: CRYPTO_KEY,
    });

    expect(encryptedBotToken).toMatch(CIPHERTEXT_PATTERN);
    await expect(
      decryptSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        encryptedBotToken,
      })
    ).resolves.toBe("xoxb-existing-contract");
  });
});
