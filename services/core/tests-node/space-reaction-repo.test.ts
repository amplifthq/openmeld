import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveReactionEmoji } from "../src/space/domain/reaction-emoji";
import {
  ensureSpaceReactionTables,
  readSpaceReactionActors,
  readSpaceReactions,
  setSpaceReaction,
} from "../src/space/infrastructure/sql/space-reaction-repo";

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) {
    db.close();
  }
});
function database() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const sql = {
    exec: (query: string, ...args: (string | number | null)[]) => {
      const statement = db.prepare(query);
      function executeWithoutRows() {
        statement.run(...args);
        return [];
      }
      // Execute once, as Durable Object SQL cursors do.
      const rows = statement.columns().length
        ? statement.all(...args)
        : executeWithoutRows();
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
  sql.exec(
    "CREATE TABLE space_members (profile_id TEXT PRIMARY KEY, profile_name_snapshot TEXT, created_at INTEGER)"
  );
  ensureSpaceReactionTables(sql);
  return { db, sql };
}
function reaction(profileId: string, emoji = "👍", active = true) {
  return {
    signalId: "message-1",
    emoji,
    label: "thumbs up",
    active,
    actor: { profileId, displayName: profileId, profileKind: "human" as const },
  };
}
describe("Space reaction persistence", () => {
  it("retries are idempotent and removing one person's reaction preserves everyone else", () => {
    const { sql } = database();
    expect(setSpaceReaction(sql, reaction("alex"))).toBe(true);
    expect(setSpaceReaction(sql, reaction("alex"))).toBe(false);
    setSpaceReaction(sql, reaction("sam"));
    expect(
      readSpaceReactions(sql, ["message-1"], "alex").get("message-1")
    ).toMatchObject({
      version: 2,
      groups: [{ emoji: "👍", count: 2, reactedByMe: true }],
    });
    expect(setSpaceReaction(sql, reaction("alex", "👍", false))).toBe(true);
    expect(setSpaceReaction(sql, reaction("alex", "👍", false))).toBe(false);
    expect(
      readSpaceReactions(sql, ["message-1"], "alex").get("message-1")
    ).toMatchObject({
      version: 3,
      groups: [
        { count: 1, reactedByMe: false, actors: [{ profileId: "sam" }] },
      ],
    });
    setSpaceReaction(sql, reaction("sam", "👍", false));
    expect(readSpaceReactions(sql, ["message-1"]).get("message-1")).toEqual({
      version: 4,
      groups: [],
    });
  });
  it("keeps first-added emoji order through equal timestamps, joins, removals, and rereads", () => {
    const { sql } = database();
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const order = () =>
      readSpaceReactions(sql, ["message-1"])
        .get("message-1")
        ?.groups.map((g) => g.emoji);
    setSpaceReaction(sql, reaction("alex", "👀"));
    setSpaceReaction(sql, reaction("alex", "❤️"));
    setSpaceReaction(sql, reaction("alex", "✅"));
    expect(order()).toEqual(["👀", "❤️", "✅"]);
    setSpaceReaction(sql, reaction("sam", "👀"));
    setSpaceReaction(sql, reaction("alex", "👀", false));
    expect(order()).toEqual(["👀", "❤️", "✅"]);
    setSpaceReaction(sql, reaction("sam", "👀", false));
    setSpaceReaction(sql, reaction("sam", "👀"));
    expect(order()).toEqual(["❤️", "✅", "👀"]);
  });
  it("keeps exact counts and viewer state beyond the name preview, with complete paginated identities", () => {
    const { sql } = database();
    for (let i = 0; i < 61; i++) {
      setSpaceReaction(sql, reaction(`person-${String(i).padStart(2, "0")}`));
    }
    sql.exec(
      "INSERT INTO space_members (profile_id, profile_name_snapshot) VALUES (?, ?)",
      "person-00",
      "Alex renamed"
    );
    const group = readSpaceReactions(sql, ["message-1"], "person-60").get(
      "message-1"
    )?.groups[0];
    expect(group).toMatchObject({
      count: 61,
      reactedByMe: true,
      actorsHasMore: true,
    });
    expect(group?.actors).toHaveLength(10);
    expect(group?.actors[0]?.displayName).toBe("Alex renamed");
    const first = readSpaceReactionActors(sql, {
      signalId: "message-1",
      emoji: "👍",
    });
    const second = readSpaceReactionActors(sql, {
      signalId: "message-1",
      emoji: "👍",
      afterProfileId: first.nextCursor ?? undefined,
    });
    expect(first.actors).toHaveLength(50);
    expect(second.actors).toHaveLength(11);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.actors, ...second.actors].map((actor) => actor.profileId)
      ).size
    ).toBe(61);
  });
  it("isolates messages and retains multiple emoji per person", () => {
    const { sql } = database();
    setSpaceReaction(sql, reaction("alex"));
    setSpaceReaction(sql, reaction("alex", "🎉"));
    expect(
      readSpaceReactions(sql, ["message-1", "message-2"], "sam").get(
        "message-1"
      )?.groups
    ).toHaveLength(2);
    expect(readSpaceReactions(sql, ["message-2"]).get("message-2")).toEqual({
      version: 0,
      groups: [],
    });
  });
  it("accepts known Unicode sequences and preserves meaningful skin tone and ZWJ differences", () => {
    expect(resolveReactionEmoji("❤️")?.emoji).toBe("❤️");
    expect(resolveReactionEmoji("❤")?.emoji).toBe("❤️");
    expect(resolveReactionEmoji("👍🏽")?.emoji).toBe("👍🏽");
    expect(resolveReactionEmoji("👩‍💻")?.emoji).toBe("👩‍💻");
    expect(resolveReactionEmoji("not an emoji")).toBeNull();
    expect(resolveReactionEmoji("__proto__")).toBeNull();
  });
});
