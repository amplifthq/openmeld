import { defineTool } from "@flue/runtime";
import { personalRemoteAgentSpaceToolResponseSchema } from "@openmeld/schemas";
import type {
  CenterAgentModelRoute,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import type { GenericSchema } from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import type { RemoteAgentDiagnosticsEnv } from "../agent-core/diagnostics-content-policy";
import type { RemoteAgentExternalToolEnv } from "../agent-core/external-tools";
import type { RemoteAgentImagePreparer } from "../agent-core/image-understanding";
import {
  getPersonalRemoteAgentTools,
  isPersonalRemoteAgentProductTool,
} from "../agent-core/personal-remote-agent-tools";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import { resolveRemoteAgentToolCallLimit } from "../agent-core/tool-progress";
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
  type RemoteAgentMessageReadBudget,
  reserveRemoteAgentMessageReadBytes,
} from "./execution-context";
import {
  createOrganizationSkillCatalogTool,
  createOrganizationSkillResourceTool,
} from "./organization-skills";
import { createHostedPublicProgressTool } from "./public-progress";
import {
  createRemoteAgentReadToolResultDefinition,
  prepareRemoteAgentToolResult,
} from "./retained-tool-results";
import { executeRemoteAgentToolDefinition } from "./tool-execution";
import { isRemoteAgentNativeCapability } from "./tool-presentation";
import {
  createCenterAgentWorkTargetTools,
  guardCenterAgentWorkTarget,
  supportsCenterAgentWorkTarget,
} from "./work-target";

export async function getRemoteAgentFlueTools(input: {
  messageReadBudget?: RemoteAgentMessageReadBudget;
  callLimit?: number;
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
  organizationSkillContext?: RemoteAgentCallbackContext;
  prepareImage?: RemoteAgentImagePreparer;
  sandboxDefinitions?: RemoteAgentToolDefinition[];
  storage: RemoteAgentStorage;
  submissionId: string;
  turnEnvelope?: RemoteAgentTurnEnvelope | null;
}) {
  if (input.replyRecovery) {
    return { tools: [], capabilities: [], deferredToolCount: 0 };
  }
  const callLimit =
    input.callLimit ??
    resolveRemoteAgentToolCallLimit(input.env?.REMOTE_AGENT_TOOL_CALL_LIMIT);
  const unverifiedMember =
    input.turnEnvelope?.sender.kind === "member" &&
    !input.turnEnvelope.sender.verified;
  const summaryOnly =
    input.turnEnvelope?.trigger.source === "task_continuation" &&
    input.turnEnvelope.trigger.summaryOnly;
  const workTargetEnabled = supportsCenterAgentWorkTarget(input);
  // Code Mode callbacks cross an RPC boundary and do not inherit AsyncLocalStorage.
  const messageReadBudget = input.messageReadBudget ?? { remainingBytes: 8192 };
  const reserveMessageReadBytes = (requested: number) =>
    reserveRemoteAgentMessageReadBytes(requested, messageReadBudget);
  const availableDefinitions = [
    ...(workTargetEnabled ? createCenterAgentWorkTargetTools(input) : []),
    createHostedPublicProgressTool(input),
    ...(unverifiedMember
      ? []
      : [createRemoteAgentReadToolResultDefinition(input)]),
    ...(!unverifiedMember &&
    input.organizationSkillContext?.organizationSkillReleases?.length
      ? [
          createOrganizationSkillResourceTool({
            context: input.organizationSkillContext,
            coreWorker: input.coreWorker,
          }),
          createOrganizationSkillCatalogTool({
            context: input.organizationSkillContext,
            coreWorker: input.coreWorker,
          }),
        ]
      : []),
    ...(input.personalAgent
      ? [
          ...getPersonalRemoteAgentTools(input),
          ...getRemoteAgentOpenMeldToolDefinitions({
            ...input,
            reserveMessageReadBytes,
          }).filter((definition) =>
            isPersonalRemoteAgentProductTool(definition.name)
          ),
        ]
      : getRemoteAgentOpenMeldToolDefinitions({
          ...input,
          reserveMessageReadBytes,
        })),
    ...(unverifiedMember ? [] : (input.sandboxDefinitions ?? [])),
  ].filter(
    (definition) => !summaryOnly || SUMMARY_ONLY_TOOL_NAMES.has(definition.name)
  );
  const guardedDefinitions = workTargetEnabled
    ? availableDefinitions.map((definition) =>
        guardCenterAgentWorkTarget(definition, input)
      )
    : availableDefinitions;
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
    : guardedDefinitions;
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
          },
          { storage: input.storage, submissionId: input.submissionId }
        )
      : [];
  const nativeDefinitions = definitions.filter((definition) =>
    isRemoteAgentNativeCapability(definition.name)
  );
  const directTools = [
    ...nativeDefinitions,
    ...capabilityDiscoveryDefinitions,
  ].map((definition) =>
    toFlueTool({
      env: input.env,
      callLimit,
      coreWorker: input.coreWorker,
      definition,
      storage: input.storage,
      submissionId: input.submissionId,
    })
  );
  if (!input.env?.LOADER) {
    throw new Error("Remote Agent Code Mode Worker Loader is unavailable.");
  }
  const codeModeTool = await createRemoteAgentCodeModeFlueTool({
    callLimit,
    coreWorker: input.coreWorker,
    definitions,
    env: input.env,
    loader: input.env.LOADER,
    runtime: input.codeModeRuntime,
    storage: input.storage,
    submissionId: input.submissionId,
  });
  return {
    capabilities: definitions,
    tools: [...directTools, codeModeTool],
    deferredToolCount: definitions.length - nativeDefinitions.length,
  };
}

// Both direct tools and Code Mode are built from this same restricted catalog.
// Progress is presentation only; no business mutations, Computer or Skill code.
const SUMMARY_ONLY_TOOL_NAMES = new Set([
  "openmeld_report_progress",
  "openmeld_read_tool_result",
  "openmeld_read_space_context",
  "openmeld_read_space_file",
]);

function toFlueTool(input: {
  env?: RemoteAgentDiagnosticsEnv;
  callLimit?: number;
  coreWorker: RemoteAgentCoreWorkerBinding;
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
        output: await prepareRemoteAgentToolResult({
          coreWorker: input.coreWorker,
          storage: input.storage,
          submissionId: input.submissionId,
          toolName: definition.name,
          value: await executeRemoteAgentToolDefinition({
            env: input.env,
            callLimit: input.callLimit,
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
