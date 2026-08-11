import {
  RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES,
  reconcileDeletedAgentProfileRequestSchema,
} from "@openmeld/schemas";
import type {
  ReconcileDeletedAgentProfileRequest,
  ReconcileDeletedAgentProfileResponse,
  ReconcileDeletedAgentProfileSpaceOutcome,
} from "@openmeld/schemas/types";
import { type CoreBindings, projectionsDb } from "../../lib/bindings";
import { rpcDisableAgentProfilePrimaryBinding } from "../../rpc/methods";
import { resolveSpaceStub } from "../../rpc/space-ref";
import { listActiveSpaceIdsForProfileFromSpaceIndex } from "../../space-index/space-index-repository";

const SYSTEM_ACTOR_PROFILE_ID = "openmeld-system";

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
  // The space-index membership projection is the authoritative "which Spaces
  // is this profile in" source; caller-provided ids are merged as best-effort
  // hints. The membership liveness backstop catches anything neither knows.
  let projectedSpaceIds: string[] = [];
  const db = projectionsDb(env);
  if (db) {
    try {
      projectedSpaceIds = await listActiveSpaceIdsForProfileFromSpaceIndex({
        db,
        limit: RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES,
        profileId,
      });
    } catch (error) {
      console.warn("[core.agent_profile.deleted_reconcile_index_failed]", {
        event: "core.agent_profile.deleted_reconcile_index_failed",
        error: error instanceof Error ? error.message : String(error),
        profileId,
      });
    }
  }
  const spaceIds = [
    ...new Set([...parsed.data.spaceIds, ...projectedSpaceIds]),
  ].slice(0, RECONCILE_DELETED_AGENT_PROFILE_MAX_SPACES);

  const spaces: ReconcileDeletedAgentProfileSpaceOutcome[] = [];
  for (const spaceId of spaceIds) {
    try {
      const shard = resolveSpaceStub(env.OPENMELD_SPACES, spaceId);
      if (!shard) {
        spaces.push({ spaceId, status: "failed" });
        continue;
      }
      const outcome = await shard.rpcReconcileDeletedAgentProfileMember({
        profileId,
        spaceId,
      });
      spaces.push({ spaceId, status: outcome.status });
    } catch (error) {
      console.warn("[core.agent_profile.deleted_reconcile_space_failed]", {
        event: "core.agent_profile.deleted_reconcile_space_failed",
        error: error instanceof Error ? error.message : String(error),
        profileId,
        spaceId,
      });
      spaces.push({ spaceId, status: "failed" });
    }
  }

  let bindingDisabled = false;
  if (profileKind !== "agent") {
    return {
      bindingDisabled,
      profileId,
      spaces,
    };
  }
  try {
    const disabled = await rpcDisableAgentProfilePrimaryBinding(env, {
      agentProfileId: profileId,
      context: {
        actorContext: {
          openMeldProfileId: SYSTEM_ACTOR_PROFILE_ID,
          ownerUserId,
          profileKind: "system",
          requestId: `profile-deleted-${profileId}`,
        },
      },
    });
    bindingDisabled = disabled.disabled;
  } catch (error) {
    console.warn("[core.agent_profile.deleted_reconcile_binding_failed]", {
      event: "core.agent_profile.deleted_reconcile_binding_failed",
      error: error instanceof Error ? error.message : String(error),
      profileId,
    });
  }

  return {
    bindingDisabled,
    profileId,
    spaces,
  };
}
