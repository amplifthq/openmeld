import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { readDispatchSourceSignalContext } from "../dispatch/application/dispatch-source-signal-context";

describe("Space-owned dispatch source context", () => {
  it("preserves the dispatch snapshot's author and text", async () => {
    const result = await readDispatchSourceSignalContext({
      message: createQueueMessage({
        sourceSignalSnapshot: {
          profileId: "usr-source-1",
          profileKind: "human",
          profileMentionLabel: "wake-1",
          text: " Hello from snapshot ",
        },
      }),
    });
    expect(result).toEqual({
      profileId: "usr-source-1",
      profileKind: "human",
      profileHandle: null,
      profileMentionLabel: "wake-1",
      text: "Hello from snapshot",
    });
  });

  it("retains the source selector without inventing an author for a legacy dispatch", async () => {
    const result = await readDispatchSourceSignalContext({
      message: createQueueMessage({ sourceEventId: "sig-source-404" }),
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

function createQueueMessage(
  overrides: Partial<OpenMeldDaemonDispatchQueueMessage> = {}
): OpenMeldDaemonDispatchQueueMessage {
  return {
    dispatchId: "dispatch-1",
    idempotencyKey: "idem-1",
    queueAttempt: 1,
    sourceEventId: "sig-source-1",
    targetProfileId: "agt-target-1",
    v: "openMeldDaemon.dispatch.v1",
    ...overrides,
  } as OpenMeldDaemonDispatchQueueMessage;
}
