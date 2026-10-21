import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type AssignAgentProfileMemberAgentOutcome,
  harnessKindFromAgentControllerRef,
} from "@openmeld/schemas";
import { lockAgentProfileMemberAgentAssignment } from "../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { CoreBindings } from "../lib/bindings";
import { callRequiredAuthWorkerRpc } from "../rpc/required-auth-worker-rpc";
import { readAgentProfileGroupingControllerRef } from "./infrastructure/postgresql/runtime-harness-presence-repo";
import { isMemberAgentsEnabled } from "./member-agents-feature";

/**
 * Put a bound Agent Profile under its owner's MemberAgent for the Harness of
 * its Binding (developing/product/agent-profiles.md, MemberAgent Layer).
 * A Binding write calls it after Core accepts the Binding, and catalog sync
 * calls it for Profiles that are still unassigned. A `custom` controller has
 * no Harness, so its Profile stays unassigned.
 *
 * The Harness is read from the Profile's current Binding while this holds the
 * Profile's assignment lock, and Auth assigns before the lock is released.
 * Binding writes take the same lock and refuse a Harness change on an assigned
 * Profile, so an assignment can never group a Profile under a Harness that a
 * concurrent controller switch has just replaced.
 *
 * The Binding is already committed when this runs. A failure is logged and
 * returned as null instead of failing the Binding write; the next catalog
 * sync retries the assignment.
 */
export async function assignBoundProfileToMemberAgent(
  env: Pick<CoreBindings, "OPENMELD_AUTH_WORKER">,
  input: {
    agentProfileId: string;
    db: PostgresDatabase;
    ownerUserId: string;
  },
  // Tests opt in explicitly; production follows the shared release decision.
  options: { enabled?: boolean } = {}
): Promise<AssignAgentProfileMemberAgentOutcome | null> {
  if (!(options.enabled ?? isMemberAgentsEnabled())) {
    return null;
  }
  let harnessKind: string | null = null;
  try {
    return await input.db.transaction(async (client) => {
      await lockAgentProfileMemberAgentAssignment(client, input.agentProfileId);
      const resolvedHarnessKind = harnessKindFromAgentControllerRef(
        await readAgentProfileGroupingControllerRef({
          agentProfileId: input.agentProfileId,
          db: client,
          ownerUserId: input.ownerUserId,
        })
      );
      if (!resolvedHarnessKind) {
        return null;
      }
      harnessKind = resolvedHarnessKind;
      const result = await callRequiredAuthWorkerRpc({
        authWorker: env.OPENMELD_AUTH_WORKER,
        call: (authWorker) =>
          authWorker.assignAgentProfileMemberAgent({
            harnessKind: resolvedHarnessKind,
            ownerUserId: input.ownerUserId,
            profileId: input.agentProfileId,
          }),
        unavailable: {
          code: "member_agents.unavailable",
          reason: "Agents are unavailable.",
        },
      });
      if (!result.ok) {
        console.warn("[core.member_agents.profile_assignment_rejected]", {
          agentProfileId: input.agentProfileId,
          code: result.code,
          harnessKind: resolvedHarnessKind,
        });
        return null;
      }
      return result.outcome;
    });
  } catch (error) {
    console.warn("[core.member_agents.profile_assignment_failed]", {
      agentProfileId: input.agentProfileId,
      error: error instanceof Error ? error.message : String(error),
      harnessKind,
    });
    return null;
  }
}
