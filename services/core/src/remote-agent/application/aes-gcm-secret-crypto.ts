const AES_GCM_ALGORITHM = "AES-GCM";
const AES_GCM_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const CIPHERTEXT_PREFIX = "aesgcm:v1";
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const BASE64_PADDING_PATTERN = /=+$/u;

export async function encryptAesGcmSecret(input: {
  cryptoKey: string;
  cryptoKeyName: string;
  secret: string;
  secretName: string;
}): Promise<string> {
  const secret = input.secret.trim();
  if (!secret) {
    throw new Error(`${input.secretName} is required`);
  }
  const key = await importAesGcmKey({
    cryptoKey: input.cryptoKey,
    cryptoKeyName: input.cryptoKeyName,
    usages: ["encrypt"],
  });
  const iv = new Uint8Array(new ArrayBuffer(AES_GCM_IV_BYTES));
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { iv: iv.buffer, name: AES_GCM_ALGORITHM },
    key,
    toArrayBuffer(new TextEncoder().encode(secret))
  );
  return `${CIPHERTEXT_PREFIX}:${encodeBase64Url(iv)}:${encodeBase64Url(
    new Uint8Array(ciphertext)
  )}`;
}

export async function decryptAesGcmSecret(input: {
  cryptoKey: string;
  cryptoKeyName: string;
  encryptedSecret: string;
  secretName: string;
}): Promise<string> {
  const [algorithm, version, encodedIv, encodedCiphertext, ...extra] =
    input.encryptedSecret.split(":");
  if (
    algorithm !== "aesgcm" ||
    version !== "v1" ||
    !encodedIv ||
    !encodedCiphertext ||
    extra.length > 0
  ) {
    throw new Error(`${input.secretName} ciphertext is invalid`);
  }
  const iv = decodeBase64Url(encodedIv, input.secretName);
  const ciphertext = decodeBase64Url(encodedCiphertext, input.secretName);
  if (iv.length !== AES_GCM_IV_BYTES || ciphertext.length === 0) {
    throw new Error(`${input.secretName} ciphertext is invalid`);
  }
  const key = await importAesGcmKey({
    cryptoKey: input.cryptoKey,
    cryptoKeyName: input.cryptoKeyName,
    usages: ["decrypt"],
  });
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { iv: toArrayBuffer(iv), name: AES_GCM_ALGORITHM },
      key,
      toArrayBuffer(ciphertext)
    );
  } catch {
    throw new Error(`${input.secretName} decryption failed`);
  }
  const secret = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: false,
  })
    .decode(plaintext)
    .trim();
  if (!secret) {
    throw new Error(`${input.secretName} decryption produced an empty value`);
  }
  return secret;
}

async function importAesGcmKey(input: {
  cryptoKey: string;
  cryptoKeyName: string;
  usages: ("decrypt" | "encrypt")[];
}): Promise<CryptoKey> {
  const keyBytes = decodeBase64Key(input);
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: AES_GCM_ALGORITHM },
    false,
    input.usages
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function decodeBase64Key(input: {
  cryptoKey: string;
  cryptoKeyName: string;
}): Uint8Array {
  const normalized = input.cryptoKey.trim();
  if (!BASE64_PATTERN.test(normalized)) {
    throw new Error(`${input.cryptoKeyName} must be base64-encoded`);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(normalized), (character) =>
      character.charCodeAt(0)
    );
  } catch {
    throw new Error(`${input.cryptoKeyName} must be base64-encoded`);
  }
  if (bytes.length !== AES_GCM_KEY_BYTES) {
    throw new Error(`${input.cryptoKeyName} must decode to exactly 32 bytes`);
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
}

function decodeBase64Url(value: string, secretName: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error(`${secretName} ciphertext is invalid`);
  }
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0)
    );
  } catch {
    throw new Error(`${secretName} ciphertext is invalid`);
  }
}
