import { describe, expect, it } from "vitest";
import {
  getActiveSpaceWakeProgressInputSchema,
  getActiveSpaceWakeProgressResponseSchema,
  getSpaceWakeProgressInputSchema,
  getSpaceWakeProgressResponseSchema,
  wakeStopEligibilityReadModelSchema,
} from "../../src/schemas";

describe("space Wake progress HTTP schemas", () => {
  it("accepts server-owned publication Stop without claiming native Controller control", () => {
    expect(
      wakeStopEligibilityReadModelSchema.safeParse({
        controlMode: "openmeld_owned_publication_cancel",
        reliability: "openmeld_owned_publication",
        reasonCode: null,
        status: "eligible",
      }).success
    ).toBe(true);
    expect(
      wakeStopEligibilityReadModelSchema.safeParse({
        controlMode: "openmeld_owned_publication_cancel",
        reliability: "native_cancel",
        reasonCode: null,
        status: "eligible",
      }).success
    ).toBe(false);
  });
  it("accepts a product Wake progress response", () => {
    const parsed = getSpaceWakeProgressResponseSchema.safeParse({
      query: {
        spaceId: "space-123",
        clientMessageId: "client-message-1",
        targetProfileId: null,
      },
      items: [
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          targetLabel: "@Codex",
          phase: "publishing",
          failureReasonCode: null,
          message: "Posting final message for @Codex...",
          startedAtMs: 1_804_999_999_000,
          updatedAtMs: 1_805_000_000_000,
          terminal: false,
          wakeStopEligibility: {
            controlMode: "cancel",
            reasonCode: null,
            reliability: "native_cancel",
            status: "eligible",
          },
        },
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          dispatchId: "dispatch-2",
          targetProfileId: "agt_44444444-4444-4444-8444-444444444444",
          targetLabel: "@Runner",
          phase: "failed",
          failureReasonCode: "auth.required",
          message: "@Runner needs access before it can reply.",
          updatedAtMs: 1_805_000_000_100,
          terminal: true,
          wakeStopEligibility: {
            controlMode: "interrupt",
            reasonCode: null,
            reliability: "native_interrupt",
            status: "eligible",
          },
        },
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          dispatchId: "dispatch-queued-1",
          targetProfileId: "agt_66666666-6666-4666-8666-666666666666",
          targetLabel: "@Runner",
          phase: "queued",
          failureReasonCode: null,
          message: "Sending to @Runner...",
          updatedAtMs: 1_805_000_000_150,
          terminal: false,
          wakeStopEligibility: {
            controlMode: "openmeld_owned_pre_agent_cancel",
            reasonCode: null,
            reliability: "openmeld_owned_pre_agent",
            status: "eligible",
          },
        },
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          dispatchId: "dispatch-3",
          targetProfileId: "agt_55555555-5555-4555-8555-555555555555",
          targetLabel: "@Claude",
          phase: "stopped",
          failureReasonCode: null,
          message: "Wake was stopped for @Claude.",
          updatedAtMs: 1_805_000_000_200,
          terminal: true,
          wakeStopEligibility: {
            controlMode: null,
            reasonCode: "runtime_coordinator.pre_agent_stop_unavailable",
            reliability: "unsupported",
            status: "not_eligible",
          },
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects contradictory Wake Stop eligibility read models", () => {
    const parsed = getSpaceWakeProgressResponseSchema.safeParse({
      query: {
        spaceId: "space-123",
        clientMessageId: "client-message-1",
        targetProfileId: null,
      },
      items: [
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          targetLabel: "@Codex",
          phase: "running",
          failureReasonCode: null,
          message: "@Codex is working on this computer...",
          updatedAtMs: 1_805_000_000_000,
          terminal: false,
          wakeStopEligibility: {
            controlMode: null,
            reasonCode: "agent_controller_interface.stop_unsupported",
            reliability: "unsupported",
            status: "eligible",
          },
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects missing client message ids", () => {
    const parsed = getSpaceWakeProgressInputSchema.safeParse({
      spaceId: "space-123",
      clientMessageId: "",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts explicit optional Wake progress projection query values", () => {
    expect(
      getSpaceWakeProgressInputSchema.safeParse({
        spaceId: "space-123",
        clientMessageId: "client-message-1",
        includeTiming: "true",
        includeSourceContext: "true",
        includeWaitReason: "true",
        includeWakeStopEligibility: "true",
      })
    ).toMatchObject({
      success: true,
      data: {
        includeTiming: true,
        includeSourceContext: true,
        includeWaitReason: true,
        includeWakeStopEligibility: true,
      },
    });

    expect(
      getActiveSpaceWakeProgressInputSchema.safeParse({
        spaceId: "space-123",
        includePageInfo: "1",
        includeTiming: "1",
        includeSourceContext: "1",
        includeWaitReason: "1",
        includeWakeStopEligibility: "1",
        sourceProfileId: "human-source-1",
      })
    ).toMatchObject({
      success: true,
      data: {
        includePageInfo: true,
        includeTiming: true,
        includeSourceContext: true,
        includeWaitReason: true,
        includeWakeStopEligibility: true,
        sourceProfileId: "human-source-1",
      },
    });
  });

  it("accepts an active Space Wake progress response without a client-message selector", () => {
    const parsed = getActiveSpaceWakeProgressResponseSchema.safeParse({
      query: {
        spaceId: "space-123",
        sourceProfileId: "human-source-1",
        targetProfileId: null,
      },
      pageInfo: {
        hasMore: true,
        limit: 25,
      },
      items: [
        {
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          sourceContext: {
            messagePreview: "Please diagnose the Wake status.",
            profileId: "human-source-1",
            profileKind: "human",
            profileName: "Felix",
            threadId: "thread-1",
          },
          dispatchId: "dispatch-1",
          targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          targetLabel: "@Codex",
          phase: "running",
          failureReasonCode: null,
          message: "@Codex is working on this computer...",
          startedAtMs: 1_804_999_990_000,
          updatedAtMs: 1_805_000_000_000,
          terminal: false,
          waitReasonCode: "runtime.agent_controller_conversation.occupied",
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts active Space Wake progress input without clientMessageId", () => {
    const parsed = getActiveSpaceWakeProgressInputSchema.safeParse({
      spaceId: "space-123",
    });

    expect(parsed.success).toBe(true);
  });
});
