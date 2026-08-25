const OPENMELD_MESSAGE_CHANNEL_PUBLICATION_NAMESPACE =
  "9f8f4bd2-07a8-5f42-a205-6f3820af9965";
const COMPACT_UUID_PATTERN = /^[0-9a-f]{32}$/u;

export async function buildMessageChannelProviderPublicationUuid(input: {
  deliveryId: string;
  provider: "feishu" | "lark";
  publicationKind:
    | "final"
    | "identity_link"
    | "private_navigation"
    | "working"
    | `rollover:${number}:create`
    | `rollover:${number}:finalize:${number}`
    | `rollover:${number}:send`
    | `stream:${number}`
    | `work-loop:${number}:stream:${number}`;
}): Promise<string> {
  const name = [input.provider, input.deliveryId, input.publicationKind].join(
    "\u001f"
  );
  const namespaceBytes = parseUuid(
    OPENMELD_MESSAGE_CHANNEL_PUBLICATION_NAMESPACE
  );
  const nameBytes = new TextEncoder().encode(name);
  const digestInput = new Uint8Array(
    namespaceBytes.byteLength + nameBytes.byteLength
  );
  digestInput.set(namespaceBytes);
  digestInput.set(nameBytes, namespaceBytes.byteLength);

  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-1", digestInput)
  ).slice(0, 16);
  // biome-ignore lint/suspicious/noBitwiseOperators: RFC 4122 version and variant bits are a byte-level protocol requirement.
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  // biome-ignore lint/suspicious/noBitwiseOperators: RFC 4122 version and variant bits are a byte-level protocol requirement.
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(digest);
}

function parseUuid(value: string): Uint8Array {
  const compact = value.replaceAll("-", "");
  if (!COMPACT_UUID_PATTERN.test(compact)) {
    throw new Error("Message Channel publication namespace is not a UUID");
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
    bytes[index] = byte;
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  if (bytes.byteLength !== 16) {
    throw new Error("Message Channel provider UUID requires exactly 16 bytes");
  }
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
