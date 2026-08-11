const MESSAGE_CHANNEL_IDENTITY_LINK_TOKEN_PREFIX = "messagechannellink_";
const MESSAGE_CHANNEL_IDENTITY_LINK_TOKEN_BYTES = 32;

export const MESSAGE_CHANNEL_IDENTITY_LINK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function createMessageChannelIdentityLinkToken(): string {
  const bytes = new Uint8Array(MESSAGE_CHANNEL_IDENTITY_LINK_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return `${MESSAGE_CHANNEL_IDENTITY_LINK_TOKEN_PREFIX}${Array.from(
    bytes,
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

export async function digestMessageChannelIdentityLinkToken(
  token: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function buildMessageChannelIdentityLinkUrl(input: {
  token: string;
  webAppUrl: string;
}): string {
  const url = new URL("/link-message-channel", input.webAppUrl);
  url.searchParams.set("token", input.token);
  return url.toString();
}
