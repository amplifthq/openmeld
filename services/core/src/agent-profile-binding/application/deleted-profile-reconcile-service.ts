import {
  RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES,
  reconcileDeletedAgentProfileRequestSchema,
} from "@openmeld/schemas";
import type {
  ReconcileDeletedAgentProfileRequest,
  ReconcileDeletedAgentProfileResponse,
  ReconcileDeletedAgentProfileSpaceOutcome,
} from "@openmeld/schemas/types";
import {
  cancelRuntimeTransportDeletedAgentProfileWakes,
  notifyRuntimeTransportRouteCatalogChanged,
} from "../../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import {
  type CoreBindings,
  localStateDb,
  projectionsDb,
} from "../../lib/bindings";
import { resolveSpaceStub } from "../../rpc/space-ref";
import { listActiveSpaceIdsForProfileFromSpaceIndex } from "../../space-index/space-index-repository";
import { disablePrimaryAgentProfileBindingRecord } from "../infrastructure/d1/agent-profile-binding-repo";

// Server-side consequence of deleting an agent profile: every client entry
// point (web, CLI, future surfaces) converges on the auth DELETE, and auth
// fans out here exactly once. Per-space failures degrade to "failed" and are
// caught up later by the Space membership liveness reconcile.
export async function reconcileDeletedAgentProfile(
  env: CoreBindings,
  input: ReconcileDeletedAgentProfileRequest
): Promise<ReconcileDeletedAgentProfileResponse> {
  const parsed = reconcileDeletedAgentProfileRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `invalid deleted agent profile reconcile request: ${parsed.error.message}`
    );
  }
  const { ownerUserId, profileId } = parsed.data;
  const profileKind = parsed.data.profileKind ?? "agent";
  const wakeCancellationConfirmed = await resolveDeletedProfileWakeCancellation(
    {
      env,
      ownerUserId,
      profileId,
      profileKind,
    }
  );
  const bindingCleanup =
    profileKind === "agent"
      ? await disableDeletedAgentProfileBinding({
          env,
          ownerUserId,
          profileId,
        })
      : { bindingDisabled: false, bindingReconciled: true };
  const spaceDiscovery = await resolveDeletedProfileSpaceIds({
    env,
    profileId,
    requestedSpaceIds: parsed.data.spaceIds,
  });
  const spaces = await reconcileDeletedProfileSpaces({
    env,
    ownerUserId,
    profileId,
    spaceIds: spaceDiscovery.spaceIds,
    wakeCancellationConfirmed,
  });
  const complete =
    wakeCancellationConfirmed &&
    bindingCleanup.bindingReconciled &&
    spaceDiscovery.discoveryConfirmed &&
    !spaceDiscovery.truncated &&
    spaces.every((space) => space.status !== "failed");

  return {
    bindingDisabled: bindingCleanup.bindingDisabled,
    complete,
    profileId,
    spaces,
  };
}

async function resolveDeletedProfileWakeCancellation(input: {
  env: CoreBindings;
  ownerUserId: string;
  profileId: string;
  profileKind: "agent" | "human";
}): Promise<boolean> {
  if (input.profileKind !== "agent") {
    return true;
  }
  const wakeCancellation = await cancelRuntimeTransportDeletedAgentProfileWakes(
    {
      env: input.env,
      ownerUserId: input.ownerUserId,
      targetProfileId: input.profileId,
    }
  );
  const logPayload = {
    event: "core.agent_profile.deleted_reconcile_wake_cancellation",
    executionStopCount: wakeCancellation.executionStopOutcomes.length,
    headStopCount: wakeCancellation.headStopOutcomes.length,
    ownerUserId: input.ownerUserId,
    profileId: input.profileId,
    status: wakeCancellation.status,
  };
  if (
    wakeCancellation.status === "partially_requested" ||
    wakeCancellation.status === "unavailable"
  ) {
    console.warn(
      "[core.agent_profile.deleted_reconcile_wake_cancellation_incomplete]",
      logPayload
    );
  } else {
    console.info(
      "[core.agent_profile.deleted_reconcile_wake_cancellation]",
      logPayload
    );
  }
  return (
    wakeCancellation.status === "inactive" ||
    wakeCancellation.status === "cancellation_requested"
  );
}

async function resolveDeletedProfileSpaceIds(input: {
  env: CoreBindings;
  profileId: string;
  requestedSpaceIds: string[];
}): Promise<{
  discoveryConfirmed: boolean;
  spaceIds: string[];
  truncated: boolean;
}> {
  // The space-index membership projection is the authoritative "which Spaces
  // is this profile in" source; caller-provided ids are merged as best-effort
  // hints. The membership liveness backstop catches anything neither knows.
  let projectedSpaceIds: string[] = [];
  let discoveryConfirmed = false;
  const db = projectionsDb(input.env);
  if (db) {
    try {
      projectedSpaceIds = await listActiveSpaceIdsForProfileFromSpaceIndex({
        db,
        // One extra row distinguishes a complete page from a truncated page.
        // A later durable retry observes the next page after these Spaces
        // project their removed membership.
        limit: RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES + 1,
        profileId: input.profileId,
      });
      discoveryConfirmed = true;
    } catch (error) {
      console.warn("[core.agent_profile.deleted_reconcile_index_failed]", {
        event: "core.agent_profile.deleted_reconcile_index_failed",
        error: error instanceof Error ? error.message : String(error),
        profileId: input.profileId,
      });
    }
  }
  const candidateSpaceIds = [
    ...new Set([...projectedSpaceIds, ...input.requestedSpaceIds]),
  ];
  return {
    discoveryConfirmed,
    spaceIds: candidateSpaceIds.slice(
      0,
      RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES
    ),
    truncated:
      projectedSpaceIds.length > RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES ||
      candidateSpaceIds.length > RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES,
  };
}

async function reconcileDeletedProfileSpaces(input: {
  env: CoreBindings;
  ownerUserId: string;
  profileId: string;
  spaceIds: string[];
  wakeCancellationConfirmed: boolean;
}): Promise<ReconcileDeletedAgentProfileSpaceOutcome[]> {
  const spaces: ReconcileDeletedAgentProfileSpaceOutcome[] = [];
  for (const spaceId of input.spaceIds) {
    try {
      const shard = resolveSpaceStub(input.env.OPENMELD_SPACES, spaceId);
      if (!shard) {
        spaces.push({ spaceId, status: "failed" });
        continue;
      }
      const outcome = await shard.rpcReconcileDeletedAgentProfileMember({
        ownerUserId: input.ownerUserId,
        profileId: input.profileId,
        spaceId,
        wakeCancellationConfirmed: input.wakeCancellationConfirmed,
      });
      spaces.push({
        spaceId,
        status: outcome.status === "deferred" ? "failed" : outcome.status,
      });
    } catch (error) {
      console.warn("[core.agent_profile.deleted_reconcile_space_failed]", {
        event: "core.agent_profile.deleted_reconcile_space_failed",
        error: error instanceof Error ? error.message : String(error),
        profileId: input.profileId,
        spaceId,
      });
      spaces.push({ spaceId, status: "failed" });
    }
  }
  return spaces;
}

async function disableDeletedAgentProfileBinding(input: {
  env: CoreBindings;
  ownerUserId: string;
  profileId: string;
}): Promise<{ bindingDisabled: boolean; bindingReconciled: boolean }> {
  try {
    const db = localStateDb(input.env);
    if (!db) {
      throw new Error("agent_profile_binding.store_unavailable");
    }
    // Auth has already deleted the Profile, so the normal user command cannot
    // revalidate it. This lifecycle-only cleanup still scopes the write to the
    // exact owner/profile pair and runs only behind ProfileLifecycleEntrypoint.
    const disabledBinding = await disablePrimaryAgentProfileBindingRecord({
      agentProfileId: input.profileId,
      db,
      disabledAtMs: Date.now(),
      owner: { id: input.ownerUserId, kind: "owner_account" },
      reasonCode: "agent_profile_binding.profile_deleted",
    });
    if (disabledBinding) {
      await notifyRuntimeTransportRouteCatalogChanged({
        affectedProfileIds: [input.profileId],
        env: input.env,
        ownerUserId: input.ownerUserId,
        reason: "agent_profile_deleted",
      }).catch((error) => {
        console.warn(
          "[core.agent_profile.deleted_reconcile_route_catalog_notify_failed]",
          {
            event:
              "core.agent_profile.deleted_reconcile_route_catalog_notify_failed",
            error: error instanceof Error ? error.message : String(error),
            ownerUserId: input.ownerUserId,
            profileId: input.profileId,
          }
        );
      });
    }
    return {
      bindingDisabled: Boolean(disabledBinding),
      // No active Binding is already the desired lifecycle state.
      bindingReconciled: true,
    };
  } catch (error) {
    console.warn("[core.agent_profile.deleted_reconcile_binding_failed]", {
      event: "core.agent_profile.deleted_reconcile_binding_failed",
      error: error instanceof Error ? error.message : String(error),
      profileId: input.profileId,
    });
    return { bindingDisabled: false, bindingReconciled: false };
  }
}
