import type { WakeProgressItem } from "@openmeld/schemas/types";
import type { createCliSpaceApi } from "../space/cli-space-api";

export const DEFAULT_CENTER_AGENT_ASK_POLL_INTERVAL_MS = 750;

export type CenterAgentAskWaitOutcome =
  | {
      kind: "terminal";
      progress: WakeProgressItem;
    }
  | {
      kind: "needs_input";
      progress: WakeProgressItem;
    }
  | {
      kind: "pending";
      progress: WakeProgressItem | null;
    };

export async function waitForCenterAgentAsk(input: {
  clientMessageId: string;
  deadlineAtMs: number;
  pollIntervalMs: number;
  requestContext: Parameters<
    ReturnType<typeof createCliSpaceApi>["getWakeProgress"]
  >[0]["requestContext"];
  spaceApi: ReturnType<typeof createCliSpaceApi>;
  spaceId: string;
  targetProfileId: string;
}): Promise<CenterAgentAskWaitOutcome> {
  let lastProgress: WakeProgressItem | null = null;

  while (true) {
    const response = await input.spaceApi.getWakeProgress({
      clientMessageId: input.clientMessageId,
      requestContext: input.requestContext,
      spaceId: input.spaceId,
      targetProfileId: input.targetProfileId,
    });
    lastProgress =
      response.items.find(
        (item) => item.targetProfileId === input.targetProfileId
      ) ?? null;
    if (lastProgress?.pendingInteraction) {
      return { kind: "needs_input", progress: lastProgress };
    }
    if (lastProgress?.terminal) {
      return { kind: "terminal", progress: lastProgress };
    }
    const remainingMs = input.deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      return { kind: "pending", progress: lastProgress };
    }
    await delay(
      Math.min(normalizePollIntervalMs(input.pollIntervalMs), remainingMs)
    );
  }
}

export async function waitForCenterAgentVisibleReply(input: {
  deadlineAtMs: number;
  pollIntervalMs: number;
  requestContext: Parameters<
    ReturnType<typeof createCliSpaceApi>["listSignalEnvelopes"]
  >[0]["requestContext"];
  sourceSignalId: string;
  spaceApi: ReturnType<typeof createCliSpaceApi>;
  spaceId: string;
  targetProfileId: string;
}): Promise<{
  answer: string;
  publishedSignalId: string;
} | null> {
  while (true) {
    const response = await input.spaceApi.listSignalEnvelopes({
      query: {
        afterSignalId: input.sourceSignalId,
        fromProfileIds: [input.targetProfileId],
        kinds: ["text"],
        limit: 50,
      },
      requestContext: input.requestContext,
      spaceId: input.spaceId,
    });
    const visibleReply = response.envelopes.find(
      (signal) =>
        signal.type === "signal.text" &&
        signal.data.messageEnvelope?.replyToSignalId === input.sourceSignalId
    );
    if (visibleReply?.type === "signal.text") {
      const answer = visibleReply.data.text.trim();
      if (answer.length > 0) {
        return {
          answer,
          publishedSignalId: visibleReply.id,
        };
      }
    }

    const remainingMs = input.deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      return null;
    }
    await delay(
      Math.min(normalizePollIntervalMs(input.pollIntervalMs), remainingMs)
    );
  }
}

function normalizePollIntervalMs(value: number): number {
  return Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : DEFAULT_CENTER_AGENT_ASK_POLL_INTERVAL_MS;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
