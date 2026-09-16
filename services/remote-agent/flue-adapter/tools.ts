import { defineTool } from "@flue/runtime";
import { personalRemoteAgentSpaceToolResponseSchema } from "@openmeld/schemas";
import type {
  CenterAgentModelRoute,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import type { GenericSchema } from "valibot";
import type {
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import type { RemoteAgentExternalToolEnv } from "../agent-core/external-tools";
import type { RemoteAgentImagePreparer } from "../agent-core/image-understanding";
import {
  getPersonalRemoteAgentTools,
  isPersonalRemoteAgentProductTool,
} from "../agent-core/personal-remote-agent-tools";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  getRemoteAgentOpenMeldToolDefinitions,
  type RemoteAgentComputerFileHandoff,
  type RemoteAgentFeedbackSubmissionConfig,
  type RemoteAgentMemberProfileReportComputerFiles,
} from "../agent-core/tools";
import { recordRemoteAgentTurnObservabilityBestEffort } from "../agent-core/turn-observability";
import type { ConnectorExecutionConfig } from "../connectors/open-connector-runtime";
import { createRemoteAgentCapabilityDiscoveryDefinitions } from "./capability-discovery";
import {
  createRemoteAgentCodeModeFlueTool,
  type RemoteAgentCodeModeRuntime,
} from "./code-mode";
import {
  executeRemoteAgentToolDefinition,
  toBoundedRemoteAgentToolResult,
} from "./tool-execution";

export async function getRemoteAgentFlueTools(input: {
  replyRecovery?: boolean;
  personalAgent?: boolean;
  sharedSpaceContextEnabled?: boolean;
  agentActivityReadEnabled?: boolean;
  codeModeRuntime?: RemoteAgentCodeModeRuntime;
  computerFileHandoff?: RemoteAgentComputerFileHandoff;
  connectorExecution?: ConnectorExecutionConfig;
  coreWorker: RemoteAgentCoreWorkerBinding;
  env?: RemoteAgentExternalToolEnv;
  feedbackSubmission?: RemoteAgentFeedbackSubmissionConfig;
  fetch?: typeof globalThis.fetch;
  memberProfileReportFiles?: RemoteAgentMemberProfileReportComputerFiles;
  modelRoute?: CenterAgentModelRoute;
  prepareImage?: RemoteAgentImagePreparer;
  sandboxDefinitions?: RemoteAgentToolDefinition[];
  storage: RemoteAgentStorage;
  submissionId: string;
  turnEnvelope?: RemoteAgentTurnEnvelope | null;
}) {
  if (input.replyRecovery) {
    return [];
  }
  const unverifiedMember =
    input.turnEnvelope?.sender.kind === "member" &&
    !input.turnEnvelope.sender.verified;
  const availableDefinitions = [
    ...(input.personalAgent
      ? [
          ...getPersonalRemoteAgentTools(input),
          ...getRemoteAgentOpenMeldToolDefinitions(input).filter((definition) =>
            isPersonalRemoteAgentProductTool(definition.name)
          ),
        ]
      : getRemoteAgentOpenMeldToolDefinitions(input)),
    ...(unverifiedMember ? [] : (input.sandboxDefinitions ?? [])),
  ];
  const definitions = input.personalAgent
    ? availableDefinitions.map((definition) => ({
        ...definition,
        execute: async (...args: Parameters<typeof definition.execute>) => {
          const authorize = input.coreWorker.personalRemoteAgentSpaceTool;
          if (!authorize) {
            throw new Error(
              "Remote Agent capability authorization is unavailable."
            );
          }
          const authorized = personalRemoteAgentSpaceToolResponseSchema.parse(
            await authorize({
              submissionId: input.submissionId,
              operation: { kind: "authorize" },
            })
          );
          if (authorized.kind !== "authorize") {
            throw new Error("Remote Agent capability authorization failed.");
          }
          return await definition.execute(...args);
        },
      }))
    : availableDefinitions;
  const capabilityDiscoveryDefinitions =
    definitions.length > 0
      ? createRemoteAgentCapabilityDiscoveryDefinitions(
          definitions,
          async (observation) => {
            await recordRemoteAgentTurnObservabilityBestEffort({
              event: {
                ...observation,
                observedAtMs: Date.now(),
                type: "capability_discovery",
              },
              storage: input.storage,
              submissionId: input.submissionId,
            });
          }
        )
      : [];
  const directTools = [...definitions, ...capabilityDiscoveryDefinitions].map(
    (definition) =>
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
    input: definition.input as GenericSchema<Record<string, unknown>, unknown>,
    run: async ({ data: toolInput, signal }) => {
      return {
        output: toBoundedRemoteAgentToolResult({
          toolName: definition.name,
          value: await executeRemoteAgentToolDefinition({
            definition,
            signal,
            source: "direct",
            storage: input.storage,
            submissionId: input.submissionId,
            toolInput: (toolInput ?? {}) as Record<string, unknown>,
          }),
        }),
      };
    },
  });
}
