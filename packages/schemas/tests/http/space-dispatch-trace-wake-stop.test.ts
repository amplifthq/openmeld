import { describe, expect, it } from "vitest";
import {
  listSpaceDispatchTraceFinalVisibleSignalCandidates,
  MAX_TEXT_LENGTH,
  projectSpaceDispatchTraceFinalVisibleOutcome,
  RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  spaceDispatchTraceFinalVisibleMessageSchema,
  spaceDispatchTraceFinalVisibleOutcomeSchema,
  spaceDispatchTraceResultInboxPublishStateSchema,
} from "../../src";

describe("space dispatch trace Wake Stop outcome", () => {
  it("accepts final visible text up to the Space signal limit", () => {
    const finalVisibleMessage = {
      factSource: "space_signal_by_published_signal_id",
      signalId: "sig-long-reply-1",
      signalType: "signal.text",
      dispatchId: "dispatch-1",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      profileId: "agt_33333333-3333-4333-8333-333333333333",
      profileKind: "agent",
      profileName: "Codex",
      text: "x".repeat(MAX_TEXT_LENGTH),
      reasonCode: null,
      noticeType: null,
      statusType: null,
      createdAt: "2026-06-29T00:00:00.000Z",
    };

    expect(
      spaceDispatchTraceFinalVisibleMessageSchema.safeParse(finalVisibleMessage)
        .success
    ).toBe(true);
    expect(
      spaceDispatchTraceFinalVisibleMessageSchema.safeParse({
        ...finalVisibleMessage,
        text: "x".repeat(MAX_TEXT_LENGTH + 1),
      }).success
    ).toBe(false);
  });

  it("projects Wake stopped system notices as visible_stopped", () => {
    const finalVisibleMessage = {
      factSource: "space_signal_by_published_signal_id",
      signalId: "sig-stop-1",
      signalType: "signal.system_notice",
      dispatchId: "dispatch-1",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      profileId: "openmeld-system",
      profileKind: "system",
      profileName: "OpenMeld",
      text: "Wake was stopped for @Codex.",
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      noticeType: "wake_stopped",
      statusType: null,
      createdAt: "2026-06-29T00:00:00.000Z",
    };

    expect(
      spaceDispatchTraceFinalVisibleMessageSchema.safeParse(finalVisibleMessage)
        .success
    ).toBe(true);
    expect(
      projectSpaceDispatchTraceFinalVisibleOutcome({
        finalVisibleMessage,
      } as Parameters<typeof projectSpaceDispatchTraceFinalVisibleOutcome>[0])
    ).toEqual({
      delivered: true,
      publicationErrorCode: null,
      publicationKind: "stopped_notice",
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      signalId: "sig-stop-1",
      sourceFact: "final_visible_message",
      sourceReasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      sourceStatus: "signal.system_notice",
      status: "visible_stopped",
    });
  });

  it("lists stopped notice publications before late reply candidates", () => {
    const candidates = listSpaceDispatchTraceFinalVisibleSignalCandidates({
      result: {
        publishedSignalId: "sig-late-reply-1",
      },
      resultInbox: {
        publishedSignalId: "sig-inbox-1",
      },
      runtimeCoordinatorEvents: [
        {
          eventType: "cancellation_control_accepted",
          payloadJson: JSON.stringify({
            stoppedNoticePublication: {
              publishedSignalId: "sig-stop-1",
              status: "published",
            },
          }),
        },
      ],
      runtimeCoordinatorHeadLifecycle: null,
    } as unknown as Parameters<
      typeof listSpaceDispatchTraceFinalVisibleSignalCandidates
    >[0]);

    expect(candidates).toEqual([
      "sig-stop-1",
      "sig-late-reply-1",
      "sig-inbox-1",
    ]);
  });

  it("accepts stopped reply suppression as a result inbox publish state", () => {
    expect(
      spaceDispatchTraceResultInboxPublishStateSchema.safeParse(
        "reply_suppressed_stopped"
      ).success
    ).toBe(true);
  });

  it("treats cancelled RuntimeCoordinator state as unresolved stopped notice, not failure", () => {
    const outcome = projectSpaceDispatchTraceFinalVisibleOutcome({
      runtimeCoordinatorEvents: [],
      runtimeCoordinatorExecution: {
        factSource: "runtime_coordinator_projection",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        bindingId: "binding-1",
        createdAtMs: 1_805_000_000_000,
        dispatchId: "dispatch-1",
        legacyPointers: {
          attemptId: "attempt-1",
          claimLeaseId: null,
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 2,
        },
        modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
        runtimeCoordinatorExecutionId: "rce-1",
        sourceClientMessageId: "client-message-1",
        spaceId: "space-1",
        status: "cancelled",
        targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
        terminalOutcome: {
          kind: "cancelled",
          observedAtMs: 1_805_000_000_100,
          reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
        },
        updatedAtMs: 1_805_000_000_100,
      },
    } as unknown as Parameters<
      typeof projectSpaceDispatchTraceFinalVisibleOutcome
    >[0]);

    expect(
      spaceDispatchTraceFinalVisibleOutcomeSchema.safeParse(outcome).success
    ).toBe(true);
    expect(outcome).toMatchObject({
      delivered: false,
      publicationErrorCode: null,
      publicationKind: "stopped_notice",
      sourceFact: "runtime_coordinator_execution",
      sourceReasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      sourceStatus: "cancelled",
      status: "publication_unresolved",
    });
    expect(outcome.publicationKind).not.toBe("failure_notice");
  });

  it("projects pre-agent stopped head publication intent as pending stopped notice", () => {
    const outcome = projectSpaceDispatchTraceFinalVisibleOutcome({
      runtimeCoordinatorEvents: [],
      runtimeCoordinatorHeadLifecycle: {
        readStatus: "found",
        publicationIntent: {
          kind: "stopped_notice",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
          status: "ready_for_phase_6",
        },
      },
    } as unknown as Parameters<
      typeof projectSpaceDispatchTraceFinalVisibleOutcome
    >[0]);

    expect(
      spaceDispatchTraceFinalVisibleOutcomeSchema.safeParse(outcome).success
    ).toBe(true);
    expect(outcome).toMatchObject({
      delivered: false,
      publicationErrorCode: null,
      publicationKind: "stopped_notice",
      sourceFact: "runtime_coordinator_head_lifecycle",
      sourceReasonCode: "runtime_coordinator.pre_agent_stop_requested",
      sourceStatus: "ready_for_phase_6",
      status: "publication_pending",
    });
    expect(outcome.publicationKind).not.toBe("failure_notice");
  });
});
