import { ensureSpaceExecutionInputOutbox } from "./space-execution-input-repo";

export const SPACE_SQL_SCHEMA_VERSION = 33;
export const SPACE_SQL_SCHEMA_CHECKSUM = "space-sql-schema-v33";
const DIRECT_MESSAGE_SPACE_PURPOSE = "openmeld_dm_space";
const OPENMELD_DAEMON_OUTBOX_POISON_FAILURE_COUNT_COLUMN =
  "poison_failure_count";
const OPENMELD_DAEMON_OUTBOX_POISON_REASON_CODE_COLUMN = "poison_reason_code";
const OPENMELD_DAEMON_OUTBOX_POISONED_AT_MS_COLUMN = "poisoned_at_ms";
const SPACE_META_ACCESS_MODE_COLUMN = "access_mode";
const SPACE_META_ORGANIZATION_ID_COLUMN = "organization_id";
const SPACE_META_ORGANIZATION_VISIBILITY_COLUMN = "organization_visibility";
const SPACE_META_PASSWORD_PROOF_COLUMN = "password_proof_json";
const SPACE_META_PURPOSE_COLUMN = "purpose";
const SPACE_META_DIRECT_MESSAGE_COLUMN = "direct_message_json";
const SPACE_META_GUIDE_COLUMN = "guide";
const SPACE_META_GUIDELINES_LEGACY_COLUMN = "guidelines";
const SPACE_CURSORS_MENTION_ALIAS_COLUMN = "mention_alias";
const SPACE_SIGNALS_CLIENT_MESSAGE_ID_COLUMN = "client_message_id";
export const ensureSpaceSqlSchema = (sql: SqlStorage): void => {
  ensureSpaceSchemaMigrationsTable(sql);
  if (hasCurrentSpaceSqlSchema(sql)) {
    return;
  }
  ensureSpaceExecutionInputOutbox(sql);
  sql.exec(`CREATE TABLE IF NOT EXISTS space_invitation_receipts (
    invitation_id TEXT PRIMARY KEY,
    profile_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('accepted', 'revoked'))
  )`);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_meta (
      space_id TEXT PRIMARY KEY,
      name TEXT NULL,
      purpose TEXT NULL,
      direct_message_json TEXT NULL,
	      creator_json TEXT NULL,
	      organization_id TEXT NOT NULL,
	      organization_visibility TEXT NOT NULL
	        CHECK (organization_visibility IN ('public', 'private')),
	      guide TEXT NULL,
      access_mode TEXT NULL,
      password_proof_json TEXT NULL,
      archive_cursor_ts INTEGER NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  ensureSpaceMetaGuideColumn(sql);
  ensureSpaceMetaPurposeColumn(sql);
  ensureSpaceMetaDirectMessageColumn(sql);
  ensureSpaceMetaPasswordProofColumn(sql);
  ensureSpaceMetaAccessModeColumn(sql);
  ensureSpaceMetaOrganizationColumns(sql);

  // retired: role_instructions is no longer read or written
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_cursors (
      profile_id TEXT PRIMARY KEY,
      last_seen_ts INTEGER NULL,
      role TEXT NULL,
      role_instructions TEXT NULL,
      mention_alias TEXT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  ensureSpaceCursorsMentionAliasColumn(sql);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_member_web_activity (
      profile_id TEXT PRIMARY KEY,
      last_active_at INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_signals (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      profile_id TEXT NULL,
      profile_kind TEXT NULL,
      client_message_id TEXT NULL,
      payload_json TEXT NOT NULL
    )
  `);
  ensureSpaceSignalsClientMessageIdColumn(sql);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_message_preview_revision (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_client_message_rejections (
      client_message_id TEXT PRIMARY KEY,
      reason_code TEXT NOT NULL,
      rejected_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_final_reply_claims (
      dispatch_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (dispatch_id, profile_id)
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_members_backfill_watermark (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_ts INTEGER NOT NULL,
      last_signal_id TEXT NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_member_profile_liveness (
      profile_id TEXT PRIMARY KEY,
      first_not_found_at_ms INTEGER NOT NULL,
      last_not_found_at_ms INTEGER NOT NULL,
      observation_count INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_member_projection_dirty (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      marked_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
		CREATE TABLE IF NOT EXISTS space_agent_owner_membership_policy (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			reconciled_at_ms INTEGER NOT NULL
		)
	`);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_members (
      space_id TEXT NOT NULL,
      profile_id TEXT PRIMARY KEY,
      profile_kind_snapshot TEXT NOT NULL
        CHECK (profile_kind_snapshot IN ('human', 'agent')),
      profile_name_snapshot TEXT NOT NULL,
      owner_user_id_snapshot TEXT NULL,
      owner_name_snapshot TEXT NULL,
      controller_ref_snapshot TEXT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('active', 'removed')),
      member_source TEXT NOT NULL
        CHECK (member_source IN ('space_creator', 'joined_directly', 'added_by_member', 'backfilled')),
      added_at INTEGER NOT NULL,
      removed_at INTEGER NULL,
      added_by_profile_id TEXT NULL,
      added_by_owner_user_id TEXT NULL,
      added_by_display_name_snapshot TEXT NULL,
      removed_by_profile_id TEXT NULL,
      removed_by_owner_user_id TEXT NULL,
      removal_reason TEXT NULL,
      first_entered_at INTEGER NULL,
      last_entered_at INTEGER NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS openMeldDaemon_outbox (
      dispatch_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      target_profile_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      queued_at_ms INTEGER NULL,
      poison_failure_count INTEGER NOT NULL DEFAULT 0,
      poisoned_at_ms INTEGER NULL,
      poison_reason_code TEXT NULL
    )
  `);
  ensureOpenMeldDaemonOutboxPoisonColumns(sql);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_index_projection_outbox (
      projection_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_updated_at_ms INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'failed', 'completed')),
      attempt_count INTEGER NOT NULL,
      last_error TEXT NULL,
      next_retry_at_ms INTEGER NULL,
      completed_at_ms INTEGER NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_inbox_projection_outbox (
      projection_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      candidates_json TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'failed', 'completed')),
      attempt_count INTEGER NOT NULL,
      last_error_code TEXT NULL,
      next_retry_at_ms INTEGER NULL,
      completed_at_ms INTEGER NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_dispatch_rules (
      scope_key TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      allow INTEGER NOT NULL,
      rule_id TEXT NOT NULL,
      rule_reason TEXT NOT NULL,
      rule_set_version INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_contracts (
      space_id TEXT PRIMARY KEY,
      contract_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    )
  `);

  sql.exec("DROP TABLE IF EXISTS space_conversation_bindings");

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_threads (
      thread_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      root_signal_id TEXT NOT NULL,
      created_by_profile_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_thread_signal_placements (
      signal_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      placement TEXT NOT NULL
        CHECK (placement IN ('root', 'thread')),
      created_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_thread_events (
      event_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      event_type TEXT NOT NULL
        CHECK (event_type IN ('created')),
      actor_profile_id TEXT NOT NULL,
      client_mutation_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    )
  `);

  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_file_entries (
      entry_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      kind TEXT NOT NULL
        CHECK (kind IN ('file', 'folder')),
      parent_id TEXT NULL,
      parent_key TEXT NOT NULL,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      created_by_json TEXT NOT NULL,
      updated_by_json TEXT NOT NULL,
      trashed_at_ms INTEGER NULL,
      trashed_by_json TEXT NULL
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
      operation TEXT NOT NULL
        CHECK (operation IN (
          'content_read',
          'content_write',
          'folder_create',
          'entry_update',
          'entry_trash',
          'entry_restore'
        )),
      actor_kind TEXT NOT NULL
        CHECK (actor_kind IN (
          'authenticated',
          'anonymous_viewer',
          'dispatch_continuation'
        )),
      actor_profile_id TEXT NULL,
      represented_human_profile_id TEXT NULL,
      result TEXT NOT NULL
        CHECK (result IN ('succeeded', 'failed')),
      error_code TEXT NULL,
      created_at_ms INTEGER NOT NULL,
      CHECK (
        (actor_kind = 'anonymous_viewer' AND actor_profile_id IS NULL)
        OR
        (actor_kind <> 'anonymous_viewer' AND actor_profile_id IS NOT NULL)
      ),
      CHECK (
        (result = 'succeeded' AND error_code IS NULL)
        OR
        (result = 'failed' AND error_code IS NOT NULL)
      )
    )
  `);

  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_signals_ts_id ON space_signals (ts, id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_signals_profile_ts ON space_signals (profile_id, ts)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_signals_type_ts ON space_signals (type, ts)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_signals_client_message_id ON space_signals (client_message_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_final_reply_claims_created_at ON space_final_reply_claims (created_at)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_members_status_added_at ON space_members (status, added_at, profile_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_members_updated_at ON space_members (updated_at)"
  );
  migrateDirectMessageAccess(sql);
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_openMeldDaemon_outbox_status_created_at ON openMeldDaemon_outbox (status, created_at_ms)"
  );
  sql.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_openMeldDaemon_outbox_idempotency_key ON openMeldDaemon_outbox (idempotency_key)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_index_projection_outbox_status_retry ON space_index_projection_outbox (status, next_retry_at_ms, created_at_ms)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_index_projection_outbox_space_status ON space_index_projection_outbox (space_id, status, updated_at_ms)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_inbox_projection_outbox_status_retry ON space_inbox_projection_outbox (status, next_retry_at_ms, created_at_ms)"
  );
  sql.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_space_inbox_projection_outbox_signal_id ON space_inbox_projection_outbox (signal_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_dispatch_rules_updated_at ON space_dispatch_rules (updated_at_ms)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_contracts_updated_at ON space_contracts (updated_at)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_threads_activity ON space_threads (updated_at_ms, thread_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_threads_root_signal ON space_threads (root_signal_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_thread_signal_placements_thread_created ON space_thread_signal_placements (thread_id, created_at_ms, signal_id)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_thread_signal_placements_placement ON space_thread_signal_placements (placement, created_at_ms)"
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_thread_events_thread_created ON space_thread_events (thread_id, created_at_ms, event_id)"
  );
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

  sql.exec(
    `
      INSERT OR IGNORE INTO schema_migrations (version, checksum, applied_at)
      VALUES (?, ?, ?)
    `,
    SPACE_SQL_SCHEMA_VERSION,
    SPACE_SQL_SCHEMA_CHECKSUM,
    Date.now()
  );
};

export function hasReconciledSpaceAgentOwnerMembershipPolicy(
  sql: SqlStorage
): boolean {
  return (
    sql
      .exec<{ id: number }>(
        "SELECT id FROM space_agent_owner_membership_policy WHERE id = 1 LIMIT 1"
      )
      .toArray().length > 0
  );
}

export function markSpaceAgentOwnerMembershipPolicyReconciled(
  sql: SqlStorage,
  reconciledAtMs = Date.now()
): void {
  sql.exec(
    `
			INSERT OR REPLACE INTO space_agent_owner_membership_policy (
				id,
				reconciled_at_ms
			)
			VALUES (1, ?)
		`,
    reconciledAtMs
  );
}

export function clearSpaceAgentOwnerMembershipPolicyReconciled(
  sql: SqlStorage
): void {
  sql.exec("DELETE FROM space_agent_owner_membership_policy WHERE id = 1");
}

function migrateDirectMessageAccess(sql: SqlStorage): void {
  const rows = sql
    .exec<{
      direct_message_json: string | null;
      space_id: string;
      updated_at: number;
    }>(
      `
        SELECT space_id, direct_message_json, updated_at
        FROM space_meta
        WHERE purpose = ?
      `,
      DIRECT_MESSAGE_SPACE_PURPOSE
    )
    .toArray();

  for (const row of rows) {
    if (!row.direct_message_json) {
      continue;
    }
    const directMessage = parseMigratableDirectMessageMetadata({
      json: row.direct_message_json,
      spaceId: row.space_id,
    });
    const activeMemberCount =
      sql
        .exec<{ count: number }>(
          `
            SELECT COUNT(*) AS count
            FROM space_members
            WHERE status = 'active'
          `
        )
        .toArray()[0]?.count ?? 0;
    if (activeMemberCount > 2 && !directMessage.convertedAt) {
      directMessage.convertedAt = new Date(row.updated_at).toISOString();
    }
    sql.exec(
      `
        UPDATE space_meta
        SET access_mode = 'members_only',
            password_proof_json = NULL,
            direct_message_json = ?
        WHERE space_id = ?
      `,
      JSON.stringify(directMessage),
      row.space_id
    );
  }
}

function parseMigratableDirectMessageMetadata(input: {
  json: string;
  spaceId: string;
}): { convertedAt?: string; pairKey: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.json);
  } catch (error) {
    throw new Error(
      `Cannot migrate Direct Message ${input.spaceId}: invalid direct_message_json.`,
      { cause: error }
    );
  }
  if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) {
    throw new Error(
      `Cannot migrate Direct Message ${input.spaceId}: invalid direct_message_json.`
    );
  }
  const metadata = parsed as Record<string, unknown>;
  const pairKey =
    typeof metadata.pairKey === "string" ? metadata.pairKey.trim() : "";
  const convertedAt = metadata.convertedAt;
  if (
    pairKey.length === 0 ||
    (convertedAt !== undefined &&
      (typeof convertedAt !== "string" ||
        Number.isNaN(Date.parse(convertedAt))))
  ) {
    throw new Error(
      `Cannot migrate Direct Message ${input.spaceId}: invalid direct_message_json.`
    );
  }
  return {
    pairKey,
    ...(typeof convertedAt === "string" ? { convertedAt } : {}),
  };
}

function ensureSpaceSchemaMigrationsTable(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

function hasCurrentSpaceSqlSchema(sql: SqlStorage): boolean {
  const [migration] = sql
    .exec<{ checksum: string }>(
      `
        SELECT checksum FROM schema_migrations
        WHERE version = ?
        LIMIT 1
      `,
      SPACE_SQL_SCHEMA_VERSION
    )
    .toArray();
  if (!migration) {
    return false;
  }
  if (migration.checksum !== SPACE_SQL_SCHEMA_CHECKSUM) {
    throw new Error(
      `Space SQL schema checksum mismatch for version ${SPACE_SQL_SCHEMA_VERSION}`
    );
  }
  return true;
}

export const timestampMsToIso = (value: number): string => {
  return new Date(value).toISOString();
};

export const isoToTimestampMs = (value: string): number => {
  return Date.parse(value);
};

function ensureSpaceCursorsMentionAliasColumn(sql: SqlStorage): void {
  const columnNames = listTableColumnNames(sql, "space_cursors");
  const hasMentionAliasColumn = columnNames.has(
    SPACE_CURSORS_MENTION_ALIAS_COLUMN
  );
  if (hasMentionAliasColumn) {
    return;
  }

  sql.exec(`
    ALTER TABLE space_cursors
    ADD COLUMN mention_alias TEXT NULL
  `);
}

function ensureOpenMeldDaemonOutboxPoisonColumns(sql: SqlStorage): void {
  const columnNames = listTableColumnNames(sql, "openMeldDaemon_outbox");
  if (!columnNames.has(OPENMELD_DAEMON_OUTBOX_POISON_FAILURE_COUNT_COLUMN)) {
    sql.exec(`
      ALTER TABLE openMeldDaemon_outbox
      ADD COLUMN poison_failure_count INTEGER NOT NULL DEFAULT 0
    `);
  }
  if (!columnNames.has(OPENMELD_DAEMON_OUTBOX_POISONED_AT_MS_COLUMN)) {
    sql.exec(`
      ALTER TABLE openMeldDaemon_outbox
      ADD COLUMN poisoned_at_ms INTEGER NULL
    `);
  }
  if (!columnNames.has(OPENMELD_DAEMON_OUTBOX_POISON_REASON_CODE_COLUMN)) {
    sql.exec(`
      ALTER TABLE openMeldDaemon_outbox
      ADD COLUMN poison_reason_code TEXT NULL
    `);
  }
}

function ensureSpaceSignalsClientMessageIdColumn(sql: SqlStorage): void {
  const hasClientMessageIdColumn = listTableColumnNames(
    sql,
    "space_signals"
  ).has(SPACE_SIGNALS_CLIENT_MESSAGE_ID_COLUMN);
  if (hasClientMessageIdColumn) {
    return;
  }

  sql.exec(`
    ALTER TABLE space_signals
    ADD COLUMN client_message_id TEXT NULL
  `);
}

function ensureSpaceMetaGuideColumn(sql: SqlStorage): void {
  const columnNames = listTableColumnNames(sql, "space_meta");
  const hasGuideColumn = columnNames.has(SPACE_META_GUIDE_COLUMN);
  const hasLegacyGuidelinesColumn = columnNames.has(
    SPACE_META_GUIDELINES_LEGACY_COLUMN
  );

  if (!hasGuideColumn) {
    sql.exec(`
      ALTER TABLE space_meta
      ADD COLUMN guide TEXT NULL
    `);
  }

  if (!hasLegacyGuidelinesColumn) {
    return;
  }

  sql.exec(`
    UPDATE space_meta
    SET guide = guidelines
    WHERE guide IS NULL
      AND guidelines IS NOT NULL
  `);
}

function ensureSpaceMetaPurposeColumn(sql: SqlStorage): void {
  const hasPurposeColumn = listTableColumnNames(sql, "space_meta").has(
    SPACE_META_PURPOSE_COLUMN
  );
  if (hasPurposeColumn) {
    return;
  }

  sql.exec(`
    ALTER TABLE space_meta
    ADD COLUMN purpose TEXT NULL
  `);
}

function ensureSpaceMetaDirectMessageColumn(sql: SqlStorage): void {
  const hasDirectMessageColumn = listTableColumnNames(sql, "space_meta").has(
    SPACE_META_DIRECT_MESSAGE_COLUMN
  );
  if (hasDirectMessageColumn) {
    return;
  }

  sql.exec(`
    ALTER TABLE space_meta
    ADD COLUMN direct_message_json TEXT NULL
  `);
}

function ensureSpaceMetaPasswordProofColumn(sql: SqlStorage): void {
  const hasPasswordProofColumn = listTableColumnNames(sql, "space_meta").has(
    SPACE_META_PASSWORD_PROOF_COLUMN
  );
  if (hasPasswordProofColumn) {
    return;
  }

  sql.exec(`
    ALTER TABLE space_meta
    ADD COLUMN password_proof_json TEXT NULL
  `);
}

function ensureSpaceMetaAccessModeColumn(sql: SqlStorage): void {
  const hasAccessModeColumn = listTableColumnNames(sql, "space_meta").has(
    SPACE_META_ACCESS_MODE_COLUMN
  );
  if (!hasAccessModeColumn) {
    sql.exec(`
      ALTER TABLE space_meta
      ADD COLUMN access_mode TEXT NULL
    `);
  }

  sql.exec(`
    UPDATE space_meta
    SET access_mode = CASE
      WHEN password_proof_json IS NULL OR trim(password_proof_json) = ''
        THEN 'public'
      ELSE 'protected'
    END
    WHERE access_mode IS NULL
      OR trim(access_mode) = ''
  `);
}

function ensureSpaceMetaOrganizationColumns(sql: SqlStorage): void {
  const columnNames = listTableColumnNames(sql, "space_meta");

  if (!columnNames.has(SPACE_META_ORGANIZATION_ID_COLUMN)) {
    sql.exec(`
      ALTER TABLE space_meta
      ADD COLUMN organization_id TEXT NULL
    `);
  }

  if (!columnNames.has(SPACE_META_ORGANIZATION_VISIBILITY_COLUMN)) {
    sql.exec(`
      ALTER TABLE space_meta
      ADD COLUMN organization_visibility TEXT NULL
    `);
  }
}

function listTableColumnNames(sql: SqlStorage, tableName: string): Set<string> {
  const tableInfoRows = sql.exec<{ name?: string }>(
    `PRAGMA table_info(${tableName})`
  );
  return new Set(
    tableInfoRows
      .toArray()
      .map((row) =>
        String(row.name ?? "")
          .trim()
          .toLowerCase()
      )
      .filter((name) => name.length > 0)
  );
}
