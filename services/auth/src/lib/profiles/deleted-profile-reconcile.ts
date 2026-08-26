import { reconcileDeletedAgentProfileResponseSchema } from "@openmeld/schemas";
import type { AuthBindings } from "../bindings";
import {
  deleteDeletedProfileReconcileOutboxRecord,
  listDueDeletedProfileReconcileOutbox,
  recordDeletedProfileReconcileFailure,
} from "./deleted-profile-reconcile-outbox";

const DELETED_PROFILE_RECONCILE_DEFAULT_LIMIT = 40;
const DELETED_PROFILE_RECONCILE_MAX_LIMIT = 50;

type DeletedProfileLike = {
  ownerUserId: string;
  profileId: string;
  profileKind: string;
};

type SupportedDeletedProfile = DeletedProfileLike & {
  profileKind: "agent" | "human";
};

export type DeletedProfileReconcileOutboxSummary = {
  completed: number;
  failed: number;
  scanned: number;
};

// Server-side fan-out for Profile deletion (agent and human kinds). The DB
// deletion trigger writes the Auth-owned outbox in the same transaction as the
// Profile delete. This interactive attempt makes the common path immediate;
// the scheduled sweep keeps every incomplete cross-service consequence
// retryable until Core confirms Wake cancellation, Binding cleanup, and Space
// membership reconciliation.
export async function reconcileDeletedAgentProfileMemberships(
  env: AuthBindings,
  profile: DeletedProfileLike
): Promise<void> {
  if (!isSupportedDeletedProfile(profile)) {
    return;
  }
  await attemptDeletedProfileReconcile({ env, profile });
}

export async function runDeletedProfileReconcileOutbox(
  env: AuthBindings,
  options?: { limit?: number; nowMs?: number }
): Promise<DeletedProfileReconcileOutboxSummary> {
  const nowMs = options?.nowMs ?? Date.now();
  const limit = Math.min(
    DELETED_PROFILE_RECONCILE_MAX_LIMIT,
    Math.max(
      1,
      Math.floor(options?.limit ?? DELETED_PROFILE_RECONCILE_DEFAULT_LIMIT)
    )
  );
  let records: Awaited<ReturnType<typeof listDueDeletedProfileReconcileOutbox>>;
  try {
    records = await listDueDeletedProfileReconcileOutbox({
      db: env.OPENMELD_DB,
      limit,
      nowMs,
    });
  } catch (error) {
    console.warn("[auth.profile.deleted_reconcile_outbox_read_failed]", {
      event: "auth.profile.deleted_reconcile_outbox_read_failed",
      error: errorMessage(error),
    });
    return { completed: 0, failed: 0, scanned: 0 };
  }

  let completed = 0;
  for (const record of records) {
    const outcome = await attemptDeletedProfileReconcile({
      attemptCount: record.attemptCount,
      env,
      profile: record,
    });
    if (outcome === "completed") {
      completed += 1;
    }
  }
  const summary = {
    completed,
    failed: records.length - completed,
    scanned: records.length,
  };
  console.info("[auth.profile.deleted_reconcile_outbox_completed]", {
    event: "auth.profile.deleted_reconcile_outbox_completed",
    ...summary,
  });
  return summary;
}

async function attemptDeletedProfileReconcile(input: {
  attemptCount?: number;
  env: AuthBindings;
  profile: SupportedDeletedProfile;
}): Promise<"completed" | "failed"> {
  const { env, profile } = input;
  const coreWorker = env.OPENMELD_CORE_WORKER;
  if (!coreWorker) {
    const reason = "openmeld_core_worker_unbound";
    console.warn("[auth.profile.deleted_reconcile_skipped]", {
      event: "auth.profile.deleted_reconcile_skipped",
      profileId: profile.profileId,
      reason,
    });
    await recordRetrySafely({
      attemptCount: input.attemptCount,
      env,
      error: reason,
      profileId: profile.profileId,
    });
    return "failed";
  }

  try {
    const rawResponse = await coreWorker.reconcileDeletedAgentProfile({
      ownerUserId: profile.ownerUserId,
      profileId: profile.profileId,
      profileKind: profile.profileKind,
      spaceIds: [],
    });
    const parsedResponse =
      reconcileDeletedAgentProfileResponseSchema.safeParse(rawResponse);
    if (!parsedResponse.success) {
      throw new Error("core_reconcile_invalid_response");
    }
    const response = parsedResponse.data;
    if (response.profileId !== profile.profileId) {
      throw new Error("core_reconcile_identity_mismatch");
    }
    if (response.complete !== true) {
      throw new Error("core_reconcile_incomplete");
    }

    await deleteDeletedProfileReconcileOutboxRecord({
      db: env.OPENMELD_DB,
      profileId: profile.profileId,
    });
    console.info("[auth.profile.deleted_reconciled]", {
      event: "auth.profile.deleted_reconciled",
      bindingDisabled: response.bindingDisabled,
      complete: true,
      profileId: profile.profileId,
      removedCount: response.spaces.filter(
        (space) => space.status === "removed"
      ).length,
      spaceCount: response.spaces.length,
    });
    return "completed";
  } catch (error) {
    const message = errorMessage(error);
    console.warn("[auth.profile.deleted_reconcile_failed]", {
      event: "auth.profile.deleted_reconcile_failed",
      error: message,
      profileId: profile.profileId,
    });
    await recordRetrySafely({
      attemptCount: input.attemptCount,
      env,
      error: message,
      profileId: profile.profileId,
    });
    return "failed";
  }
}

async function recordRetrySafely(input: {
  attemptCount?: number;
  env: AuthBindings;
  error: string;
  profileId: string;
}): Promise<void> {
  try {
    await recordDeletedProfileReconcileFailure({
      ...(input.attemptCount === undefined
        ? {}
        : { attemptCount: input.attemptCount }),
      db: input.env.OPENMELD_DB,
      error: input.error,
      nowMs: Date.now(),
      profileId: input.profileId,
    });
  } catch (error) {
    console.warn("[auth.profile.deleted_reconcile_retry_record_failed]", {
      event: "auth.profile.deleted_reconcile_retry_record_failed",
      error: errorMessage(error),
      profileId: input.profileId,
    });
  }
}

function isSupportedDeletedProfile(
  profile: DeletedProfileLike
): profile is SupportedDeletedProfile {
  return profile.profileKind === "agent" || profile.profileKind === "human";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
