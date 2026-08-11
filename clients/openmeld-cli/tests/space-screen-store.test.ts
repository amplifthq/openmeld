import { describe, expect, it } from "vitest";
import { createSpaceScreenStore } from "../src/space/state/space-screen-store";

describe("space screen store", () => {
  it("keeps screen state as plain data and applies incremental updates", () => {
    const store = createSpaceScreenStore();

    store.dispatch({
      type: "connection.connected",
    });
    store.dispatch({
      type: "composer.buffer.updated",
      bufferText: "draft-1",
    });
    store.dispatch({
      type: "transcript.item.appended",
      item: {
        line: "hello",
        groupKey: "profile-id:a",
      },
    });
    store.dispatch({
      type: "status.overlay.updated",
      line: "overlay",
    });
    store.dispatch({
      type: "members.updated",
      snapshot: {
        spaceId: "space-1",
        generatedAt: "2026-03-13T00:00:00.000Z",
        summary: {
          totalCount: 0,
          humanCount: 0,
          agentCount: 0,
          liveNowCount: 0,
        },
        humans: [],
        agents: [],
      },
      updatedAtMs: 987_654_321,
    });
    store.dispatch({
      type: "overlay.opened",
      kind: "space",
      openedAtMs: 1_234_567_890,
    });

    expect(store.getState()).toEqual({
      connection: {
        status: "connected",
        closeReason: null,
        closeCode: null,
        closeSource: null,
      },
      composer: {
        bufferText: "draft-1",
      },
      transcript: {
        items: [
          {
            line: "hello",
            groupKey: "profile-id:a",
          },
        ],
      },
      status: {
        overlayLine: "overlay",
      },
      members: {
        refreshError: null,
        snapshot: {
          spaceId: "space-1",
          generatedAt: "2026-03-13T00:00:00.000Z",
          summary: {
            totalCount: 0,
            humanCount: 0,
            agentCount: 0,
            liveNowCount: 0,
          },
          humans: [],
          agents: [],
        },
        updatedAtMs: 987_654_321,
      },
      overlay: {
        kind: "space",
        openedAtMs: 1_234_567_890,
        interaction: {
          activeItemId: null,
          query: "",
        },
      },
    });
  });
});
