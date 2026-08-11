import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
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
      env: {} as CoreBindings,
      sql: { exec } as unknown as SqlStorage,
    });

    expect(exec).toHaveBeenCalledTimes(2);
    expect(latestVisibleUpdate).toMatchObject({
      actorName: "Test User",
      previewText: "Visible after the first candidate page.",
      signalId: visibleSignal.id,
    });
  });
});
