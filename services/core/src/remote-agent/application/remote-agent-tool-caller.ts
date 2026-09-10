import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { requireCurrentDesignatedCenterAgentCaller } from "../../center-agent/current-designated-center-agent";
import type { CoreBindings } from "../../lib/bindings";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { requirePersonalRemoteAgentExecution } from "./personal-remote-agent-space-tools";

/** Shared capabilities accept an active personal delivery or the designated Center.
 * Organization administration must continue to require the Center caller.
 */
export async function requireRemoteAgentToolCaller(input: {
  context: OpenMeldRequestContext;
  env: CoreBindings;
  skillPreparationKey?: string;
}) {
  if (
    input.context.actorContext.agentControllerRef !==
    HOSTED_REMOTE_AGENT_CONTROLLER_REF
  ) {
    return await requireCurrentDesignatedCenterAgentCaller(input);
  }
  const submissionId = input.context.agentControllerConversationId;
  if (!submissionId) {
    throw createCoreRpcHttpError({
      code: "remote_agent.personal_execution_required",
      reason: "An active Remote Agent delivery is required.",
      status: 403,
    });
  }
  const execution = await requirePersonalRemoteAgentExecution(
    input.env,
    submissionId,
    input.skillPreparationKey
  );
  const actor = input.context.actorContext;
  if (
    input.context.activeOrganizationId !== execution.delivery.organizationId ||
    actor.openMeldProfileId !== execution.delivery.profileId ||
    actor.profileKind !== "agent" ||
    actor.ownerUserId !== execution.request.agentProfileOwnerUserId ||
    actor.callerPrincipalId !== execution.request.agentProfileOwnerUserId
  ) {
    throw createCoreRpcHttpError({
      code: "remote_agent.execution_identity_mismatch",
      reason: "The tool caller does not match its admitted delivery.",
      status: 403,
    });
  }
  return {
    activeOrganization: {
      organizationId: execution.delivery.organizationId,
      userId: execution.request.agentProfileOwnerUserId,
    },
    context: execution.context,
    db: execution.db,
    actorProfileId: execution.delivery.profileId,
    personalExecution: execution,
  };
}
