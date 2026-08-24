import {
  AGENT_STREAM_SNAPSHOT_MAX_CHARS,
  REMOTE_AGENT_STREAM_DELTA_MAX_CHARS,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  handleRemoteAgentChatResponse,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentStreamDeltaCallbackBody,
  buildRemoteAgentStreamPartCallbackBody,
  createRemoteAgentStreamPublisher,
  isRemoteAgentStreamEligible,
} from "../flue-adapter/streaming";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const ACK = {
  accepted: true,
  createdAt: TEST_NOW_MS,
  idempotencyKey: "remote-agent:dispatch_123",
  requestId: "flue_submission_123",
  status: "pending",
  submissionId: "flue_submission_123",
} as const;

describe("Remote Agent streaming", () => {
  it("builds stable stream identity and sequence from the native delivery context", () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });

    expect(
      buildRemoteAgentStreamDeltaCallbackBody({
        context,
        delta: " plan",
        kind: "text",
        observedAtMs: TEST_NOW_MS + 100,
        sequence: 2,
        snapshot: "Release plan",
      })
    ).toEqual({
      agentProfileId: context.agentProfileId,
      bindingId: context.bindingId,
      dispatchId: context.dispatchId,
      idempotencyKey: context.idempotencyKey,
      observedAtMs: TEST_NOW_MS + 100,
      organizationId: context.organizationId,
      sequence: 2,
      delta: " plan",
      kind: "text",
      spaceId: context.spaceId,
      streamId: `stream:${ACK.submissionId}`,
      submissionId: ACK.submissionId,
      snapshot: "Release plan",
      source: "flue.text_delta",
      triggerMessageId: context.triggerMessageId,
      v: 2,
    });
  });

  it("builds a privacy-bounded tool part without Flue arguments or results", () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });

    expect(
      buildRemoteAgentStreamPartCallbackBody({
        context,
        observedAtMs: TEST_NOW_MS + 100,
        part: {
          type: "tool",
          toolCallId: "tool_call_1",
          toolName: "openmeld_list_spaces",
          state: "input-available",
        },
        sequence: 1,
      })
    ).toEqual({
      agentProfileId: context.agentProfileId,
      bindingId: context.bindingId,
      dispatchId: context.dispatchId,
      idempotencyKey: context.idempotencyKey,
      observedAtMs: TEST_NOW_MS + 100,
      organizationId: context.organizationId,
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "input-available",
      },
      sequence: 1,
      source: "flue.tool",
      spaceId: context.spaceId,
      streamId: `stream:${ACK.submissionId}`,
      submissionId: ACK.submissionId,
      triggerMessageId: context.triggerMessageId,
      v: 1,
    });
  });

  it("orders tool lifecycle parts and text on one stream sequence", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const submitRemoteAgentStreamPart = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const publisher = createRemoteAgentStreamPublisher();
    const coreWorker = {
      submitRemoteAgentStreamDelta,
      submitRemoteAgentStreamPart,
    };

    await publisher.pushPart({
      context,
      coreWorker,
      observedAtMs: TEST_NOW_MS,
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "input-available",
      },
      storage,
    });
    await publisher.push({
      context,
      coreWorker,
      delta: "a".repeat(200),
      kind: "text",
      observedAtMs: TEST_NOW_MS + 100,
      storage,
    });
    await publisher.pushPart({
      context,
      coreWorker,
      observedAtMs: TEST_NOW_MS + 200,
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "output-available",
      },
      storage,
    });

    expect(submitRemoteAgentStreamPart.mock.calls[0]?.[0]).toMatchObject({
      sequence: 1,
      part: { state: "input-available" },
    });
    expect(submitRemoteAgentStreamDelta.mock.calls[0]?.[0]).toMatchObject({
      kind: "text",
      sequence: 2,
      snapshot: "a".repeat(200),
    });
    expect(submitRemoteAgentStreamPart.mock.calls[1]?.[0]).toMatchObject({
      sequence: 3,
      part: { state: "output-available" },
    });
  });

  it("streams protocol-looking assistant prose as ordinary text", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const publisher = createRemoteAgentStreamPublisher();
    const coreWorker = { submitRemoteAgentStreamDelta };
    const text =
      "The provider calls its typed event <tool_call>, but this sentence is only an explanation.";

    await publisher.push({
      context,
      coreWorker,
      delta: text,
      kind: "text",
      observedAtMs: TEST_NOW_MS,
      storage,
    });
    await expect(
      publisher.flush({
        context,
        coreWorker,
        observedAtMs: TEST_NOW_MS + 100,
        storage,
      })
    ).resolves.toMatchObject({ status: "published" });
    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: text })
    );
  });

  it("orders thinking and text deltas without persisting thinking content", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const publisher = createRemoteAgentStreamPublisher();

    await publisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "Checking ".repeat(25),
      kind: "thinking",
      observedAtMs: TEST_NOW_MS,
      storage,
    });
    await publisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "Done.".repeat(40),
      kind: "text",
      observedAtMs: TEST_NOW_MS + 100,
      storage,
    });

    expect(submitRemoteAgentStreamDelta.mock.calls[0]?.[0]).toMatchObject({
      delta: "Checking ".repeat(25),
      kind: "thinking",
      sequence: 1,
      snapshot: "Checking ".repeat(25),
      source: "flue.thinking_delta",
      v: 2,
    });
    expect(submitRemoteAgentStreamDelta.mock.calls[1]?.[0]).toMatchObject({
      delta: "Done.".repeat(40),
      kind: "text",
      sequence: 2,
      snapshot: "Done.".repeat(40),
      source: "flue.text_delta",
      v: 2,
    });
    const storedStreamState = await storage.list({
      prefix: "openmeld:remote-agent:stream:",
    });
    expect(JSON.stringify([...storedStreamState.values()])).not.toContain(
      "Checking"
    );
  });

  it("keeps text streaming after the transient thinking budget is exhausted", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const publisher = createRemoteAgentStreamPublisher();
    const fullThinkingChunks =
      AGENT_STREAM_SNAPSHOT_MAX_CHARS / REMOTE_AGENT_STREAM_DELTA_MAX_CHARS;

    for (let index = 0; index < fullThinkingChunks; index += 1) {
      await publisher.push({
        context,
        coreWorker: { submitRemoteAgentStreamDelta },
        delta: "t".repeat(REMOTE_AGENT_STREAM_DELTA_MAX_CHARS),
        kind: "thinking",
        observedAtMs: TEST_NOW_MS + index * 100,
        storage,
      });
    }

    const overflow = await publisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "overflow",
      kind: "thinking",
      observedAtMs: TEST_NOW_MS + fullThinkingChunks * 100,
      storage,
    });
    const text = await publisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "The answer continues.",
      kind: "text",
      observedAtMs: TEST_NOW_MS + (fullThinkingChunks + 1) * 100,
      storage,
    });

    expect(overflow).toMatchObject({
      contentKind: "thinking",
      status: "dropped",
    });
    expect(text).toMatchObject({
      contentKind: "text",
      status: "published",
    });
    expect(submitRemoteAgentStreamDelta.mock.calls.at(-1)?.[0]).toMatchObject({
      delta: "The answer continues.",
      kind: "text",
      snapshot: "The answer continues.",
    });
  });

  it("waits for provider Retry-After before replaying a stream snapshot", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi
      .fn()
      .mockResolvedValueOnce({
        lastSequence: 0,
        reasonCode: "lark.card_update_http_429",
        retryAfterMs: 7000,
        status: "retryable" as const,
      })
      .mockResolvedValueOnce({
        lastSequence: 1,
        status: "accepted" as const,
      });
    const sleep = vi.fn(async () => undefined);
    const publisher = createRemoteAgentStreamPublisher({ sleep });

    await publisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "a".repeat(200),
      kind: "text",
      observedAtMs: TEST_NOW_MS,
      storage,
    });

    expect(sleep).toHaveBeenCalledExactlyOnceWith(7000);
    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledTimes(2);
  });

  it("keeps text streaming when an older Core has no tool-part receiver", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const publisher = createRemoteAgentStreamPublisher();

    await publisher.pushPart({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      observedAtMs: TEST_NOW_MS,
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "input-available",
      },
      storage,
    });
    await publisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "a".repeat(200),
      kind: "text",
      observedAtMs: TEST_NOW_MS + 100,
      storage,
    });

    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "text",
        sequence: 2,
        snapshot: "a".repeat(200),
      })
    );
  });

  it("retries connected App work without its new subject for an older Core", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamPart = vi
      .fn()
      .mockResolvedValueOnce({
        status: "rejected" as const,
        reasonCode: "agent_stream.invalid",
        lastSequence: 0,
      })
      .mockImplementationOnce(async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      }));
    const publisher = createRemoteAgentStreamPublisher();

    const result = await publisher.pushPart({
      context,
      coreWorker: { submitRemoteAgentStreamPart },
      observedAtMs: TEST_NOW_MS,
      part: {
        type: "tool",
        toolCallId: "tool_call_connected_app",
        toolName: "openmeld_execute_app_action",
        state: "output-available",
        work: {
          v: 1,
          key: "connected_app.action.execute",
          subject: {
            kind: "connected_app",
            label: "PostHog: list projects",
          },
        },
      },
      storage,
    });

    expect(result).toMatchObject({ status: "published" });
    expect(submitRemoteAgentStreamPart).toHaveBeenCalledTimes(2);
    expect(submitRemoteAgentStreamPart.mock.calls[0]?.[0]).toMatchObject({
      sequence: 1,
      part: {
        work: {
          key: "connected_app.action.execute",
          subject: {
            kind: "connected_app",
            label: "PostHog: list projects",
          },
        },
      },
    });
    expect(submitRemoteAgentStreamPart.mock.calls[1]?.[0]).toMatchObject({
      sequence: 1,
      part: {
        toolCallId: "tool_call_connected_app",
        toolName: "openmeld_execute_app_action",
      },
    });
    expect(
      submitRemoteAgentStreamPart.mock.calls[1]?.[0].part
    ).not.toHaveProperty("work");
  });

  it("stops the preview after Core rejects a tool part", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn();
    const submitRemoteAgentStreamPart = vi.fn(async () => ({
      status: "rejected" as const,
      reasonCode: "agent_stream.terminal",
      lastSequence: 1,
    }));
    const publisher = createRemoteAgentStreamPublisher();
    const coreWorker = {
      submitRemoteAgentStreamDelta,
      submitRemoteAgentStreamPart,
    };

    await publisher.pushPart({
      context,
      coreWorker,
      observedAtMs: TEST_NOW_MS,
      part: {
        type: "tool",
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "input-available",
      },
      storage,
    });
    const next = await publisher.push({
      context,
      coreWorker,
      delta: "This must not be published.",
      kind: "text",
      observedAtMs: TEST_NOW_MS + 100,
      storage,
    });

    expect(next.status).toBe("disabled");
    expect(submitRemoteAgentStreamDelta).not.toHaveBeenCalled();
  });

  it("caps worker callbacks at ten accumulated snapshots per second", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const publisher = createRemoteAgentStreamPublisher({
      sleep: async () => undefined,
    });

    for (let index = 0; index < 100; index += 1) {
      await publisher.push({
        context,
        coreWorker: { submitRemoteAgentStreamDelta },
        delta: "a",
        kind: "text",
        observedAtMs: TEST_NOW_MS + index * 10,
        storage,
      });
    }
    await publisher.flush({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      observedAtMs: TEST_NOW_MS + 1000,
      storage,
    });

    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledTimes(10);
    expect(submitRemoteAgentStreamDelta.mock.calls.at(-1)?.[0]).toMatchObject({
      sequence: 10,
      snapshot: "a".repeat(100),
    });
  });

  it("applies one callback budget across alternating thinking and text", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const publisher = createRemoteAgentStreamPublisher();

    for (let index = 0; index <= 100; index += 1) {
      await publisher.push({
        context,
        coreWorker: { submitRemoteAgentStreamDelta },
        delta: "a",
        kind: index % 2 === 0 ? "thinking" : "text",
        observedAtMs: TEST_NOW_MS + index * 10,
        storage,
      });
    }

    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledTimes(10);
    expect(
      submitRemoteAgentStreamDelta.mock.calls.map(([body]) => body.sequence)
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("flushes a short pending chunk before the authoritative final callback", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const submitRemoteAgentStreamDelta = vi.fn(() =>
      Promise.reject(new Error("Core stream callback unavailable"))
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_final_1",
      status: "accepted" as const,
    }));
    const publisher = createRemoteAgentStreamPublisher({
      sleep: async () => undefined,
    });

    await publisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "Partial",
      kind: "text",
      observedAtMs: TEST_NOW_MS + 10,
      storage,
    });
    await publisher.flush({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      observedAtMs: TEST_NOW_MS + 20,
      storage,
    });
    await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 30,
      result: {
        continuation: false,
        message: { parts: [{ text: "Authoritative final", type: "text" }] },
        requestId: ACK.requestId,
        status: "completed",
      },
      storage,
    });

    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledTimes(2);
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: ACK.submissionId,
        text: "Authoritative final",
      })
    );
  });

  it("replaces a partial snapshot when recovery restarts the provider", async () => {
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const storage = new InMemoryDurableObjectStorage();
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const firstPublisher = createRemoteAgentStreamPublisher();

    await firstPublisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "a".repeat(200),
      kind: "text",
      observedAtMs: TEST_NOW_MS,
      storage,
    });

    const restartedPublisher = createRemoteAgentStreamPublisher();
    await restartedPublisher.push({
      context,
      coreWorker: { submitRemoteAgentStreamDelta },
      delta: "b",
      kind: "text",
      observedAtMs: TEST_NOW_MS + 100,
      storage,
    });

    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledTimes(2);
    expect(submitRemoteAgentStreamDelta.mock.calls[1]?.[0]).toMatchObject({
      sequence: 2,
      delta: "b",
      kind: "text",
      snapshot: "b",
    });
  });

  it("streams Space conversations but excludes Slack result surfaces", () => {
    const spaceContext = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    const slackRequest = createSubmitTurnRequest({
      turnEnvelope: {
        ...createSubmitTurnRequest().turnEnvelope,
        trigger: {
          source: "slack",
        },
      },
    });
    const slackContext = createRemoteAgentCallbackContext({
      ack: { ...ACK, submissionId: "flue_submission_slack" },
      nowMs: TEST_NOW_MS,
      request: slackRequest,
    });

    expect(isRemoteAgentStreamEligible(spaceContext)).toBe(true);
    expect(isRemoteAgentStreamEligible(slackContext)).toBe(false);
  });
});
