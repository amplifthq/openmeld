import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  getSpaceMessageDetailsResponseSchema,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import type {
  AgentTaskContinuation,
  AgentTaskHandle,
  RemoteAgentWorkerCancellationRequest,
  RemoteAgentWorkerCancellationResponse,
} from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequestV2 } from "../../remote-agent/tests/fixtures";
import { processAgentTaskContinuationQueueMessage } from "../src/agent-task-coordination/application/agent-task-continuation-service";
import {
  recordAndEnqueueAgentTaskTerminalOutcome,
  retryReadyAgentTaskContinuations,
} from "../src/agent-task-coordination/application/agent-task-terminal-outcome-service";
import {
  activateAgentDelegationChildren,
  createAgentDelegation,
  readAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import {
  claimReadyAgentTaskCompletionSubscription,
  readAgentTaskCompletionSubscription,
  recordAgentTaskTerminalOutcome,
  recordTaskSummaryRecoveryIntent,
  registerAgentTaskCompletionSubscription,
  registerManualTaskSummaryRecovery,
  settleAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { prepareCenterAgentWakeDelegation } from "../src/center-agent/application/center-agent-delegation-service";
import {
  continueTaskSummary,
  readInterruptedTaskResults,
  readVerifiedSummaryResults,
  recoverFailedTaskContinuationSummary,
} from "../src/center-agent/application/task-summary-recovery-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const submitContinuation = vi.hoisted(() => vi.fn());
const activateFallbackWake = vi.hoisted(() => vi.fn());
const resolveSpace = vi.hoisted(() => vi.fn());
const TaskContinuationTerminalError = vi.hoisted(
  () =>
    class extends Error {
      readonly reasonCode: string;
      constructor(reasonCode: string) {
        super(reasonCode);
        this.reasonCode = reasonCode;
      }
    }
);
vi.mock("../src/remote-agent/application/native-delivery-service", () => ({
  activateCenterAgentFallbackSpaceWake: activateFallbackWake,
  RemoteAgentTaskContinuationTerminalError: TaskContinuationTerminalError,
  submitRemoteAgentTaskContinuationDelivery: submitContinuation,
}));
vi.mock("../src/rpc/space-ref", () => ({
  resolveSpaceStub: resolveSpace,
}));
const childTask = {
  kind: "space_wake",
  sourceClientMessageId: "client-child",
  spaceId: "space-child",
  targetProfileId: "agt_00000000-0000-4000-8000-000000000002",
  v: 1,
} satisfies AgentTaskHandle;
const parentTask: AgentTaskHandle = {
  deliveryId: "delivery-parent",
  kind: "native_delivery",
  v: 1,
};
const continuation: Extract<
  AgentTaskContinuation,
  {
    kind: "resume_agent";
  }
> = {
  delegationId: "delegation-1",
  instruction: "Synthesize the child result for the original requester.",
  kind: "resume_agent",
  replyLanguageTag: "zh-Hans",
  sourceSignalId: "signal-parent",
  spaceId: "space-parent",
  threadContext: null,
};
describe("Agent Task continuation service", () => {
  beforeEach(() => {
    activateFallbackWake.mockReset();
    resolveSpace.mockReset();
    submitContinuation.mockReset();
  });
  it.each([
    "available",
    "running",
    "not_found",
    "missing_result",
    "revoked_result",
    "old_receiver",
    "old_receiver_rejects",
    "stopped",
    "parent_stop_during_reconciliation",
    "missing_fence",
    "fence_read_failure",
    "user_stop_after_recovery_fence",
    "wrong_execution",
    "wrong_result",
    "cancelled_recovery",
    "failed_recovery",
    "completed_recovery",
    "unverified_result_recovery",
    "revoked_result_recovery",
    "running_recovery",
    "automatic_available",
    "automatic_before_settlement",
    "automatic_denied",
    "automatic_stopped",
    "automatic_budget",
    "automatic_unpublished",
    "automatic_identity_mismatch",
    "automatic_recursive",
  ] as const)("summary recovery uses exact native evidence and retained Space results: %s", async (scenario) => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(harness.db, "summary-source");
      submitContinuation.mockResolvedValue({
        task: {
          kind: "native_delivery",
          deliveryId: "delivery-continuation-race",
          v: 1,
        },
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env: {} as CoreBindings,
        message: buildQueueMessage("summary-source"),
        nowMs: 1200,
      });
      const source = await readAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: "summary-source",
      });
      if (
        !(source?.continuationIdempotencyKey && source.outcome) ||
        source.outcome.status === "needs_attention"
      ) {
        throw new Error("Missing source continuation");
      }
      await insertContinuationDelivery({
        db: harness.db,
        idempotencyKey: source.continuationIdempotencyKey,
      });
      const request = remoteAgentWorkerSubmitTurnRequestSchema.parse(
        createSubmitTurnRequestV2({
          organizationId: "org-1",
          spaceId: "space-parent",
          agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
          bindingId: "binding-parent",
          dispatchId: "dispatch-continuation-race",
          triggerMessageId: "signal-parent",
          idempotencyKey: source.continuationIdempotencyKey,
        })
      );
      request.turnEnvelope.trigger = {
        source: "task_continuation",
        subscriptionId: source.subscriptionId,
        delegationId: `delegation:${source.subscriptionId}`,
        watchedTask: source.watchedTask,
        outcome: source.outcome,
      };
      await harness.db.query({
        ...{
          text: "UPDATE \"openmeld\".\"openMeldRemoteAgent_native_delivery_ledger\" SET status = 'failed', execution_recovery_submit_request_json = $1 WHERE delivery_id = 'delivery-continuation-race'",
          values: [],
        },
        values: [JSON.stringify(request)],
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"members\" (id, role, organization_id, user_id, \"created_at\") VALUES ('member-parent', 'member', 'org-1', 'user-parent', 1700000000000)",
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_kind, profile_name, owner_user_id, status, profile_handle, source) VALUES ('11111111-1111-4111-8111-111111111111', 'human', 'Requester', 'user-parent', 'active', 'requester', 'auth_bootstrap')",
      });
      const unavailableFact = {
        state: "not_recorded",
        value: null,
        source: "none",
      };
      const resultDetails = getSpaceMessageDetailsResponseSchema.parse({
        query: { spaceId: "space-child", signalId: "signal-child-result" },
        message: {
          signalId: "signal-child-result",
          signalType: "signal.text",
          sentAtMs: 1100,
          actor: {
            profileId: childTask.targetProfileId,
            profileKind: "agent",
            displayName: "Child",
            profileName: "Child",
            profileHandle: null,
          },
        },
        agentContext: {
          state: "not_recorded",
          ...Object.fromEntries(
            [
              "profileId",
              "profileName",
              "agentControllerRef",
              "agentControllerConversationId",
              "workspacePath",
              "openMeldServiceRuntimeId",
              "bindingId",
              "workspaceFingerprint",
            ].map((key) => [key, unavailableFact])
          ),
        },
        wakeContext: {
          state: "not_recorded",
          sourceSignalId: unavailableFact,
          clientMessageId: unavailableFact,
          targets: [],
        },
        replyContext: {
          state: "not_recorded",
          replyingToSignalId: unavailableFact,
          replyingToAuthor: unavailableFact,
          previewText: unavailableFact,
          resolved: false,
        },
        diagnostics: { signalId: "signal-child-result", traceSelectors: [] },
      });
      const readResult = vi.fn(() => {
        if (scenario === "missing_result") {
          throw new Error("HTTP 404: result missing");
        }
        if (scenario === "revoked_result") {
          throw new Error("HTTP 403: access revoked");
        }
        return Promise.resolve(resultDetails);
      });
      resolveSpace.mockReturnValue({
        rpcCheckTaskSummaryRecoveryAccess: vi.fn(async () => ({
          allowed: scenario !== "automatic_denied",
        })),
        rpcGetMessageDetails: readResult,
        rpcGetDispatchLookup: vi.fn(async () => ({
          query: {
            spaceId: "space-child",
            sourceSignalId: null,
            clientMessageId: childTask.sourceClientMessageId,
            targetProfileId: childTask.targetProfileId,
          },
          matches: [
            {
              dispatchId: "child-dispatch",
              sourceSignalId: "child-source",
              targetProfileId: childTask.targetProfileId,
              status: "succeeded",
              attemptCount: 1,
              latestAttemptId: "child-attempt",
              latestAttemptStatus: "succeeded",
              latestAttemptErrorCode: null,
              latestAttemptErrorMessage: null,
            },
          ],
        })),
        rpcReadFinalReplyClaimOutcome: vi.fn(async () => ({
          outcome: "success",
          signalId:
            scenario === "wrong_result"
              ? "unrelated-result"
              : "signal-child-result",
        })),
      });
      const execution = {
        v: 1 as const,
        organizationId: "org-1",
        spaceId: "space-parent",
        idempotencyKey: source.continuationIdempotencyKey,
        submissionId:
          scenario === "wrong_execution"
            ? "unrelated-execution"
            : "submission-continuation-race",
        status: scenario === "running" ? "running" : "failed",
        acceptedAtMs: 1100,
        lastProgressAtMs: 1150,
        lastProgressKind: "prompt_failed",
        completedAtMs: scenario === "running" ? null : 1150,
        cancellationReason: null,
      };
      const reconcile = vi.fn(async () => {
        if (scenario === "parent_stop_during_reconciliation") {
          await recordAgentTaskTerminalOutcome({
            db: harness.db,
            nowMs: 1250,
            task: parentTask,
            outcome: {
              status: "stopped",
              errorCode: "remote_agent.execution_cancelled",
              eventId: "parent-stop-race",
              occurredAtMs: 1250,
              publishedSignalId: null,
            },
          });
        }
        return scenario === "not_found"
          ? { status: "not_found" }
          : { status: "found", execution };
      });
      let recoveryFenceId: string | undefined;
      let fenceReadFailed = false;
      const cancel = vi.fn((query: { summaryRecoveryId?: string }) => {
        recoveryFenceId = query.summaryRecoveryId;
        return Promise.resolve({ status: "not_stoppable", execution });
      });
      const readFence = vi.fn((input: unknown) => {
        const frozen = remoteAgentWorkerSubmitTurnRequestSchema.parse(input);
        if (
          frozen.turnEnvelope.trigger.source === "task_continuation" &&
          frozen.turnEnvelope.trigger.summaryOnly
        ) {
          expect(frozen).toEqual({
            ...request,
            turnEnvelope: {
              ...request.turnEnvelope,
              trigger: { ...request.turnEnvelope.trigger, summaryOnly: true },
            },
          });
          if (scenario === "old_receiver") {
            return Promise.resolve({ v: 1, status: "not_found" });
          }
          if (scenario === "old_receiver_rejects") {
            throw new Error("Unrecognized key: summaryOnly");
          }
          return Promise.resolve(
            scenario === "stopped" ||
              scenario === "automatic_stopped" ||
              (cancel.mock.calls.length > 0 &&
                [
                  "fence_read_failure",
                  "user_stop_after_recovery_fence",
                ].includes(scenario))
              ? {
                  v: 1,
                  status: "found",
                  summaryOnlySupported: true,
                  summaryRecoveryFenceSupported: true,
                  stopIntent: {
                    v: 1,
                    organizationId: frozen.organizationId,
                    spaceId: frozen.spaceId,
                    idempotencyKey: frozen.idempotencyKey,
                    requestedAtMs: 1200,
                    reason: "Stopped",
                    ...(recoveryFenceId
                      ? { summaryRecoveryId: recoveryFenceId }
                      : {}),
                  },
                }
              : {
                  v: 1,
                  status: "not_found",
                  summaryOnlySupported: true,
                  summaryRecoveryFenceSupported: true,
                }
          );
        }
        expect(frozen).toEqual(request);
        if (
          ["fence_read_failure", "user_stop_after_recovery_fence"].includes(
            scenario
          ) &&
          !fenceReadFailed
        ) {
          fenceReadFailed = true;
          return Promise.reject(new Error("temporary fence read failure"));
        }
        return Promise.resolve(
          scenario === "missing_fence"
            ? { v: 1, status: "not_found" }
            : {
                v: 1,
                status: "found",
                stopIntent: {
                  v: 1,
                  organizationId: frozen.organizationId,
                  spaceId: frozen.spaceId,
                  idempotencyKey: frozen.idempotencyKey,
                  requestedAtMs: 1300,
                  reason: null,
                  ...(recoveryFenceId
                    ? { summaryRecoveryId: recoveryFenceId }
                    : {}),
                },
              }
        );
      });
      const send = vi.fn((_event: unknown) => Promise.resolve());
      const env = {
        OPENMELD_REMOTE_AGENT_WORKER: {
          reconcileExecution: reconcile,
          cancelExecution: cancel,
          readAdmissionStop: readFence,
        },
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
      } as unknown as CoreBindings;
      const input = {
        actorProfileId: "agt_00000000-0000-4000-8000-000000000001",
        db: harness.db,
        env,
        inspectOnly: true,
        nowMs: 1300,
        operatorUserId: "user-parent",
        organizationId: "org-1",
        sourceSubscriptionId: source.subscriptionId,
      };
      if (scenario.startsWith("automatic_")) {
        if (
          scenario === "automatic_recursive" &&
          request.turnEnvelope.trigger.source === "task_continuation"
        ) {
          request.turnEnvelope.trigger.summaryOnly = true;
        }
        await harness.db.query({
          text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            SET failure_code = $1, published_signal_id = $2,
              execution_recovery_submit_request_json = $3
            WHERE delivery_id = 'delivery-continuation-race'`,
          values: [
            scenario === "automatic_budget"
              ? "remote_agent.turn.output_limit_exceeded"
              : "remote_agent.computer.command_cleanup_failed",
            scenario === "automatic_unpublished"
              ? null
              : "signal-coordinator-failure",
            JSON.stringify(request),
          ],
        });
        const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
          db: harness.db,
          deliveryId: "delivery-continuation-race",
        });
        if (!delivery) {
          throw new Error("Missing failed coordinator");
        }
        if (scenario === "automatic_identity_mismatch") {
          delivery.deliveryId = "unrelated-delivery";
        }
        if (scenario === "automatic_before_settlement") {
          await harness.db.query({
            text: `UPDATE "openmeld"."agent_task_completion_subscriptions"
              SET state = 'continuation_claimed', continuation_task_handle_json = NULL,
                continuation_task_key = NULL, claim_id = 'original-claim', claim_expires_at_ms = 1200
              WHERE subscription_id = $1`,
            values: [source.subscriptionId],
          });
          await recoverFailedTaskContinuationSummary({ ...input, delivery });
          expect(cancel).not.toHaveBeenCalled();
          expect(send).not.toHaveBeenCalled();
          await processAgentTaskContinuationQueueMessage({
            ...input,
            message: buildQueueMessage(source.subscriptionId),
          });
        } else {
          await recoverFailedTaskContinuationSummary({ ...input, delivery });
        }
        const recovers =
          scenario === "automatic_available" ||
          scenario === "automatic_before_settlement";
        if (recovers) {
          await Promise.all([
            recoverFailedTaskContinuationSummary({ ...input, delivery }),
            processAgentTaskContinuationQueueMessage({
              ...input,
              message: buildQueueMessage(source.subscriptionId),
            }),
          ]);
          const recoveries = await harness.db.query<{
            continuation_json: string;
          }>({
            text: `SELECT continuation_json FROM "openmeld"."agent_task_completion_subscriptions"
              WHERE subscription_id <> $1`,
            values: [source.subscriptionId],
          });
          expect(recoveries.rows).toHaveLength(1);
          expect(
            JSON.parse(recoveries.rows[0]?.continuation_json ?? "{}")
          ).toMatchObject({
            summaryRecovery: {
              sourceSubscriptionId: source.subscriptionId,
              operatorUserId: "user-parent",
            },
          });
          const retained = await readRemoteAgentNativeDeliveryByDeliveryId({
            db: harness.db,
            deliveryId: delivery.deliveryId,
          });
          expect(retained).toMatchObject({
            status: "failed",
            publishedSignalId: "signal-coordinator-failure",
          });
          expect(
            (
              await readAgentTaskCompletionSubscription({
                db: harness.db,
                subscriptionId: source.subscriptionId,
              })
            )?.outcome
          ).toEqual(source.outcome);
          expect(cancel).toHaveBeenCalledTimes(1);
          expect(submitContinuation).toHaveBeenCalledTimes(
            scenario === "automatic_before_settlement" ? 2 : 1
          );
          expect(activateFallbackWake).not.toHaveBeenCalled();
        } else {
          expect(cancel).not.toHaveBeenCalled();
          expect(send).not.toHaveBeenCalled();
        }
        return;
      }
      const observer = await readRemoteAgentNativeDeliveryByDeliveryId({
        db: harness.db,
        deliveryId: "delivery-parent",
      });
      const delegation = await readAgentDelegation({
        db: harness.db,
        delegationId: `delegation:${source.subscriptionId}`,
      });
      if (!(observer && delegation)) {
        throw new Error("Missing parent evidence");
      }
      const verified = await readVerifiedSummaryResults({
        env,
        source,
        observer,
        delegation,
        operatorUserId: "user-parent",
        publicationSpaceId: "space-child",
      });
      expect(verified).toEqual(
        ["missing_result", "revoked_result", "wrong_result"].includes(scenario)
          ? []
          : [{ spaceId: "space-child", signalId: "signal-child-result" }]
      );
      readResult.mockClear();
      expect(
        await readVerifiedSummaryResults({
          env,
          source,
          observer,
          delegation,
          operatorUserId: "user-parent",
          publicationSpaceId: "unrelated-space",
        })
      ).toEqual([]);
      expect(readResult).not.toHaveBeenCalled();
      // Exercise the failure reader through the real persisted subscription and
      // delegation. The public destination must match the child's own Space.
      await harness.db.query({
        text: "UPDATE \"openmeld\".\"openMeldRemoteAgent_native_delivery_ledger\" SET space_id = 'space-child' WHERE delivery_id = 'delivery-parent'",
        values: [],
      });
      const interrupted = await readRemoteAgentNativeDeliveryByDeliveryId({
        db: harness.db,
        deliveryId: "delivery-continuation-race",
      });
      if (!interrupted) {
        throw new Error("Missing interrupted execution");
      }
      const publicDelivery = {
        ...interrupted,
        spaceId: "space-child",
        executionRecoverySubmitRequest: { ...request, spaceId: "space-child" },
      };
      expect(
        await readInterruptedTaskResults({
          db: harness.db,
          env,
          delivery: publicDelivery,
        })
      ).toEqual(verified);
      expect(
        await readInterruptedTaskResults({
          db: harness.db,
          env,
          delivery: {
            ...publicDelivery,
            idempotencyKey: "unrelated-execution",
          },
        })
      ).toEqual([]);
      await harness.db.query({
        text: "UPDATE \"openmeld\".\"openMeldRemoteAgent_native_delivery_ledger\" SET space_id = 'space-parent' WHERE delivery_id = 'delivery-parent'",
        values: [],
      });
      const inspected = await continueTaskSummary(input);
      expect(cancel).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      if (
        ["fence_read_failure", "user_stop_after_recovery_fence"].includes(
          scenario
        )
      ) {
        await expect(
          continueTaskSummary({ ...input, inspectOnly: false })
        ).rejects.toThrow("temporary fence read failure");
        expect(send).not.toHaveBeenCalled();
        if (scenario === "user_stop_after_recovery_fence") {
          await recordAgentTaskTerminalOutcome({
            db: harness.db,
            nowMs: 1350,
            task: parentTask,
            outcome: {
              status: "stopped",
              errorCode: "remote_agent.execution_cancelled",
              eventId: "user-stop-after-fence",
              occurredAtMs: 1350,
              publishedSignalId: null,
            },
          });
        }
      }
      const result = await continueTaskSummary({
        ...input,
        inspectOnly: false,
      });
      const available =
        scenario === "available" ||
        scenario === "fence_read_failure" ||
        scenario.endsWith("_recovery");
      expect(inspected.status).toBe(
        available ||
          scenario === "missing_fence" ||
          scenario === "user_stop_after_recovery_fence"
          ? "available"
          : "unavailable"
      );
      expect(result.status).toBe(available ? "queued" : "unavailable");
      if (available) {
        await Promise.all([
          continueTaskSummary({ ...input, inspectOnly: false }),
          continueTaskSummary({ ...input, inspectOnly: false }),
        ]);
        const recovery = await readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: result.subscriptionId ?? "",
        });
        expect(recovery).toMatchObject({
          state: "ready",
          continuation: {
            summaryRecovery: {
              operatorUserId: "user-parent",
              sourceSubscriptionId: source.subscriptionId,
            },
          },
        });
        expect(recovery?.continuationIdempotencyKey).not.toBe(
          source.continuationIdempotencyKey
        );
        expect(send.mock.calls.map(([event]) => event)).toEqual([
          expect.objectContaining({ subscriptionId: result.subscriptionId }),
          expect.objectContaining({ subscriptionId: result.subscriptionId }),
          expect.objectContaining({ subscriptionId: result.subscriptionId }),
        ]);
        if (scenario.endsWith("_recovery")) {
          if (!recovery?.continuationIdempotencyKey) {
            throw new Error("Missing recovery identity");
          }
          if (scenario === "cancelled_recovery") {
            await harness.db.query({
              ...{
                text: 'UPDATE "openmeld"."agent_task_completion_subscriptions" SET state = \'cancelled\' WHERE subscription_id = $1',
                values: [],
              },
              values: [recovery.subscriptionId],
            });
          } else {
            await insertContinuationDelivery({
              db: harness.db,
              idempotencyKey: recovery.continuationIdempotencyKey,
              deliveryId: "summary-delivery",
            });
            await harness.db.query({
              ...{
                text: 'UPDATE "openmeld"."agent_task_completion_subscriptions" SET state = \'settled\', continuation_task_handle_json = $1, continuation_task_key = $2 WHERE subscription_id = $3',
                values: [],
              },
              values: [
                JSON.stringify({
                  v: 1,
                  kind: "native_delivery",
                  deliveryId: "summary-delivery",
                }),
                "native_delivery:summary-delivery",
                recovery.subscriptionId,
              ],
            });
            if (scenario !== "running_recovery") {
              await harness.db.query({
                ...{
                  text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET status = $1, published_signal_id = $2 WHERE delivery_id = \'summary-delivery\'',
                  values: [],
                },
                values: [
                  scenario === "failed_recovery" ? "failed" : "completed",
                  [
                    "completed_recovery",
                    "unverified_result_recovery",
                    "revoked_result_recovery",
                  ].includes(scenario)
                    ? "summary-result"
                    : null,
                ],
              });
            }
            readResult.mockResolvedValue({
              ...resultDetails,
              query: { spaceId: "space-parent", signalId: "summary-result" },
              message: {
                ...resultDetails.message,
                signalId: "summary-result",
                actor: {
                  ...resultDetails.message.actor,
                  profileId: input.actorProfileId,
                },
              },
            });
            resolveSpace.mockReturnValue({
              rpcCheckTaskSummaryRecoveryAccess: vi.fn(() =>
                Promise.resolve({ allowed: true })
              ),
              rpcGetMessageDetails:
                scenario === "revoked_result_recovery"
                  ? vi.fn(() =>
                      Promise.reject(new Error("HTTP 403: no access"))
                    )
                  : readResult,
              rpcReadFinalReplyClaimOutcome: vi.fn(() =>
                Promise.resolve({
                  outcome: "success",
                  signalId:
                    scenario === "unverified_result_recovery"
                      ? "unrelated-result"
                      : "summary-result",
                })
              ),
            });
          }
          send.mockClear();
          const repeated = await continueTaskSummary({
            ...input,
            inspectOnly: false,
            includePublishedResult: true,
          });
          expect(repeated).toMatchObject({
            status:
              scenario === "running_recovery"
                ? "already_requested"
                : "unavailable",
            subscriptionId: recovery.subscriptionId,
          });
          if (scenario === "completed_recovery") {
            expect(repeated).toMatchObject({
              reasonCode: "task_summary_recovery.completed",
              publishedResult: {
                spaceId: "space-parent",
                signalId: "summary-result",
              },
            });
            const legacyReceipt = await continueTaskSummary({
              ...input,
              inspectOnly: false,
            });
            expect(legacyReceipt).toMatchObject({
              status: "unavailable",
              reasonCode: "task_summary_recovery.completed",
            });
            expect(legacyReceipt).not.toHaveProperty("publishedResult");
          }
          if (
            scenario === "unverified_result_recovery" ||
            scenario === "revoked_result_recovery"
          ) {
            expect(repeated.reasonCode).toBe(
              "task_summary_recovery.result_unavailable"
            );
            expect(repeated).not.toHaveProperty("publishedResult");
          }
          expect(send).not.toHaveBeenCalled();
        }
      } else {
        expect(send).not.toHaveBeenCalled();
      }
      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: "submission-continuation-race",
          idempotencyKey: source.continuationIdempotencyKey,
        })
      );
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: source.subscriptionId,
        })
      ).resolves.toMatchObject({ ...source, updatedAtMs: expect.any(Number) });
      if (scenario === "available" && result.subscriptionId) {
        await processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env,
          message: buildQueueMessage(result.subscriptionId),
          nowMs: 1400,
        });
        expect(submitContinuation).toHaveBeenLastCalledWith(
          expect.objectContaining({
            summaryOnly: true,
            subscriptionId: result.subscriptionId,
          })
        );
      }
    } finally {
      await harness.close();
    }
  });
  it.each([
    true,
    false,
  ])("rechecks the requester's current Space access before manual summary admission: %s", async (allowed) => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(harness.db, "original-manual");
      await claimReadyAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: "original-manual",
        claimId: "old-claim",
        claimLeaseMs: 30_000,
        nowMs: 1110,
      });
      const source = await settleAgentTaskCompletionSubscription({
        db: harness.db,
        subscriptionId: "original-manual",
        claimId: "old-claim",
        nowMs: 1120,
        continuationTask: {
          kind: "native_delivery",
          deliveryId: "old-continuation",
          v: 1,
        },
      });
      if (!source) {
        throw new Error("Missing settled source");
      }
      const prepared = await recordTaskSummaryRecoveryIntent({
        db: harness.db,
        source,
        recoveryId: "manual-summary",
        operatorUserId: "user-parent",
        nowMs: 1125,
      });
      await registerManualTaskSummaryRecovery({
        db: harness.db,
        source,
        subscriptionId: "manual-summary",
        operatorUserId: "user-parent",
        nowMs: 1130,
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"members\" (id, role, organization_id, user_id, \"created_at\") VALUES ('member-parent', 'member', 'org-1', 'user-parent', 1700000000000)",
      });
      await harness.query({
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_kind, profile_name, owner_user_id, status, profile_handle, source) VALUES ('11111111-1111-4111-8111-111111111111', 'human', 'Requester', 'user-parent', 'active', 'requester', 'auth_bootstrap')",
      });
      const access = vi.fn(async () => ({ allowed }));
      resolveSpace.mockReturnValue({
        rpcCheckTaskSummaryRecoveryAccess: access,
      });
      submitContinuation.mockImplementation(async (input) => {
        expect(await input.isAuthorized()).toBe(true);
        return {
          task: {
            kind: "native_delivery",
            deliveryId: "fresh-continuation",
            v: 1,
          },
        };
      });
      const result = await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env: {} as CoreBindings,
        message: buildQueueMessage("manual-summary"),
        nowMs: 1200,
      });
      expect(submitContinuation).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(access).toHaveBeenCalledWith({
        spaceId: "space-parent",
        profileId: "11111111-1111-4111-8111-111111111111",
        ownerUserId: "user-parent",
      });
      expect(result.status).toBe("completed");
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "manual-summary",
        })
      ).resolves.toMatchObject({ state: allowed ? "settled" : "cancelled" });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: source.subscriptionId,
        })
      ).resolves.toEqual(prepared);
      if (allowed) {
        expect(submitContinuation.mock.calls[0]?.[0]).toMatchObject({
          idempotencyKey: "agent-task-continuation:manual-summary",
          observerDelivery: { onBehalfOfUserId: "user-parent" },
        });
      }
    } finally {
      await harness.close();
    }
  });
  it("submits and settles one continuation exactly once", async () => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-1");
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-continuation-1",
          kind: "native_delivery",
          v: 1,
        },
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-1"),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-1" },
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-1"),
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-1" },
      });
      expect(submitContinuation).toHaveBeenCalledTimes(1);
      const submittedContinuation = submitContinuation.mock.calls[0]?.[0];
      expect(submittedContinuation.replyLanguageTag).toBe("zh-Hans");
      expect(submittedContinuation).not.toHaveProperty("sourceSignalId");
      expect(submittedContinuation).not.toHaveProperty("spaceId");
      expect(submittedContinuation).not.toHaveProperty("threadContext");
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-1",
        })
      ).resolves.toMatchObject({
        continuationTask: {
          deliveryId: "delivery-continuation-1",
          kind: "native_delivery",
        },
        state: "settled",
      });
    } finally {
      await harness.close();
    }
  });
  it("settles a terminal continuation instead of retrying its admission", async () => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-terminal");
      submitContinuation.mockResolvedValue({
        status: "terminal",
        task: {
          deliveryId: "delivery-continuation-terminal",
          kind: "native_delivery",
          v: 1,
        },
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-terminal"),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-terminal" },
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-terminal",
        })
      ).resolves.toMatchObject({
        continuationTask: {
          deliveryId: "delivery-continuation-terminal",
          kind: "native_delivery",
        },
        state: "settled",
      });
      expect(submitContinuation).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("cancels a continuation when its frozen model route was already cleared", async () => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(
        harness.db,
        "subscription-cleared-model-route"
      );
      submitContinuation.mockRejectedValue(
        new TaskContinuationTerminalError(
          "remote_agent.task_continuation.original_model_route_unavailable"
        )
      );
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-cleared-model-route"),
          nowMs: 1200,
        })
      ).resolves.toEqual({ status: "completed", task: null });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-cleared-model-route",
        })
      ).resolves.toMatchObject({
        continuationTask: null,
        state: "cancelled",
      });
      expect(submitContinuation).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("waits for a Routine observer callback to finish before resuming it", async () => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-routine");
      await harness.db.query({
        ...{
          text: `
            UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            SET routine_run_id = 'routine-run-1'
            WHERE delivery_id = $1
          `,
          values: [],
        },
        values: [parentTask.deliveryId],
      });
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-routine-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-routine"),
          nowMs: 1200,
        })
      ).resolves.toEqual({ retryAfterSeconds: 5, status: "retry_later" });
      expect(submitContinuation).not.toHaveBeenCalled();
      await harness.db.query({
        ...{
          text: `
            UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            SET status = 'completed'
            WHERE delivery_id = $1
          `,
          values: [],
        },
        values: [parentTask.deliveryId],
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-routine"),
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-routine-continuation" },
      });
      expect(submitContinuation).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it("resumes a general exact-task watch without requiring a delegation", async () => {
    const harness = await createHarness();
    try {
      await arrangeReadyTaskWatchSubscription(
        harness.db,
        "subscription-task-watch"
      );
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-task-watch-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-task-watch"),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-task-watch-continuation" },
      });
      const submitted = submitContinuation.mock.calls[0]?.[0];
      expect(submitted).toMatchObject({
        watchedTask: childTask,
        watchId: "watch-task-watch",
      });
      expect(submitted).not.toHaveProperty("delegation");
      expect(submitted).not.toHaveProperty("delegationId");
    } finally {
      await harness.close();
    }
  });
  it("retries with the same continuation idempotency key after a crash gap", async () => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-crash-gap");
      submitContinuation
        .mockRejectedValueOnce(new Error("simulated post-submit crash"))
        .mockResolvedValueOnce({
          task: {
            deliveryId: "delivery-continuation-recovered",
            kind: "native_delivery",
            v: 1,
          },
        });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-crash-gap"),
          nowMs: 1200,
        })
      ).rejects.toThrow("simulated post-submit crash");
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-crash-gap"),
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-recovered" },
      });
      expect(submitContinuation).toHaveBeenCalledTimes(2);
      expect(submitContinuation.mock.calls[0]?.[0].idempotencyKey).toBe(
        "agent-task-continuation:subscription-crash-gap"
      );
      expect(submitContinuation.mock.calls[1]?.[0].idempotencyKey).toBe(
        "agent-task-continuation:subscription-crash-gap"
      );
    } finally {
      await harness.close();
    }
  });
  it("redrives a durable winner if the delegation completion write was interrupted", async () => {
    const harness = await createHarness();
    const subscriptionId = "subscription-winner-crash-gap";
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await harness.db.query({
        ...{
          text: `
            UPDATE "openmeld"."agent_delegations"
            SET state = 'active', completed_at_ms = NULL
            WHERE delegation_id = $1
          `,
          values: [],
        },
        values: [`delegation:${subscriptionId}`],
      });
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-winner-redriven",
          kind: "native_delivery",
          v: 1,
        },
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage(subscriptionId),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-winner-redriven" },
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: `delegation:${subscriptionId}`,
        })
      ).resolves.toMatchObject({ state: "completed" });
    } finally {
      await harness.close();
    }
  });
  it("defers while another continuation claim lease is active", async () => {
    const harness = await createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-claimed");
      await claimReadyAgentTaskCompletionSubscription({
        claimId: "claim-existing",
        claimLeaseMs: 60_000,
        db: harness.db,
        nowMs: 1200,
        subscriptionId: "subscription-claimed",
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-claimed"),
          nowMs: 1300,
        })
      ).resolves.toEqual({
        retryAfterSeconds: 60,
        status: "retry_later",
      });
      expect(submitContinuation).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
  it("redrives durable ready subscriptions after an enqueue gap", async () => {
    const harness = await createHarness();
    const send = vi.fn(async () => undefined);
    try {
      await arrangeReadySubscription(harness.db, "subscription-redrive");
      await expect(
        retryReadyAgentTaskContinuations({
          db: harness.db,
          env: {
            OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
          } as unknown as CoreBindings,
          nowMs: 1200,
        })
      ).resolves.toEqual({ enqueuedCount: 1 });
      expect(send).toHaveBeenCalledWith({
        ...buildQueueMessage("subscription-redrive"),
        enqueuedAtMs: 1200,
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps a continuation ready when its immediate Queue send fails", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: continuation.delegationId,
        idempotencyKey: "delegation-key:enqueue-failure",
        nowMs: 999,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation,
        db: harness.db,
        idempotencyKey: "subscription-key:enqueue-failure",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-enqueue-failure",
        watchedTask: childTask,
      });
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_DAEMON_DISPATCH_QUEUE: {
              send: vi.fn(() => Promise.reject(new Error("Queue unavailable"))),
            },
          } as unknown as CoreBindings,
          nowMs: 1100,
          outcome: {
            errorCode: null,
            eventId: "terminal:enqueue-failure",
            occurredAtMs: 1090,
            publishedSignalId: "signal-child-result",
            status: "succeeded",
          },
          task: childTask,
        })
      ).resolves.toBeUndefined();
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-enqueue-failure",
        })
      ).resolves.toMatchObject({ state: "ready" });
    } finally {
      await harness.close();
    }
  });
  it("enqueues and resumes a duplicate terminal observation exactly once", async () => {
    const harness = await createHarness();
    const send = vi.fn(async () => undefined);
    const subscriptionId = "subscription-duplicate-terminal";
    const outcome = {
      errorCode: null,
      eventId: "terminal:duplicate-observation",
      occurredAtMs: 1090,
      publishedSignalId: "signal-child-result",
      status: "succeeded" as const,
    };
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: continuation.delegationId,
        idempotencyKey: "delegation-key:duplicate-terminal",
        nowMs: 999,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation,
        db: harness.db,
        idempotencyKey: "subscription-key:duplicate-terminal",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId,
        watchedTask: childTask,
      });
      const env = {
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
      } as unknown as CoreBindings;
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1100,
        outcome,
        task: childTask,
      });
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1110,
        outcome,
        task: childTask,
      });
      expect(send).toHaveBeenCalledTimes(1);
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-duplicate-terminal-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1200,
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1210,
      });
      expect(submitContinuation).toHaveBeenCalledTimes(1);
    } finally {
      await harness.close();
    }
  });
  it("resumes the exact parent controller conversation once after a local runtime is lost", async () => {
    const harness = await createHarness();
    const send = vi.fn(async () => undefined);
    const subscriptionId = "subscription-local-runtime-lost";
    const outcome = {
      errorCode: "runtime.local_runtime_lost",
      eventId: "runtime-coordinator:local-runtime-lost",
      occurredAtMs: 1090,
      publishedSignalId: "signal-local-runtime-lost",
      status: "failed" as const,
    };
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: "delegation-local-runtime-lost",
        idempotencyKey: "delegation-key:local-runtime-lost",
        nowMs: 999,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: {
          ...continuation,
          delegationId: "delegation-local-runtime-lost",
        },
        db: harness.db,
        idempotencyKey: "subscription-key:local-runtime-lost",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId,
        watchedTask: childTask,
      });
      const env = {
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
      } as unknown as CoreBindings;
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1100,
        outcome,
        task: childTask,
      });
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1110,
        outcome,
        task: childTask,
      });
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith(buildQueueMessage(subscriptionId));
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-local-runtime-lost-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1200,
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1210,
      });
      expect(submitContinuation).toHaveBeenCalledOnce();
      expect(submitContinuation).toHaveBeenCalledWith(
        expect.objectContaining({
          observerDelivery: expect.objectContaining({
            deliveryId: "delivery-parent",
            submissionId: "submission-parent",
          }),
          outcome,
          watchedTask: childTask,
        })
      );
    } finally {
      await harness.close();
    }
  });
  it("activates a fallback only after the primary authoritatively fails", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: "agt_00000000-0000-4000-8000-000000000001",
        childSpaceId: "space-child",
        clientMessageId: "client-fallback",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        fallbackAgentProfileId: "agt_00000000-0000-4000-8000-000000000003",
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [childTask.targetProfileId],
        text: "Complete the task.",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: prepared.delegationId,
        nowMs: 1010,
      });
      const primaryTask = prepared.childTasks[0]?.task;
      if (!primaryTask) {
        throw new Error("expected primary task fixture");
      }
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: {
          errorCode: "task.failed",
          eventId: "terminal:primary-failed",
          occurredAtMs: 1090,
          publishedSignalId: null,
          status: "failed",
        },
        task: primaryTask,
      });
      const fallbackTask = prepared.fallbackTask?.task;
      const activationSubscriptionId =
        prepared.fallbackTask?.activationSubscriptionId;
      if (!(fallbackTask && activationSubscriptionId)) {
        throw new Error("expected fallback task fixture");
      }
      activateFallbackWake.mockResolvedValue({
        status: "submitted",
        task: fallbackTask,
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: activationSubscriptionId,
        })
      ).resolves.toMatchObject({
        continuation: { kind: "activate_fallback" },
        outcome: { status: "failed" },
        state: "ready",
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage(activationSubscriptionId),
          nowMs: 1200,
        })
      ).resolves.toEqual({ status: "completed", task: fallbackTask });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage(activationSubscriptionId),
          nowMs: 1300,
        })
      ).resolves.toEqual({ status: "completed", task: fallbackTask });
      expect(activateFallbackWake).toHaveBeenCalledTimes(1);
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [
          { role: "primary", state: "terminal" },
          { role: "fallback", state: "active" },
        ],
        state: "active",
      });
    } finally {
      await harness.close();
    }
  });
  it("waits for active child cancellation before confirming the parent stop", async () => {
    const harness = await createHarness();
    const postWakeStop = vi
      .fn()
      .mockResolvedValueOnce({
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: null,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "requested" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-child",
        status: "cancellation_requested" as const,
        stopMode: "controller_control" as const,
        targetProfileId: childTask.targetProfileId,
      })
      .mockResolvedValueOnce({
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: 1250,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "cancelled" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-child",
        status: "cancelled" as const,
        stopMode: "controller_control" as const,
        targetProfileId: childTask.targetProfileId,
      });
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: "delegation-parent-stop",
        idempotencyKey: "delegation-key:parent-stop",
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-parent-stop",
        nowMs: 1010,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: {
          ...continuation,
          delegationId: "delegation-parent-stop",
        },
        db: harness.db,
        idempotencyKey: "subscription-key:parent-stop",
        nowMs: 1020,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-parent-stop",
        watchedTask: childTask,
      });
      resolveSpace.mockReturnValue({ rpcPostWakeStop: postWakeStop });
      const terminalInput = {
        db: harness.db,
        env: {} as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: "terminal:parent-stopped",
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped" as const,
        },
        task: parentTask,
      };
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome(terminalInput)
      ).rejects.toThrow("agent_task_parent_stop.cancellation_requested");
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome(terminalInput)
      ).resolves.toBeUndefined();
      expect(postWakeStop).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            reason: "Parent task was stopped.",
            target: {
              by: "client_message",
              clientMessageId: childTask.sourceClientMessageId,
              targetProfileId: childTask.targetProfileId,
            },
          },
          spaceId: childTask.spaceId,
        })
      );
      expect(postWakeStop).toHaveBeenCalledTimes(2);
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: "delegation-parent-stop",
        })
      ).resolves.toMatchObject({
        children: [{ state: "cancelled" }],
        state: "cancelled",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-parent-stop",
        })
      ).resolves.toMatchObject({ state: "cancelled" });
    } finally {
      await harness.close();
    }
  });
  it("maps a missing rpcPostWakeStop receiver method to stable Space unavailable", async () => {
    const harness = await createHarness();
    try {
      await arrangeActiveChildForParentStop(harness.db);
      resolveSpace.mockReturnValue(
        createProxyLikeSpaceStubWithMissingReceiverMethod("rpcPostWakeStop")
      );
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {} as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-rpc-skew",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("agent_task_parent_stop.space_unavailable");
    } finally {
      await harness.close();
    }
  });
  it.each([
    ["transport", "network connection lost"],
    [
      "business",
      'HTTP 409: {"ok":false,"error":{"code":"space.wake_stop.not_stoppable","message":"Wake is already terminal."}}',
    ],
  ])("preserves an unrelated %s error from rpcPostWakeStop", async (_errorKind, errorMessage) => {
    const harness = await createHarness();
    try {
      await arrangeActiveChildForParentStop(harness.db);
      resolveSpace.mockReturnValue({
        rpcPostWakeStop: vi.fn(() => Promise.reject(new Error(errorMessage))),
      });
      const rejection = await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env: {} as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: `terminal:parent-stop-${_errorKind}-error`,
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      }).then(
        () => null,
        (error: unknown) => error
      );
      const rejectionMessage =
        rejection instanceof Error ? rejection.message : String(rejection);
      expect(rejectionMessage).toContain(errorMessage);
      expect(rejectionMessage).not.toContain(
        "agent_task_parent_stop.space_unavailable"
      );
    } finally {
      await harness.close();
    }
  });
  it("preserves a missing nested receiver method that is not rpcPostWakeStop", async () => {
    const harness = await createHarness();
    try {
      await arrangeActiveChildForParentStop(harness.db);
      resolveSpace.mockReturnValue(
        createProxyLikeSpaceStubWithMissingReceiverMethod(
          "rpcReadWakeStopState"
        )
      );
      const rejection = await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env: {} as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: "terminal:parent-stop-nested-rpc-skew",
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      }).then(
        () => null,
        (error: unknown) => error
      );
      const rejectionMessage =
        rejection instanceof Error ? rejection.message : String(rejection);
      expect(rejectionMessage).toContain(
        'The RPC receiver does not implement the method "rpcReadWakeStopState".'
      );
      expect(rejectionMessage).not.toContain(
        "agent_task_parent_stop.space_unavailable"
      );
    } finally {
      await harness.close();
    }
  });
  it("attempts every child and continuation cancellation before reporting Stop failures", async () => {
    const harness = await createHarness();
    const subscriptionId = "subscription-stop-all-targets";
    const continuationIdempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const activeChildTask = {
      ...childTask,
      sourceClientMessageId: "client-stop-all-first",
    } satisfies AgentTaskHandle;
    const siblingTask = {
      ...childTask,
      sourceClientMessageId: "client-stop-all-sibling",
      targetProfileId: "agt_00000000-0000-4000-8000-000000000003",
    } satisfies AgentTaskHandle;
    const postWakeStop = vi.fn(async (request) => {
      await Promise.resolve();
      const target = request.body.target;
      if (target.clientMessageId === activeChildTask.sourceClientMessageId) {
        return {
          cancellationState: {
            acceptedAtMs: null,
            completedAtMs: null,
            reason: null,
            requestedAtMs: null,
            status: "not_requested" as const,
          },
          ok: false as const,
          reasonCode: "runtime_coordinator.wake_stop_target_not_found",
          runtimeCoordinatorExecutionId: null,
          status: "not_found" as const,
          targetProfileId: activeChildTask.targetProfileId,
        };
      }
      return {
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: null,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "requested" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-sibling",
        status: "cancellation_requested" as const,
        stopMode: "controller_control" as const,
        targetProfileId: siblingTask.targetProfileId,
      };
    });
    const cancelExecution = vi.fn((input) => {
      const { reason, ...identity } = input;
      return Promise.resolve({
        execution: {
          ...identity,
          acceptedAtMs: 1110,
          cancellationReason: reason ?? null,
          completedAtMs: null,
          lastProgressAtMs: 1200,
          lastProgressKind: "cancellation_requested" as const,
          status: "cancellation_requested" as const,
        },
        status: "cancellation_requested" as const,
      });
    });
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await insertContinuationDelivery({
        db: harness.db,
        idempotencyKey: continuationIdempotencyKey,
      });
      await createAgentDelegation({
        children: [activeChildTask, siblingTask].map((task) => ({
          agentProfileId: task.targetProfileId,
          role: "primary" as const,
          task,
        })),
        completionPolicy: { mode: "child_reports_directly" },
        db: harness.db,
        delegationId: "delegation-stop-all-targets",
        idempotencyKey: "delegation-key:stop-all-targets",
        nowMs: 1100,
        organizationId: "org-1",
        parentTask,
        spaceId: activeChildTask.spaceId,
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-stop-all-targets",
        nowMs: 1110,
      });
      resolveSpace.mockReturnValue({ rpcPostWakeStop: postWakeStop });
      const rejection = await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env: {
          OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
        } as unknown as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: "terminal:parent-stop-all-targets",
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      }).then(
        () => null,
        (error: unknown) => error
      );
      const rejectionMessage =
        rejection instanceof Error ? rejection.message : String(rejection);
      expect(rejectionMessage).toContain("agent_task_parent_stop.not_found");
      expect(rejectionMessage).toContain(
        "remote_agent.parent_stop_cancellation_pending"
      );
      expect(postWakeStop).toHaveBeenCalledTimes(2);
      expect(cancelExecution).toHaveBeenCalledTimes(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });
  it("stops active siblings after a first-success delegation already completed", async () => {
    const harness = await createHarness();
    const siblingTask = {
      ...childTask,
      sourceClientMessageId: "client-sibling",
      targetProfileId: "agt_00000000-0000-4000-8000-000000000003",
    } satisfies AgentTaskHandle;
    const postWakeStop = vi.fn(async () => ({
      cancellationState: {
        acceptedAtMs: 1100,
        completedAtMs: 1110,
        reason: null,
        requestedAtMs: 1100,
        status: "not_requested" as const,
      },
      ok: false as const,
      reasonCode: "runtime_coordinator.wake_stop_execution_terminal",
      runtimeCoordinatorExecutionId: "execution-sibling",
      status: "not_stoppable" as const,
      targetProfileId: siblingTask.targetProfileId,
    }));
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
          {
            agentProfileId: siblingTask.targetProfileId,
            role: "primary",
            task: siblingTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "first_success" },
        db: harness.db,
        delegationId: "delegation-first-success-stop",
        idempotencyKey: "delegation-key:first-success-stop",
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-first-success-stop",
        nowMs: 1010,
      });
      for (const [index, task] of [childTask, siblingTask].entries()) {
        await registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: {
            ...continuation,
            delegationId: "delegation-first-success-stop",
          },
          db: harness.db,
          idempotencyKey: `subscription-key:first-success-stop:${index}`,
          nowMs: 1020,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: `subscription-first-success-stop:${index}`,
          watchedTask: task,
        });
      }
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: {
          errorCode: null,
          eventId: "terminal:first-success",
          occurredAtMs: 1090,
          publishedSignalId: "signal:first-success",
          status: "succeeded",
        },
        task: childTask,
      });
      resolveSpace.mockReturnValue({ rpcPostWakeStop: postWakeStop });
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {} as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:first-success-parent-stopped",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).resolves.toBeUndefined();
      expect(postWakeStop).toHaveBeenCalledTimes(1);
      expect(postWakeStop).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            target: expect.objectContaining({
              clientMessageId: siblingTask.sourceClientMessageId,
            }),
          }),
        })
      );
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: "delegation-first-success-stop",
        })
      ).resolves.toMatchObject({
        children: [{ state: "terminal" }, { state: "cancelled" }],
        state: "cancelled",
      });
    } finally {
      await harness.close();
    }
  });
  it("cancels a claimed native continuation when Parent Stop wins the race", async () => {
    const harness = await createHarness();
    const subscriptionId = "subscription-native-continuation-stop";
    const continuationIdempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const cancelExecution = vi
      .fn(
        (
          input: RemoteAgentWorkerCancellationRequest
        ): Promise<RemoteAgentWorkerCancellationResponse> => {
          const {
            conversationId: _conversationId,
            reason,
            ...identity
          } = input;
          return Promise.resolve({
            execution: {
              ...identity,
              acceptedAtMs: 1110,
              cancellationReason: reason ?? null,
              completedAtMs: 1210,
              lastProgressAtMs: 1210,
              lastProgressKind: "aborted" as const,
              status: "aborted" as const,
            },
            status: "already_cancelled" as const,
          });
        }
      )
      .mockImplementationOnce((input) => {
        const { conversationId: _conversationId, reason, ...identity } = input;
        return Promise.resolve({
          execution: {
            ...identity,
            acceptedAtMs: 1110,
            cancellationReason: reason ?? null,
            completedAtMs: null,
            lastProgressAtMs: 1200,
            lastProgressKind: "cancellation_requested" as const,
            status: "cancellation_requested" as const,
          },
          status: "cancellation_requested" as const,
        });
      });
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await insertContinuationDelivery({
        db: harness.db,
        idempotencyKey: continuationIdempotencyKey,
      });
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
          } as unknown as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("remote_agent.parent_stop_cancellation_pending");
      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: continuationIdempotencyKey,
          reason: "Parent task was stopped.",
          submissionId: "submission-continuation-race",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
      });
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
          } as unknown as CoreBindings,
          nowMs: 1210,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation-retry",
            occurredAtMs: 1200,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).resolves.toBeUndefined();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps Parent Stop retryable when the native continuation cannot be found", async () => {
    const harness = await createHarness();
    const subscriptionId = "subscription-native-continuation-missing";
    const continuationIdempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const cancelExecution = vi.fn(
      (
        input: RemoteAgentWorkerCancellationRequest
      ): Promise<RemoteAgentWorkerCancellationResponse> => {
        const { conversationId: _conversationId, reason, ...identity } = input;
        return Promise.resolve({
          execution: {
            ...identity,
            acceptedAtMs: 1110,
            cancellationReason: reason ?? null,
            completedAtMs: 1210,
            lastProgressAtMs: 1210,
            lastProgressKind: "aborted" as const,
            status: "aborted" as const,
          },
          status: "already_cancelled" as const,
        });
      }
    );
    cancelExecution.mockResolvedValueOnce({ status: "not_found" });
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await insertContinuationDelivery({
        db: harness.db,
        idempotencyKey: continuationIdempotencyKey,
      });
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: {
              cancelExecution,
            },
          } as unknown as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation-missing",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("remote_agent.parent_stop_execution_not_found");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
      });
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
          } as unknown as CoreBindings,
          nowMs: 1210,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation-retry",
            occurredAtMs: 1200,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).resolves.toBeUndefined();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("does not treat an unproven missing child as a successful Parent Stop", async () => {
    const harness = await createHarness();
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: "delegation-parent-stop-not-found",
        idempotencyKey: "delegation-key:parent-stop-not-found",
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-parent-stop-not-found",
        nowMs: 1010,
      });
      resolveSpace.mockReturnValue({
        rpcPostWakeStop: vi.fn(async () => ({
          cancellationState: {
            acceptedAtMs: null,
            completedAtMs: null,
            reason: null,
            requestedAtMs: null,
            status: "not_requested" as const,
          },
          ok: false as const,
          reasonCode: "runtime_coordinator.wake_stop_target_not_found",
          runtimeCoordinatorExecutionId: null,
          status: "not_found" as const,
          targetProfileId: childTask.targetProfileId,
        })),
      });
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {} as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-not-found",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("agent_task_parent_stop.not_found");
    } finally {
      await harness.close();
    }
  });
});
async function arrangeActiveChildForParentStop(
  db: PostgresDatabase
): Promise<void> {
  await insertParentDelivery(db);
  await createAgentDelegation({
    children: [
      {
        agentProfileId: childTask.targetProfileId,
        role: "primary",
        task: childTask,
      },
    ],
    completionPolicy: { mode: "child_reports_directly" },
    db,
    delegationId: "delegation-parent-stop-rpc-skew",
    idempotencyKey: "delegation-key:parent-stop-rpc-skew",
    nowMs: 1000,
    organizationId: "org-1",
    parentTask,
    spaceId: childTask.spaceId,
  });
  await activateAgentDelegationChildren({
    db,
    delegationId: "delegation-parent-stop-rpc-skew",
    nowMs: 1010,
  });
}
function createProxyLikeSpaceStubWithMissingReceiverMethod(
  methodName: string
): object {
  return new Proxy(
    {},
    {
      get: () => () =>
        Promise.reject(
          new Error(
            `The RPC receiver does not implement the method "${methodName}".`
          )
        ),
    }
  );
}
async function arrangeReadySubscription(
  db: PostgresDatabase,
  subscriptionId: string
): Promise<void> {
  await insertParentDelivery(db);
  await createAgentDelegation({
    children: [
      {
        agentProfileId: childTask.targetProfileId,
        role: "primary",
        task: childTask,
      },
    ],
    completionPolicy: { mode: "resume_parent", when: "all_terminal" },
    db,
    delegationId: `delegation:${subscriptionId}`,
    idempotencyKey: `delegation-key:${subscriptionId}`,
    nowMs: 999,
    organizationId: "org-1",
    parentTask,
    spaceId: "space-child",
  });
  await registerAgentTaskCompletionSubscription({
    completionCondition: "terminal",
    continuation: {
      ...continuation,
      delegationId: `delegation:${subscriptionId}`,
    },
    db,
    idempotencyKey: `subscription-key:${subscriptionId}`,
    nowMs: 1000,
    observerTask: parentTask,
    organizationId: "org-1",
    subscriptionId,
    watchedTask: childTask,
  });
  await recordAgentTaskTerminalOutcome({
    db,
    nowMs: 1100,
    outcome: {
      errorCode: null,
      eventId: `terminal:${subscriptionId}`,
      occurredAtMs: 1090,
      publishedSignalId: "signal-child-result",
      status: "succeeded",
    },
    task: childTask,
  });
}
async function arrangeReadyTaskWatchSubscription(
  db: PostgresDatabase,
  subscriptionId: string
): Promise<void> {
  await insertParentDelivery(db);
  await registerAgentTaskCompletionSubscription({
    completionCondition: "terminal",
    continuation: {
      instruction: "Continue after the exact parallel task completes.",
      kind: "resume_task_watch",
      sourceSignalId: "signal-parent",
      spaceId: "space-parent",
      threadContext: null,
      watchId: "watch-task-watch",
    },
    db,
    idempotencyKey: `task-watch-key:${subscriptionId}`,
    nowMs: 1000,
    observerTask: parentTask,
    organizationId: "org-1",
    subscriptionId,
    watchedTask: childTask,
  });
  await recordAgentTaskTerminalOutcome({
    db,
    nowMs: 1100,
    outcome: {
      errorCode: null,
      eventId: `terminal:${subscriptionId}`,
      occurredAtMs: 1090,
      publishedSignalId: "signal-child-result",
      status: "succeeded",
    },
    task: childTask,
  });
}
function buildQueueMessage(subscriptionId: string) {
  return {
    enqueuedAtMs: 1100,
    idempotencyKey: `agent-task-continuation-event:${subscriptionId}`,
    kind: "agent_task_continuation" as const,
    subscriptionId,
    v: 4 as const,
  };
}
async function createHarness() {
  const harness = await createPostgresHarness();
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id, name, email) VALUES ('user-parent', 'Requester', 'requester@example.test')`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ('org-1', 'Organization', 'org-1', 1700000000000)`,
  });
  return harness;
}
async function insertParentDelivery(db: PostgresDatabase): Promise<void> {
  await db.query({
    ...{
      text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          dispatch_id,
          idempotency_key,
          submission_id,
          status,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, 'space', $3, $4, $5, $6, $7, $8, $9, 'accepted', $10, $11, $12, $13, $14)
      `,
      values: [],
    },
    values: [
      "delivery-parent",
      "org-1",
      "space-parent",
      "agt_00000000-0000-4000-8000-000000000001",
      "binding-parent",
      "signal-parent",
      "dispatch-parent",
      "idempotency-parent",
      "submission-parent",
      "11111111-1111-4111-8111-111111111111",
      "user-parent",
      "Felix",
      900,
      900,
    ],
  });
}
async function insertContinuationDelivery(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  deliveryId?: string;
}): Promise<void> {
  await input.db.query({
    ...{
      text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          dispatch_id,
          idempotency_key,
          submission_id,
          status,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, 'space', $3, $4, $5, $6, $7, $8, $9, 'accepted', $10, $11, $12, $13, $14)
      `,
      values: [],
    },
    values: [
      input.deliveryId ?? "delivery-continuation-race",
      "org-1",
      "space-parent",
      "agt_00000000-0000-4000-8000-000000000001",
      "binding-parent",
      "signal-parent",
      input.deliveryId
        ? `dispatch:${input.deliveryId}`
        : "dispatch-continuation-race",
      input.idempotencyKey,
      input.deliveryId
        ? `submission:${input.deliveryId}`
        : "submission-continuation-race",
      "11111111-1111-4111-8111-111111111111",
      "user-parent",
      "Felix",
      1110,
      1110,
    ],
  });
}
