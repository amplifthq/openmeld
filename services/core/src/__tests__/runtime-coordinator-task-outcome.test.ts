import {
  RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
  RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
  TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import type {
  RuntimeCoordinatorFailurePublicationCommand,
  RuntimeCoordinatorFinalizationCommand,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  projectRuntimeCoordinatorFailureTaskTerminalRecord,
  projectRuntimeCoordinatorFinalizationTaskTerminalRecord,
  projectRuntimeCoordinatorPublicationFailedTaskTerminalRecord,
  projectRuntimeCoordinatorStoppedTaskTerminalRecord,
} from "../agent-task-coordination/application/runtime-coordinator-task-outcome";
import { resolveRuntimeCoordinatorFinalizationSemantic } from "../runtime-transport/application/runtime-coordinator-finalization-semantic";

describe("RuntimeCoordinator Agent Task terminal projection", () => {
  it("requires the verified final message kind for an implicit reply", () => {
    const implicitSuccess = buildFinalizationCommand({
      acceptedResult: {
        taskResult: {
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            output: "Done",
            sourceEventId: "signal-child",
            status: "success",
            taskId: "task-1",
          },
          v: 4,
        },
      },
    });
    expect(
      resolveRuntimeCoordinatorFinalizationSemantic({
        publishState: "reply_published",
        taskResult: implicitSuccess.acceptedResult.taskResult,
      })
    ).toEqual({
      reasonCode: "agent_task.invalid_space_action",
      status: "failed",
    });
    expect(
      resolveRuntimeCoordinatorFinalizationSemantic({
        finalMessageKind: "success_reply",
        publishState: "reply_published",
        taskResult: implicitSuccess.acceptedResult.taskResult,
      })
    ).toEqual({ reasonCode: null, status: "succeeded" });
    expect(
      resolveRuntimeCoordinatorFinalizationSemantic({
        finalMessageKind: "failure_notice",
        publishState: "reply_published",
        taskResult: implicitSuccess.acceptedResult.taskResult,
      })
    ).toEqual({
      reasonCode: "agent_task.invalid_space_action",
      status: "failed",
    });
    expect(
      resolveRuntimeCoordinatorFinalizationSemantic({
        finalMessageKind: "success_reply",
        publishState: "invalid_space_action",
        taskResult: implicitSuccess.acceptedResult.taskResult,
      })
    ).toEqual({
      reasonCode: "agent_task.invalid_space_action",
      status: "failed",
    });
  });

  it("uses the verified final message kind instead of the planned Space action", () => {
    const plannedSilence = buildFinalizationCommand({
      acceptedResult: {
        taskResult: {
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            output: "Done",
            sourceEventId: "signal-child",
            spaceAction: {
              reason: "No public reply is needed.",
              type: "stay_silent",
            },
            status: "success",
            taskId: "task-1",
          },
          v: 4,
        },
      },
    });

    expect(
      resolveRuntimeCoordinatorFinalizationSemantic({
        finalMessageKind: "success_reply",
        publishState: "reply_published",
        taskResult: plannedSilence.acceptedResult.taskResult,
      })
    ).toEqual({ reasonCode: null, status: "succeeded" });
  });

  it("does not treat non-visible silence as a successful Wake outcome", () => {
    const internalOnly = buildFinalizationCommand({
      acceptedResult: {
        taskResult: {
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            output: "No public reply is needed.",
            sourceEventId: "signal-child",
            status: "success",
            suppressPublicOutcome: true,
            taskId: "task-1",
          },
          v: 4,
        },
      },
    });

    expect(
      projectRuntimeCoordinatorFinalizationTaskTerminalRecord({
        command: internalOnly,
        finalMessageKind: "stay_silent",
        publishedSignalId: null,
        publishState: "invalid_space_action",
      })?.outcome
    ).toMatchObject({
      errorCode: "agent_task.invalid_space_action",
      publishedSignalId: null,
      status: "failed",
    });
  });

  it("projects a published child reply as succeeded", () => {
    const command = buildFinalizationCommand({
      acceptedResult: {
        taskResult: {
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            output: "Done",
            sourceEventId: "signal-child",
            spaceAction: {
              messageEnvelope: {
                activationTargets: [],
                referenceTargets: [],
                text: "Done",
              },
              type: "post_message",
            },
            status: "success",
            taskId: "task-1",
            telemetry: {
              completedAtMs: 2400,
              contextHealed: false,
              invokedAtMs: 2000,
              resumedContext: false,
            },
          },
          v: 4,
        },
      },
    });

    expect(
      projectRuntimeCoordinatorFinalizationTaskTerminalRecord({
        command,
        publishedSignalId: "signal-result",
        publishState: "reply_published",
      })
    ).toEqual({
      nowMs: 2500,
      outcome: {
        errorCode: null,
        eventId: "finalization-1",
        occurredAtMs: 2400,
        publishedSignalId: "signal-result",
        status: "succeeded",
      },
      task: {
        kind: "space_wake",
        sourceClientMessageId: "client-child",
        spaceId: "space-child",
        targetProfileId: "child-profile",
        v: 1,
      },
    });
  });

  it("projects a policy-blocked final Space outcome as failed", () => {
    const command = buildFinalizationCommand({
      acceptedResult: {
        taskResult: {
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            output: "Done",
            sourceEventId: "signal-child",
            spaceAction: {
              messageEnvelope: {
                activationTargets: [],
                referenceTargets: [],
                text: "Done",
              },
              type: "post_message",
            },
            status: "success",
            taskId: "task-1",
          },
          v: 4,
        },
      },
    });

    expect(
      projectRuntimeCoordinatorFinalizationTaskTerminalRecord({
        command,
        publishedSignalId: "signal-policy-blocked",
        publishState: "invalid_space_action",
      })?.outcome
    ).toMatchObject({
      errorCode: "agent_task.invalid_space_action",
      publishedSignalId: "signal-policy-blocked",
      status: "failed",
    });
  });

  it("preserves stayed-silent and failed child outcomes", () => {
    const stayedSilent = buildFinalizationCommand({
      acceptedResult: {
        taskResult: {
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            output: "No action",
            sourceEventId: "signal-child",
            spaceAction: {
              reason: "I was referenced, not assigned.",
              type: "stay_silent",
            },
            status: "success",
            taskId: "task-1",
          },
          v: 4,
        },
      },
    });
    expect(
      projectRuntimeCoordinatorFinalizationTaskTerminalRecord({
        command: stayedSilent,
        publishedSignalId: "signal-silent",
        publishState: "reply_published",
      })?.outcome
    ).toMatchObject({
      errorCode: null,
      publishedSignalId: "signal-silent",
      status: "stayed_silent",
    });

    const failed = buildFinalizationCommand({
      acceptedResult: {
        taskResult: {
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            errorCode: "git.auth_failed",
            errorType: "auth",
            sourceEventId: "signal-child",
            status: "failed",
            taskId: "task-1",
          },
          v: 4,
        },
      },
    });
    expect(
      projectRuntimeCoordinatorFinalizationTaskTerminalRecord({
        command: failed,
        publishedSignalId: "signal-failure",
        publishState: "reply_published",
      })?.outcome
    ).toMatchObject({
      errorCode: "git.auth_failed",
      publishedSignalId: "signal-failure",
      status: "failed",
    });
  });

  it("ignores Wakes that do not have a stable client task handle", () => {
    const command = buildFinalizationCommand({
      dispatchFact: { sourceClientMessageId: null },
    });

    expect(
      projectRuntimeCoordinatorFinalizationTaskTerminalRecord({
        command,
        publishedSignalId: "signal-result",
        publishState: "reply_published",
      })
    ).toBeNull();
  });

  it("projects exhausted final publication as publication_failed", () => {
    const command = buildFinalizationCommand();

    expect(
      projectRuntimeCoordinatorPublicationFailedTaskTerminalRecord({
        command,
        occurredAtMs: 2600,
        publishedSignalId: "signal-publication-failed-1",
        reasonCode: "runtime_coordinator.publication_retry_exhausted",
      })
    ).toEqual({
      nowMs: 2600,
      outcome: {
        errorCode: "runtime_coordinator.publication_retry_exhausted",
        eventId: "finalization-1",
        occurredAtMs: 2600,
        publishedSignalId: "signal-publication-failed-1",
        status: "publication_failed",
      },
      task: {
        kind: "space_wake",
        sourceClientMessageId: "client-child",
        spaceId: "space-child",
        targetProfileId: "child-profile",
        v: 1,
      },
    });
  });

  it("uses the existing visible final message as failure-path truth", () => {
    const command = buildFailurePublicationCommand();

    expect(
      projectRuntimeCoordinatorFailureTaskTerminalRecord({
        command,
        finalMessageKind: "success_reply",
        publishedSignalId: "signal-success",
      })?.outcome
    ).toMatchObject({
      errorCode: null,
      publishedSignalId: "signal-success",
      status: "succeeded",
    });
    expect(
      projectRuntimeCoordinatorFailureTaskTerminalRecord({
        command,
        finalMessageKind: "failure_notice",
        publishedSignalId: "signal-failed",
      })?.outcome
    ).toMatchObject({
      errorCode: "daemon.profile.offline",
      publishedSignalId: "signal-failed",
      status: "failed",
    });
  });

  it("projects a visible Stop notice as the child terminal outcome", () => {
    expect(
      projectRuntimeCoordinatorStoppedTaskTerminalRecord({
        eventId: "wake-stopped-publication-1",
        occurredAtMs: 2600,
        publishedSignalId: "signal-stopped",
        reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        sourceClientMessageId: "client-child",
        spaceId: "space-child",
        targetProfileId: "child-profile",
      })
    ).toEqual({
      nowMs: 2600,
      outcome: {
        errorCode: "runtime_coordinator.pre_agent_stop_requested",
        eventId: "wake-stopped-publication-1",
        occurredAtMs: 2600,
        publishedSignalId: "signal-stopped",
        status: "stopped",
      },
      task: {
        kind: "space_wake",
        sourceClientMessageId: "client-child",
        spaceId: "space-child",
        targetProfileId: "child-profile",
        v: 1,
      },
    });
  });
});

function buildFinalizationCommand(
  overrides: {
    acceptedResult?: {
      taskResult: RuntimeCoordinatorFinalizationCommand["acceptedResult"]["taskResult"];
    };
    dispatchFact?: {
      sourceClientMessageId: string | null;
    };
  } = {}
): RuntimeCoordinatorFinalizationCommand {
  return {
    acceptedResult: {
      acceptedAtMs: 2100,
      attemptId: "attempt-1",
      daemonSessionId: "daemon-session-1",
      dispatchId: "dispatch-1",
      executionTokenFingerprint: "fingerprint-1",
      executionTokenRunId: "run-1",
      leaseEpoch: 1,
      runtimeCoordinatorExecutionId: "execution-1",
      submittedConnectionGeneration: 1,
      targetProfileId: "child-profile",
      taskId: "task-1",
      taskResult:
        overrides.acceptedResult?.taskResult ??
        ({
          code: "service.task_result",
          payload: {
            agentId: "child-profile",
            attemptId: "attempt-1",
            deduped: false,
            output: "Done",
            sourceEventId: "signal-child",
            spaceAction: {
              messageEnvelope: {
                activationTargets: [],
                referenceTargets: [],
                text: "Done",
              },
              type: "post_message",
            },
            status: "success",
            taskId: "task-1",
          },
          v: 4,
        } as const),
    },
    createdAtMs: 2500,
    dispatchFact: {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      dispatchOwner: {
        id: "owner-1",
        kind: "owner_account",
      },
      enqueuedAtMs: 1500,
      idempotencyKey: "dispatch-idempotency-1",
      sourceClientMessageId: overrides.dispatchFact
        ? overrides.dispatchFact.sourceClientMessageId
        : "client-child",
      sourceEventId: "signal-child",
      spaceId: "space-child",
      targetProfileId: "child-profile",
      taskId: "task-1",
    },
    dispatchId: "dispatch-1",
    executionTokenRunId: "run-1",
    finalizationCommandId: "finalization-1",
    modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
    publicationIdempotencyKey: "publication-1",
    resultIdempotencyKey: "result-1",
    runtimeCoordinatorExecutionId: "execution-1",
    spaceId: "space-child",
    targetOwnerUserId: "owner-1",
    targetProfileId: "child-profile",
    targetProfileMentionLabel: "Child Agent",
    targetProfileName: "Child Agent",
  };
}

function buildFailurePublicationCommand(): RuntimeCoordinatorFailurePublicationCommand {
  return {
    createdAtMs: 2500,
    dispatchId: "dispatch-1",
    failurePublicationCommandId: "failure-publication-1",
    modelVersion: RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION,
    ownerUserId: "owner-1",
    publicationCategory: "service_not_connected",
    publicationIntentId: "publication-intent-1",
    reasonCode: "daemon.profile.offline",
    spaceId: "space-child",
    targetProfileId: "child-profile",
    targetProfileMentionLabel: "Child Agent",
    targetProfileName: "Child Agent",
    targetWakeLifecycleId: "lifecycle-1",
    targetWakeLifecycleIdentity: {
      clientMessageId: "client-child",
      dispatchId: "dispatch-1",
      modelVersion: TARGET_WAKE_LIFECYCLE_IDENTITY_MODEL_VERSION,
      sourceSignalId: "signal-child",
      spaceId: "space-child",
      targetProfileId: "child-profile",
      targetWakeLifecycleId: "lifecycle-1",
    },
    userRecoveryAction: "start_or_restart_openmeld_service",
  };
}
