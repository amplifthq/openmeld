import { signalTextEnvelopeSchema } from "@openmeld/schemas";

const BACKFILL_BATCH_SIZE = 500;

/** The index is private to the owning Space and never grants read access. */
export function initializeSpaceMessageSearch(sql: SqlStorage): void {
  sql.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS space_message_search USING fts5(text, tokenize = 'trigram')"
  );
  sql.exec(`CREATE TABLE IF NOT EXISTS space_message_search_backfill (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    position INTEGER NOT NULL,
    complete INTEGER NOT NULL
  )`);
  sql.exec(
    "INSERT OR IGNORE INTO space_message_search_backfill VALUES (1, 0, 0)"
  );
  sql.exec(`CREATE TRIGGER IF NOT EXISTS space_message_search_insert
    AFTER INSERT ON space_signals
    WHEN new.type = 'signal.text' AND json_extract(new.payload_json, '$.data.meta.recalledAt') IS NULL
    BEGIN
      INSERT INTO space_message_search(rowid, text)
      VALUES (new.rowid, json_extract(new.payload_json, '$.data.text'));
    END`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS space_message_search_delete
    AFTER DELETE ON space_signals BEGIN
      DELETE FROM space_message_search WHERE rowid = old.rowid;
    END`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS space_message_search_update
    AFTER UPDATE OF payload_json, type ON space_signals BEGIN
      DELETE FROM space_message_search WHERE rowid = old.rowid;
      INSERT INTO space_message_search(rowid, text)
      SELECT new.rowid, json_extract(new.payload_json, '$.data.text')
      WHERE new.type = 'signal.text' AND json_extract(new.payload_json, '$.data.meta.recalledAt') IS NULL;
    END`);
}

/** Resume historical indexing in bounded transactions, without blocking Space startup. */
export function backfillSpaceMessageSearch(sql: SqlStorage): boolean {
  const state = sql
    .exec<{ position: number; complete: number }>(
      "SELECT position, complete FROM space_message_search_backfill WHERE singleton = 1"
    )
    .one();
  if (state.complete) {
    return true;
  }
  const rows = sql
    .exec<{ position: number }>(
      "SELECT rowid AS position FROM space_signals WHERE rowid > ? ORDER BY rowid LIMIT ?",
      state.position,
      BACKFILL_BATCH_SIZE
    )
    .toArray();
  const position = rows.at(-1)?.position ?? state.position;
  sql.exec(
    `INSERT OR REPLACE INTO space_message_search(rowid, text)
    SELECT rowid, json_extract(payload_json, '$.data.text') FROM space_signals
    WHERE rowid > ? AND rowid <= ? AND type = 'signal.text'
      AND json_extract(payload_json, '$.data.meta.recalledAt') IS NULL`,
    state.position,
    position
  );
  const complete = rows.length < BACKFILL_BATCH_SIZE;
  sql.exec(
    "UPDATE space_message_search_backfill SET position = ?, complete = ? WHERE singleton = 1",
    position,
    complete ? 1 : 0
  );
  return complete;
}

export function searchSpaceMessages(
  sql: SqlStorage,
  input: {
    query: string;
    before: number | null;
    limit: number;
    afterPosition?: number;
  }
) {
  const rows = querySpaceMessageRows(sql, input);
  const page = rows.slice(0, input.limit);
  return {
    threadRoots: Object.fromEntries(
      page.flatMap((row) =>
        row.root_signal_id ? [[row.id, row.root_signal_id]] : []
      )
    ),
    signals: page.map((row) =>
      signalTextEnvelopeSchema.parse(JSON.parse(row.payload_json))
    ),
    nextCursor:
      rows.length > input.limit ? String(page.at(-1)?.position) : null,
  };
}

/** Search and chronological reads use the same source rows and visibility boundary. */
export function querySpaceMessageRows(
  sql: SqlStorage,
  input: {
    query?: string;
    before: number | null;
    includeBefore?: boolean;
    through?: number;
    limit: number;
    afterPosition?: number;
    fromProfileId?: string;
    afterTs?: number;
    beforeTs?: number;
    threadId?: string;
    signalId?: string;
    includeSystem?: boolean;
  }
) {
  // Literal substring search works inside words and unsegmented CJK text.
  const query = input.query?.trim();
  const { searchClause, searchValue } = literalSearch(query);
  const rows = sql
    .exec<{
      id: string;
      position: number;
      payload_json: string;
      root_signal_id: string | null;
    }>(
      `SELECT s.id, s.rowid AS position, s.payload_json, t.root_signal_id FROM space_signals s
      ${query ? "JOIN space_message_search f ON s.rowid = f.rowid" : ""}
      LEFT JOIN space_thread_signal_placements p ON p.signal_id = s.id AND p.placement = 'thread'
      LEFT JOIN space_threads t ON t.thread_id = p.thread_id
      WHERE ${query ? searchClause : "1 = 1"}
      AND s.type IN (${input.includeSystem ? "'signal.text', 'signal.status', 'signal.system_notice'" : "'signal.text'"}) AND json_extract(s.payload_json, '$.data.meta.recalledAt') IS NULL
      AND s.rowid > ? AND (? IS NULL OR s.rowid ${input.includeBefore ? "<=" : "<"} ?)
      AND (? IS NULL OR s.rowid <= ?)
      AND (? IS NULL OR json_extract(s.payload_json, '$.profile.profileId') = ?)
      AND (? IS NULL OR json_extract(s.payload_json, '$.ts') >= ?)
      AND (? IS NULL OR json_extract(s.payload_json, '$.ts') <= ?)
      AND (? IS NULL OR p.thread_id = ? OR s.id = (SELECT root_signal_id FROM space_threads WHERE thread_id = ?))
      AND (? IS NULL OR s.id = ?)
      ORDER BY s.rowid DESC LIMIT ?`,
      ...(query ? [searchValue ?? ""] : []),
      input.afterPosition ?? 0,
      input.before,
      input.before,
      input.through ?? null,
      input.through ?? null,
      input.fromProfileId ?? null,
      input.fromProfileId ?? null,
      input.afterTs ?? null,
      input.afterTs ?? null,
      input.beforeTs ?? null,
      input.beforeTs ?? null,
      input.threadId ?? null,
      input.threadId ?? null,
      input.threadId ?? null,
      input.signalId ?? null,
      input.signalId ?? null,
      input.limit + 1
    )
    .toArray();
  return rows;
}

function literalSearch(query?: string) {
  if (query && [...query].length < 3) {
    return {
      searchClause: "instr(lower(f.text), lower(?)) > 0",
      searchValue: query,
    };
  }
  return {
    searchClause: "space_message_search MATCH ?",
    searchValue: `"${query?.replaceAll('"', '""')}"`,
  };
}
