export async function digestCanonicalJson(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stringifyCanonicalJson(value))
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function stringifyCanonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalizeJsonValue(value));
  if (serialized === undefined) {
    throw new TypeError("Value must be JSON-serializable.");
  }
  return serialized;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([leftKey], [rightKey]) =>
          compareCanonicalJsonKeys(leftKey, rightKey)
        )
        .map(([key, entry]) => [key, canonicalizeJsonValue(entry)])
    );
  }
  throw new TypeError("Value must be JSON-serializable.");
}

function compareCanonicalJsonKeys(leftKey: string, rightKey: string): number {
  if (leftKey < rightKey) {
    return -1;
  }
  if (leftKey > rightKey) {
    return 1;
  }
  return 0;
}
