import {
  remoteAgentExecutionScopeKey,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import type { RemoteAgentCallbackContext } from "../agent-core/callback-context";

/** Resolve execution and cleanup against the same admitted isolation scope. */
export function resolveRemoteAgentComputerName(
  context: RemoteAgentCallbackContext
): string {
  if (context.computerIsolationVersion === 2) {
    return `agent-computer:audience-v2:${remoteAgentExecutionScopeKey(resolveRemoteAgentExecutionScope(context))}`;
  }
  if (context.computerIsolationVersion === 1) {
    return `agent-computer:audience-v1:${remoteAgentExecutionScopeKey(resolveRemoteAgentExecutionScope(context))}`;
  }
  // Address old commands only for drain/cleanup. New capabilities reject this
  // admission rather than copying the old shared filesystem into a new audience.
  return buildAgentComputerName(
    context.agentProfileId,
    context.conversationIdentity?.kind === "personal_agent"
      ? (context.spaceId ?? "")
      : undefined
  );
}

/**
 * Legacy names remain solely for already-admitted command cleanup. Current
 * Computer capabilities always use resolveRemoteAgentComputerName's audience key.
 */
const AGENT_COMPUTER_NAME_PREFIX = "agent-computer:";

export function buildAgentComputerName(
  agentProfileId: string,
  personalSpaceId?: string
): string {
  const trimmed = agentProfileId.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "Agent computer requires a non-empty agent profile id for its durable name."
    );
  }
  if (personalSpaceId !== undefined) {
    const spaceId = personalSpaceId.trim();
    if (!spaceId) {
      throw new Error("Personal Agent computer requires its admitted Space.");
    }
    // A shell can traverse its entire filesystem. Separate durable workspaces,
    // rather than working-directory conventions, isolate DM and Space files.
    return `${AGENT_COMPUTER_NAME_PREFIX}${JSON.stringify([trimmed, spaceId])}`;
  }
  return `${AGENT_COMPUTER_NAME_PREFIX}${trimmed}`;
}
