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
  }
) {
  // Literal substring search works inside words and unsegmented CJK text.
  if ([...input.query.trim()].length < 3) {
    return { signals: [], nextCursor: null, threadRoots: {} };
  }
  const match = `"${input.query.trim().replaceAll('"', '""')}"`;
  const rows = sql
    .exec<{
      id: string;
      position: number;
      payload_json: string;
      root_signal_id: string | null;
    }>(
      `SELECT s.id, s.rowid AS position, s.payload_json, t.root_signal_id FROM space_message_search f
      JOIN space_signals s ON s.rowid = f.rowid
      LEFT JOIN space_thread_signal_placements p ON p.signal_id = s.id AND p.placement = 'thread'
      LEFT JOIN space_threads t ON t.thread_id = p.thread_id
      WHERE space_message_search MATCH ? AND (? IS NULL OR s.rowid < ?)
      ORDER BY s.rowid DESC LIMIT ?`,
      match,
      input.before,
      input.before,
      input.limit + 1
    )
    .toArray();
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
