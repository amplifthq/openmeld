import { toStructuredApiClientFailure } from "@openmeld/api-client";

export function rethrowSpaceAddressingSnapshotLoadFailure(
  error: unknown
): never {
  const failure = toStructuredApiClientFailure(error);
  if (failure.code || failure.status !== null) {
    throw error;
  }

  throw new Error(buildMembersSnapshotLoadFailureMessage(error), {
    cause: error,
  });
}

function buildMembersSnapshotLoadFailureMessage(error: unknown): string {
  const prefix = "OpenMeld couldn't validate the selected recipients.";
  const plainTextHint =
    "Retry when Space members are available. To send without recipients, remove the recipient options.";
  const failure = toStructuredApiClientFailure(error);
  const details: string[] = [];

  if (failure.message.trim().length > 0) {
    details.push(failure.message.trim());
  }
  if (failure.code) {
    details.push(`code: ${failure.code}`);
  }
  if (failure.requestId) {
    details.push(`request ID: ${failure.requestId}`);
  }
  if (failure.status !== null) {
    details.push(`status: ${String(failure.status)}`);
  }

  return details.length === 0
    ? `${prefix} ${plainTextHint}`
    : `${prefix} ${plainTextHint} Details: ${details.join("; ")}`;
}
