import { buildOutboxReadLedgerStatusFailedFinding } from "../../../dispatch/rules/dispatch-health-invariant-policy";

const JSON_SPACE_PASSWORD_FIELD_PATTERN =
  /("x-openmeld-space-password"\s*:\s*")[^"]*(")/gi;
const TEXT_SPACE_PASSWORD_FIELD_PATTERN =
  /(x-openmeld-space-password\s*[:=]\s*)[^\s,;]+/gi;

export function toRedactedSpaceErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error ? error.stack || error.message : String(error);
  return rawMessage
    .replace(JSON_SPACE_PASSWORD_FIELD_PATTERN, "$1<redacted>$2")
    .replace(TEXT_SPACE_PASSWORD_FIELD_PATTERN, "$1<redacted>");
}

export function buildReadLedgerStatusFailedHealthReport(input: {
  error: unknown;
  idempotencyKey: string;
  spaceId: string;
  spaceName: string | null;
}) {
  const errorMessage = toRedactedSpaceErrorMessage(input.error);

  return {
    eventName:
      "[core.openmeld.space.outbox.read_ledger_status_failed]" as const,
    fields: {
      error: errorMessage,
      idempotencyKey: input.idempotencyKey,
      spaceId: input.spaceId,
      spaceName: input.spaceName,
    },
    finding: buildOutboxReadLedgerStatusFailedFinding({
      humanContext: {
        error: errorMessage,
        idempotencyKey: input.idempotencyKey,
        spaceId: input.spaceId,
        spaceName: input.spaceName,
      },
    }),
  };
}
