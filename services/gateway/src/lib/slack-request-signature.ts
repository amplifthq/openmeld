const SLACK_SIGNATURE_VERSION = "v0";
const SLACK_REQUEST_MAX_AGE_SECONDS = 60 * 5;

export async function verifySlackRequestSignature(input: {
  body: string;
  nowSeconds: number;
  signature?: string;
  signingSecret?: string;
  timestamp?: string;
}): Promise<boolean> {
  const signingSecret = normalizeOptionalText(input.signingSecret);
  const timestampSeconds = Number(input.timestamp);
  if (
    !(signingSecret && input.signature && Number.isInteger(timestampSeconds))
  ) {
    return false;
  }
  if (
    Math.abs(input.nowSeconds - timestampSeconds) >
    SLACK_REQUEST_MAX_AGE_SECONDS
  ) {
    return false;
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestampSeconds}:${input.body}`;
  const expectedSignature = `${SLACK_SIGNATURE_VERSION}=${await signHmacSha256Hex(
    {
      message: baseString,
      secret: signingSecret,
    }
  )}`;
  return timingSafeEqual(expectedSignature, input.signature);
}

async function signHmacSha256Hex(input: {
  message: string;
  secret: string;
}): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(input.message)
  );
  return bytesToHex(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let differenceCount = leftBytes.length === rightBytes.length ? 0 : 1;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < maxLength; index += 1) {
    if ((leftBytes[index] ?? 0) !== (rightBytes[index] ?? 0)) {
      differenceCount += 1;
    }
  }
  return differenceCount === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
