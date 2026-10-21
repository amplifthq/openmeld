import {
  ensureFileCopyRequestSchema,
  ensureFileRepositorySchema,
} from "../../../files/file-schema-repo";
import { ensureSpaceAgentAccessHoldTable } from "./space-agent-access-hold-repo";
import { ensureSpaceExecutionInputOutbox } from "./space-execution-input-repo";
import { SpaceFileUpdateRepository } from "./space-file-update-repo";
import { ensureSpaceInboxContactTable } from "./space-inbox-contact-repo";
import { ensureSpaceInboxProjectionSelectionsTable } from "./space-inbox-projection-outbox-repo";
import { ensureSpaceMemberDisplayCacheTables } from "./space-member-display-cache-repo";
import { ensurePendingWakeStopTable } from "./space-pending-wake-stop-repo";
import { ensureSpaceProfileLineageTable } from "./space-profile-lineage-repo";
import { ensureSpaceReactionTables } from "./space-reaction-repo";
import { SpaceTaskDeliveryRepository } from "./space-task-delivery-repo";
import { ensureSpaceTaskTables } from "./space-task-repo";

export const SPACE_SQL_SCHEMA_VERSION = 54;
export const SPACE_SQL_SCHEMA_CHECKSUM = "space-sql-schema-v54";
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
const SPACE_META_LINK_JOIN_POLICY_COLUMN = "link_join_policy";
const SPACE_META_GUIDELINES_LEGACY_COLUMN = "guidelines";
const SPACE_CURSORS_MENTION_ALIAS_COLUMN = "mention_alias";
const SPACE_FILE_ENTRIES_ORIGIN_COLUMN = "origin";
const SPACE_SIGNALS_CLIENT_MESSAGE_ID_COLUMN = "client_message_id";
export const ensureSpaceSqlSchema = (sql: SqlStorage): void => {
  ensureSpaceSchemaMigrationsTable(sql);
  ensureFileCopyRequestSchema(sql);
  if (hasCurrentSpaceSqlSchema(sql)) {
    return;
  }
  ensureSpaceExecutionInputOutbox(sql);
  ensurePendingWakeStopTable(sql);
  ensureSpaceAgentAccessHoldTable(sql);
  new SpaceFileUpdateRepository(sql).initialize();
  ensureSpaceReactionTables(sql);
  ensureSpaceInboxContactTable(sql);
  ensureSpaceInboxProjectionSelectionsTable(sql);
  ensureSpaceTaskTables(sql);
  new SpaceTaskDeliveryRepository(sql).initialize();
  ensureSpaceProfileLineageTable(sql);
  ensureSpaceMemberDisplayCacheTables(sql);
  sql.exec(`CREATE TABLE IF NOT EXISTS space_file_pins (
    signal_id TEXT PRIMARY KEY,
    pinned_by_profile_id TEXT NOT NULL,
    pinned_at TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS space_message_pins (
    signal_id TEXT PRIMARY KEY,
    pinned_by_profile_id TEXT NOT NULL,
    pinned_at TEXT NOT NULL
  )`);
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
      link_join_policy TEXT NULL
        CHECK (link_join_policy IN ('invite_only', 'access_mode')),
      password_proof_json TEXT NULL,
      archive_cursor_ts INTEGER NULL,
      deleted_at INTEGER NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  ensureSpaceMetaGuideColumn(sql);
  ensureSpaceMetaPurposeColumn(sql);
  ensureSpaceMetaDirectMessageColumn(sql);
  if (!listTableColumnNames(sql, "space_meta").has("deleted_at")) {
    sql.exec("ALTER TABLE space_meta ADD COLUMN deleted_at INTEGER NULL");
  }
  ensureSpaceMetaPasswordProofColumn(sql);
  ensureSpaceMetaAccessModeColumn(sql);
  ensureSpaceMetaLinkJoinPolicyColumn(sql);
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
  sql.exec(
    "CREATE TABLE IF NOT EXISTS space_signal_sequence (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), position INTEGER NOT NULL)"
  );
  sql.exec(
    "INSERT OR IGNORE INTO space_signal_sequence SELECT 1, COALESCE(MAX(rowid), 0) FROM space_signals"
  );
  sql.exec(
    "UPDATE space_signal_sequence SET position = MAX(position, (SELECT COALESCE(MAX(rowid), 0) FROM space_signals)) WHERE singleton = 1"
  );
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_recalled_message_drafts (
      signal_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    )
  `);
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
      native_admission_started_at_ms INTEGER NULL,
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

  ensureFileRepositorySchema(sql);
  ensureSpaceFileEntriesOriginColumn(sql);

  // Additive, idempotent migration: historical bytes are never read or rewritten.
  if (
    !listTableColumnNames(sql, "space_file_revisions").has(
      "image_dimensions_json"
    )
  ) {
    sql.exec(
      "ALTER TABLE space_file_revisions ADD COLUMN image_dimensions_json TEXT NULL"
    );
  }

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
  // Publication and subsequent reactions have distinct projection identities.
  // Keep projection_id as the idempotency boundary; one message has many events.
  sql.exec("DROP INDEX IF EXISTS idx_space_inbox_projection_outbox_signal_id");
  sql.exec(
    "CREATE INDEX IF NOT EXISTS idx_space_inbox_projection_outbox_source_signal ON space_inbox_projection_outbox (signal_id)"
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

  const metaColumns = sql
    .exec<{ name: string }>("PRAGMA table_info(space_meta)")
    .toArray();
  if (!metaColumns.some((column) => column.name === "owner_user_ids_json")) {
    sql.exec(
      "ALTER TABLE space_meta ADD COLUMN owner_user_ids_json TEXT NOT NULL DEFAULT '[]'"
    );
    // Seed historical ownership once. Subsequent creator edits never grant ownership.
    sql.exec(`UPDATE space_meta SET owner_user_ids_json = json_array(
      COALESCE(json_extract(creator_json, '$.ownerUserId'),
        (SELECT owner_user_id_snapshot FROM space_members
         WHERE profile_id = json_extract(space_meta.creator_json, '$.profileId') LIMIT 1)))
      WHERE json_valid(creator_json) AND COALESCE(json_extract(creator_json, '$.ownerUserId'),
        (SELECT owner_user_id_snapshot FROM space_members
         WHERE profile_id = json_extract(space_meta.creator_json, '$.profileId') LIMIT 1)) IS NOT NULL`);
  }
  if (!metaColumns.some((column) => column.name === "allow_guests")) {
    sql.exec(
      "ALTER TABLE space_meta ADD COLUMN allow_guests INTEGER NOT NULL DEFAULT 0 CHECK (allow_guests IN (0, 1))"
    );
  }
  sql.exec(
    "CREATE TABLE IF NOT EXISTS space_guest_users (user_id TEXT PRIMARY KEY, invitation_id TEXT NOT NULL, joined_at INTEGER NOT NULL)"
  );
  sql.exec(`CREATE TABLE IF NOT EXISTS space_ownership_audit (
    id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, target_user_id TEXT NOT NULL,
    role TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);

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

function ensureSpaceFileEntriesOriginColumn(sql: SqlStorage): void {
  const columnNames = listTableColumnNames(sql, "space_file_entries");
  if (!columnNames.has(SPACE_FILE_ENTRIES_ORIGIN_COLUMN)) {
    sql.exec(`
      ALTER TABLE space_file_entries
      ADD COLUMN origin TEXT NULL
        CHECK (origin IS NULL OR origin IN ('artifact', 'chat_upload'))
    `);
  }
  // Unconditional and idempotent, matching the
  // `ensureSpaceMetaAccessModeColumn` repair pattern: this must run every
  // time this function runs, not only on the call that just added the
  // column. A database that already has the column from an earlier,
  // interrupted, or previously buggy schema pass can still have NULL file
  // rows; gating the backfill on "column was just added" would leave those
  // rows unrepaired forever. `SPACE_SQL_SCHEMA_VERSION` is bumped whenever
  // this repair logic changes so a durable database that already recorded
  // an older version (even one that ran a stale copy of this function)
  // re-enters this whole migration and gets repaired.
  backfillSpaceFileEntriesOrigin(sql);
}

/**
 * Every file row that predates this column was written by the same code
 * path the current "artifact" write default now uses explicitly — chat
 * uploads only gained a distinct write path (and always set `origin`
 * themselves) in the same change that added this column. There is no
 * reliable signal in existing rows that would let this backfill tell a
 * historical chat upload apart from historical deliberately-created work,
 * so every pre-existing file defaults to 'artifact', matching the
 * repository's create-time default and keeping historical files visible in
 * the default Files view instead of hiding them behind a filter that did
 * not exist when they were created.
 *
 * Folders never carry an origin (they are excluded from this UPDATE by the
 * `kind = 'file'` guard) and are never affected by the origin filter.
 *
 * After this backfill runs, a NULL origin on a file row is not normal
 * historical data — it is an exceptional/corrupt state that must fail
 * closed (stay out of the default "artifact" view) rather than being
 * silently reclassified. This UPDATE is itself the repair for that state:
 * it is safe and correct to run on every schema pass, whether the column
 * was just added, already existed with every row classified, or already
 * existed with some rows still NULL from an earlier incomplete run.
 */
function backfillSpaceFileEntriesOrigin(sql: SqlStorage): void {
  sql.exec(`
    UPDATE space_file_entries
    SET origin = 'artifact'
    WHERE kind = 'file' AND origin IS NULL
  `);
}

function ensureOpenMeldDaemonOutboxPoisonColumns(sql: SqlStorage): void {
  const columnNames = listTableColumnNames(sql, "openMeldDaemon_outbox");
  if (!columnNames.has("native_admission_started_at_ms")) {
    // Historical/in-flight rows remain unknown, never "not yet admitted".
    sql.exec(`
      ALTER TABLE openMeldDaemon_outbox
      ADD COLUMN native_admission_started_at_ms INTEGER NULL
    `);
  }
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

function ensureSpaceMetaLinkJoinPolicyColumn(sql: SqlStorage): void {
  const hasLinkJoinPolicyColumn = listTableColumnNames(sql, "space_meta").has(
    SPACE_META_LINK_JOIN_POLICY_COLUMN
  );
  if (hasLinkJoinPolicyColumn) {
    return;
  }

  sql.exec(`
    ALTER TABLE space_meta
    ADD COLUMN link_join_policy TEXT NULL
      CHECK (link_join_policy IN ('invite_only', 'access_mode'))
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
