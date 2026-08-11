import { describe, expect, it } from "vitest";
import {
  remoteAgentStreamDeltaCallbackBodySchema,
  remoteAgentStreamDeltaCallbackResponseSchema,
  remoteAgentStreamPartCallbackBodySchema,
} from "../../src/index";

const validDeltaCallback = {
  v: 1,
  streamId: "stream:sub_123",
  sequence: 2,
  submissionId: "sub_123",
  idempotencyKey: "space_1:dispatch_1",
  organizationId: "org_1",
  spaceId: "space_1",
  agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
  bindingId: "binding_1",
  triggerMessageId: "signal_1",
  dispatchId: "dispatch_1",
  source: "flue.text_delta",
  textDelta: " world",
  textSnapshot: "Hello world",
  observedAtMs: 1_805_000_000_000,
} as const;

describe("Remote Agent stream callback contracts", () => {
  it("accepts a correlated accumulated snapshot with a stable stream sequence", () => {
    expect(
      remoteAgentStreamDeltaCallbackBodySchema.parse(validDeltaCallback)
    ).toEqual(validDeltaCallback);
  });

  it("accepts typed text and thinking deltas without changing the legacy callback", () => {
    const identity = {
      agentProfileId: validDeltaCallback.agentProfileId,
      bindingId: validDeltaCallback.bindingId,
      dispatchId: validDeltaCallback.dispatchId,
      idempotencyKey: validDeltaCallback.idempotencyKey,
      observedAtMs: validDeltaCallback.observedAtMs,
      organizationId: validDeltaCallback.organizationId,
      sequence: validDeltaCallback.sequence,
      spaceId: validDeltaCallback.spaceId,
      streamId: validDeltaCallback.streamId,
      submissionId: validDeltaCallback.submissionId,
      triggerMessageId: validDeltaCallback.triggerMessageId,
      v: 2,
    } as const;
    const textDelta = {
      ...identity,
      delta: " world",
      kind: "text",
      snapshot: "Hello world",
      source: "flue.text_delta",
    } as const;
    const thinkingDelta = {
      ...identity,
      delta: "Checking",
      kind: "thinking",
      snapshot: "Checking the current Space state",
      source: "flue.thinking_delta",
    } as const;

    expect(remoteAgentStreamDeltaCallbackBodySchema.parse(textDelta)).toEqual(
      textDelta
    );
    expect(
      remoteAgentStreamDeltaCallbackBodySchema.parse(thinkingDelta)
    ).toEqual(thinkingDelta);
    expect(
      remoteAgentStreamDeltaCallbackBodySchema.safeParse({
        ...thinkingDelta,
        source: "flue.text_delta",
      }).success
    ).toBe(false);
  });

  it("accepts a privacy-bounded tool lifecycle part on the same stream", () => {
    const {
      textDelta: _textDelta,
      textSnapshot: _textSnapshot,
      ...identity
    } = validDeltaCallback;
    const callback = {
      ...identity,
      source: "flue.tool",
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "output-available",
      },
    } as const;

    expect(remoteAgentStreamPartCallbackBodySchema.parse(callback)).toEqual(
      callback
    );
  });

  it("rejects callbacks without the complete native-delivery identity", () => {
    const { bindingId: _bindingId, ...missingBindingId } = validDeltaCallback;

    expect(
      remoteAgentStreamDeltaCallbackBodySchema.safeParse(missingBindingId)
        .success
    ).toBe(false);
  });

  it.each([0, -1, 1.5])("rejects invalid stream sequence %s", (sequence) => {
    expect(
      remoteAgentStreamDeltaCallbackBodySchema.safeParse({
        ...validDeltaCallback,
        sequence,
      }).success
    ).toBe(false);
  });

  it("accepts idempotent and gap-tolerant Core responses", () => {
    expect(
      remoteAgentStreamDeltaCallbackResponseSchema.parse({
        status: "duplicate_accepted",
        lastSequence: 4,
      })
    ).toEqual({ status: "duplicate_accepted", lastSequence: 4 });

    expect(
      remoteAgentStreamDeltaCallbackResponseSchema.parse({
        status: "accepted",
        lastSequence: 7,
        gapDetected: true,
      })
    ).toEqual({ status: "accepted", lastSequence: 7, gapDetected: true });
  });

  it("requires a reason code when Core rejects or defers a delta", () => {
    expect(
      remoteAgentStreamDeltaCallbackResponseSchema.safeParse({
        status: "rejected",
        lastSequence: 4,
      }).success
    ).toBe(false);

    expect(
      remoteAgentStreamDeltaCallbackResponseSchema.parse({
        lastSequence: 4,
        reasonCode: "lark.card_update_http_429",
        retryAfterMs: 7000,
        status: "retryable",
      })
    ).toEqual({
      lastSequence: 4,
      reasonCode: "lark.card_update_http_429",
      retryAfterMs: 7000,
      status: "retryable",
    });
  });
});
