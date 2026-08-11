import { describe, expect, it } from "vitest";
import {
  getSpaceMessageDetailsInputSchema,
  getSpaceMessageDetailsResponseSchema,
  spaceMessageDetailsStringFactSchema,
} from "../../src/schemas";

describe("space Message Details HTTP schemas", () => {
  it("accepts the unified Message Details response model", () => {
    const parsed = getSpaceMessageDetailsResponseSchema.safeParse(
      buildValidMessageDetailsResponse()
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts privacy-bounded Agent working details", () => {
    const parsed = getSpaceMessageDetailsResponseSchema.safeParse({
      ...buildValidMessageDetailsResponse(),
      workingDetails: {
        state: "recorded",
        tools: [
          {
            toolName: "openmeld_list_spaces",
            state: "output-available",
            startedAtMs: 1_803_000_000_100,
            updatedAtMs: 1_803_000_000_200,
            work: {
              v: 1,
              key: "spaces.read",
            },
          },
        ],
        truncated: false,
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects working details that expose unbounded tool data", () => {
    const parsed = getSpaceMessageDetailsResponseSchema.safeParse({
      ...buildValidMessageDetailsResponse(),
      workingDetails: {
        state: "recorded",
        tools: [
          {
            toolName: "openmeld_list_spaces",
            state: "output-available",
            startedAtMs: 1_803_000_000_100,
            updatedAtMs: 1_803_000_000_200,
            input: { organizationId: "private" },
          },
        ],
        truncated: false,
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("normalizes Message Details selectors", () => {
    const parsed = getSpaceMessageDetailsInputSchema.safeParse({
      spaceId: " space-123 ",
      signalId: " sig-1 ",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      spaceId: "space-123",
      signalId: "sig-1",
    });
  });

  it("keeps fact states unambiguous", () => {
    expect(
      spaceMessageDetailsStringFactSchema.safeParse({
        state: "recorded",
        value: "conv-1",
        source: "space_signal_profile",
      }).success
    ).toBe(true);

    expect(
      spaceMessageDetailsStringFactSchema.safeParse({
        state: "redacted",
        value: null,
        source: "wake_trace_execution_context",
      }).success
    ).toBe(true);

    expect(
      spaceMessageDetailsStringFactSchema.safeParse({
        state: "recorded",
        value: null,
        source: "space_signal_profile",
      }).success
    ).toBe(false);

    expect(
      spaceMessageDetailsStringFactSchema.safeParse({
        state: "not_recorded",
        value: "conv-1",
        source: "space_signal_profile",
      }).success
    ).toBe(false);
  });

  it("rejects hidden payload drift", () => {
    const response = buildValidMessageDetailsResponse();

    const parsed = getSpaceMessageDetailsResponseSchema.safeParse({
      ...response,
      rawWorkspacePath: "/Users/felix/.openmeld/private",
    });

    expect(parsed.success).toBe(false);
  });
});

function buildValidMessageDetailsResponse() {
  return {
    query: {
      spaceId: "space-123",
      signalId: "sig-reply-1",
    },
    message: {
      signalId: "sig-reply-1",
      signalType: "signal.text",
      sentAtMs: 1_803_000_000_000,
      actor: {
        profileId: "agt-1",
        profileKind: "agent",
        displayName: "Codex Local Agent",
        profileName: "Codex Local Agent",
        profileHandle: null,
      },
    },
    agentContext: {
      state: "recorded",
      profileId: recordedFact("agt-1", "space_signal_profile"),
      profileName: recordedFact("Codex Local Agent", "space_signal_profile"),
      agentControllerRef: recordedFact("builtin:codex", "space_signal_profile"),
      agentControllerConversationId: recordedFact(
        "conv-1",
        "space_signal_profile"
      ),
      workspacePath: redactedFact("space_signal_profile"),
      openMeldServiceRuntimeId: notRecordedFact("space_signal_profile"),
      bindingId: notRecordedFact("space_signal_profile"),
      workspaceFingerprint: notRecordedFact("space_signal_profile"),
    },
    wakeContext: {
      state: "recorded",
      sourceSignalId: recordedFact("sig-source-1", "space_signal"),
      clientMessageId: recordedFact(
        "cm_01J00000000000000000000001",
        "space_signal"
      ),
      targets: [
        {
          targetProfileId: "agt-1",
          targetLabel: "@Codex Local Agent",
          status: "replied",
          terminalStep: "reply_signal",
          reasonCode: "final_visible_message.reply_signal",
          agentContext: {
            state: "recorded",
            profileId: recordedFact("agt-1", "wake_trace"),
            profileName: recordedFact("@Codex Local Agent", "wake_trace"),
            agentControllerRef: recordedFact(
              "builtin:codex",
              "wake_trace_execution_context"
            ),
            agentControllerConversationId: recordedFact(
              "conv-1",
              "wake_trace_execution_context"
            ),
            workspacePath: redactedFact("wake_trace_execution_context"),
            openMeldServiceRuntimeId: notRecordedFact(
              "wake_trace_execution_context"
            ),
            bindingId: notRecordedFact("wake_trace_execution_context"),
            workspaceFingerprint: notRecordedFact(
              "wake_trace_execution_context"
            ),
          },
          steps: [
            {
              order: 8,
              name: "reply_signal",
              status: "found",
              factSource: "space_signal_by_published_signal_id",
              observedAt: "2026-06-04T00:00:00.000Z",
              reasonCode: "reply_signal.found",
              ids: {
                clientMessageId: "cm_01J00000000000000000000001",
                sourceSignalId: "sig-source-1",
                targetProfileId: "agt-1",
                targetWakeLifecycleId: null,
                dispatchId: "dispatch-1",
                attemptId: null,
                claimLeaseId: null,
                bindingId: null,
                openMeldServiceRuntimeId: null,
                agentControllerRef: null,
                resultKey: null,
                resultRef: null,
                publishedSignalId: "sig-reply-1",
                replySignalId: "sig-reply-1",
              },
            },
          ],
        },
      ],
    },
    replyContext: {
      state: "recorded",
      replyingToSignalId: recordedFact("sig-source-1", "reply_signal"),
      replyingToAuthor: recordedFact("Felix", "reply_signal"),
      previewText: recordedFact("@codex(wake) please check", "reply_signal"),
      resolved: true,
    },
    diagnostics: {
      signalId: "sig-reply-1",
      traceSelectors: [
        {
          kind: "signal",
          label: "Message ID",
          value: "sig-reply-1",
          targetProfileId: null,
        },
      ],
    },
  };
}

function recordedFact(value: string, source: string) {
  return {
    state: "recorded",
    value,
    source,
  };
}

function notRecordedFact(source: string) {
  return {
    state: "not_recorded",
    value: null,
    source,
  };
}

function redactedFact(source: string) {
  return {
    state: "redacted",
    value: null,
    source,
  };
}
