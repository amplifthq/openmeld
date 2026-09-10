import type {
  SignalEnvelope,
  SpaceMessageReactions,
  SpaceReactionActor,
} from "@openmeld/schemas/types";

type ReactionRow = {
  signal_id: string;
  emoji: string;
  label: string;
  profile_id: string;
  display_name: string;
  profile_kind: "human" | "agent";
  rank: number;
  total: number;
  mine: number;
};
export function ensureSpaceReactionTables(sql: SqlStorage): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS space_message_reactions (
    signal_id TEXT NOT NULL, emoji TEXT NOT NULL, label TEXT NOT NULL,
    profile_id TEXT NOT NULL, display_name TEXT NOT NULL, profile_kind TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (signal_id, emoji, profile_id))`);
  sql.exec(`CREATE TABLE IF NOT EXISTS space_message_reaction_versions (
    signal_id TEXT PRIMARY KEY, version INTEGER NOT NULL)`);
}
export function setSpaceReaction(
  sql: SqlStorage,
  input: {
    signalId: string;
    emoji: string;
    label: string;
    actor: SpaceReactionActor;
    active: boolean;
  }
): boolean {
  const changed = input.active
    ? sql
        .exec(
          `INSERT INTO space_message_reactions (signal_id, emoji, label, profile_id, display_name, profile_kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(
          (SELECT MIN(created_at) FROM space_message_reactions WHERE signal_id = ? AND emoji = ?),
          (SELECT MAX(?, COALESCE(MAX(created_at) + 1, 0)) FROM space_message_reactions WHERE signal_id = ?)
        )) ON CONFLICT DO NOTHING RETURNING profile_id`,
          input.signalId,
          input.emoji,
          input.label,
          input.actor.profileId,
          input.actor.displayName,
          input.actor.profileKind,
          input.signalId,
          input.emoji,
          Date.now(),
          input.signalId
        )
        .toArray().length > 0
    : sql
        .exec(
          "DELETE FROM space_message_reactions WHERE signal_id = ? AND emoji = ? AND profile_id = ? RETURNING profile_id",
          input.signalId,
          input.emoji,
          input.actor.profileId
        )
        .toArray().length > 0;
  if (changed) {
    sql.exec(
      `INSERT INTO space_message_reaction_versions (signal_id, version) VALUES (?, 1)
    ON CONFLICT (signal_id) DO UPDATE SET version = version + 1`,
      input.signalId
    );
  }
  return changed;
}
export function readSpaceReactions(
  sql: SqlStorage,
  signalIds: readonly string[],
  viewerProfileId?: string
): Map<string, SpaceMessageReactions> {
  const result = new Map<string, SpaceMessageReactions>();
  // Stay below SQLite bind parameter limits, including large history reads.
  for (let offset = 0; offset < signalIds.length; offset += 80) {
    const ids = signalIds.slice(offset, offset + 80);
    if (!ids.length) {
      continue;
    }
    for (const id of ids) {
      result.set(id, { version: 0, groups: [] });
    }
    const marks = ids.map(() => "?").join(",");
    for (const row of sql
      .exec<{ signal_id: string; version: number }>(
        `SELECT * FROM space_message_reaction_versions WHERE signal_id IN (${marks})`,
        ...ids
      )
      .toArray()) {
      result.set(row.signal_id, { version: row.version, groups: [] });
    }
    const rows = sql
      .exec<ReactionRow>(
        `SELECT * FROM (
      SELECT r.*, COALESCE(m.profile_name_snapshot, r.display_name) AS current_name,
        ROW_NUMBER() OVER (PARTITION BY signal_id, emoji ORDER BY r.profile_id) AS rank,
        COUNT(*) OVER (PARTITION BY signal_id, emoji) AS total,
        MIN(r.created_at) OVER (PARTITION BY signal_id, emoji) AS group_order,
        MAX(CASE WHEN r.profile_id = ? THEN 1 ELSE 0 END) OVER (PARTITION BY signal_id, emoji) AS mine
      FROM space_message_reactions r LEFT JOIN space_members m ON m.profile_id = r.profile_id
      WHERE signal_id IN (${marks})
    ) WHERE rank <= 10 ORDER BY signal_id, group_order, emoji, rank`,
        viewerProfileId ?? "",
        ...ids
      )
      .toArray();
    for (const row of rows) {
      const snapshot = result.get(row.signal_id);
      if (!snapshot) {
        continue;
      }
      let group = snapshot.groups.find(
        (candidate) => candidate.emoji === row.emoji
      );
      if (!group) {
        group = {
          emoji: row.emoji,
          label: row.label,
          count: row.total,
          reactedByMe: row.mine === 1,
          actors: [],
          actorsHasMore: row.total > 10,
        };
        snapshot.groups.push(group);
      }
      group.actors.push(toActor(row));
    }
  }
  return result;
}
function toActor(row: {
  profile_id: string;
  display_name: string;
  profile_kind: "human" | "agent";
  current_name?: string;
}): SpaceReactionActor {
  return {
    profileId: row.profile_id,
    displayName: row.current_name ?? row.display_name,
    profileKind: row.profile_kind,
  };
}
export function readSpaceReactionActors(
  sql: SqlStorage,
  input: { signalId: string; emoji: string; afterProfileId?: string }
) {
  const rows = sql
    .exec<ReactionRow>(
      `SELECT r.*, COALESCE(m.profile_name_snapshot, r.display_name) AS current_name
    FROM space_message_reactions r LEFT JOIN space_members m ON m.profile_id = r.profile_id
    WHERE signal_id = ? AND emoji = ? AND r.profile_id > ? ORDER BY r.profile_id LIMIT 51`,
      input.signalId,
      input.emoji,
      input.afterProfileId ?? ""
    )
    .toArray();
  return {
    actors: rows.slice(0, 50).map(toActor),
    nextCursor: rows.length > 50 ? (rows[49]?.profile_id ?? null) : null,
  };
}
export function hydrateSpaceSignalReactions(
  sql: SqlStorage,
  signals: readonly SignalEnvelope[],
  viewerProfileId?: string
): SignalEnvelope[] {
  const snapshots = readSpaceReactions(
    sql,
    signals.filter((s) => s.type === "signal.text").map((s) => s.id),
    viewerProfileId
  );
  return signals.map((signal) =>
    signal.type === "signal.text"
      ? {
          ...signal,
          reactions: snapshots.get(signal.id) ?? { version: 0, groups: [] },
        }
      : signal
  );
}
