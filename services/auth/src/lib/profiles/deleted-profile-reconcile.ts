import type { AuthBindings } from "../bindings";

type DeletedProfileLike = {
  profileId: string;
  profileKind: string;
  ownerUserId: string;
};

// Server-side fan-out for profile deletion (agent and human kinds). Every delete entry point
// (HTTP route, RPC entrypoint) calls this after a successful delete so web
// and CLI deletions converge on identical consequences: leave joined Spaces,
// disable the primary Binding. Core resolves the affected Spaces itself from
// the space-index membership projection (the auth-owned join history does not
// cover owner-added members). Failures only warn — the Space membership
// liveness reconcile catches stragglers later.
export async function reconcileDeletedAgentProfileMemberships(
  env: AuthBindings,
  profile: DeletedProfileLike
): Promise<void> {
  if (profile.profileKind !== "agent" && profile.profileKind !== "human") {
    return;
  }
  const coreWorker = env.OPENMELD_CORE_WORKER;
  if (!coreWorker) {
    console.warn("[auth.profile.deleted_reconcile_skipped]", {
      event: "auth.profile.deleted_reconcile_skipped",
      profileId: profile.profileId,
      reason: "openmeld_core_worker_unbound",
    });
    return;
  }

  try {
    const response = await coreWorker.reconcileDeletedAgentProfile({
      ownerUserId: profile.ownerUserId,
      profileId: profile.profileId,
      profileKind: profile.profileKind,
      spaceIds: [],
    });
    console.info("[auth.profile.deleted_reconciled]", {
      event: "auth.profile.deleted_reconciled",
      bindingDisabled: response.bindingDisabled,
      profileId: profile.profileId,
      removedCount: response.spaces.filter(
        (space) => space.status === "removed"
      ).length,
      spaceCount: response.spaces.length,
    });
  } catch (error) {
    console.warn("[auth.profile.deleted_reconcile_failed]", {
      event: "auth.profile.deleted_reconcile_failed",
      error: error instanceof Error ? error.message : String(error),
      profileId: profile.profileId,
    });
  }
}
