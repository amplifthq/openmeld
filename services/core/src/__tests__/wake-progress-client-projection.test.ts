import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { projectWakeProgressItemsForClient } from "../space/application/wake-progress-client-projection";

const WRITING_ITEM: WakeProgressItem = {
  clientMessageId: "client-message-1",
  dispatchId: "dispatch-1",
  message: "runner is replying",
  phase: "writing",
  previewText: "I’m checking the release now.",
  sourceSignalId: "signal-1",
  targetLabel: "@runner",
  targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
  terminal: false,
  updatedAtMs: 1_805_000_000_000,
};

describe("Wake progress client projection", () => {
  it("includes device waiting details only for clients that opt into that contract", () => {
    const waiting: WakeProgressItem = {
      ...WRITING_ITEM,
      phase: "request_sent",
      deviceWait: {
        deadlineAtMs: WRITING_ITEM.updatedAtMs + 60_000,
        reason: "device_offline",
      },
    };
    expect(
      projectWakeProgressItemsForClient({
        items: [waiting],
        includePreviewText: true,
      })[0]
    ).not.toHaveProperty("deviceWait");
    expect(
      projectWakeProgressItemsForClient({
        items: [waiting],
        includePreviewText: false,
        includeDeviceWait: true,
      })[0]
    ).toMatchObject({ deviceWait: waiting.deviceWait });
  });
  it("omits live reply preview text unless the client opts in", () => {
    const [item] = projectWakeProgressItemsForClient({
      includePreviewText: false,
      items: [WRITING_ITEM],
    });

    expect(item).toMatchObject({
      message: WRITING_ITEM.message,
      phase: "writing",
    });
    expect(item).not.toHaveProperty("previewText");
  });

  it("returns live reply preview text to an opted-in client", () => {
    expect(
      projectWakeProgressItemsForClient({
        includePreviewText: true,
        items: [WRITING_ITEM],
      })
    ).toEqual([WRITING_ITEM]);
  });
});
