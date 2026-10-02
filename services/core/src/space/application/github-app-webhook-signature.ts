export async function verifyGitHubAppWebhookSignature(input: {
  rawBody: string;
  secret?: string;
  signature256?: string | null;
}): Promise<boolean> {
  const secret = input.secret?.trim() ?? "";
  const signature = input.signature256?.trim() ?? "";
  if (!(secret && signature.startsWith("sha256="))) {
    return false;
  }
  const expected = `sha256=${await signHmacSha256Hex({
    message: input.rawBody,
    secret,
  })}`;
  return timingSafeEqual(expected, signature);
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
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
