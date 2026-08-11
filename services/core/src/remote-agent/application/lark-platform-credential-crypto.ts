import {
  decryptAesGcmSecret,
  encryptAesGcmSecret,
} from "./aes-gcm-secret-crypto";

export const LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION = 1;

const LARK_PLATFORM_CRYPTO_KEY_NAME =
  "LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY";

export async function encryptLarkPlatformCredential(input: {
  credential: string;
  credentialName: string;
  cryptoKey: string;
}): Promise<string> {
  return await encryptAesGcmSecret({
    cryptoKey: input.cryptoKey,
    cryptoKeyName: LARK_PLATFORM_CRYPTO_KEY_NAME,
    secret: input.credential,
    secretName: buildCredentialName(input.credentialName),
  });
}

export async function decryptLarkPlatformCredential(input: {
  credentialName: string;
  cryptoKey: string;
  encryptedCredential: string;
}): Promise<string> {
  return await decryptAesGcmSecret({
    cryptoKey: input.cryptoKey,
    cryptoKeyName: LARK_PLATFORM_CRYPTO_KEY_NAME,
    encryptedSecret: input.encryptedCredential,
    secretName: buildCredentialName(input.credentialName),
  });
}

function buildCredentialName(credentialName: string): string {
  const normalized = credentialName.trim();
  if (!normalized) {
    throw new Error("Lark-platform credential name is required");
  }
  return `Lark-platform ${normalized}`;
}
