/**
 * The file tables are shared by each independent file-root Durable Object.
 * Historical Space roots retain their table names and data in place.
 * New Team and member roots use the same repository schema in their own
 * private SQLite database; root authorization happens before opening one.
 */
export function ensureFileRepositorySchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_file_entries (
      entry_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
      parent_id TEXT NULL,
      parent_key TEXT NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      created_by_json TEXT NOT NULL,
      updated_by_json TEXT NOT NULL,
      trashed_at_ms INTEGER NULL,
      trashed_by_json TEXT NULL,
      origin TEXT NULL CHECK (origin IS NULL OR origin IN ('artifact', 'chat_upload'))
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_file_revisions (
      revision_id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      created_by_json TEXT NOT NULL,
      client_mutation_id TEXT NOT NULL,
      image_dimensions_json TEXT NULL,
      UNIQUE (file_id, revision),
      UNIQUE (file_id, client_mutation_id)
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_file_mutations (
      client_mutation_id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_file_audit_events (
      event_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      revision_id TEXT NULL,
      operation TEXT NOT NULL CHECK (operation IN (
        'content_read', 'content_write', 'folder_create',
        'entry_update', 'entry_trash', 'entry_restore'
      )),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN (
        'authenticated', 'anonymous_viewer', 'dispatch_continuation'
      )),
      actor_profile_id TEXT NULL,
      represented_human_profile_id TEXT NULL,
      result TEXT NOT NULL CHECK (result IN ('succeeded', 'failed')),
      error_code TEXT NULL,
      created_at_ms INTEGER NOT NULL,
      CHECK (
        (actor_kind = 'anonymous_viewer' AND actor_profile_id IS NULL)
        OR (actor_kind <> 'anonymous_viewer' AND actor_profile_id IS NOT NULL)
      ),
      CHECK (
        (result = 'succeeded' AND error_code IS NULL)
        OR (result = 'failed' AND error_code IS NOT NULL)
      )
    )
  `);
  sql.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_space_file_entries_active_parent_name ON space_file_entries (parent_key, name_key) WHERE trashed_at_ms IS NULL"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_file_entries_parent_updated ON space_file_entries (parent_key, updated_at_ms, entry_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_file_revisions_file_revision ON space_file_revisions (file_id, revision DESC)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_file_mutations_created_at ON space_file_mutations (created_at_ms)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_file_audit_entry_created ON space_file_audit_events (entry_id, created_at_ms, event_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_file_audit_operation_id ON space_file_audit_events (operation, operation_id)"
  );
}
