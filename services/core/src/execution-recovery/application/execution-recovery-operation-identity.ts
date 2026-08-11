import type { ExecuteExecutionRecoveryBody } from "@openmeld/schemas/types";

export const EXECUTION_RECOVERY_OPERATION_LEASE_MS = 11 * 60_000;

const EXECUTION_RECOVERY_OPERATION_STORAGE_PREFIX =
  "execution_recovery.operation.v1:";
export const EXECUTION_RECOVERY_OPERATION_CLAIM_STORAGE_PREFIX =
  "execution_recovery.claim.v1:";

export async function buildExecutionRecoveryOperationKeys(
  command: ExecuteExecutionRecoveryBody
): Promise<{
  claimStorageKey: string;
  commandJson: string;
  effectOperationId: string;
  operationStorageKey: string;
}> {
  const commandJson = stableExecutionRecoveryJson({
    action: command.action,
    destination: command.destination,
    expectedIdentity: command.expectedIdentity,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(commandJson)
  );
  const claimDigest = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return {
    claimStorageKey: `${EXECUTION_RECOVERY_OPERATION_CLAIM_STORAGE_PREFIX}${claimDigest}`,
    commandJson,
    effectOperationId: `execution-recovery-effect:${claimDigest}`,
    operationStorageKey: `${EXECUTION_RECOVERY_OPERATION_STORAGE_PREFIX}${command.operationId}`,
  };
}

export function buildExecutionRecoveryFreshClientMessageId(
  claimStorageKey: string
): string {
  return `execution-recovery-${claimStorageKey.slice(
    EXECUTION_RECOVERY_OPERATION_CLAIM_STORAGE_PREFIX.length
  )}`;
}

function stableExecutionRecoveryJson(value: unknown): string {
  return JSON.stringify(sortExecutionRecoveryJsonValue(value));
}

function sortExecutionRecoveryJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortExecutionRecoveryJsonValue);
  }
  if (!(value && typeof value === "object")) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [
        key,
        sortExecutionRecoveryJsonValue(nestedValue),
      ])
  );
}
