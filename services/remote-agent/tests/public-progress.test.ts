import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { createHostedPublicProgressTool } from "../flue-adapter/public-progress";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SUBMISSION_ID = "submission_public_progress";

describe("hosted public progress", () => {
  it("publishes an explicitly authored update through the transient Space stream", async () => {
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
      async (body: { sequence: number }) => ({
        status: "accepted" as const,
        lastSequence: body.sequence,
      })
    );
    const tool = createHostedPublicProgressTool({
      coreWorker: { submitRemoteAgentStreamDelta },
      storage,
      streamPublisher: createRemoteAgentStreamPublisher(),
      submissionId: SUBMISSION_ID,
    });

    await expect(
      tool.execute({ update: "Checking the current Space context." })
    ).resolves.toEqual({ shown: true });
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
});
