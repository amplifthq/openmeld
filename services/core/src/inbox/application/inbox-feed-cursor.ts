import { InboxServiceError } from "./inbox-service";

const ENCODED_KEY_PATTERN = /^[A-Za-z0-9_-]+$/u;

export type InboxFeedCursor = {
  snapshotId: string;
  rank: number;
  occurredAtMs: number;
  key: string;
  expandedGroup: string | null;
};

export function encodeInboxFeedKey(value: string): string {
  return btoa(
    Array.from(new TextEncoder().encode(value), (byte) =>
      String.fromCharCode(byte)
    ).join("")
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeInboxFeedKey(value: string): string {
  if (!ENCODED_KEY_PATTERN.test(value) || value.length > 8192) {
    throw invalidInboxFeedCursor();
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Uint8Array.from(
        atob(value.replaceAll("-", "+").replaceAll("_", "/")),
        (character) => character.charCodeAt(0)
      )
    );
  } catch {
    throw invalidInboxFeedCursor();
  }
}

export function decodeInboxFeedCursor(value?: string): InboxFeedCursor | null {
  if (!value) {
    return null;
  }
  try {
    const row: unknown = JSON.parse(decodeInboxFeedKey(value));
    if (
      !Array.isArray(row) ||
      row.length !== 5 ||
      typeof row[0] !== "string" ||
      row[0].length > 256 ||
      !Number.isInteger(row[1]) ||
      row[1] < 0 ||
      row[1] > 2 ||
      !Number.isSafeInteger(row[2]) ||
      row[2] < 0 ||
      typeof row[3] !== "string" ||
      row[3].length > 4096 ||
      !(row[4] === null || typeof row[4] === "string")
    ) {
      throw invalidInboxFeedCursor();
    }
    return {
      snapshotId: row[0],
      rank: row[1],
      occurredAtMs: row[2],
      key: row[3],
      expandedGroup: row[4],
    };
  } catch {
    throw invalidInboxFeedCursor();
  }
}

export function encodeInboxFeedCursor(cursor: InboxFeedCursor): string {
  return encodeInboxFeedKey(
    JSON.stringify([
      cursor.snapshotId,
      cursor.rank,
      cursor.occurredAtMs,
      cursor.key,
      cursor.expandedGroup,
    ])
  );
}

export function invalidInboxFeedCursor(): InboxServiceError {
  return new InboxServiceError({
    code: "inbox.cursor_invalid",
    status: 400,
    message: "This Inbox page does not match its filters. Refresh the list.",
  });
}
