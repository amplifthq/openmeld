import { describe, expect, it } from "vitest";
import {
  getSpaceWakeTraceWaterfallInputSchema,
  getSpaceWakeTraceWaterfallResponseSchema,
  OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
  WAKE_TRACE_WATERFALL_STEP_NAMES,
} from "../../src/schemas";

const CLIENT_MESSAGE_ID = "cm_01J00000000000000000000001";

describe("space Wake trace waterfall HTTP schemas", () => {
  it("accepts a product Wake trace waterfall response", () => {
    const parsed = getSpaceWakeTraceWaterfallResponseSchema.safeParse(
      buildValidWaterfallResponse()
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts a source-signal-selected Wake trace waterfall response", () => {
    const response = buildValidWaterfallResponse();
    response.query.clientMessageId = null;
    response.query.sourceSignalId = "sig-source-1";
    const item = getOnlyWaterfallItem(response);
    const correlation = item.correlation as unknown as {
      clientMessageId: string | null;
      selector: unknown;
    };
    correlation.selector = {
      kind: "source_signal",
      spaceId: "space-123",
      sourceSignalId: "sig-source-1",
      targetProfileId: "agent-1",
    };
    correlation.clientMessageId = null;
    for (const step of item.steps) {
      const ids = step.ids as unknown as { clientMessageId: string | null };
      ids.clientMessageId = null;
    }

    const parsed = getSpaceWakeTraceWaterfallResponseSchema.safeParse(response);

    expect(parsed.success).toBe(true);
  });

  it("accepts a reply signal step backed by a Space final reply claim", () => {
    const response = buildValidWaterfallResponse();
    const item = getOnlyWaterfallItem(response);
    const replySignalStep = item.steps.find(
      (step) => step.name === "reply_signal"
    );
    if (!replySignalStep) {
      throw new Error("test fixture must include a reply signal step");
    }
    replySignalStep.factSource = "space_final_reply_claim";

    const parsed = getSpaceWakeTraceWaterfallResponseSchema.safeParse(response);

    expect(parsed.success).toBe(true);
  });

  it("normalizes a blank target profile selector as omitted", () => {
    const parsed = getSpaceWakeTraceWaterfallInputSchema.safeParse({
      spaceId: "space-123",
      clientMessageId: CLIENT_MESSAGE_ID,
      targetProfileId: "  ",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.targetProfileId).toBeUndefined();
  });

  it("requires exactly one Wake trace selector", () => {
    expect(
      getSpaceWakeTraceWaterfallInputSchema.safeParse({
        spaceId: "space-123",
        targetProfileId: "agent-1",
      }).success
    ).toBe(false);
    expect(
      getSpaceWakeTraceWaterfallInputSchema.safeParse({
        spaceId: "space-123",
        clientMessageId: CLIENT_MESSAGE_ID,
        sourceSignalId: "sig-source-1",
      }).success
    ).toBe(false);
    expect(
      getSpaceWakeTraceWaterfallInputSchema.safeParse({
        spaceId: "space-123",
        sourceSignalId: "sig-source-1",
      }).success
    ).toBe(true);
  });

  it("rejects arbitrary diagnostic payload fields", () => {
    const parsed = getSpaceWakeTraceWaterfallResponseSchema.safeParse({
      query: {
        spaceId: "space-123",
        clientMessageId: CLIENT_MESSAGE_ID,
        sourceSignalId: null,
        targetProfileId: null,
      },
      items: [],
      fullMessageText: "do not accept raw user text",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects missing canonical waterfall steps", () => {
    const response = buildValidWaterfallResponse();
    const item = getOnlyWaterfallItem(response);
    item.steps = item.steps.slice(0, 1);

    const parsed = getSpaceWakeTraceWaterfallResponseSchema.safeParse(response);

    expect(parsed.success).toBe(false);
  });

  it("rejects target mismatches between query and item", () => {
    const response = buildValidWaterfallResponse();
    response.query.targetProfileId = "agent-2";

    const parsed = getSpaceWakeTraceWaterfallResponseSchema.safeParse(response);

    expect(parsed.success).toBe(false);
  });

  it("rejects selectors that do not match the query selector", () => {
    const response = buildValidWaterfallResponse();
    const item = getOnlyWaterfallItem(response);
    const correlation = item.correlation as unknown as { selector: unknown };
    correlation.selector = {
      kind: "dispatch",
      spaceId: "space-123",
      dispatchId: "dispatch-1",
    };

    const parsed = getSpaceWakeTraceWaterfallResponseSchema.safeParse(response);

    expect(parsed.success).toBe(false);
  });
});

function buildValidWaterfallResponse() {
  return {
    query: {
      spaceId: "space-123",
      clientMessageId: CLIENT_MESSAGE_ID as string | null,
      sourceSignalId: null as string | null,
      targetProfileId: null as string | null,
    },
    items: [
      {
        targetProfileId: "agent-1",
        targetLabel: "@Codex",
        correlation: {
          modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
          selector: {
            kind: "client_message",
            spaceId: "space-123",
            clientMessageId: CLIENT_MESSAGE_ID,
            targetProfileId: "agent-1",
          },
          spaceId: "space-123",
          clientMessageId: CLIENT_MESSAGE_ID,
          sourceSignalId: "sig-source-1",
          targetProfileId: "agent-1",
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
          latestAttemptId: "attempt-1",
          claimLeaseId: null,
          bindingId: "binding-1",
          openMeldServiceRuntimeId: "runtime-1",
          agentControllerRef: "builtin:codex",
          resultRef: "result-1",
          publishedSignalId: "sig-reply-1",
          replySignalId: "sig-reply-1",
          cloudflare: {
            cfRayId: null,
            requestId: null,
            traceId: null,
          },
        },
        executionContext: {
          resolutionStatus: "resolved",
          factSource: "dispatch_trace_origin",
          reasonCode: null,
          bindingId: "binding-1",
          openMeldServiceRuntimeId: "runtime-1",
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "conv-1",
          agentControllerConversationKind: "thread",
          runtimeWorkspacePath: "/tmp/openmeld-workspace",
          runtimeWorkspaceFingerprint: "sha256:workspace-1",
        },
        summary: {
          status: "replied",
          terminalStep: "reply_signal",
          reasonCode: null,
        },
        steps: WAKE_TRACE_WATERFALL_STEP_NAMES.map((name, order) => ({
          order,
          name,
          status: "found",
          factSource: resolveFactSource(name),
          observedAt: "2026-05-13T00:00:00.000Z",
          reasonCode: null,
          ids: {
            clientMessageId: CLIENT_MESSAGE_ID,
            sourceSignalId: "sig-source-1",
            targetProfileId: "agent-1",
            targetWakeLifecycleId:
              "twl_v1|9:space-123|12:sig-source-1|7:agent-1",
            dispatchId: "dispatch-1",
            attemptId: "attempt-1",
            claimLeaseId: null,
            bindingId: "binding-1",
            openMeldServiceRuntimeId: "runtime-1",
            agentControllerRef: "builtin:codex",
            resultKey: "result-key-1",
            resultRef: "result-1",
            publishedSignalId: "sig-reply-1",
            replySignalId: "sig-reply-1",
          },
        })),
      },
    ],
  };
}

function getOnlyWaterfallItem(
  response: ReturnType<typeof buildValidWaterfallResponse>
) {
  const item = response.items[0];
  if (!item) {
    throw new Error("test fixture must include one waterfall item");
  }
  return item;
}

function resolveFactSource(name: string): string {
  switch (name) {
    case "source_signal":
      return "space_signal_by_client_message_id";
    case "planner":
      return "dispatch_outbox";
    case "dispatch":
      return "dispatch_ledger";
    case "head_lifecycle":
      return "runtime_coordinator_head_lifecycle";
    case "attempt":
      return "dispatch_attempt";
    case "result_inbox":
      return "dispatch_result_inbox";
    case "result":
      return "dispatch_result";
    case "reply_signal":
      return "space_signal_by_published_signal_id";
    default:
      throw new Error(`unknown waterfall step: ${name}`);
  }
}
