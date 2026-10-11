import { DatabaseSync } from "node:sqlite";
import { messageReadQuerySchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { readSpaceMessagePage } from "../src/space/application/message-read";
import {
  backfillSpaceMessageSearch,
  initializeSpaceMessageSearch,
  searchSpaceMessages,
} from "../src/space/infrastructure/sql/space-message-search-repo";

describe("Space message search", () => {
  it("reads 186 messages within a byte budget and resumes long Unicode messages without gaps", async () => {
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
    try {
      db.exec(
        "CREATE TABLE space_signals (id TEXT PRIMARY KEY, type TEXT, payload_json TEXT); CREATE TABLE space_thread_signal_placements (signal_id TEXT, thread_id TEXT, placement TEXT); CREATE TABLE space_threads(thread_id TEXT, root_signal_id TEXT)"
      );
      const insert = (id: string, text: string) =>
        db
          .prepare("INSERT INTO space_signals VALUES (?, 'signal.text', ?)")
          .run(
            id,
            JSON.stringify({
              v: 1,
              id,
              spaceId: "space-1",
              ts: 100,
              type: "signal.text",
              profile: {
                profileId: "human-1",
                profileName: "Alice",
                kind: "human",
              },
              data: { text },
            })
          );
      const original = new Map<string, string>();
      for (let index = 0; index < 186; index++) {
        const text =
          index === 185
            ? `${"超长消息🙂".repeat(3000)} target final decision`
            : `feedback ${index}`;
        original.set(`m-${index}`, text);
        insert(`m-${index}`, text);
      }
      const query = messageReadQuerySchema.parse({
        spaceId: "space-1",
        mode: "full",
        limit: 186,
        maxBytes: 4096,
      });
      const received = new Map<string, string>();
      let cursor: string | undefined;
      let finished = 0;
      let pages = 0;
      do {
        const page = await readSpaceMessagePage({
          sql,
          query: { ...query, cursor },
          viewerKey: "human-1",
          project: (signal) => signal,
        });
        expect(
          new TextEncoder().encode(JSON.stringify(page)).length
        ).toBeLessThanOrEqual(query.maxBytes);
        for (const item of page.matches) {
          const prior = received.get(item.signal.id) ?? "";
          expect(item.content.offset).toBe(prior.length);
          received.set(item.signal.id, prior + item.signal.data.text);
        }
        finished += page.completeCount;
        // Serialize the continuation as a new process/compaction checkpoint would.
        cursor = page.nextCursor
          ? JSON.parse(JSON.stringify(page.nextCursor))
          : undefined;
        if (pages++ === 0) {
          insert("new-after-start", "must not shift this read");
        }
        expect(pages).toBeLessThan(100);
      } while (cursor);
      expect(received).toEqual(original);
      expect(finished).toBe(186);
      expect(pages).toBeGreaterThan(2);
      const preview = await readSpaceMessagePage({
        sql,
        query: { ...query, q: "target", mode: "preview" },
        viewerKey: "human-1",
        project: (signal) => signal,
      });
      expect(preview.matches[0]?.signal.data.text).toContain(
        "target final decision"
      );
      expect(preview.matches[0]?.content.complete).toBe(false);
      const first = await readSpaceMessagePage({
        sql,
        query: { ...query, signalId: "m-185" },
        viewerKey: "human-1",
        project: (signal) => signal,
      });
      const continuation = {
        ...query,
        signalId: "m-185",
        cursor: first.nextCursor ?? undefined,
      };
      await expect(
        readSpaceMessagePage({
          sql,
          query: continuation,
          viewerKey: "different-viewer",
          project: (signal) => signal,
        })
      ).rejects.toThrow("different query");
      db.prepare(
        "UPDATE space_signals SET payload_json = json_set(payload_json, '$.data.text', 'edited') WHERE id = 'm-185'"
      ).run();
      await expect(
        readSpaceMessagePage({
          sql,
          query: continuation,
          viewerKey: "human-1",
          project: (signal) => signal,
        })
      ).rejects.toThrow("message changed");
      const notice = {
        v: 1,
        id: "public-notice",
        spaceId: "space-1",
        ts: 101,
        type: "signal.system_notice",
        profile: {
          profileId: "system",
          profileName: "OpenMeld",
          kind: "human",
        },
        data: {
          text: "The Agent was stopped.",
          noticeType: "wake_stopped",
          dispatchId: "stopped-dispatch",
          generatedBy: "openmeld",
        },
        stoppedReplyText: "Partial answer.",
      };
      db.prepare("INSERT INTO space_signals VALUES (?, ?, ?)").run(
        notice.id,
        notice.type,
        JSON.stringify(notice)
      );
      const history = await readSpaceMessagePage({
        sql,
        query: { ...query, includeSystem: true, limit: 1 },
        viewerKey: "human-1",
        project: (signal) => signal,
      });
      expect(history.matches[0]?.signal).toMatchObject({
        type: "signal.system_notice",
        data: {
          noticeType: "wake_stopped",
          text: "The Agent was stopped.\n\nPartial reply before stop:\nPartial answer.",
        },
      });
    } finally {
      db.close();
    }
  });
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
      insert.run("short", message("short", "A % _"));
      expect(search("a").signals.map((item) => item.id)).toEqual(["short"]);
      expect(search("%").signals.map((item) => item.id)).toEqual(["short"]);
      expect(search("_").signals.map((item) => item.id)).toEqual(["short"]);
    } finally {
      db.close();
    }
  });
});
