import { describe, expect, it, vi } from "vitest";
import { updateDispatchResultInboxPublishState } from "../runtime-transport/infrastructure/d1/dispatch-result-inbox-repo";

describe("dispatch result inbox repo", () => {
  it("keeps a published reply projection terminal when a later publication failure arrives", async () => {
    let updateQuery = "";
    let updateParams: unknown[] = [];
    const db = {
      prepare: vi.fn((query: string) => {
        if (query.includes("UPDATE openMeldDaemon_dispatch_result_inbox")) {
          updateQuery = query;
          return {
            bind: vi.fn((...params: unknown[]) => {
              updateParams = params;
              return {
                run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
              };
            }),
          };
        }
        if (
          query.includes("SELECT") &&
          query.includes("WHERE result_key = ?")
        ) {
          return {
            bind: vi.fn(() => ({
              first: vi.fn().mockResolvedValue({
                publish_state: "reply_published",
              }),
            })),
          };
        }
        throw new Error(`unexpected query: ${query}`);
      }),
    } as unknown as D1Database;

    await expect(
      updateDispatchResultInboxPublishState(db, {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        publicationErrorCode: "space.reply_write_failed",
        publishedSignalId: null,
        publishState: "reply_publication_failed",
        updatedAtMs: 1_700_000_000_100,
      })
    ).resolves.toEqual({ status: "unchanged_terminal" });

    expect(updateQuery).toContain("publish_state <> 'reply_published'");
    expect(updateParams).toEqual([
      "reply_publication_failed",
      null,
      "space.reply_write_failed",
      1_700_000_000_100,
      "dispatch-1::attempt-1",
    ]);
  });
});
