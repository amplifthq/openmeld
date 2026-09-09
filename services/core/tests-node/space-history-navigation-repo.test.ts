import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readSpaceHistoryNavigationGroups } from "../src/space/infrastructure/sql/space-history-navigation-repo";
import { listSignalEntriesAroundAnchor } from "../src/space/infrastructure/sql/space-signal-repo";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE space_signals (id TEXT PRIMARY KEY, ts INTEGER, type TEXT, payload_json TEXT);
    CREATE TABLE space_thread_signal_placements (signal_id TEXT PRIMARY KEY, placement TEXT);`);
  const insert = db.prepare("INSERT INTO space_signals VALUES (?, ?, ?, ?)");
  for (let index = 0; index < 480; index += 1) {
    // Equal timestamps deliberately exercise durable insertion order.
    insert.run(
      `main-${index}`,
      100,
      "signal.text",
      JSON.stringify({ id: `main-${index}` })
    );
    for (let reply = 0; reply < 3; reply += 1) {
      const id = `thread-${index}-${reply}`;
      insert.run(id, 100, "signal.text", JSON.stringify({ id }));
      db.prepare(
        "INSERT INTO space_thread_signal_placements VALUES (?, 'thread')"
      ).run(id);
    }
    insert.run(`presence-${index}`, 100, "signal.presence", "{}");
  }
  const sql = {
    exec: (query: string, ...params: (string | number | null)[]) => ({
      toArray: () => db.prepare(query).all(...params),
    }),
  } as unknown as SqlStorage;
  return { db, sql };
}

describe("Space history directory", () => {
  it("covers every main message with bounded excerpts, including equal timestamps", () => {
    const { db, sql } = fixture();
    try {
      const groups = readSpaceHistoryNavigationGroups(sql, {});
      expect(groups).toHaveLength(48);
      expect(groups.reduce((total, group) => total + group.count, 0)).toBe(480);
      expect(groups[0]?.signal_id).toBe("main-0");
      expect(groups.at(-1)?.end_signal_id).toBe("main-479");
      const expanded = groups.flatMap((group) =>
        readSpaceHistoryNavigationGroups(sql, {
          startSignalId: group.signal_id,
          endSignalId: group.end_signal_id,
        })
      );
      expect(expanded.map((entry) => entry.signal_id)).toEqual(
        Array.from({ length: 480 }, (_, index) => `main-${index}`)
      );
      expect(
        readSpaceHistoryNavigationGroups(sql, { startSignalId: "missing" })
      ).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("pages across thread replies without presenting a false main-history boundary", () => {
    const { db, sql } = fixture();
    try {
      const page = listSignalEntriesAroundAnchor(sql, {
        aroundSignalId: "main-240",
        beforeCount: 30,
        afterCount: 30,
        filters: { signalTypes: ["signal.text"], mainTimelineOnly: true },
      });
      expect(
        page?.beforeEntries.map(([, payload]) => JSON.parse(payload).id)
      ).toEqual(
        Array.from({ length: 30 }, (_, index) => `main-${210 + index}`)
      );
      expect(
        page?.afterEntries.map(([, payload]) => JSON.parse(payload).id)
      ).toEqual(
        Array.from({ length: 30 }, (_, index) => `main-${241 + index}`)
      );
    } finally {
      db.close();
    }
  });
});
