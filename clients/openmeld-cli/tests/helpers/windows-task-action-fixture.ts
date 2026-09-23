const ENCODED_COMMAND = /-EncodedCommand ([A-Za-z0-9+/=]+)$/u;
const ENCODED_DATA = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/u;

// Inspect emitted protocol data, never production source text. Replacing the
// JSON models the persisted spread payload captured from CLI 0.3.211/0.3.219.
export function readTaskActionPayload(argumentsText: string): unknown {
  const script = decodeScript(argumentsText);
  const data = script.match(ENCODED_DATA)?.[1];
  if (!data) {
    throw new Error("Fixture action has no encoded payload.");
  }
  return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
}

export function withStoredTaskActionPayload(
  argumentsText: string,
  payload: unknown
): string {
  const script = decodeScript(argumentsText);
  if (!ENCODED_DATA.test(script)) {
    throw new Error("Fixture action has no encoded payload.");
  }
  const data = Buffer.from(JSON.stringify(payload)).toString("base64");
  const replacement = script.replace(
    ENCODED_DATA,
    `FromBase64String('${data}')`
  );
  return argumentsText.replace(
    ENCODED_COMMAND,
    `-EncodedCommand ${Buffer.from(replacement, "utf16le").toString("base64")}`
  );
}

function decodeScript(argumentsText: string): string {
  const encoded = argumentsText.match(ENCODED_COMMAND)?.[1];
  if (!encoded) {
    throw new Error("Fixture action has no encoded command.");
  }
  return Buffer.from(encoded, "base64").toString("utf16le");
}
