import {
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
export async function requireRemoteAgentExecutionAccess(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  sources?: RemoteAgentResultSource[];
}) {
  const authorize = input.coreWorker.authorizeRemoteAgentExecutionAccess;
  if (!authorize) {
    throw new Error(
      "remote_agent.execution_access_unavailable: Update Core before using isolated Computers or retained results."
    );
  }
  const response = remoteAgentExecutionAccessResponseSchema.parse(
    await authorize({
      context: buildRemoteAgentCoreContext(
        input.context,
        `execution-access:${input.context.submissionId}`
      ),
      submissionId: input.context.submissionId,
      ...(input.sources?.length ? { sources: input.sources } : {}),
    })
  );
  const scope = resolveRemoteAgentExecutionScope(input.context);
  if (
    response.submissionId !== input.context.submissionId ||
    remoteAgentExecutionScopeKey(response.scope) !==
      remoteAgentExecutionScopeKey(scope)
  ) {
    throw new Error("remote_agent.execution_audience_mismatch");
  }
  return scope;
}
