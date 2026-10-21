import { supportsExecutionContextAccess } from "@openmeld/agent-runtime";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import { readActiveRepresentedHumanSender } from "../../remote-agent/application/turn-envelope";
import { readRequestChainRootProfileId } from "../../request-chain/request-chain";
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

/**
 * At finalization: whether the Wake's conversation must stay off the
 * Binding. It honors the delivery decision even if the gate changed since,
 * by reading the root from the Wake's admitted chain. Missing evidence
 * keeps it off.
 */
export async function keepsColleagueConversationOffBinding(input: {
  agentControllerRef: string;
  env: CoreBindings;
  message: OpenMeldDaemonDispatchQueueMessage;
  targetOwnerUserId: string;
}): Promise<boolean> {
  if (await usesSeparateColleagueConversation(input)) {
    return true;
  }
  const chain = input.message.requestChain;
  if (
    !chain?.length ||
    input.message.executionContext ||
    supportsExecutionContextAccess(
      input.agentControllerRef,
      "workspace",
      "agent_settings"
    )
  ) {
    return false;
  }
  const db = getPostgresDatabase(input.env);
  if (!(db && input.message.organizationId)) {
    return true;
  }
  return !(await readActiveRepresentedHumanSender({
    db,
    organizationId: input.message.organizationId,
    profileId: readRequestChainRootProfileId(chain),
    userId: input.targetOwnerUserId,
  }));
}
