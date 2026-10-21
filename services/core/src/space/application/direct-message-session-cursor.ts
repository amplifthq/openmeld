/** URL-safe base64 JSON cursors shared by the Direct Message Session lists. */
export function encodeDirectMessageSessionCursor(value: unknown): string {
  return btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Returns the decoded JSON value; the caller validates it with its schema. */
export function decodeDirectMessageSessionCursor(cursor: string): unknown {
  const bytes = Uint8Array.from(
    atob(cursor.replace(/-/g, "+").replace(/_/g, "/")),
    (character) => character.charCodeAt(0)
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}
