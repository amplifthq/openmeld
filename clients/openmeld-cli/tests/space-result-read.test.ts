import { readFileSync } from "node:fs";
import type { SpaceApi } from "@openmeld/api-client";
import {
  dispatchResultSchema,
  projectObservabilityWakeCorrelation,
  projectSpaceNativeDeliveryTraceFinalVisibleOutcome,
  signalEnvelopeSchema,
  spaceDispatchTraceResponseSchema,
} from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSpaceDispatchTrace } from "../src/config/space-dispatch-trace-api";
import { GatewayHttpError } from "../src/space/gateway-response";
import { fetchSpaceDispatchResult } from "../src/space/result-api";
import { readSpaceResult } from "../src/space/result-read";

vi.mock("../src/config/space-dispatch-trace-api", () => ({
  fetchSpaceDispatchTrace: vi.fn(),
}));
vi.mock("../src/space/result-api", () => ({
  fetchSpaceDispatchResult: vi.fn(),
}));

// Public service trace + Space thread response captured 2026-10-13.
// IDs and message text are anonymized; the hosted failure shape is retained.
const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/published-dispatch-result.json", import.meta.url),
    "utf8"
  )
);
const trace = spaceDispatchTraceResponseSchema.parse(captured.trace);
const signal = signalEnvelopeSchema.parse(captured.signal);
const listSignalEnvelopes = vi.fn<SpaceApi["listSignalEnvelopes"]>();
const input = {
  baseUrl: "https://example.invalid",
  space: trace.query.spaceId,
  dispatchId: trace.query.dispatchId,
  requestContext: {
    actorContext: {
      requestId: "result-test",
      openMeldProfileId: "human-test",
      profileKind: "human" as const,
    },
  },
  spaceApi: { listSignalEnvelopes },
};
function missing(status = 404, code = "space.dispatch_result.not_found") {
  return new GatewayHttpError({
    status,
    code,
    message: "dispatch result not found",
    requestId: "req-result",
    rawBody: "",
  });
}

describe("cross-runtime Space result read", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchSpaceDispatchResult).mockRejectedValue(missing());
    vi.mocked(fetchSpaceDispatchTrace).mockResolvedValue(trace);
    listSignalEnvelopes.mockResolvedValue({
      envelopes: [signal],
      nextCursor: null,
    });
  });

  it("reads the exact hosted final message and preserves its real failure outcome and reply identity", async () => {
    const result = await readSpaceResult(input);
    expect(result).toMatchObject({
      source: "published_message",
      result: { outcome: { status: "visible_failure" }, signal },
    });
    expect(listSignalEnvelopes).toHaveBeenCalledWith(
      expect.objectContaining({
        requestContext: input.requestContext,
        query: { aroundSignalId: signal.id, beforeCount: 0, afterCount: 0 },
      })
    );
    expect(fetchSpaceDispatchTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        includeRemoteAgentRuntimeDiagnostics: false,
        includeServiceConnectionDiagnostics: false,
      })
    );
  });

  it.each([
    [403, "space.forbidden"],
    [503, "space.dispatch_result.not_found"],
    [404, "other.not_found"],
  ])("preserves %s %s without looking up another result", async (status, code) => {
    const error = missing(status, code);
    vi.mocked(fetchSpaceDispatchResult).mockRejectedValue(error);
    await expect(readSpaceResult(input)).rejects.toBe(error);
    expect(fetchSpaceDispatchTrace).not.toHaveBeenCalled();
    expect(listSignalEnvelopes).not.toHaveBeenCalled();
  });

  it("preserves archive success and result-ref reads", async () => {
    const archive = dispatchResultSchema.parse({
      resultRef: "archive-1",
      dispatchId: input.dispatchId,
      spaceId: input.space,
      actorProfileId: signal.profile.profileId,
      resultKind: "text",
      finalText: "Archived result",
      publicOutcome: "post_message",
      createdAt: "2026-10-13T18:00:00Z",
    });
    vi.mocked(fetchSpaceDispatchResult).mockResolvedValueOnce(archive);
    await expect(readSpaceResult(input)).resolves.toEqual({
      source: "archive",
      result: archive,
    });
    const error = missing();
    vi.mocked(fetchSpaceDispatchResult).mockRejectedValueOnce(error);
    await expect(
      readSpaceResult({
        ...input,
        dispatchId: undefined,
        resultRef: "archive-1",
      })
    ).rejects.toBe(error);
    expect(fetchSpaceDispatchTrace).not.toHaveBeenCalled();
  });

  it("does not treat execution completion without a published message as success", async () => {
    const pending = structuredClone(trace);
    if (!pending.trace?.nativeDelivery) {
      throw new Error("Captured hosted trace required");
    }
    pending.trace.nativeDelivery.status = "completed";
    pending.trace.finalVisibleMessage = null;
    pending.trace.finalVisibleMessageLinkage = null;
    pending.trace.finalVisibleOutcome =
      projectSpaceNativeDeliveryTraceFinalVisibleOutcome({
        finalVisibleMessage: null,
      });
    vi.mocked(fetchSpaceDispatchTrace).mockResolvedValue(pending);
    await expect(readSpaceResult(input)).rejects.toMatchObject({
      code: "space.result.not_published",
      message: expect.stringContaining("completed"),
    });
    expect(listSignalEnvelopes).not.toHaveBeenCalled();
  });

  it("reads a native-only published success without inventing a workstation archive", async () => {
    const delivery = trace.trace?.nativeDelivery;
    const capturedVisible = trace.trace?.finalVisibleMessage;
    if (!(delivery && capturedVisible)) {
      throw new Error("Captured hosted publication required");
    }
    const visible = {
      ...capturedVisible,
      reasonCode: null,
      text: "Review complete.",
    };
    const native = spaceDispatchTraceResponseSchema.parse({
      query: trace.query,
      correlation: projectObservabilityWakeCorrelation({
        selector: {
          kind: "dispatch",
          spaceId: input.space,
          dispatchId: input.dispatchId,
        },
        targetProfileId: delivery.destination.targetProfileId,
        bindingId: delivery.bindingId,
        agentControllerRef: "hosted:center-agent",
        publishedSignalId: visible.signalId,
        replySignalId: visible.signalId,
      }),
      trace: null,
      nativeDeliveryTrace: {
        factSource: delivery.factSource,
        bindingId: delivery.bindingId,
        destination: delivery.destination,
        // Fields follow the shared Center Agent diagnostic contract used by
        // service-trace.integration.test.ts, with this capture's identities.
        turn: {
          acceptedAtMs: 1000,
          callbackReceivedAtMs: 2000,
          completedAtMs: 2000,
          conversationSource: {
            kind: "space",
            spaceId: input.space,
            isCurrentConversation: true,
          },
          createdAtMs: 1000,
          deliveryId: delivery.deliveryId,
          dispatchId: input.dispatchId,
          failureCode: null,
          failureDetail: null,
          failureDetailTruncated: false,
          publicationState: "outcome_unknown",
          publishedResultId: visible.signalId,
          status: "completed",
          submissionId: delivery.submissionId,
          submittedAtMs: 1000,
          triggerMessageId: "trigger-native",
          updatedAtMs: 2000,
        },
        finalVisibleMessage: visible,
        finalVisibleMessageLinkage: trace.trace?.finalVisibleMessageLinkage,
        finalVisibleOutcome: projectSpaceNativeDeliveryTraceFinalVisibleOutcome(
          { finalVisibleMessage: visible }
        ),
      },
    });
    const successSignal = signalEnvelopeSchema.parse({
      ...signal,
      data: {
        ...signal.data,
        text: "Review complete.",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "Review complete.",
        },
      },
    });
    vi.mocked(fetchSpaceDispatchTrace).mockResolvedValue(native);
    listSignalEnvelopes.mockResolvedValue({
      envelopes: [successSignal],
      nextCursor: null,
    });
    await expect(readSpaceResult(input)).resolves.toMatchObject({
      source: "published_message",
      result: { outcome: { status: "visible_reply" }, signal: successSignal },
    });
  });

  it.each([
    "wrong-space",
    "wrong-author",
    "missing",
  ])("rejects a %s canonical signal instead of substituting trace text", async (kind) => {
    const changed = structuredClone(signal);
    if (kind === "wrong-space") {
      changed.spaceId = "another-space";
    }
    if (kind === "wrong-author") {
      changed.profile.profileId = "another-agent";
    }
    listSignalEnvelopes.mockResolvedValue({
      envelopes: kind === "missing" ? [] : [changed],
      nextCursor: null,
    });
    await expect(readSpaceResult(input)).rejects.toMatchObject({
      code: "space.result.message_unavailable",
    });
  });

  it("preserves a later authorization or storage error from the canonical message read", async () => {
    const error = missing(403, "space.forbidden");
    listSignalEnvelopes.mockRejectedValue(error);
    await expect(readSpaceResult(input)).rejects.toBe(error);
  });
});
