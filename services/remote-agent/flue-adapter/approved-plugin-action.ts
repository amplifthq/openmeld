import { readApprovedPluginActionResponseSchema } from "@openmeld/schemas";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { getRemoteAgentConnectorToolDefinitions } from "../agent-core/connector-tools";
import { callCoreRpc } from "../agent-core/core-rpc";
import { getRemoteAgentGitHubToolDefinitions } from "../agent-core/github-tools";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { ConnectorExecutionConfig } from "../connectors/open-connector-runtime";
import { prepareRemoteAgentToolResult } from "./retained-tool-results";
import { executeRemoteAgentToolDefinition } from "./tool-execution";

/** A human approval resumes an immutable action, not a model-authored retry.
 * Core resolves the private binding and reauthorizes its exact requester and
 * account. The normal tool owner still claims execution and fences replays. */
export async function resumeApprovedPluginAction(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  connectorExecution?: ConnectorExecutionConfig;
}) {
  const trigger = input.context.turnEnvelope?.trigger.source;
  if (
    input.context.replyRecovery ||
    (trigger !== "space_wake" && trigger !== "web_dm") ||
    !input.context.sourceClientMessageId?.startsWith("plugin-continue:")
  ) {
    return null;
  }
  const response = readApprovedPluginActionResponseSchema.parse(
    await callCoreRpc(
      input.coreWorker,
      "readApprovedPluginAction",
      {
        context: buildRemoteAgentCoreContext(
          input.context,
          "approved-plugin-action"
        ),
      },
      (binding, request) => binding.readApprovedPluginAction?.(request)
    )
  );
  const action = response.action;
  if (!action) {
    return null;
  }
  const dependencies = {
    coreWorker: input.coreWorker,
    storage: input.storage,
    submissionId: input.context.submissionId,
    connectorExecution: input.connectorExecution,
  };
  const github = action.service === "github";
  const name = github ? "github_execute_action" : "openmeld_execute_app_action";
  const definition = (
    github
      ? getRemoteAgentGitHubToolDefinitions(dependencies)
      : getRemoteAgentConnectorToolDefinitions(dependencies)
  ).find((candidate) => candidate.name === name);
  if (!definition) {
    throw new Error("plugin.request.recovery_executor_unavailable");
  }
  const value = await executeRemoteAgentToolDefinition({
    ...dependencies,
    definition,
    toolInput: {
      operationId: action.operationId,
      actionId: action.actionId,
      input: action.recovery.input,
      ...(action.recovery.issueDestinationAuthority
        ? {
            issueDestinationAuthority:
              action.recovery.issueDestinationAuthority,
          }
        : {}),
      ...(github
        ? {
            githubActor: action.recovery.githubActor,
          }
        : {
            service: action.service,
            connectionPreference: action.connectionPreference,
          }),
    },
  });
  return {
    requestId: action.requestId,
    operationId: action.operationId,
    actionId: action.actionId,
    result: await prepareRemoteAgentToolResult({
      ...dependencies,
      toolName: name,
      value,
      maxBytes: 8192,
    }),
  };
}
