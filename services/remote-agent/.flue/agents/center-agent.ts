import { defineAgent } from "@flue/runtime";
import { extend, getCloudflareContext } from "@flue/runtime/cloudflare";
import {
  remoteAgentWorkerAdmissionRejectedResponseSchema,
  remoteAgentWorkerCancellationRequestSchema,
  remoteAgentWorkerExecutionQuerySchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentAdmissionStageOperation,
  RemoteAgentWorkerCancellationRequest,
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerSubmitMessagesResult,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import {
  listRemoteAgentUsageRecords,
  type RemoteAgentCoreWorkerBinding,
} from "../../agent-core/callback-context";
import { callCoreRpc } from "../../agent-core/core-rpc";
import {
  buildRemoteAgentExecutionIdentity,
  markRemoteAgentExecutionProgress,
  readRemoteAgentExecutionState,
} from "../../agent-core/execution-state";
import {
  type RemoteAgentImagePreparer,
  transformRemoteAgentImageForContext,
  understandRemoteAgentImages,
} from "../../agent-core/image-understanding";
import { resolveRemoteAgentModelDisplayName } from "../../agent-core/model";
import { buildRemoteAgentSystemPrompt } from "../../agent-core/prompt";
import {
  buildRemoteAgentName,
  cleanupExpiredRemoteAgentSubmissionReceipts,
  cleanupFinalizedRemoteAgentSubmissionAttachments,
  readExistingRemoteAgentSubmission,
  resolveRemoteAgentTurnEnvelopeForExecution,
  submitRemoteAgentConversationTurn,
} from "../../agent-core/submission";
import { buildRemoteAgentCoreContext } from "../../agent-core/tool-context";
import {
  abortFlueCenterAgentSubmission,
  createFlueCenterAgentAdmissionHost,
  prepareFlueCenterAgentAdmission,
  reconcileAndRedeliverRemoteAgentCallbacks,
  scheduleRemoteAgentCallbackRetry,
} from "../../flue-adapter/center-agent-admission";
import { CENTER_AGENT_DURABILITY } from "../../flue-adapter/center-agent-durability";
import {
  materializeCenterAgentRuntime,
  resolveCenterAgentRuntimeContextPlan,
} from "../../flue-adapter/center-agent-runtime-materialization";
import {
  emitRemoteAgentAdmissionStageEvidence,
  emitRemoteAgentExecutionStageEvidence,
} from "../../flue-adapter/cloudflare-runtime-evidence";
import {
  createRemoteAgentComputerCapability,
  isRemoteAgentComputerEnabled,
} from "../../flue-adapter/computer-sandbox";
import {
  assertRemoteAgentConversationFootprintSchema,
  readRemoteAgentConversationFootprint,
  resolveRemoteAgentConversationAutomaticRolloverLimitBytes,
} from "../../flue-adapter/conversation-footprint";
import { cancelFlueRemoteAgentExecution } from "../../flue-adapter/execution-cancellation";
import {
  installRemoteAgentExecutionInstrumentation,
  resolveRemoteAgentExecutionCallbackContext,
} from "../../flue-adapter/execution-context";
import {
  type FlueSubmissionLifecycle,
  reconcileRemoteAgentExecution,
} from "../../flue-adapter/execution-reconciliation";
import { registerRemoteAgentCloudflareProvider } from "../../flue-adapter/model";
import { resolveCurrentOrganizationDocumentPromptContext } from "../../flue-adapter/organization-document-prompt-context";
import { materializeOrganizationSkillFlueSkills } from "../../flue-adapter/organization-skills";
import {
  resolveRemoteAgentCompactionReserveTokens,
  resolveRemoteAgentProviderContextCapacity,
} from "../../flue-adapter/provider-context-capacity";
import { readRemoteAgentRuntimeDiagnostics } from "../../flue-adapter/runtime-diagnostics";
import { disabledNoNetworkSandbox } from "../../flue-adapter/sandbox";
import { createRemoteAgentSqlStorage } from "../../flue-adapter/storage";
import { getRemoteAgentFlueTools } from "../../flue-adapter/tools";

installRemoteAgentExecutionInstrumentation();

function createRemoteAgentImagePreparer(
  imagesBinding: Pick<ImagesBinding, "info" | "input">
): RemoteAgentImagePreparer {
  return async (image) =>
    await transformRemoteAgentImageForContext({ image, imagesBinding });
}

export default defineAgent(async () => {
  const context = getCloudflareContext();
  const env = context.env as CloudflareBindings;
  const prepareImageForContext = createRemoteAgentImagePreparer(
    env.OPENMELD_IMAGES
  );
  const storage = createRemoteAgentSqlStorage(context.storage.sql);
  const executionContext = await resolveRemoteAgentExecutionCallbackContext({
    storage,
  });
  const turnEnvelope = resolveRemoteAgentTurnEnvelopeForExecution({
    agentName: requireRemoteAgentDurableObjectName(
      context.durableObjectIdentity?.name
    ),
    callbackContext: executionContext,
  });
  const runtimeContextPlan = turnEnvelope
    ? resolveCenterAgentRuntimeContextPlan(turnEnvelope)
    : {
        materializeOrganizationDocuments: true,
        materializeOrganizationSkills: true,
      };
  const coreWorker =
    env.OPENMELD_CORE_WORKER as unknown as RemoteAgentCoreWorkerBinding;
  const organizationSkillSelections =
    executionContext?.organizationSkillReleases ?? [];
  const materialization = await materializeCenterAgentRuntime({
    createSandbox: async () =>
      executionContext && isRemoteAgentComputerEnabled(env)
        ? await createRemoteAgentComputerCapability({
            context: executionContext,
            coreWorker,
            env,
            materializeOrganizationDocuments:
              runtimeContextPlan.materializeOrganizationDocuments,
          })
        : {
            definitions: [],
            fileHandoff: undefined,
            memberProfileReportFiles: undefined,
            sandbox: disabledNoNetworkSandbox(),
          },
    createTools: async (sandboxCapability) =>
      executionContext
        ? await getRemoteAgentFlueTools({
            agentActivityReadEnabled:
              env.OPENMELD_AGENT_ACTIVITY_READ_TOOL_ENABLED === "true",
            connectorExecution: {
              baseUrl: env.OPENMELD_CONNECTORS_BASE_URL,
              runtimeToken: env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN,
            },
            computerFileHandoff: sandboxCapability.fileHandoff,
            coreWorker,
            env,
            feedbackSubmission: {
              baseUrl: env.OPENMELD_FEEDBACK_SUBMIT_BASE_URL,
              inboxKey: env.OPENMELD_OFFICIAL_FEEDBACK_INBOX_KEY,
            },
            memberProfileReportFiles:
              sandboxCapability.memberProfileReportFiles,
            modelRoute: executionContext.modelRoute,
            prepareImage: prepareImageForContext,
            sandboxDefinitions: sandboxCapability.definitions,
            storage,
            submissionId: executionContext.submissionId,
            turnEnvelope,
          })
        : [],
    markProgress: async () => {
      if (!executionContext) {
        return;
      }
      await markRemoteAgentExecutionProgress({
        identity: buildRemoteAgentExecutionIdentity(executionContext),
        nowMs: Date.now(),
        progressKind: "agent_started",
        storage,
      });
    },
    materializeSkills: async () =>
      executionContext &&
      runtimeContextPlan.materializeOrganizationSkills &&
      organizationSkillSelections.length > 0
        ? await materializeOrganizationSkillFlueSkills({
            expectedOrganizationId: executionContext.organizationId,
            selections: organizationSkillSelections,
            snapshot: await callCoreRpc(
              coreWorker,
              "readOrganizationSkillRuntimeSnapshot",
              {
                context: buildRemoteAgentCoreContext(
                  executionContext,
                  `remote-agent-skills:${executionContext.submissionId}`
                ),
                releases: organizationSkillSelections,
              },
              (binding, rpcInput) =>
                binding.readOrganizationSkillRuntimeSnapshot?.(rpcInput)
            ),
          })
        : [],
    // The materialization factory has no execution context, so admission never
    // starts or awaits this Core RPC. The agent interceptor supplies the
    // context only in the fiber, where the current authoritative prompt must
    // be ready before model execution.
    readDocuments: async () =>
      executionContext && runtimeContextPlan.materializeOrganizationDocuments
        ? await resolveCurrentOrganizationDocumentPromptContext({
            organizationId: executionContext.organizationId,
            read: async () =>
              await callCoreRpc(
                coreWorker,
                "readOrganizationDocumentPromptContext",
                {
                  context: buildRemoteAgentCoreContext(
                    executionContext,
                    `remote-agent-prompt:${executionContext.submissionId}`
                  ),
                  includeOrganizationProtectedInformation: true,
                },
                (binding, rpcInput) =>
                  binding.readOrganizationDocumentPromptContext?.(rpcInput)
              ),
          })
        : null,
    registerModel: async () =>
      await registerRemoteAgentCloudflareProvider({
        env,
        modelRoute: executionContext?.modelRoute,
        organizationId: executionContext?.organizationId ?? null,
      }),
    reportStage: (observation) => {
      if (!observation.submissionId) {
        return;
      }
      emitRemoteAgentExecutionStageEvidence(env, {
        bindingId: executionContext?.bindingId,
        category: "materialization",
        clientMessageId: executionContext?.sourceClientMessageId,
        dispatchId: executionContext?.dispatchId,
        durationMs: observation.durationMs,
        errorName: observation.errorName,
        operation: observation.stage,
        requestId: observation.submissionId,
        spaceId: executionContext?.spaceId,
        status: observation.status,
        targetProfileId: executionContext?.agentProfileId,
      });
    },
    submissionId: executionContext?.submissionId ?? null,
  });

  return {
    compaction: materialization.model.compaction,
    durability: CENTER_AGENT_DURABILITY,
    model: materialization.model.modelSpecifier,
    skipLocalContextDiscovery: true,
    thinkingLevel: executionContext?.modelRoute?.reasoningLevel ?? "high",
    instructions: buildRemoteAgentSystemPrompt({
      modelDisplayName: resolveRemoteAgentModelDisplayName(
        env,
        executionContext?.modelRoute
      ),
      organizationBrief: materialization.documents?.briefContent,
      organizationDocumentTitles: materialization.documents?.documentTitles,
      organizationProtectedInformation:
        materialization.documents?.organizationProtectedInformation,
      turnEnvelope,
    }),
    sandbox: materialization.sandbox.sandbox,
    skills: materialization.skills,
    tools: materialization.tools,
  };
});

export const cloudflare = extend({
  base: (Base) =>
    class extends Base {
      async submitConversationTurn(
        request: RemoteAgentWorkerSubmitTurnRequest
      ) {
        const logContext = {
          dispatchId: request.dispatchId,
          idempotencyKey: request.idempotencyKey,
          organizationId: request.organizationId,
          spaceId: request.spaceId,
        };
        const evidenceContext = {
          bindingId: request.bindingId,
          clientMessageId: request.sourceClientMessageId ?? null,
          dispatchId: request.dispatchId,
          spaceId: request.spaceId,
          targetProfileId: request.agentProfileId,
        };
        const env = this.env as CloudflareBindings;
        const prepareImageForContext = createRemoteAgentImagePreparer(
          env.OPENMELD_IMAGES
        );
        const reportStage = (
          operation: RemoteAgentAdmissionStageOperation
        ): void => {
          emitRemoteAgentAdmissionStageEvidence(env, {
            ...evidenceContext,
            operation,
            status: "succeeded",
          });
        };
        const startedAtMs = Date.now();
        let outcome = "failed";
        console.info(
          "[remote_agent.admission.durable_object_entered]",
          logContext
        );
        emitRemoteAgentAdmissionStageEvidence(env, {
          ...evidenceContext,
          operation: "durable_object_entered",
          status: "started",
        });
        try {
          const storage = createRemoteAgentSqlStorage(this.ctx.storage.sql);
          emitRemoteAgentAdmissionStageEvidence(env, {
            ...evidenceContext,
            operation: "storage_initialized",
            status: "succeeded",
          });
          await cleanupExpiredRemoteAgentSubmissionReceipts({
            nowMs: startedAtMs,
            storage,
          });
          const providerContextCapacity =
            request.v === 4
              ? resolveRemoteAgentProviderContextCapacity({
                  contextWindow: request.modelRoute.contextWindow,
                  reserveTokens: resolveRemoteAgentCompactionReserveTokens(
                    request.modelRoute.contextWindow
                  ),
                })
              : undefined;
          const admission = await prepareFlueCenterAgentAdmission({
            automaticRolloverSupported: request.v === 4,
            providerContextCapacity,
            assertConversationFootprintSchema: () =>
              assertRemoteAgentConversationFootprintSchema(
                this.ctx.storage.sql
              ),
            cleanupFinalizedSubmissionReplay: async () =>
              await cleanupFinalizedRemoteAgentSubmissionAttachments({
                attachmentBucket: env.OPENMELD_SPACE_ATTACHMENTS,
                request,
              }),
            ensureInitialized: this.__unsafe_ensureInitialized.bind(this),
            readConversationFootprint: () =>
              readRemoteAgentConversationFootprint(this.ctx.storage.sql),
            readExistingSubmission: async () =>
              await readExistingRemoteAgentSubmission({ request, storage }),
            reportConversationFootprintBeforeReplay: (footprint) => {
              if (footprint.level !== "soft_limit") {
                return;
              }
              console.warn(
                "[remote_agent.admission.conversation_history_soft_limit]",
                {
                  ...logContext,
                  ...footprint,
                }
              );
            },
          });
          if (admission.outcome === "rejected") {
            outcome = "rejected";
            console.warn(
              "[remote_agent.admission.conversation_history_limit_exceeded]",
              {
                ...logContext,
                ...admission.footprint,
                automaticRolloverLimitBytes:
                  resolveRemoteAgentConversationAutomaticRolloverLimitBytes(
                    providerContextCapacity
                  ),
                providerInputTokenBudget:
                  providerContextCapacity?.inputTokenBudget ?? null,
              }
            );
            return remoteAgentWorkerAdmissionRejectedResponseSchema.parse({
              ...admission.rejection,
              idempotencyKey: request.idempotencyKey,
              outcome: "rejected",
              v: 1,
            });
          }
          if (admission.outcome === "finalized") {
            emitRemoteAgentAdmissionStageEvidence(env, {
              ...evidenceContext,
              operation: "submission_acknowledged",
              requestId:
                admission.submission.result.ack.requestId ??
                admission.submission.result.ack.submissionId ??
                null,
              status: "succeeded",
            });
            emitRemoteAgentAdmissionStageEvidence(env, {
              ...evidenceContext,
              operation: "callback_retry_arm_started",
              status: "started",
            });
            await this.armRemoteAgentCallbackRetry();
            emitRemoteAgentAdmissionStageEvidence(env, {
              ...evidenceContext,
              operation: "callback_retry_arm_completed",
              status: "succeeded",
            });
            outcome = "acknowledged";
            return admission.submission.result.ack;
          }
          const host = createFlueCenterAgentAdmissionHost({
            registerProvider: async ({ modelRoute, organizationId }) => {
              await registerRemoteAgentCloudflareProvider({
                env: this.env as CloudflareBindings,
                modelRoute,
                organizationId,
              });
            },
            reportStage,
            routeRequest: this.onRequest.bind(this),
            understandImages: async (imageInput) =>
              await understandRemoteAgentImages({
                ...imageInput,
                env: this.env as CloudflareBindings,
                prepareImage: prepareImageForContext,
              }),
          });
          let ack: RemoteAgentWorkerSubmitMessagesResult;
          try {
            emitRemoteAgentAdmissionStageEvidence(env, {
              ...evidenceContext,
              operation: "submission_started",
              status: "started",
            });
            const result = await submitRemoteAgentConversationTurn({
              agentName: this.name,
              attachmentBucket: env.OPENMELD_SPACE_ATTACHMENTS,
              host,
              includeContinuityContext:
                request.v === 4 &&
                request.continuityContext !== undefined &&
                admission.footprint?.batchCount === 0,
              input: request,
              nowMs: () => startedAtMs,
              reportStage,
              storage,
            });
            emitRemoteAgentAdmissionStageEvidence(env, {
              ...evidenceContext,
              operation: "submission_acknowledged",
              requestId:
                result.ack.requestId ?? result.ack.submissionId ?? null,
              status: "succeeded",
            });
            ack = result.ack;
          } finally {
            emitRemoteAgentAdmissionStageEvidence(env, {
              ...evidenceContext,
              operation: "callback_retry_arm_started",
              status: "started",
            });
            await this.armRemoteAgentCallbackRetry();
            emitRemoteAgentAdmissionStageEvidence(env, {
              ...evidenceContext,
              operation: "callback_retry_arm_completed",
              status: "succeeded",
            });
          }
          outcome = "acknowledged";
          return ack;
        } finally {
          emitRemoteAgentAdmissionStageEvidence(env, {
            ...evidenceContext,
            durationMs: Date.now() - startedAtMs,
            operation: "durable_object_exited",
            status: outcome === "acknowledged" ? "succeeded" : "failed",
          });
          console.info("[remote_agent.admission.durable_object_exited]", {
            ...logContext,
            durationMs: Date.now() - startedAtMs,
            outcome,
          });
        }
      }

      async retryRemoteAgentCallbacks(): Promise<void> {
        const storage = createRemoteAgentSqlStorage(this.ctx.storage.sql);
        const readSubmission = requireFlueSubmissionReader(this);
        await reconcileAndRedeliverRemoteAgentCallbacks({
          coreWorker: this.env
            .OPENMELD_CORE_WORKER as unknown as RemoteAgentCoreWorkerBinding,
          readSubmission,
          schedule: this.schedule.bind(this),
          storage,
        });
      }

      async readExecutionState(input: RemoteAgentWorkerExecutionQuery) {
        const request = remoteAgentWorkerExecutionQuerySchema.parse(input);
        const storage = createRemoteAgentSqlStorage(this.ctx.storage.sql);
        return await readRemoteAgentExecutionState({
          identity: request,
          storage,
        });
      }

      async reconcileExecution(input: RemoteAgentWorkerExecutionQuery) {
        const request = remoteAgentWorkerExecutionQuerySchema.parse(input);
        const storage = createRemoteAgentSqlStorage(this.ctx.storage.sql);
        const readSubmission = requireFlueSubmissionReader(this);
        const reconciled = await reconcileRemoteAgentExecution({
          coreWorker: this.env
            .OPENMELD_CORE_WORKER as unknown as RemoteAgentCoreWorkerBinding,
          identity: request,
          readSubmission: readSubmission.bind(this),
          storage,
        });
        await this.armRemoteAgentCallbackRetry();
        return reconciled;
      }

      async cancelExecution(input: RemoteAgentWorkerCancellationRequest) {
        const request = remoteAgentWorkerCancellationRequestSchema.parse(input);
        await this.__unsafe_ensureInitialized();
        const storage = createRemoteAgentSqlStorage(this.ctx.storage.sql);
        const cancellation = await cancelFlueRemoteAgentExecution({
          abortSubmission: () =>
            abortFlueCenterAgentSubmission({
              conversationId: buildRemoteAgentName(request),
              routeRequest: this.onRequest.bind(this),
              submissionId: request.submissionId,
            }),
          identity: request,
          nowMs: Date.now(),
          reason: request.reason,
          storage,
        });
        if (cancellation.abortedFlueSubmission !== null) {
          console.info("[remote_agent.execution.abort_requested]", {
            abortedFlueSubmission: cancellation.abortedFlueSubmission,
            idempotencyKey: request.idempotencyKey,
            organizationId: request.organizationId,
            spaceId: request.spaceId,
            submissionId: request.submissionId,
          });
        }
        return cancellation.response;
      }

      async readUsageDiagnostics(input: {
        organizationId?: string;
        spaceId?: string;
      }) {
        const storage = createRemoteAgentSqlStorage(this.ctx.storage.sql);
        return {
          records: await listRemoteAgentUsageRecords(storage, input),
          spaceId: input.spaceId ?? null,
        };
      }

      async readRuntimeDiagnostics(input: { spaceId: string }) {
        return await readRemoteAgentRuntimeDiagnostics({
          getAlarmAtMs: () => this.ctx.storage.getAlarm(),
          spaceId: input.spaceId,
          sql: this.ctx.storage.sql,
        });
      }

      private async armRemoteAgentCallbackRetry(
        dueAtIso?: string
      ): Promise<void> {
        await scheduleRemoteAgentCallbackRetry({
          dueAtIso,
          schedule: this.schedule.bind(this),
        });
      }
    },
});

function requireRemoteAgentDurableObjectName(name: string | undefined): string {
  if (!name) {
    throw new Error("Remote Agent Durable Object identity is unavailable.");
  }
  return name;
}

function requireFlueSubmissionReader(
  instance: object
): (submissionId: string) => Promise<FlueSubmissionLifecycle | null> {
  const readSubmission = (
    instance as {
      __unsafe_readSubmission?: (
        submissionId: string
      ) => Promise<FlueSubmissionLifecycle | null>;
    }
  ).__unsafe_readSubmission;
  if (typeof readSubmission !== "function") {
    throw new Error(
      "Flue does not expose lightweight submission reconciliation."
    );
  }
  return readSubmission.bind(instance);
}
