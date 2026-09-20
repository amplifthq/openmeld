import { describe, expect, it, vi } from "vitest";
import { readLatestVisibleFormalUpdate } from "../src/space/application/space-latest-visible-update-service";

describe("space-latest-visible-update-service", () => {
  it("continues to the next bounded page without changing latest-visible semantics", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `invalid-${String(index).padStart(3, "0")}`,
      payload_json: "{}",
      ts: 1000 - index,
    }));
    const visibleSignal = {
      v: 1,
      id: "signal-visible-on-second-page",
      spaceId: "space-paged-latest-visible",
      ts: 800,
      type: "signal.text",
      profile: {
        kind: "human",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Test User",
      },
      data: { text: "Visible after the first candidate page." },
    };
    const exec = vi.fn((_sql: string, ...params: SqlStorageValue[]) => ({
      toArray: () =>
        params.length === 1
          ? firstPage
          : [
              {
                id: visibleSignal.id,
                payload_json: JSON.stringify(visibleSignal),
                ts: visibleSignal.ts,
              },
            ],
    }));

    const latestVisibleUpdate = await readLatestVisibleFormalUpdate({
      sql: { exec } as unknown as SqlStorage,
    });

    expect(exec).toHaveBeenCalledTimes(2);
    expect(latestVisibleUpdate).toMatchObject({
      actorName: "Test User",
      previewText: "Visible after the first candidate page.",
      signalId: visibleSignal.id,
    });
  });

  it("returns a bounded preview for a long visible message", async () => {
    const visibleSignal = {
      v: 1,
      id: "signal-long-visible-update",
      spaceId: "space-long-latest-visible",
      ts: 900,
      type: "signal.text",
      profile: {
        kind: "human",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Test User",
      },
      data: { text: `${"a".repeat(238)}😀tail-that-must-not-leak` },
    };
    const exec = vi.fn(() => ({
      toArray: () => [
        {
          id: visibleSignal.id,
          payload_json: JSON.stringify(visibleSignal),
          ts: visibleSignal.ts,
        },
      ],
    }));

    const latestVisibleUpdate = await readLatestVisibleFormalUpdate({
      sql: { exec } as unknown as SqlStorage,
    });

    expect(latestVisibleUpdate?.previewText).toHaveLength(239);
    expect(latestVisibleUpdate?.previewText).toBe(`${"a".repeat(238)}…`);
    expect(latestVisibleUpdate?.previewText).not.toContain("tail");
  });

  it("projects only the authorized message preview, never Agent local-origin facts", async () => {
    const signal = {
      v: 1,
      id: "signal-agent-preview",
      spaceId: "space-agent-preview",
      ts: 1000,
      type: "signal.text",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Project Analyst",
        owner: "private-owner",
        workingDirectory: "/private/company/project",
        agentControllerConversationId: "private-native-conversation",
      },
      data: { text: "The review is complete." },
    };
    const exec = vi.fn(() => ({
      toArray: () => [
        {
          id: signal.id,
          ts: signal.ts,
          payload_json: JSON.stringify(signal),
        },
      ],
    }));
    const preview = await readLatestVisibleFormalUpdate({
      sql: { exec } as unknown as SqlStorage,
    });
    expect(preview).toEqual({
      actorName: "Project Analyst",
      actorProfileId: signal.profile.profileId,
      createdAt: "1970-01-01T00:00:01.000Z",
      previewText: "The review is complete.",
      signalId: signal.id,
      signalType: "signal.text",
    });
  });
});
