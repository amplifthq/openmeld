import { defineTool } from "@flue/runtime";
import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import type { RemoteAgentExternalToolEnv } from "../agent-core/external-tools";
import type { RemoteAgentConnectorExecutionConfig } from "../agent-core/github-tools";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  getRemoteAgentOpenMeldToolDefinitions,
  type RemoteAgentFeedbackSubmissionConfig,
  type RemoteAgentMemberProfileReportComputerFiles,
} from "../agent-core/tools";
import {
  createRemoteAgentCodeModeFlueTool,
  type RemoteAgentCodeModeRuntime,
} from "./code-mode";
import {
  executeRemoteAgentToolDefinition,
  toBoundedRemoteAgentToolResult,
} from "./tool-execution";

export async function getRemoteAgentFlueTools(input: {
  agentActivityReadEnabled?: boolean;
  codeModeRuntime?: RemoteAgentCodeModeRuntime;
  connectorExecution?: RemoteAgentConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  env?: RemoteAgentExternalToolEnv;
  feedbackSubmission?: RemoteAgentFeedbackSubmissionConfig;
  fetch?: typeof globalThis.fetch;
  memberProfileReportFiles?: RemoteAgentMemberProfileReportComputerFiles;
  sandboxDefinitions?: RemoteAgentToolDefinition[];
  storage: RemoteAgentStorage;
  submissionId: string;
  turnEnvelope?: RemoteAgentTurnEnvelope | null;
}) {
  const unverifiedMember =
    input.turnEnvelope?.sender.kind === "member" &&
    !input.turnEnvelope.sender.verified;
  const definitions = [
    ...getRemoteAgentOpenMeldToolDefinitions(input),
    ...(unverifiedMember ? [] : (input.sandboxDefinitions ?? [])),
  ];
  const directTools = definitions.map((definition) =>
    toFlueTool({
      definition,
      storage: input.storage,
      submissionId: input.submissionId,
    })
  );
  if (!input.env?.LOADER) {
    throw new Error("Remote Agent Code Mode Worker Loader is unavailable.");
  }
  const codeModeTool = await createRemoteAgentCodeModeFlueTool({
    coreWorker: input.coreWorker,
    definitions,
    env: input.env,
    loader: input.env.LOADER,
    runtime: input.codeModeRuntime,
    storage: input.storage,
    submissionId: input.submissionId,
  });
  return [...directTools, codeModeTool];
}

function toFlueTool(input: {
  definition: RemoteAgentToolDefinition;
  storage: RemoteAgentStorage;
  submissionId: string;
}) {
  const { definition } = input;
  return defineTool({
    name: definition.name,
    description: definition.description,
    input: definition.input as never,
    run: async ({ input: toolInput, signal }) => {
      return toBoundedRemoteAgentToolResult({
        toolName: definition.name,
        value: await executeRemoteAgentToolDefinition({
          definition,
          signal,
          storage: input.storage,
          submissionId: input.submissionId,
          toolInput: (toolInput ?? {}) as Record<string, unknown>,
        }),
      });
    },
  });
}
