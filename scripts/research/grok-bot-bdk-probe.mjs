import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const IDENTIFIER = /^[A-Za-z0-9_-]{1,256}$/u;
const CURSOR = /^(?:-1|\d{1,32})$/u;

/** Read-only protocol research. This is not a production runtime adapter. */
export async function probeGrokBotSession({
  apiKey,
  sessionId,
  afterUpdatedSeq,
  fetchImpl = fetch,
}) {
  if (!(typeof apiKey === "string" && apiKey.trim())) {
    throw new Error("A BDK API key is required.");
  }
  if (!IDENTIFIER.test(sessionId ?? "")) {
    throw new Error("An existing Grok Bot session ID is required.");
  }
  if (!CURSOR.test(afterUpdatedSeq ?? "")) {
    throw new Error("An explicit transcript cursor is required.");
  }
  let response;
  try {
    response = await fetchImpl(
      `https://api.cursor.com/v0/grokbot/sessions/${sessionId}/entries?afterUpdatedSeq=${afterUpdatedSeq}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "x-cursor-client-type": "agent-serve",
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      }
    );
  } catch {
    throw new Error(
      "Grok Bot protocol probe could not reach the official API."
    );
  }
  if (!response.ok) {
    // Never echo an upstream error body: it may include private account data.
    throw new Error(
      `Grok Bot protocol probe failed (HTTP ${response.status}).`
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Grok Bot returned an invalid JSON response.");
  }
  if (
    !(
      data &&
      Array.isArray(data.entries) &&
      data.entries.every(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry)
      )
    ) ||
    typeof data.latestUpdatedSeq !== "string" ||
    !CURSOR.test(data.latestUpdatedSeq) ||
    typeof data.turn?.idle !== "boolean" ||
    typeof data.turn?.inFlight !== "boolean" ||
    !Number.isSafeInteger(data.turn?.queued) ||
    data.turn.queued < 0
  ) {
    throw new Error("Grok Bot returned an unrecognized session response.");
  }
  return {
    responseFields: Object.keys(data).sort(),
    turnFields: Object.keys(data.turn).sort(),
    turn: {
      idle: data.turn.idle,
      inFlight: data.turn.inFlight,
      queued: data.turn.queued,
    },
    entryFields: [...new Set(data.entries.flatMap(Object.keys))].sort(),
    entryCount: data.entries.length,
    latestUpdatedSeq: data.latestUpdatedSeq,
    // A successful read is deliberately not projected as Agent readiness.
    purpose: "protocol_observation_only",
  };
}

async function main() {
  const [sessionId, afterUpdatedSeq] = process.argv.slice(2);
  const keyFile = process.env.GROK_BOT_BDK_CREDENTIALS_FILE;
  if (!keyFile) {
    throw new Error(
      "Set GROK_BOT_BDK_CREDENTIALS_FILE to the credentials.json produced by bdk login."
    );
  }
  let credential;
  try {
    credential = JSON.parse(await readFile(keyFile, "utf8"));
  } catch {
    throw new Error(
      "The explicitly selected BDK credential file is unreadable."
    );
  }
  // Match BDK's default login backend; never send another backend's key here.
  if (credential?.backendUrl !== "https://api2.cursor.sh") {
    throw new Error("The selected BDK credential belongs to another backend.");
  }
  const evidence = await probeGrokBotSession({
    apiKey: credential.apiKey,
    sessionId,
    afterUpdatedSeq,
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
