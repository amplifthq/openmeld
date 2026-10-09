import {
  buildAgentTaskKey,
  RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  RuntimeCoordinatorFinalizationCommand,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { retryReadyAgentTaskContinuations } from "../src/agent-task-coordination/application/agent-task-terminal-outcome-service";
import {
  recordRuntimeCoordinatorExecutionFailureTaskOutcome,
  recordRuntimeCoordinatorFinalizationTaskOutcome,
  recordRuntimeCoordinatorStoppedTaskOutcome,
} from "../src/agent-task-coordination/application/runtime-coordinator-task-outcome";
import {
  readAgentTaskCompletionSubscription,
  readAgentTaskTerminalOutcome,
  recordAgentTaskTerminalOutcome,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { retryPendingPreHeadFailurePublications } from "../src/dispatch/application/dispatch-queue-service";
import {
  buildDispatchSystemRequestContext,
  buildDispatchSystemSpaceAccess,
} from "../src/dispatch/application/dispatch-space-access";
import {
  claimPreHeadFailurePublicationIntent,
  createPreHeadFailurePublicationIntent,
  createPreHeadFailureRedriveMessage,
  ensurePreHeadFailurePublicationIntent,
  listDuePreHeadFailurePublicationIntents,
  markPreHeadFailurePublicationCompleted,
  readPreHeadFailurePublicationState,
  reschedulePreHeadFailurePublicationIntent,
} from "../src/dispatch/infrastructure/postgresql/pre-head-failure-publication-outbox-repository";
import {
  DISPATCH_HINT_SYSTEM_PROFILE_ID,
  DISPATCH_HINT_SYSTEM_PROFILE_NAME,
} from "../src/dispatch/rules/dispatch-hint-policy";
import { OPENMELD_DAEMON_DISPATCH_STATE } from "../src/dispatch/rules/dispatch-lifecycle-contract";
import { handleDispatchQueueBatch } from "../src/dispatch/transport/queue/dispatch-queue-consumer";
import type { CoreBindings } from "../src/lib/bindings";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../src/runtime-transport/application/runtime-coordinator-authority";
import type { Space } from "../src/space/transport/do/space";

import {
  createPostgresHarness,
  installPostgresWriteFailure,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const createDispatchMessage = (): OpenMeldDaemonDispatchQueueMessage => ({
  v: 2,
  autoRelayDepth: 0,
  contextIdMappingSpec: null,
  controllerSnapshot: {
    agentControllerRef: null,
    targetBindingEnabled: true,
    targetBindingState: "bound",
  },
  dispatchChainId: "dispatch-outbox-1",
  dispatchContractVersion: 2,
  dispatchId: "dispatch-outbox-1",
  dispatchPolicy: "mention_only",
  dispatchRulesSnapshot: {
    dispatchPolicy: "mention_only",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    ruleSource: "registry",
  },
  dispatchSnapshot: {
    dispatchPolicy: "mention_only",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    ruleSource: "registry",
    targetBindingEnabled: true,
    targetBindingState: "bound",
  },
  enqueuedAtMs: 1000,
  idempotencyKey: "5:event|5:agent",
  ruleId: "registry.default.all_members.v1",
  ruleReason: "default allow all members mention",
  ruleSource: "registry",
  sourceEventId: "event-outbox-1",
  spaceId: "space-1",
  targetProfileId: "agt_00000000-0000-4000-8000-000000000001",
  taskId: "task-outbox-1",
  transportMode: null,
  visitedProfileIds: [],
  visitedProfileIdsHash: "stable32:outbox",
});

describe("pre-head failure publication operational outbox", () => {
  it.each([
    { claim: "failure", status: "failed", stored: false, fault: null },
    { claim: "success", status: "succeeded", stored: false, fault: null },
    { claim: "stopped", status: "stopped", stored: false, fault: null },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "other_producer",
    },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "legacy_identity",
    },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "legacy_attention_write",
    },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "legacy_attention_mark",
    },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "legacy_attention_queue",
    },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "legacy_unpublished",
    },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "old_receiver",
    },
    { claim: "success", status: "succeeded", stored: true, fault: null },
    { claim: "stopped", status: "stopped", stored: true, fault: null },
    { claim: "failure", status: "failed", stored: false, fault: "task_write" },
    { claim: "failure", status: "failed", stored: false, fault: "claim_read" },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "missing_claim",
    },
    {
      claim: "failure",
      status: "failed",
      stored: false,
      fault: "unknown_claim",
    },
    {
      claim: "success",
      status: "succeeded",
      stored: true,
      fault: "task_conflict",
    },
  ] as const)("settles the exact child from the saved $claim receipt (stored=$stored, fault=$fault) before completing publication", async ({
    claim,
    status,
    stored,
    fault,
  }) => {
    const harness = await createPostgresHarness();
    const legacyAttention =
      fault === "legacy_identity" || fault?.startsWith("legacy_attention_");
    const message = {
      ...createDispatchMessage(),
      sourceClientMessageId: "client-pre-head-1",
      spaceId: "a".repeat(64),
    };
    const task = {
      kind: "space_wake" as const,
      sourceClientMessageId: message.sourceClientMessageId,
      spaceId: message.spaceId,
      targetProfileId: message.targetProfileId,
      v: 1 as const,
    };
    const context = buildDispatchSystemRequestContext({
      message,
      requestIdPrefix: "test-pre-head",
    });
    const intent = createPreHeadFailurePublicationIntent({
      attemptId: "attempt-outbox-1",
      createdAtMs: 1000,
      dispatchMessage: message,
      errorCode: "profile.workspace.missing",
      finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
      idempotencyKey: message.idempotencyKey,
      publicationCommand: {
        context,
        ...(legacyAttention || fault === "legacy_unpublished"
          ? {}
          : {
              preHeadFailurePublication: {
                signalId: "86c5b365-4f68-4fd7-8cd2-0f1a72f471b3",
              },
            }),
        data: {
          actorProfileId: message.targetProfileId,
          dispatchId: message.dispatchId,
          failureStage: "execution",
          generatedBy: "openmeld",
          noticeType: "terminal_failure",
          reason: "profile.workspace.missing",
          reasonCode: "profile.workspace.missing",
          text: "Choose a working folder before retrying this task.",
        },
        profile: {
          kind: "system",
          profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
          profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
        },
        spaceAccess: buildDispatchSystemSpaceAccess({
          message,
          requestIdPrefix: "test-pre-head",
        }),
        spaceId: message.spaceId,
      },
    });
    const queueSend = vi.fn(async () => undefined);
    const foreignProducer =
      claim !== "failure" || fault === "other_producer" || legacyAttention;
    let publishedSignalId = foreignProducer
      ? `saved-${claim}`
      : "86c5b365-4f68-4fd7-8cd2-0f1a72f471b3";
    const errorCode = {
      failure: "profile.workspace.missing",
      success: null,
      stopped: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
    }[claim];
    const existingOutcome = {
      status,
      errorCode,
      eventId: "original-terminal-event",
      occurredAtMs: 1800,
      publishedSignalId:
        fault === "task_conflict" ? "prior-result" : publishedSignalId,
    };
    const space: Pick<
      Space,
      "rpcPostSystemNoticeSignal" | "rpcReadFinalReplyClaimOutcome"
    > &
      Partial<Pick<Space, "rpcPostPreHeadFailureNoticeSignal">> = {
      rpcPostPreHeadFailureNoticeSignal: vi.fn(async (request) => {
        const frozen = await readPreHeadFailurePublicationState({
          db: harness.db,
          dispatchId: message.dispatchId,
        });
        expect(frozen).toMatchObject({
          status: "pending",
          intent: {
            publicationCommand: {
              preHeadFailurePublication: {
                signalId: request.preHeadFailurePublication.signalId,
              },
            },
          },
        });
        if (fault === "legacy_unpublished") {
          publishedSignalId = request.preHeadFailurePublication.signalId;
        }
        return {
          v: 1 as const,
          id: request.preHeadFailurePublication.signalId,
          ts: 1000,
          spaceId: message.spaceId,
          profile: request.profile,
          type: "signal.system_notice" as const,
          data: request.data,
        };
      }),
      rpcPostSystemNoticeSignal: vi.fn(async () => ({
        v: 1 as const,
        id: "visible-failure",
        ts: 1000,
        spaceId: message.spaceId,
        profile: intent.publicationCommand.profile,
        type: "signal.system_notice" as const,
        data: intent.publicationCommand.data,
      })),
      rpcReadFinalReplyClaimOutcome: vi.fn(async () => ({
        outcome: claim,
        signalId: publishedSignalId,
      })),
    };
    const env = {
      OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
      OPENMELD_SPACES: { idFromString: () => ({}), get: () => space },
    } as unknown as CoreBindings;
    const clock = vi.spyOn(Date, "now").mockReturnValue(5000);
    let removeWriteFault: (() => Promise<void>) | undefined;
    try {
      await ensurePreHeadFailurePublicationIntent({ db: harness.db, intent });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: {
          kind: "resume_task_watch",
          instruction: "Report the result of this task.",
          watchId: "watch-pre-head-1",
        },
        db: harness.db,
        idempotencyKey: "observe-pre-head-1",
        nowMs: 1000,
        observerTask: {
          kind: "native_delivery",
          deliveryId: "parent-delivery",
          v: 1,
        },
        organizationId: "org-1",
        subscriptionId: "observe-pre-head-1",
        watchedTask: task,
      });
      if (legacyAttention) {
        await registerAgentTaskCompletionSubscription({
          completionCondition: "needs_attention",
          continuation: {
            kind: "resume_task_watch",
            instruction: "Report the blocker without restarting this task.",
            watchId: "watch-pre-head-attention",
          },
          db: harness.db,
          idempotencyKey: "observe-pre-head-attention",
          nowMs: 1000,
          observerTask: {
            kind: "native_delivery",
            deliveryId: "parent-delivery",
            v: 1,
          },
          organizationId: "org-1",
          subscriptionId: "observe-pre-head-attention",
          watchedTask: task,
        });
      }
      if (stored) {
        await recordAgentTaskTerminalOutcome({
          db: harness.db,
          nowMs: 1000,
          task,
          outcome: existingOutcome,
        });
      }
      if (
        fault === "legacy_attention_write" ||
        fault === "legacy_attention_mark"
      ) {
        removeWriteFault = await installPostgresWriteFailure({
          harness,
          table:
            fault === "legacy_attention_write"
              ? "agent_task_needs_attention_observations"
              : "openMeldDaemon_pre_head_failure_publication_outbox",
          operation: fault === "legacy_attention_write" ? "INSERT" : "UPDATE",
          ...(fault === "legacy_attention_mark"
            ? { condition: "NEW.status = 'needs_attention'" }
            : {}),
          message: "Attention projection unavailable",
        });
      } else if (fault === "legacy_attention_queue") {
        queueSend.mockRejectedValueOnce(
          new Error("Continuation Queue unavailable")
        );
      } else if (fault === "task_write") {
        removeWriteFault = await installPostgresWriteFailure({
          harness,
          table: "agent_task_terminal_outcomes",
          operation: "INSERT",
          message: "Task projection unavailable",
        });
      } else if (fault === "claim_read") {
        vi.mocked(space.rpcReadFinalReplyClaimOutcome).mockRejectedValueOnce(
          new Error("Space claim read unavailable")
        );
      } else if (fault === "missing_claim") {
        vi.mocked(space.rpcReadFinalReplyClaimOutcome).mockResolvedValueOnce({
          outcome: null,
          signalId: null,
        });
      } else if (fault === "unknown_claim") {
        vi.mocked(space.rpcReadFinalReplyClaimOutcome).mockResolvedValueOnce({
          outcome: "unknown",
          signalId: publishedSignalId,
        });
      } else if (fault === "legacy_unpublished") {
        vi.mocked(space.rpcReadFinalReplyClaimOutcome).mockResolvedValueOnce({
          outcome: null,
          signalId: null,
        });
      }
      const supportedReceiver = space.rpcPostPreHeadFailureNoticeSignal;
      if (fault === "old_receiver") {
        Reflect.deleteProperty(space, "rpcPostPreHeadFailureNoticeSignal");
      }
      const ack = vi.fn();
      const input = {
        batch: {
          messages: [
            {
              ack,
              attempts: 1,
              body: intent.redriveMessage,
              id: "queue-pre-head-1",
              retry: vi.fn(),
              timestamp: new Date(1000),
            },
          ],
        } as unknown as MessageBatch<unknown>,
        env,
      };
      await handleDispatchQueueBatch(input);
      if (legacyAttention) {
        if (removeWriteFault) {
          expect(
            await readPreHeadFailurePublicationState({
              db: harness.db,
              dispatchId: message.dispatchId,
            })
          ).toMatchObject({ status: "pending" });
          await removeWriteFault();
          removeWriteFault = undefined;
          clock.mockReturnValue(90_000);
          await handleDispatchQueueBatch(input);
        }
        const observation = {
          attentionCode: "dispatch.pre_head_failure_legacy_claim_unattributed",
          eventId: `pre-head:${message.dispatchId}:legacy-claim:${publishedSignalId}`,
          occurredAtMs: intent.createdAtMs,
          status: "needs_attention",
        };
        expect(
          await readAgentTaskCompletionSubscription({
            db: harness.db,
            subscriptionId: "observe-pre-head-attention",
          })
        ).toMatchObject({ outcome: observation, state: "ready" });
        expect(
          await readPreHeadFailurePublicationState({
            db: harness.db,
            dispatchId: message.dispatchId,
          })
        ).toMatchObject({
          status: "needs_attention",
          reasonCode: "dispatch.pre_head_failure_legacy_claim_unattributed",
        });
        expect(
          await readAgentTaskTerminalOutcome({
            db: harness.db,
            taskKey: buildAgentTaskKey(task),
          })
        ).toBeNull();
        expect(
          await readAgentTaskCompletionSubscription({
            db: harness.db,
            subscriptionId: "observe-pre-head-1",
          })
        ).toMatchObject({ outcome: null, state: "pending" });
        const late = await registerAgentTaskCompletionSubscription({
          completionCondition: "needs_attention",
          continuation: {
            kind: "resume_task_watch",
            instruction: "Report the original blocker.",
            watchId: "watch-pre-head-attention-late",
          },
          db: harness.db,
          idempotencyKey: "observe-pre-head-attention-late",
          nowMs: 91_000,
          observerTask: {
            kind: "native_delivery",
            deliveryId: "parent-delivery",
            v: 1,
          },
          organizationId: "org-1",
          subscriptionId: "observe-pre-head-attention-late",
          watchedTask: task,
        });
        expect(late).toMatchObject({ outcome: observation, state: "ready" });
        queueSend.mockClear();
        expect(
          await retryReadyAgentTaskContinuations({
            db: harness.db,
            env,
            nowMs: 92_000,
          })
        ).toEqual({ enqueuedCount: 2 });
        expect(queueSend).toHaveBeenCalledTimes(2);
        queueSend.mockClear();
        expect(space.rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
        expect(space.rpcPostPreHeadFailureNoticeSignal).not.toHaveBeenCalled();
        expect(
          await retryPendingPreHeadFailurePublications({
            db: harness.db,
            env,
            nowMs: 90_000,
          })
        ).toEqual({ enqueued: 0, errors: 0, scanned: 0 });
        clock.mockReturnValue(90_000);
        await handleDispatchQueueBatch(input);
        expect(ack).toHaveBeenCalledTimes(
          fault === "legacy_attention_write" ||
            fault === "legacy_attention_mark"
            ? 3
            : 2
        );
        expect(queueSend).not.toHaveBeenCalled();
        const observations = await harness.db.query<{ count: string }>({
          text: 'SELECT count(*)::text AS count FROM "openmeld"."agent_task_needs_attention_observations" WHERE task_key = $1',
          values: [buildAgentTaskKey(task)],
        });
        expect(observations.rows[0]?.count).toBe("1");
        return;
      }
      if (fault === "task_conflict") {
        expect(
          await readPreHeadFailurePublicationState({
            db: harness.db,
            dispatchId: message.dispatchId,
          })
        ).toMatchObject({ status: "pending" });
        expect(
          await readAgentTaskTerminalOutcome({
            db: harness.db,
            taskKey: buildAgentTaskKey(task),
          })
        ).toMatchObject({ outcome: existingOutcome });
        expect(queueSend).toHaveBeenCalledWith(
          intent.redriveMessage,
          expect.anything()
        );
        return;
      }
      if (
        (fault && fault !== "legacy_unpublished") ||
        (!stored && foreignProducer)
      ) {
        expect(
          await readPreHeadFailurePublicationState({
            db: harness.db,
            dispatchId: message.dispatchId,
          })
        ).toMatchObject({ status: "pending" });
        expect(
          await readAgentTaskTerminalOutcome({
            db: harness.db,
            taskKey: buildAgentTaskKey(task),
          })
        ).toBeNull();
        expect(queueSend).toHaveBeenCalledWith(
          intent.redriveMessage,
          expect.anything()
        );
        await removeWriteFault?.();
        removeWriteFault = undefined;
        if (fault === "old_receiver") {
          expect(space.rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
          space.rpcPostPreHeadFailureNoticeSignal = supportedReceiver;
        }
        if (foreignProducer) {
          // The original producer replays after saving a visible claim but
          // before writing Task state. Use its real writer, not a synthesized
          // recovery event: exact equality must still accept the replay.
          if (claim === "success") {
            const result =
              await recordRuntimeCoordinatorFinalizationTaskOutcome({
                command: buildSuccessfulFinalizationCommand(message),
                db: harness.db,
                env,
                finalMessageKind: "success_reply",
                publishedSignalId,
                publishState: "reply_published",
              });
            expect(result?.matches).toBe(true);
          } else {
            const writer =
              claim === "stopped"
                ? recordRuntimeCoordinatorStoppedTaskOutcome
                : recordRuntimeCoordinatorExecutionFailureTaskOutcome;
            await writer({
              db: harness.db,
              env,
              eventId: existingOutcome.eventId,
              occurredAtMs: existingOutcome.occurredAtMs,
              publishedSignalId,
              reasonCode: errorCode ?? "unexpected_success",
              sourceClientMessageId: message.sourceClientMessageId,
              spaceId: message.spaceId,
              targetProfileId: message.targetProfileId,
            });
          }
        }
        clock.mockReturnValue(90_000);
        await handleDispatchQueueBatch(input);
      }
      if (stored) {
        await retryReadyAgentTaskContinuations({
          db: harness.db,
          env,
          nowMs: 90_000,
        });
      }
      expect(
        await readAgentTaskTerminalOutcome({
          db: harness.db,
          taskKey: buildAgentTaskKey(task),
        })
      ).toMatchObject({
        outcome: {
          ...(stored || foreignProducer ? existingOutcome : {}),
          status,
          errorCode,
          publishedSignalId,
        },
      });
      expect(
        await readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "observe-pre-head-1",
        })
      ).toMatchObject({ state: "ready" });
      expect(queueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "agent_task_continuation",
          subscriptionId: "observe-pre-head-1",
        })
      );
      expect(
        await readPreHeadFailurePublicationState({
          db: harness.db,
          dispatchId: message.dispatchId,
        })
      ).toEqual({ status: "completed" });
      expect(ack).toHaveBeenCalledTimes(
        (fault && fault !== "legacy_unpublished") ||
          (!stored && foreignProducer)
          ? 2
          : 1
      );
    } finally {
      clock.mockRestore();
      await removeWriteFault?.();
      await harness.close();
    }
  });
  it("recovers an overdue frozen command with versioned claim and completion fencing", async () => {
    const harness = await createPostgresHarness();
    const db = harness.db;
    try {
      const redriveMessage = createPreHeadFailureRedriveMessage(
        createDispatchMessage()
      );
      const context = buildDispatchSystemRequestContext({
        message: redriveMessage,
        requestIdPrefix: "openMeldDaemon-dispatch-hint",
      });
      const intent = createPreHeadFailurePublicationIntent({
        attemptId: "attempt-outbox-1",
        createdAtMs: 1000,
        dispatchMessage: redriveMessage,
        errorCode: "agent_profile_binding.profile_owner_invalid",
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        idempotencyKey: redriveMessage.idempotencyKey,
        publicationCommand: {
          context,
          data: {
            actorProfileId: redriveMessage.targetProfileId,
            dispatchId: redriveMessage.dispatchId,
            failureStage: "execution",
            generatedBy: "openmeld",
            noticeType: "terminal_failure",
            reason: "agent_profile_binding.profile_owner_invalid",
            reasonCode: "agent_profile_binding.profile_owner_invalid",
            text: "This agent no longer exists, so this Wake cannot be delivered.",
          },
          profile: {
            kind: "system",
            profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
            profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
          },
          spaceAccess: buildDispatchSystemSpaceAccess({
            message: redriveMessage,
            requestIdPrefix: "openMeldDaemon-dispatch-hint",
          }),
          spaceId: redriveMessage.spaceId,
        },
      });

      await expect(
        ensurePreHeadFailurePublicationIntent({ db, intent })
      ).resolves.toEqual(intent);
      await expect(
        listDuePreHeadFailurePublicationIntents({
          db,
          limit: 10,
          nowMs: 45 * 24 * 60 * 60 * 1000,
        })
      ).resolves.toEqual([intent]);

      const queueSend = vi.fn().mockResolvedValue(undefined);
      await expect(
        retryPendingPreHeadFailurePublications({
          db,
          env: {
            OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
          } as unknown as CoreBindings,
          nowMs: 2000,
        })
      ).resolves.toEqual({ enqueued: 1, errors: 0, scanned: 1 });
      expect(queueSend).toHaveBeenCalledWith(intent.redriveMessage);

      const claimed = await claimPreHeadFailurePublicationIntent({
        claimId: "claim-outbox-1",
        db,
        dispatchId: intent.dispatchId,
        nowMs: 2000,
      });
      expect(claimed).toMatchObject({
        outcome: "claimed",
        intent: {
          claimId: "claim-outbox-1",
          stateVersion: 1,
        },
      });
      await expect(
        claimPreHeadFailurePublicationIntent({
          claimId: "claim-outbox-2",
          db,
          dispatchId: intent.dispatchId,
          nowMs: 2000,
        })
      ).resolves.toEqual({ outcome: "busy" });
      if (claimed.outcome !== "claimed") {
        throw new Error("expected the first outbox claim to win");
      }

      await reschedulePreHeadFailurePublicationIntent({
        db,
        intent: claimed.intent,
        nextAttemptAtMs: 3000,
        nowMs: 2500,
      });
      const reclaimed = await claimPreHeadFailurePublicationIntent({
        claimId: "claim-outbox-3",
        db,
        dispatchId: intent.dispatchId,
        nowMs: 3000,
      });
      expect(reclaimed).toMatchObject({
        outcome: "claimed",
        intent: {
          attemptCount: 1,
          claimId: "claim-outbox-3",
          stateVersion: 3,
        },
      });
      if (reclaimed.outcome !== "claimed") {
        throw new Error("expected the rescheduled outbox row to be claimable");
      }
      await markPreHeadFailurePublicationCompleted({
        completedAtMs: 4000,
        db,
        intent: reclaimed.intent,
      });
      await expect(
        readPreHeadFailurePublicationState({
          db,
          dispatchId: intent.dispatchId,
        })
      ).resolves.toEqual({ status: "completed" });
    } finally {
      await harness.close();
    }
  });
});

function buildSuccessfulFinalizationCommand(
  message: OpenMeldDaemonDispatchQueueMessage
): RuntimeCoordinatorFinalizationCommand {
  return {
    acceptedResult: {
      acceptedAtMs: 1800,
      attemptId: "attempt-outbox-1",
      daemonSessionId: "daemon-session-1",
      dispatchId: message.dispatchId,
      executionTokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      executionTokenRunId: "run-1",
      leaseEpoch: 1,
      runtimeCoordinatorExecutionId: "execution-1",
      submittedConnectionGeneration: 1,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
      taskResult: {
        code: "service.task_result",
        payload: {
          agentId: message.targetProfileId,
          attemptId: "attempt-outbox-1",
          deduped: false,
          output: "Done",
          sourceEventId: message.sourceEventId,
          status: "success",
          taskId: message.taskId,
          telemetry: {
            completedAtMs: 1800,
            invokedAtMs: 1700,
            resumedContext: false,
          },
        },
        v: 4,
      },
    },
    createdAtMs: 1850,
    dispatchFact: {
      attemptId: "attempt-outbox-1",
      dispatchId: message.dispatchId,
      dispatchOwner: { id: "owner-1", kind: "owner_account" },
      enqueuedAtMs: message.enqueuedAtMs,
      idempotencyKey: message.idempotencyKey,
      sourceClientMessageId: message.sourceClientMessageId ?? null,
      sourceEventId: message.sourceEventId,
      spaceId: message.spaceId,
      targetProfileId: message.targetProfileId,
      taskId: message.taskId,
    },
    dispatchId: message.dispatchId,
    executionTokenRunId: "run-1",
    finalizationCommandId: "original-terminal-event",
    modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
    publicationIdempotencyKey: "publication-1",
    resultIdempotencyKey: "result-1",
    runtimeCoordinatorExecutionId: "execution-1",
    spaceId: message.spaceId,
    targetOwnerUserId: "owner-1",
    targetProfileId: message.targetProfileId,
    targetProfileMentionLabel: null,
    targetProfileName: "Child Agent",
  };
}
