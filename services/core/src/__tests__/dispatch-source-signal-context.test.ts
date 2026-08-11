import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readDispatchSourceSignalContext } from "../dispatch/infrastructure/d1/dispatch-source-signal-context";

describe("dispatch source signal context", () => {
  it("prefers the queue snapshot when it already carries source signal text", async () => {
    const db = {
      prepare: vi.fn(),
    } as unknown as D1Database;

    const result = await readDispatchSourceSignalContext({
      db,
      message: createQueueMessage({
        sourceSignalSnapshot: {
          profileId: "usr-source-1",
          profileKind: "human",
          profileMentionLabel: "wake-1",
          text: " Hello from snapshot ",
        },
      }),
    });

    expect(db.prepare).not.toHaveBeenCalled();
    expect(result).toEqual({
      profileId: "usr-source-1",
      profileKind: "human",
      profileHandle: null,
      profileMentionLabel: "wake-1",
      text: "Hello from snapshot",
    });
  });

  it("reads the stored source signal payload when the queue snapshot is absent", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            payloadJson: JSON.stringify({
              data: { text: "Reply context text" },
              profile: {
                kind: "agent",
                profileHandle: "codex",
                profileId: "agt-source-1",
              },
            }),
          }),
        }),
      })),
    } as unknown as D1Database;

    const result = await readDispatchSourceSignalContext({
      db,
      message: createQueueMessage(),
    });

    expect(result).toEqual({
      profileId: "agt-source-1",
      profileKind: "agent",
      profileHandle: "codex",
      profileMentionLabel: null,
      text: "Reply context text",
    });
  });

  it("falls back to a synthetic source text when the stored payload is unavailable", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            payloadJson: "{not-json",
          }),
        }),
      })),
    } as unknown as D1Database;

    const result = await readDispatchSourceSignalContext({
      db,
      message: createQueueMessage({
        sourceEventId: "sig-source-404",
      }),
    });

    expect(result).toEqual({
      profileId: null,
      profileKind: null,
      profileHandle: null,
      profileMentionLabel: null,
      text: "reply to source event sig-source-404",
    });
  });
});

const createQueueMessage = (
  overrides: Partial<OpenMeldDaemonDispatchQueueMessage> = {}
): OpenMeldDaemonDispatchQueueMessage =>
  ({
    dispatchId: "dispatch-1",
    idempotencyKey: "idem-1",
    queueAttempt: 1,
    sourceEventId: "sig-source-1",
    targetProfileId: "agt-target-1",
    v: "openMeldDaemon.dispatch.v1",
    ...overrides,
  }) as OpenMeldDaemonDispatchQueueMessage;
