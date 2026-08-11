export const SLACK_IDENTITY_LINK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PREFIX = "slacklink_";

export function createSlackIdentityLinkToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

export async function digestSlackIdentityLinkToken(
  token: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}
