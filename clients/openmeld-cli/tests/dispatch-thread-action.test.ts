import { normalizeDispatchThreadAction } from "@openmeld/local-service";
import { describe, expect, it } from "vitest";

const THREAD_CONTEXT = {
  threadId: "thr_11111111-1111-4111-8111-111111111111",
  rootSignalId: "sig-root-1",
} as const;

describe("normalizeDispatchThreadAction", () => {
  it("defaults post_message replies to the current thread", () => {
    const normalized = normalizeDispatchThreadAction({
      action: {
        type: "post_message",
        messageEnvelope: {
          text: "Checklist is ready.",
          activationTargets: [],
          referenceTargets: [],
        },
      },
      threadContext: THREAD_CONTEXT,
    });

    expect(normalized.thread).toEqual({ threadId: THREAD_CONTEXT.threadId });
  });

  it("defaults post_status replies to the current thread", () => {
    const normalized = normalizeDispatchThreadAction({
      action: {
        type: "post_status",
        status: "working",
        text: "Checking release blockers.",
      },
      threadContext: THREAD_CONTEXT,
    });

    expect(normalized.thread).toEqual({ threadId: THREAD_CONTEXT.threadId });
  });

  it("rejects an explicit thread that does not match the current dispatch thread", () => {
    expect(() =>
      normalizeDispatchThreadAction({
        action: {
          type: "post_message",
          messageEnvelope: {
            text: "Wrong thread.",
            activationTargets: [],
            referenceTargets: [],
          },
          thread: { threadId: "thr_22222222-2222-4222-8222-222222222222" },
        },
        threadContext: THREAD_CONTEXT,
      })
    ).toThrow(
      `structured action thread.threadId must match the current dispatch thread: ${THREAD_CONTEXT.threadId}`
    );
  });

  it("rejects thread-scoped actions when the dispatch has no thread", () => {
    expect(() =>
      normalizeDispatchThreadAction({
        action: {
          type: "post_status",
          status: "blocked",
          text: "Need a thread context.",
          thread: { threadId: THREAD_CONTEXT.threadId },
        },
        threadContext: null,
      })
    ).toThrow(
      "structured action thread is only allowed when the dispatch belongs to a thread"
    );
  });
});
