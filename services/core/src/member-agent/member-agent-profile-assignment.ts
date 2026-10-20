import {
  type AssignAgentProfileMemberAgentOutcome,
  harnessKindFromAgentControllerRef,
} from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";
import { callRequiredAuthWorkerRpc } from "../rpc/required-auth-worker-rpc";
import { isMemberAgentsEnabled } from "./member-agents-feature";

/**
 * Put a bound Agent Profile under its owner's MemberAgent for the Harness of
 * its Binding (developing/product/agent-profiles.md, MemberAgent Layer).
 * A Binding write calls it after Core accepts the Binding, and catalog sync
 * calls it for Profiles that are still unassigned. A `custom` controller has
 * no Harness, so its Profile stays unassigned.
 *
 * The Binding is already committed when this runs. A failure is logged and
 * returned as null instead of failing the Binding write; the next catalog
 * sync retries the assignment.
 */
export async function assignBoundProfileToMemberAgent(
  env: Pick<CoreBindings, "OPENMELD_AUTH_WORKER">,
  input: {
    agentControllerRef: string;
    agentProfileId: string;
    ownerUserId: string;
  },
  // Tests opt in explicitly; production follows the shared release decision.
  options: { enabled?: boolean } = {}
): Promise<AssignAgentProfileMemberAgentOutcome | null> {
  if (!(options.enabled ?? isMemberAgentsEnabled())) {
    return null;
  }
  const harnessKind = harnessKindFromAgentControllerRef(
    input.agentControllerRef
  );
  if (!harnessKind) {
    return null;
  }
  try {
    const result = await callRequiredAuthWorkerRpc({
      authWorker: env.OPENMELD_AUTH_WORKER,
      call: (authWorker) =>
        authWorker.assignAgentProfileMemberAgent({
          harnessKind,
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
        harnessKind,
      });
      return null;
    }
    return result.outcome;
  } catch (error) {
    console.warn("[core.member_agents.profile_assignment_failed]", {
      agentProfileId: input.agentProfileId,
      error: error instanceof Error ? error.message : String(error),
      harnessKind,
    });
    return null;
  }
}
