import { supportsExecutionContextAccess } from "@openmeld/agent-runtime";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import { isDispatchRequestedByAgentOwner } from "./accepted-dispatch-snapshot";

/**
 * A harness without Execution Contexts keeps one Binding conversation. A
 * Wake whose request chain root is not the Binding owner never resumes it
 * and never writes its own conversation back, so a colleague never sees the
 * owner's history and the owner never continues the colleague's
 * (member-agent-program.md §4.3). Owner-rooted Wakes are unchanged. Missing
 * ownership evidence counts as a colleague.
 */
export async function usesSeparateColleagueConversation(input: {
  agentControllerRef: string;
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  /** From the delivery's requester context, when it was resolved. */
  requesterIsAgentOwner?: boolean;
  targetOwnerUserId: string;
}): Promise<boolean> {
  if (
    !isRequestChainEnforced() ||
    input.message.executionContext ||
    supportsExecutionContextAccess(
      input.agentControllerRef,
      "workspace",
      "agent_settings"
    )
  ) {
    return false;
  }
  const ownerRooted =
    input.requesterIsAgentOwner ??
    (await isDispatchRequestedByAgentOwner({
      env: input.env,
      message: input.message,
      targetOwnerUserId: input.targetOwnerUserId,
    }));
  return !ownerRooted;
}
