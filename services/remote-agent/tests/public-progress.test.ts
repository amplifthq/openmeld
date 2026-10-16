import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { createHostedPublicProgressTool } from "../flue-adapter/public-progress";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SUBMISSION_ID = "submission_public_progress";

describe("hosted public progress", () => {
  it.each([
    "accepted",
    "duplicate_accepted",
    "rejected",
  ] as const)("reports visible progress only for a Core acceptance (%s)", async (status) => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: request.idempotencyKey,
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request,
      })
    );
    const submitRemoteAgentStreamDelta = vi.fn(
      async (body: { kind?: string; sequence: number }) =>
        body.kind === "progress" && status === "rejected"
          ? {
              status,
              lastSequence: body.sequence,
              reasonCode: "agent_stream.terminal",
            }
          : {
              status: body.kind === "progress" ? status : ("accepted" as const),
              lastSequence: body.sequence,
            }
    );
    const publisher = createRemoteAgentStreamPublisher();
    const context = await readRemoteAgentCallbackContext(
      storage,
      SUBMISSION_ID
    );
    if (!context) {
      throw new Error("Missing progress callback context");
    }
    for (const offset of [0, 1]) {
      await publisher.push({
        context,
        coreWorker: { submitRemoteAgentStreamDelta },
        storage,
        kind: "thinking",
        delta: "Reasoning stays separate. ",
        observedAtMs: TEST_NOW_MS + offset,
      });
    }
    const tool = createHostedPublicProgressTool({
      coreWorker: { submitRemoteAgentStreamDelta },
      storage,
      streamPublisher: publisher,
      submissionId: SUBMISSION_ID,
    });

    await expect(
      tool.execute({ update: "Checking the current Space context." })
    ).resolves.toEqual({ shown: status !== "rejected" });
    expect(submitRemoteAgentStreamDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "progress",
        snapshot: "Checking the current Space context.\n\n",
        source: "hosted.public_progress",
      })
    );
    const storedStreamState = await storage.list({
      prefix: "openmeld:remote-agent:stream:",
    });
    expect(JSON.stringify([...storedStreamState.values()])).not.toContain(
      "Checking the current Space context"
    );
  });

  it("does not send Space-only progress to a Message Channel", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    request.turnEnvelope.trigger = {
      source: "message_channel",
      provider: "lark",
      connectionId: "connection_1",
      conversationId: "conversation_1",
    };
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: request.idempotencyKey,
          requestId: SUBMISSION_ID,
          status: "pending",
          submissionId: SUBMISSION_ID,
        },
        nowMs: TEST_NOW_MS,
        request,
      })
    );
    const submitRemoteAgentStreamDelta = vi.fn();
    const tool = createHostedPublicProgressTool({
      coreWorker: { submitRemoteAgentStreamDelta },
      storage,
      streamPublisher: createRemoteAgentStreamPublisher(),
      submissionId: SUBMISSION_ID,
    });

    await expect(
      tool.execute({ update: "Checking the request." })
    ).resolves.toEqual({
      shown: false,
    });
    expect(submitRemoteAgentStreamDelta).not.toHaveBeenCalled();
  });

  it("keeps text streaming when the previous Core rejects the new progress kind", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: SUBMISSION_ID,
        status: "pending",
        submissionId: SUBMISSION_ID,
      },
      nowMs: TEST_NOW_MS,
      request,
    });
    await putRemoteAgentCallbackContext(storage, context);
    const submitRemoteAgentStreamDelta = vi.fn(
      async (
        body: Parameters<
          NonNullable<
            RemoteAgentCoreWorkerBinding["submitRemoteAgentStreamDelta"]
          >
        >[0]
      ) =>
        "kind" in body && body.kind === "progress"
          ? {
              status: "rejected" as const,
              reasonCode: "agent_stream.invalid",
              lastSequence: 0,
            }
          : { status: "accepted" as const, lastSequence: body.sequence }
    );
    const coreWorker = { submitRemoteAgentStreamDelta };
    const publisher = createRemoteAgentStreamPublisher();
    const tool = createHostedPublicProgressTool({
      coreWorker,
      storage,
      streamPublisher: publisher,
      submissionId: SUBMISSION_ID,
    });

    await publisher.push({
      context,
      coreWorker,
      delta: "I found the context. ",
      kind: "text",
      observedAtMs: TEST_NOW_MS,
      storage,
    });
    await publisher.flush({
      context,
      coreWorker,
      observedAtMs: TEST_NOW_MS + 50,
      storage,
    });
    await expect(
      tool.execute({ update: "Checking context." })
    ).resolves.toEqual({
      shown: false,
    });
    await expect(
      tool.execute({ update: "Checking once more." })
    ).resolves.toEqual({
      shown: false,
    });
    await expect(
      publisher.push({
        context,
        coreWorker,
        delta: "The answer is ready.",
        kind: "text",
        observedAtMs: TEST_NOW_MS + 100,
        storage,
      })
    ).resolves.toMatchObject({ status: "buffered" });
    await expect(
      publisher.flush({
        context,
        coreWorker,
        observedAtMs: TEST_NOW_MS + 200,
        storage,
      })
    ).resolves.toMatchObject({ status: "published" });
    expect(submitRemoteAgentStreamDelta.mock.calls).toHaveLength(3);
    expect(submitRemoteAgentStreamDelta.mock.calls[1]?.[0]).toMatchObject({
      kind: "progress",
      sequence: 2,
    });
    expect(submitRemoteAgentStreamDelta.mock.calls[2]?.[0]).toMatchObject({
      kind: "text",
      sequence: 2,
      snapshot: "I found the context. The answer is ready.",
    });
  });
});
