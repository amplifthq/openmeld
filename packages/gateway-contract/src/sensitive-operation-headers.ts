import { runtimeCoordinatorExecutionTokenEchoSchema } from "@openmeld/schemas";
import type { RuntimeCoordinatorExecutionTokenEcho } from "@openmeld/schemas/types";

/**
 * A task's credential (its RuntimeCoordinator execution token), attached by
 * the CLI when it runs inside a Wake (design-plans/member-agent-program.md
 * §4.7). Core decides sensitive operations by the task's chain root.
 */
export const OPENMELD_HEADER_TASK_CREDENTIAL = "x-openmeld-task-credential";
/**
 * A client-chosen handle for the owner confirmation a sensitive operation may
 * need. The client polls it and repeats the same request once it is approved.
 */
export const OPENMELD_HEADER_CREDENTIAL_CONFIRMATION =
  "x-openmeld-credential-confirmation";

const MAX_TASK_CREDENTIAL_HEADER_LENGTH = 2048;
const CREDENTIAL_CONFIRMATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const BASE64_PADDING_PATTERN = /=+$/u;

export function encodeTaskCredentialHeader(
  echo: RuntimeCoordinatorExecutionTokenEcho
): string {
  const bytes = new TextEncoder().encode(JSON.stringify(echo));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
}

export type TaskCredentialHeaderReadResult =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "present"; taskCredential: RuntimeCoordinatorExecutionTokenEcho };

export function readTaskCredentialHeader(
  headers: Headers
): TaskCredentialHeaderReadResult {
  const raw = headers.get(OPENMELD_HEADER_TASK_CREDENTIAL)?.trim();
  if (!raw) {
    return { status: "absent" };
  }
  if (raw.length > MAX_TASK_CREDENTIAL_HEADER_LENGTH) {
    return { status: "invalid" };
  }
  try {
    const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    const parsed = runtimeCoordinatorExecutionTokenEchoSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes))
    );
    return parsed.success
      ? { status: "present", taskCredential: parsed.data }
      : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

export function readCredentialConfirmationHeader(
  headers: Headers
): string | null {
  const raw = headers.get(OPENMELD_HEADER_CREDENTIAL_CONFIRMATION)?.trim();
  return raw && CREDENTIAL_CONFIRMATION_ID_PATTERN.test(raw) ? raw : null;
}
