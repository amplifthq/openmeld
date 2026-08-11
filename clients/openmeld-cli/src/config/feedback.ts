/**
 * The official OpenMeld Feedback Inbox key is publishable, not a credential.
 * Rotate it by updating this release default; --inbox-key and
 * OPENMELD_FEEDBACK_INBOX_KEY can switch callers immediately during rollout.
 */
export const OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY =
  "feedback_key_8oDRg9Aq-Q4crzVGV6hUqhKT2dQpKkBn4bKg9bjXLcE";

export function resolveFeedbackInboxKey(input: {
  cliValue?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const fromCli = normalizeOptionalString(input.cliValue);
  if (fromCli) {
    return fromCli;
  }

  const fromEnv = normalizeOptionalString(
    (input.env ?? process.env).OPENMELD_FEEDBACK_INBOX_KEY
  );
  return fromEnv ?? OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
