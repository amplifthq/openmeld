import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  backfillSpaceMessageSearch,
  initializeSpaceMessageSearch,
  searchSpaceMessages,
} from "../src/space/infrastructure/sql/space-message-search-repo";

describe("Space message search", () => {
  it("resumes historical indexing and follows edits, recalls and retention atomically", () => {
    const db = new DatabaseSync(":memory:");
    const sql = {
      exec(query: string, ...params: (string | number | null)[]) {
        const statement = db.prepare(query);
        if (!statement.columns().length) {
          statement.run(...params);
          return { toArray: () => [], one: () => undefined };
        }
        const rows = statement.all(...params);
        return { toArray: () => rows, one: () => rows[0] };
      },
    } as unknown as SqlStorage;
    const message = (id: string, text: string, recalled = false) =>
      JSON.stringify({
        v: 1,
        id,
        spaceId: "space-1",
        ts: 100,
        type: "signal.text",
        profile: { profileId: "human-1", profileName: "Alice", kind: "human" },
        data: { text, ...(recalled ? { meta: { recalledAt: 101 } } : {}) },
      });
    try {
      db.exec(
        "CREATE TABLE space_signals (id TEXT PRIMARY KEY, type TEXT, payload_json TEXT)"
      );
      db.exec(
        "CREATE TABLE space_thread_signal_placements (signal_id TEXT, thread_id TEXT, placement TEXT); CREATE TABLE space_threads(thread_id TEXT, root_signal_id TEXT)"
      );
      const insert = db.prepare(
        "INSERT INTO space_signals VALUES (?, 'signal.text', ?)"
      );
      for (let index = 0; index < 501; index++) {
        insert.run(`m-${index}`, message(`m-${index}`, "Historic invoice"));
      }
      initializeSpaceMessageSearch(sql);
      expect(backfillSpaceMessageSearch(sql)).toBe(false);
      insert.run("live", message("live", "Current invoice"));
      expect(backfillSpaceMessageSearch(sql)).toBe(true);
      const search = (query: string, before: number | null = null) =>
        searchSpaceMessages(sql, { query, before, limit: 2 });
      expect(search("invoice").signals.map((item) => item.id)).toEqual([
        "live",
        "m-500",
      ]);
      expect(
        search("invoice", Number(search("invoice").nextCursor)).signals.map(
          (item) => item.id
        )
      ).toEqual(["m-499", "m-498"]);
      db.prepare(
        "UPDATE space_signals SET payload_json = ? WHERE id = 'live'"
      ).run(message("live", "Revised budget"));
      expect(search("current").signals).toEqual([]);
      expect(search("budget").signals.map((item) => item.id)).toEqual(["live"]);
      db.prepare(
        "UPDATE space_signals SET payload_json = ? WHERE id = 'live'"
      ).run(message("live", "Revised budget", true));
      expect(search("budget").signals).toEqual([]);
      db.exec("DELETE FROM space_signals WHERE id = 'm-500'");
      expect(search("invoice").signals.map((item) => item.id)).toEqual([
        "m-499",
        "m-498",
      ]);
      expect(search('invoice OR "budget"').signals).toEqual([]);
      expect(search("***").signals).toEqual([]);
      insert.run("chinese", message("chinese", "我们讨论搜索历史消息的方案"));
      expect(search("历史消息").signals.map((item) => item.id)).toEqual([
        "chinese",
      ]);
      expect(search("nvoice").signals.length).toBe(2);
    } finally {
      db.close();
    }
  });
});
