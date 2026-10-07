import {
  type RemoteAgentExecutionAccessResponse,
  type RemoteAgentResultSource,
  remoteAgentExecutionAccessResponseSchema,
  remoteAgentExecutionScopeKey,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
} from "./callback-context";
import { buildRemoteAgentCoreContext } from "./tool-context";

/** Rechecked before accessing a retained workspace/result, not a cached grant. */
export async function readRemoteAgentExecutionAccess(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  sources?: RemoteAgentResultSource[];
  effect?: "read" | "write";
  includeDelegatedRequester?: true;
  includePluginDelegations?: true;
  includeComputer?: true;
}) {
  const includeDelegatedRequester =
    input.includeDelegatedRequester ||
    (isDelegatedGitHubTurn(input.context) && Boolean(input.sources?.length));
  const authorize = input.coreWorker.authorizeRemoteAgentExecutionAccess;
  if (!authorize) {
    throw new Error(
      "remote_agent.execution_access_unavailable: Update Core before using isolated Computers or retained results."
    );
  }
  let rawResponse: unknown;
  try {
    rawResponse = await authorize({
      context: buildRemoteAgentCoreContext(
        input.context,
        `execution-access:${input.context.submissionId}`
      ),
      submissionId: input.context.submissionId,
      ...(input.includeComputer ? { includeComputer: true } : {}),
      ...(includeDelegatedRequester ? { includeDelegatedRequester: true } : {}),
      ...(input.includePluginDelegations
        ? { includePluginDelegations: true }
        : {}),
      ...(input.effect ? { effect: input.effect } : {}),
      ...(input.sources?.length ? { sources: input.sources } : {}),
    });
  } catch (error) {
    // An older strict Core rejects the opt-in field before returning a capability marker.
    if (
      includeDelegatedRequester &&
      error instanceof Error &&
      error.message.includes("unrecognized_keys") &&
      error.message.includes("includeDelegatedRequester")
    ) {
      throw new Error(
        "remote_agent.delegated_requester_capability_unavailable: Update Core before using delegated GitHub access.",
        { cause: error }
      );
    }
    throw error;
  }
  const response = remoteAgentExecutionAccessResponseSchema.parse(rawResponse);
  requireComputerCapability(input.includeComputer, response);
  if (input.includePluginDelegations && !response.pluginDelegations) {
    throw new Error("remote_agent.plugin_delegation_capability_unavailable");
  }
  const scope = resolveRemoteAgentExecutionScope(input.context);
  if (
    response.submissionId !== input.context.submissionId ||
    remoteAgentExecutionScopeKey(response.scope) !==
      remoteAgentExecutionScopeKey(scope)
  ) {
    throw new Error("remote_agent.execution_audience_mismatch");
  }
  if (includeDelegatedRequester && !response.delegatedRequesterSupported) {
    throw new Error(
      "remote_agent.delegated_requester_capability_unavailable: Update Core before using delegated GitHub access."
    );
  }
  if (includeDelegatedRequester && !response.delegatedRequester) {
    throw new Error("remote_agent.delegated_requester_unavailable");
  }
  return response;
}

export function isDelegatedGitHubTurn(context: RemoteAgentCallbackContext) {
  return (
    context.conversationIdentity?.kind === "personal_agent" &&
    context.turnEnvelope?.sender.kind === "agent_profile"
  );
}

function requireComputerCapability(
  requested: boolean | undefined,
  response: RemoteAgentExecutionAccessResponse
) {
  if (requested && response.computer === undefined) {
    throw new Error(
      "computer.identity_unavailable: Update Core before using a personal Computer."
    );
  }
}

export async function requireRemoteAgentExecutionAccess(
  input: Parameters<typeof readRemoteAgentExecutionAccess>[0]
) {
  const { scope } = await readRemoteAgentExecutionAccess(input);
  return scope;
}
