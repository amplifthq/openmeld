import { SPACE_PASSWORD_MIN_LENGTH } from "@openmeld/schemas";

const SPACE_PASSWORD_PROOF_VERSION = 1 as const;
const SPACE_PASSWORD_PROOF_ALGORITHM = "pbkdf2-sha256" as const;
const SPACE_PASSWORD_PROOF_HASH = "SHA-256" as const;
const SPACE_PASSWORD_PROOF_ITERATIONS = 100_000;
const SPACE_PASSWORD_PROOF_SALT_BYTES = 16;
const SPACE_PASSWORD_PROOF_HASH_BYTES = 32;
const SPACE_PASSWORD_PROOF_HASH_BITS = SPACE_PASSWORD_PROOF_HASH_BYTES * 8;

const SPACE_PASSWORD_TOO_SHORT_ERROR_CODE = "space.password_too_short" as const;
const SPACE_PASSWORD_PROOF_INVALID_ERROR_CODE =
  "space.password_proof_invalid" as const;

const PROOF_KEYS = ["v", "alg", "iter", "salt", "hash"] as const;
const BASE64_PADDING = "=";
const BASE64_PAD_MOD = 4;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const textEncoder = new TextEncoder();

type MinimalWebCrypto = {
  subtle?: {
    importKey(
      format: "raw",
      keyData: Uint8Array,
      algorithm: { name: "PBKDF2" },
      extractable: boolean,
      keyUsages: ["deriveBits"]
    ): Promise<unknown>;
    deriveBits(
      algorithm: {
        name: "PBKDF2";
        hash: typeof SPACE_PASSWORD_PROOF_HASH;
        salt: Uint8Array;
        iterations: number;
      },
      baseKey: unknown,
      length: number
    ): Promise<ArrayBuffer>;
  };
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

export type SpacePasswordProof = {
  v: typeof SPACE_PASSWORD_PROOF_VERSION;
  alg: typeof SPACE_PASSWORD_PROOF_ALGORITHM;
  iter: number;
  salt: string;
  hash: string;
};

type SpacePasswordProofErrorCode =
  | typeof SPACE_PASSWORD_TOO_SHORT_ERROR_CODE
  | typeof SPACE_PASSWORD_PROOF_INVALID_ERROR_CODE;

export class SpacePasswordProofError extends Error {
  readonly code: SpacePasswordProofErrorCode;

  constructor(code: SpacePasswordProofErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export async function buildSpacePasswordProof(
  password: string
): Promise<SpacePasswordProof> {
  if (typeof password !== "string") {
    throw createPasswordProofInvalidError("password must be a string");
  }
  if (password.length < SPACE_PASSWORD_MIN_LENGTH) {
    throw createPasswordTooShortError();
  }

  const saltBytes = getRandomBytes(SPACE_PASSWORD_PROOF_SALT_BYTES);
  const hashBytes = await derivePasswordHash({
    password,
    salt: saltBytes,
    iterations: SPACE_PASSWORD_PROOF_ITERATIONS,
  });

  return {
    v: SPACE_PASSWORD_PROOF_VERSION,
    alg: SPACE_PASSWORD_PROOF_ALGORITHM,
    iter: SPACE_PASSWORD_PROOF_ITERATIONS,
    salt: encodeBase64Url(saltBytes),
    hash: encodeBase64Url(hashBytes),
  };
}

export async function verifySpacePasswordProof(
  password: string,
  proof: SpacePasswordProof
): Promise<boolean> {
  if (typeof password !== "string") {
    return false;
  }

  const normalizedProof = parseSpacePasswordProofObject(proof);
  const expectedHashBytes = decodeBase64Url(
    normalizedProof.hash,
    SPACE_PASSWORD_PROOF_HASH_BYTES
  );
  const saltBytes = decodeBase64Url(
    normalizedProof.salt,
    SPACE_PASSWORD_PROOF_SALT_BYTES
  );
  const computedHashBytes = await derivePasswordHash({
    password,
    salt: saltBytes,
    iterations: normalizedProof.iter,
  });

  return constantTimeEquals(expectedHashBytes, computedHashBytes);
}

export function parseSpacePasswordProofJson(raw: string): SpacePasswordProof {
  if (typeof raw !== "string") {
    throw createPasswordProofInvalidError("password proof json must be string");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createPasswordProofInvalidError("password proof json is invalid");
  }

  return parseSpacePasswordProofObject(parsed);
}

function parseSpacePasswordProofObject(value: unknown): SpacePasswordProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createPasswordProofInvalidError("password proof must be object");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== PROOF_KEYS.length) {
    throw createPasswordProofInvalidError("password proof keys mismatch");
  }
  for (const key of PROOF_KEYS) {
    if (!Object.hasOwn(record, key)) {
      throw createPasswordProofInvalidError(`password proof missing ${key}`);
    }
  }

  const version = record.v;
  if (version !== SPACE_PASSWORD_PROOF_VERSION) {
    throw createPasswordProofInvalidError("password proof version invalid");
  }

  const algorithm = record.alg;
  if (algorithm !== SPACE_PASSWORD_PROOF_ALGORITHM) {
    throw createPasswordProofInvalidError("password proof algorithm invalid");
  }

  const iter = record.iter;
  if (
    typeof iter !== "number" ||
    !Number.isInteger(iter) ||
    iter <= 0 ||
    iter > 1_000_000
  ) {
    throw createPasswordProofInvalidError("password proof iteration invalid");
  }

  const salt = record.salt;
  const hash = record.hash;
  if (typeof salt !== "string" || typeof hash !== "string") {
    throw createPasswordProofInvalidError("password proof data invalid");
  }

  decodeBase64Url(salt, SPACE_PASSWORD_PROOF_SALT_BYTES);
  decodeBase64Url(hash, SPACE_PASSWORD_PROOF_HASH_BYTES);

  return {
    v: SPACE_PASSWORD_PROOF_VERSION,
    alg: SPACE_PASSWORD_PROOF_ALGORITHM,
    iter,
    salt,
    hash,
  };
}

async function derivePasswordHash(input: {
  password: string;
  salt: Uint8Array;
  iterations: number;
}): Promise<Uint8Array> {
  const subtle = getWebCrypto().subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle API is unavailable");
  }

  const passwordKey = await subtle.importKey(
    "raw",
    textEncoder.encode(input.password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: SPACE_PASSWORD_PROOF_HASH,
      salt: input.salt,
      iterations: input.iterations,
    },
    passwordKey,
    SPACE_PASSWORD_PROOF_HASH_BITS
  );

  return new Uint8Array(bits);
}

function getRandomBytes(length: number): Uint8Array {
  const webCrypto = getWebCrypto();
  const bytes = new Uint8Array(length);
  webCrypto.getRandomValues(bytes);
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  const base64 = encodeBase64(bytes);
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string, expectedLength: number): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw createPasswordProofInvalidError("password proof data malformed");
  }

  const padSize = value.length % BASE64_PAD_MOD;
  const normalized =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    (padSize === 0 ? "" : BASE64_PADDING.repeat(BASE64_PAD_MOD - padSize));
  const bytes = decodeBase64(normalized);
  if (bytes.length !== expectedLength) {
    throw createPasswordProofInvalidError("password proof data length invalid");
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") {
    throw new Error("base64 encoder is unavailable");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob !== "function") {
    throw new Error("base64 decoder is unavailable");
  }

  let binary = "";
  try {
    binary = atob(value);
  } catch {
    throw createPasswordProofInvalidError("password proof data malformed");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let index = 0; index < maxLength; index += 1) {
    diff += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return diff === 0;
}

function createPasswordTooShortError(): SpacePasswordProofError {
  return new SpacePasswordProofError(
    SPACE_PASSWORD_TOO_SHORT_ERROR_CODE,
    `password length must be at least ${SPACE_PASSWORD_MIN_LENGTH}`
  );
}

function createPasswordProofInvalidError(
  message: string
): SpacePasswordProofError {
  return new SpacePasswordProofError(
    SPACE_PASSWORD_PROOF_INVALID_ERROR_CODE,
    message
  );
}

function getWebCrypto(): MinimalWebCrypto {
  const webCrypto = (globalThis as { crypto?: MinimalWebCrypto }).crypto;
  if (!webCrypto) {
    throw new Error("WebCrypto API is unavailable");
  }
  return webCrypto;
}
