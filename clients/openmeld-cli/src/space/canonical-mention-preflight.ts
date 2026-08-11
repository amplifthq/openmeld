import { toStructuredApiClientFailure } from "@openmeld/api-client";

export function rethrowCanonicalMentionSnapshotLoadFailure(
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
  const prefix =
    "Cannot validate mention targets right now because current space members could not be loaded.";
  const plainTextHint =
    "If you meant to send @Name(wake) or @Name(reference) as literal text, rerun with --plain.";
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
