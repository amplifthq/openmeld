import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONNECTOR_SERVICES } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { LATEST_SHARED_MIGRATION_ID } from "../src/index";
import { getRepoRootDirectoryPath } from "../src/tooling";

type DrizzleJournalEntry = {
  idx: number;
  tag: string;
};

type DrizzleJournal = {
  entries: DrizzleJournalEntry[];
};

const SQL_MIGRATION_FILE_PATTERN = /^\d{4}_.+\.sql$/u;
const SNAPSHOT_FILE_PATTERN = /^\d{4}_snapshot\.json$/u;

const migrationDirectoryPath = path.resolve(
  getRepoRootDirectoryPath(),
  "packages/db/drizzle"
);
const metaDirectoryPath = path.join(migrationDirectoryPath, "meta");
const journalPath = path.join(metaDirectoryPath, "_journal.json");

const readJournal = (): DrizzleJournal => {
  return JSON.parse(fs.readFileSync(journalPath, "utf8")) as DrizzleJournal;
};

const listSqlMigrationFiles = (): string[] => {
  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => SQL_MIGRATION_FILE_PATTERN.test(entry))
    .sort((left, right) => left.localeCompare(right));
};

const listSnapshotFiles = (): string[] => {
  return fs
    .readdirSync(metaDirectoryPath)
    .filter((entry) => SNAPSHOT_FILE_PATTERN.test(entry))
    .sort((left, right) => left.localeCompare(right));
};

const readMigrationStatements = (fileName: string): readonly string[] => {
  return fs
    .readFileSync(path.join(migrationDirectoryPath, fileName), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

const applyMigrationFiles = (
  database: DatabaseSync,
  fileNames: readonly string[]
): void => {
  for (const fileName of fileNames) {
    for (const statement of readMigrationStatements(fileName)) {
      database.exec(statement);
    }
  }
};

const hasTable = (database: DatabaseSync, tableName: string): boolean => {
  return Boolean(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      )
      .get(tableName)
  );
};

const listTableColumns = (
  database: DatabaseSync,
  tableName: string
): string[] => {
  return database
    .prepare(`PRAGMA table_info('${tableName}')`)
    .all()
    .map((column) => String(column.name));
};

const listTableIndexes = (
  database: DatabaseSync,
  tableName: string
): string[] => {
  return database
    .prepare(`PRAGMA index_list('${tableName}')`)
    .all()
    .map((index) => String(index.name));
};

const getRetentionQueryPlanDetails = (
  database: DatabaseSync,
  input: {
    filterColumnName: string;
    orderColumnName?: string;
    tableName: string;
  }
): string[] => {
  const orderColumnName = input.orderColumnName ?? input.filterColumnName;
  return database
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM ${input.tableName}
       WHERE ${input.filterColumnName} < ? ORDER BY ${orderColumnName} ASC LIMIT ?`
    )
    .all(1, 100)
    .map((row) => String(row.detail));
};

const expectStatementToThrow = (
  database: DatabaseSync,
  sql: string,
  expectedMessageFragment: string
): void => {
  try {
    database.exec(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expectedMessageFragment)) {
      return;
    }
    throw new Error(
      `Expected SQL error to include ${expectedMessageFragment}, got ${message}`
    );
  }
  throw new Error(`Expected SQL statement to reject: ${sql}`);
};

const toSnapshotFileName = (entry: DrizzleJournalEntry): string => {
  return `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
};

describe("shared drizzle migration history integrity", () => {
  it("enforces one personal Organization per creator from canonical metadata", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0123_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }

      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        INSERT INTO organizations (
          id,
          name,
          slug,
          created_at,
          metadata,
          created_by_user_id
        ) VALUES
          (
            'personal-owner-fence',
            'Personal Owner',
            'personal-owner-fence',
            1000,
            '{"personal":true}',
            'owner-fence-user'
          ),
          (
            'shared-owner-fence',
            'Shared Owner',
            'shared-owner-fence',
            1000,
            NULL,
            'owner-fence-user'
          ),
          (
            'malformed-owner-fence',
            'Malformed Metadata',
            'malformed-owner-fence',
            1000,
            'not-json',
            'owner-fence-user'
          );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(listTableIndexes(database, "organizations")).toContain(
        "organizations_personal_created_by_user_uidx"
      );
      expectStatementToThrow(
        database,
        `INSERT INTO organizations (
           id,
           name,
           slug,
           created_at,
           metadata,
           created_by_user_id
         ) VALUES (
           'duplicate-personal-owner',
           'Duplicate Personal Owner',
           'duplicate-personal-owner',
           1000,
           '{"personal":true}',
           'owner-fence-user'
         )`,
        "UNIQUE constraint failed: organizations.created_by_user_id"
      );
      database.exec(`
        INSERT INTO organizations (
          id,
          name,
          slug,
          created_at,
          metadata,
          created_by_user_id
        ) VALUES (
          'another-personal-owner',
          'Another Personal Owner',
          'another-personal-owner',
          1000,
          '{"personal":true}',
          'another-owner-fence-user'
        );
      `);
    } finally {
      database.close();
    }
  });

  it("preserves pending Slack channel introductions when adding durable recovery notices", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0120_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }

      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        INSERT INTO slack_channel_introduction_runs (
          interaction_id,
          manifest_creation_id,
          slack_team_id,
          organization_id,
          requester_slack_user_id,
          dm_channel_id,
          organization_invite_url,
          status,
          acknowledgement_ts,
          failure_code,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'interaction-upgrade',
          'manifest-upgrade',
          'team-upgrade',
          'organization-upgrade',
          'user-upgrade',
          'dm-upgrade',
          'https://app.openmeld.com/invite/upgrade',
          'ack_pending',
          NULL,
          NULL,
          1000,
          2000
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        database
          .prepare(
            `
              SELECT
                interaction_id,
                manifest_creation_id,
                organization_invite_url,
                status,
                acknowledgement_ts,
                recovery_notice_ts,
                recovery_notice_attempt_count,
                failure_code,
                created_at_ms,
                updated_at_ms
              FROM slack_channel_introduction_runs
              WHERE interaction_id = 'interaction-upgrade'
            `
          )
          .get()
      ).toEqual({
        acknowledgement_ts: null,
        created_at_ms: 1000,
        failure_code: null,
        interaction_id: "interaction-upgrade",
        manifest_creation_id: "manifest-upgrade",
        organization_invite_url: "https://app.openmeld.com/invite/upgrade",
        recovery_notice_attempt_count: 0,
        recovery_notice_ts: null,
        status: "ack_pending",
        updated_at_ms: 2000,
      });
      expect(
        listTableIndexes(database, "slack_channel_introduction_runs")
      ).toContain("idx_slack_channel_introduction_runs_status_updated");
    } finally {
      database.close();
    }
  });

  it("preserves existing document folders while adding nested sibling rules", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0098_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }
      const migrations = listSqlMigrationFiles();
      applyMigrationFiles(
        database,
        migrations.filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('nested-folder-org', 'Nested Folder Org', 'nested-folder-org', 1000);
        INSERT INTO organization_document_folders (
          id,
          organization_id,
          name,
          created_at,
          updated_at
        ) VALUES (
          'existing-folder',
          'nested-folder-org',
          'Runbooks',
          1000,
          1000
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        listTableColumns(database, "organization_document_folders")
      ).toContain("parent_folder_id");
      expect(
        listTableIndexes(database, "organization_document_folders")
      ).toEqual(
        expect.arrayContaining([
          "organization_document_folders_root_name_unique",
          "organization_document_folders_sibling_name_unique",
        ])
      );
      expect(
        database
          .prepare(
            "SELECT id, parent_folder_id FROM organization_document_folders WHERE id = 'existing-folder'"
          )
          .get()
      ).toEqual({ id: "existing-folder", parent_folder_id: null });

      database.exec(`
        INSERT INTO organization_document_folders (
          id,
          organization_id,
          parent_folder_id,
          name,
          created_at,
          updated_at
        ) VALUES (
          'nested-folder',
          'nested-folder-org',
          'existing-folder',
          'Runbooks',
          1000,
          1000
        );
      `);
      expectStatementToThrow(
        database,
        `
          INSERT INTO organization_document_folders (
            id,
            organization_id,
            name,
            created_at,
            updated_at
          ) VALUES (
            'duplicate-root-folder',
            'nested-folder-org',
            'runbooks',
            1000,
            1000
          );
        `,
        "UNIQUE constraint failed"
      );
    } finally {
      database.close();
    }
  });

  it("backfills stable Space signal targets for existing Agent Interaction Inbox items", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0093_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }
      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        PRAGMA foreign_keys = OFF;
        INSERT INTO openMeldDaemon_dispatch_ledger (
          idempotency_key,
          dispatch_id,
          space_id,
          source_event_id,
          target_profile_id,
          status,
          first_seen_at_ms,
          last_attempt_at_ms,
          attempt_count
        ) VALUES (
          'dispatch-key',
          'dispatch-1',
          'space-1',
          'signal-1',
          'profile-1',
          'completed',
          1,
          1,
          1
        );
        INSERT INTO openMeldDaemon_runtime_coordinator_executions (
          runtime_coordinator_execution_id,
          model_version,
          space_id,
          dispatch_id,
          target_profile_id,
          openmeld_service_runtime_id_source,
          openmeld_service_runtime_id,
          binding_id,
          agent_controller_ref,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'execution-1',
          'v1',
          'space-1',
          'dispatch-1',
          'profile-1',
          'binding',
          'runtime-1',
          'binding-1',
          'controller-1',
          'reply_published',
          1,
          1
        );
        INSERT INTO inbox_items (
          id,
          organization_id,
          recipient_user_id,
          kind,
          attention,
          importance,
          title,
          preview,
          context_label,
          source_kind,
          source_key,
          source_target_json,
          resolution_status,
          occurred_at_ms,
          created_at_ms,
          updated_at_ms,
          resolved_at_ms
        ) VALUES (
          'item-1',
          'organization-1',
          'user-1',
          'agent_interaction',
          'action_required',
          'urgent',
          'Approval required',
          'Agent needs your approval.',
          'Agent',
          'runtime_coordinator_interaction',
          'source-key-1',
          '{"kind":"agent_interaction","interactionId":"interaction-1","runtimeCoordinatorExecutionId":"execution-1","spaceId":"space-1"}',
          'resolved',
          1,
          1,
          1,
          1
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        database
          .prepare(
            `SELECT source_target_json
             FROM inbox_items
             WHERE id = 'item-1'`
          )
          .get()
      ).toMatchObject({
        source_target_json: JSON.stringify({
          kind: "space",
          signalId: "signal-1",
          spaceId: "space-1",
        }),
      });
    } finally {
      database.close();
    }
  });

  it("backfills the Task-owned authorized-reader projection without changing Inbox targets", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0102_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }
      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        PRAGMA foreign_keys = OFF;
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('task-org', 'Task Org', 'task-org', 1);
        INSERT INTO users (id, name, email)
        VALUES
          ('task-requester', 'Requester', 'requester@example.com'),
          ('other-user', 'Other', 'other@example.com');
        INSERT INTO center_agent_tasks (
          id,
          organization_id,
          requester_user_id,
          idempotency_key,
          title,
          goal,
          origin_kind,
          status,
          active_attempt_generation,
          version,
          created_at_ms,
          updated_at_ms,
          finished_at_ms
        ) VALUES (
          'task-1',
          'task-org',
          'task-requester',
          'task-key-1',
          'Research onboarding',
          'Research competitor onboarding.',
          'open_meld',
          'succeeded',
          1,
          1,
          1,
          2,
          2
        );
        INSERT INTO inbox_items (
          id,
          organization_id,
          recipient_user_id,
          kind,
          attention,
          importance,
          title,
          preview,
          context_label,
          source_kind,
          source_key,
          source_target_json,
          resolution_status,
          occurred_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES
          (
            'task-item-authorized',
            'task-org',
            'task-requester',
            'center_agent_task',
            'update',
            'normal',
            'Research onboarding',
            'Research is complete.',
            'Center Agent Task',
            'center_agent_task_event',
            'task-1:event-1',
            '{"kind":"center_agent_task","taskId":"task-1"}',
            'not_applicable',
            2,
            2,
            2
          ),
          (
            'task-item-mismatched',
            'task-org',
            'other-user',
            'center_agent_task',
            'update',
            'normal',
            'Research onboarding',
            'Private result.',
            'Center Agent Task',
            'center_agent_task_event',
            'task-1:event-2',
            '{"kind":"center_agent_task","taskId":"task-1"}',
            'not_applicable',
            2,
            2,
            2
          );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        database
          .prepare(
            `SELECT id, source_target_json
             FROM inbox_items
             ORDER BY id ASC`
          )
          .all()
      ).toEqual([
        {
          id: "task-item-authorized",
          source_target_json: JSON.stringify({
            kind: "center_agent_task",
            taskId: "task-1",
          }),
        },
        {
          id: "task-item-mismatched",
          source_target_json: JSON.stringify({
            kind: "center_agent_task",
            taskId: "task-1",
          }),
        },
      ]);
      expect(
        database
          .prepare(
            `SELECT task_id, organization_id, user_id, access_scope
             FROM center_agent_task_authorized_readers`
          )
          .all()
      ).toEqual([
        {
          access_scope: "requester_private",
          organization_id: "task-org",
          task_id: "task-1",
          user_id: "task-requester",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("preserves research batches when adding Slack onboarding acceptance identity", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0121_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }

      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec("PRAGMA foreign_keys = OFF");
      database.exec(`
        INSERT INTO center_agent_member_research_batches (
          id,
          organization_id,
          scope,
          status,
          requested_by_user_id,
          requested_by_member_id,
          requested_by_profile_id,
          requested_by_display_name,
          direct_message_space_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'batch-before-acceptance-key',
          'organization-upgrade',
          'member',
          'completed',
          'user-upgrade',
          'member-upgrade',
          'profile-upgrade',
          'Upgrade User',
          'space-upgrade',
          1000,
          2000
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        database
          .prepare(
            `SELECT id, acceptance_idempotency_key
             FROM center_agent_member_research_batches
             WHERE id = 'batch-before-acceptance-key'`
          )
          .get()
      ).toEqual({
        acceptance_idempotency_key: null,
        id: "batch-before-acceptance-key",
      });
      database.exec(`
        INSERT INTO center_agent_member_research_batches (
          id,
          organization_id,
          scope,
          status,
          requested_by_user_id,
          requested_by_member_id,
          requested_by_profile_id,
          requested_by_display_name,
          direct_message_space_id,
          acceptance_idempotency_key,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'batch-with-acceptance-key',
          'organization-upgrade',
          'member',
          'completed',
          'user-upgrade',
          'member-upgrade',
          'profile-upgrade',
          'Upgrade User',
          'space-upgrade',
          'slack-welcome:upgrade',
          3000,
          3000
        );
      `);
      expectStatementToThrow(
        database,
        `INSERT INTO center_agent_member_research_batches (
          id, organization_id, scope, status, requested_by_user_id,
          requested_by_member_id, requested_by_profile_id,
          requested_by_display_name, direct_message_space_id,
          acceptance_idempotency_key, created_at_ms, updated_at_ms
        ) VALUES (
          'batch-duplicate-acceptance-key', 'organization-upgrade', 'member',
          'completed', 'user-upgrade', 'member-upgrade', 'profile-upgrade',
          'Upgrade User', 'space-upgrade', 'slack-welcome:upgrade', 4000, 4000
        )`,
        "UNIQUE constraint failed"
      );
    } finally {
      database.close();
    }
  });

  it("preserves Center Agent identity and backfills the Organization creator when adding pause state", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0081_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }
      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        PRAGMA foreign_keys = OFF;
        INSERT INTO users (id, name, email)
        VALUES
          ('creator-user', 'Creator', 'creator@example.com'),
          ('later-owner', 'Later Owner', 'later-owner@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES
          ('creator-org', 'Creator Org', 'creator-org', 1),
          ('ownerless-org', 'Ownerless Org', 'ownerless-org', 1);
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES
          ('later-owner-member', 'creator-org', 'later-owner', 'owner', 20),
          ('creator-member', 'creator-org', 'creator-user', 'owner', 10);
        INSERT INTO center_agent_designations (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        ) VALUES (
          'creator-org',
          'agt_existing_center_agent',
          NULL,
          'creator-user',
          30
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        database
          .prepare(
            `SELECT
               agent_profile_id,
               operating_state,
               paused_at,
               paused_by_user_id
             FROM center_agent_designations
             WHERE organization_id = 'creator-org'`
          )
          .get()
      ).toMatchObject({
        agent_profile_id: "agt_existing_center_agent",
        operating_state: "active",
        paused_at: null,
        paused_by_user_id: null,
      });
      expect(
        database
          .prepare(
            "SELECT created_by_user_id FROM organizations WHERE id = 'creator-org'"
          )
          .get()
      ).toMatchObject({ created_by_user_id: "creator-user" });
      expect(
        database
          .prepare(
            "SELECT created_by_user_id FROM organizations WHERE id = 'ownerless-org'"
          )
          .get()
      ).toMatchObject({ created_by_user_id: null });
    } finally {
      database.close();
    }
  });

  it("stores one active organization join link while preserving revoked history", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());
      database.exec("PRAGMA foreign_keys = ON");

      expect(listTableColumns(database, "organization_join_links")).toEqual([
        "id",
        "organization_id",
        "token",
        "role",
        "created_by",
        "created_at",
        "revoked_at",
      ]);
      expect(listTableIndexes(database, "organization_join_links")).toEqual(
        expect.arrayContaining([
          "organization_join_links_token_uidx",
          "organization_join_links_active_organization_uidx",
        ])
      );

      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('join-link-owner', 'Join Link Owner', 'join-link@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES
          ('join-link-org', 'Join Link Org', 'join-link-org', 1),
          ('second-join-link-org', 'Second Join Link Org', 'second-join-link-org', 1);
        INSERT INTO organization_join_links (
          id,
          organization_id,
          token,
          role,
          created_by,
          created_at
        ) VALUES (
          'join-link-1',
          'join-link-org',
          'joinlink_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'member',
          'join-link-owner',
          1
        );
      `);

      expectStatementToThrow(
        database,
        `
          INSERT INTO organization_join_links (
            id,
            organization_id,
            token,
            role,
            created_by,
            created_at
          ) VALUES (
            'join-link-2',
            'join-link-org',
            'joinlink_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            'member',
            'join-link-owner',
            2
          );
        `,
        "UNIQUE constraint failed: organization_join_links.organization_id"
      );

      database.exec(`
        UPDATE organization_join_links
        SET revoked_at = 2
        WHERE id = 'join-link-1';
        INSERT INTO organization_join_links (
          id,
          organization_id,
          token,
          role,
          created_by,
          created_at
        ) VALUES (
          'join-link-2',
          'join-link-org',
          'joinlink_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'member',
          'join-link-owner',
          2
        );
      `);

      expectStatementToThrow(
        database,
        `
          INSERT INTO organization_join_links (
            id,
            organization_id,
            token,
            role,
            created_by,
            created_at
          ) VALUES (
            'join-link-3',
            'second-join-link-org',
            'joinlink_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            'member',
            'join-link-owner',
            3
          );
        `,
        "UNIQUE constraint failed: organization_join_links.token"
      );
    } finally {
      database.close();
    }
  });

  it("creates the organization Project truth for Agent Activity opt-in", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(listTableColumns(database, "projects")).toEqual([
        "id",
        "organization_id",
        "name",
        "slug",
        "repository_fingerprint",
        "repository_url",
        "created_by_user_id",
        "created_at_ms",
        "updated_at_ms",
        "archived_at_ms",
      ]);
      expect(listTableIndexes(database, "projects")).toEqual(
        expect.arrayContaining([
          "projects_org_slug_unique",
          "projects_org_archived_updated_idx",
          "projects_repository_fingerprint_idx",
        ])
      );

      expect(listTableColumns(database, "agent_activity_events")).toEqual(
        expect.arrayContaining([
          "event_id",
          "canonical_payload_hash",
          "organization_id",
          "project_id",
          "member_user_id",
          "device_id",
          "openmeld_service_runtime_id",
          "provider_session_id",
          "provider_metadata_json",
        ])
      );
      expect(listTableIndexes(database, "agent_activity_sessions")).toEqual(
        expect.arrayContaining([
          "agent_activity_sessions_expiry_idx",
          "agent_activity_sessions_identity_unique",
          "agent_activity_sessions_org_active_idx",
          "agent_activity_sessions_org_project_active_idx",
        ])
      );
      expect(listTableIndexes(database, "agent_activity_digests")).toContain(
        "agent_activity_digests_expiry_idx"
      );
      expect(
        listTableIndexes(database, "agent_activity_execution_links")
      ).toContain("agent_activity_execution_links_created_idx");
      const retentionQueryPlans = [
        ...getRetentionQueryPlanDetails(database, {
          filterColumnName: "last_observed_at_ms",
          orderColumnName: "expires_at_ms",
          tableName: "agent_activity_sessions",
        }),
        ...getRetentionQueryPlanDetails(database, {
          filterColumnName: "expires_at_ms",
          tableName: "agent_activity_digests",
        }),
        ...getRetentionQueryPlanDetails(database, {
          filterColumnName: "created_at_ms",
          tableName: "agent_activity_execution_links",
        }),
      ].join("\n");
      expect(retentionQueryPlans).toContain(
        "USING INDEX agent_activity_sessions_expiry_idx"
      );
      expect(retentionQueryPlans).toContain(
        "USING INDEX agent_activity_digests_expiry_idx"
      );
      expect(retentionQueryPlans).toContain(
        "USING INDEX agent_activity_execution_links_created_idx"
      );
      expect(retentionQueryPlans).not.toContain("USE TEMP B-TREE");
      for (const tableName of [
        "agent_activity_daily_aggregates",
        "agent_activity_digests",
        "agent_activity_execution_links",
      ]) {
        expect(listTableColumns(database, tableName).length).toBeGreaterThan(0);
      }
      expect(
        listTableColumns(database, "agent_activity_daily_aggregates")
      ).toContain("active_duration_ms");

      database.exec(`
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('org-1', 'Agent Activity Org', 'agent-activity-org', 1);
        INSERT INTO agent_activity_daily_aggregates (
          id,
          organization_id,
          project_id,
          member_user_id,
          utc_date,
          session_count,
          event_count,
          first_observed_at_ms,
          last_observed_at_ms,
          provider_counts_json,
          updated_at_ms
        ) VALUES (
          'aggregate-default-duration',
          'org-1',
          'project-1',
          'user-1',
          '2026-07-10',
          1,
          1,
          1000,
          1000,
          '{}',
          1000
        );
      `);
      expect(
        database
          .prepare(
            "SELECT active_duration_ms AS activeDurationMs FROM agent_activity_daily_aggregates WHERE id = ?"
          )
          .get("aggregate-default-duration")
      ).toEqual({ activeDurationMs: 0 });
      expectStatementToThrow(
        database,
        `UPDATE agent_activity_daily_aggregates
         SET active_duration_ms = -1
         WHERE id = 'aggregate-default-duration'`,
        "CHECK constraint failed"
      );

      expectStatementToThrow(
        database,
        `INSERT INTO projects (
          id,
          organization_id,
          name,
          slug,
          repository_fingerprint,
          created_by_user_id,
          created_at_ms,
          updated_at_ms,
          archived_at_ms
        ) VALUES (
          'project-1',
          'org-1',
          'OpenMeld',
          'openmeld',
          'https://user:token@example.com/private.git',
          'user-1',
          1,
          1,
          NULL
        )`,
        "CHECK constraint failed"
      );

      database.exec(`
        INSERT INTO projects (
          id,
          organization_id,
          name,
          slug,
          repository_fingerprint,
          created_by_user_id,
          created_at_ms,
          updated_at_ms,
          archived_at_ms
        ) VALUES
          ('project-archived', 'org-1', 'Archived', 'reusable', NULL, 'user-1', 1, 2, 2),
          ('project-active', 'org-1', 'Active', 'reusable', NULL, 'user-1', 3, 3, NULL);
      `);
      expectStatementToThrow(
        database,
        `INSERT INTO projects (
          id,
          organization_id,
          name,
          slug,
          repository_fingerprint,
          created_by_user_id,
          created_at_ms,
          updated_at_ms,
          archived_at_ms
        ) VALUES (
          'project-conflict',
          'org-1',
          'Conflict',
          'reusable',
          NULL,
          'user-1',
          4,
          4,
          NULL
        )`,
        "UNIQUE constraint failed: projects.organization_id, projects.slug"
      );
    } finally {
      database.close();
    }
  });

  it("preserves existing Tasks while adding bounded origin attribution", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0106_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }
      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('task-origin-org', 'Task Origin Org', 'task-origin-org', 1);
        INSERT INTO users (id, name, email)
        VALUES ('task-origin-user', 'Mira', 'task-origin@example.com');
        INSERT INTO center_agent_tasks (
          id,
          organization_id,
          requester_user_id,
          idempotency_key,
          title,
          goal,
          origin_kind,
          origin_destination_json,
          status,
          active_attempt_generation,
          version,
          created_at_ms,
          updated_at_ms,
          finished_at_ms
        ) VALUES (
          'task-origin-existing',
          'task-origin-org',
          'task-origin-user',
          'task-origin-key',
          'Existing Task',
          'Preserve this Task.',
          'open_meld',
          NULL,
          'queued',
          NULL,
          1,
          1,
          1,
          NULL
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(listTableColumns(database, "center_agent_tasks")).toContain(
        "origin_attribution_json"
      );
      expect(
        database
          .prepare(
            "SELECT id, origin_attribution_json FROM center_agent_tasks WHERE id = 'task-origin-existing'"
          )
          .get()
      ).toEqual({
        id: "task-origin-existing",
        origin_attribution_json: null,
      });
      expectStatementToThrow(
        database,
        `UPDATE center_agent_tasks
         SET origin_attribution_json = 'not-json'
         WHERE id = 'task-origin-existing'`,
        "CHECK constraint failed"
      );
      database.exec(`
        UPDATE center_agent_tasks
        SET origin_attribution_json = '{"requestedBy":{"displayName":"Mira","profileId":"human-1","userId":"task-origin-user"},"localAgent":{"client":"codex","kind":"local_agent"}}'
        WHERE id = 'task-origin-existing';
      `);
    } finally {
      database.close();
    }
  });

  it("adds Agent Profile creation requests while preserving existing Profiles", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0131_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }

      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('org-creation-request-migration', 'Migration Org', 'migration-org', 1000);
        INSERT INTO users (
          id, name, email, email_verified, created_at, updated_at
        ) VALUES
          ('creation-requester', 'Requester', 'requester@example.com', 1, 1000, 1000),
          ('creation-owner', 'Owner', 'owner@example.com', 1, 1000, 1000);
        INSERT INTO openmeld_profiles (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          organization_id,
          owner_user_id,
          source
        ) VALUES (
          'agt_00000000-0000-0000-0000-000000000001',
          'Existing Agent',
          'existing-agent',
          'agent',
          'org-creation-request-migration',
          'creation-requester',
          'cli_create'
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        database
          .prepare(
            `SELECT profile_name, creation_actor_profile_id
             FROM openmeld_profiles
             WHERE profile_id = 'agt_00000000-0000-0000-0000-000000000001'`
          )
          .get()
      ).toEqual({
        creation_actor_profile_id: null,
        profile_name: "Existing Agent",
      });

      database.exec(`
        INSERT INTO agent_profile_creation_requests (
          id,
          organization_id,
          requester_user_id,
          actor_profile_id,
          target_owner_user_id,
          source,
          profile_name,
          session_strategy,
          idempotency_key,
          status,
          status_reason,
          failure_message,
          created_at,
          updated_at
        ) VALUES
          (
            'request-failed',
            'org-creation-request-migration',
            'creation-requester',
            'requester-profile',
            'creation-owner',
            'web',
            'Failed Agent',
            'new',
            'failed-key',
            'failed',
            'profile_creation_failed',
            'OpenMeld couldn''t finish creating this Agent.',
            1000,
            1000
          ),
          (
            'request-pending',
            'org-creation-request-migration',
            'creation-requester',
            'requester-profile',
            'creation-owner',
            'cli',
            'Pending Agent',
            'new',
            'pending-key',
            'pending',
            'approval_required',
            NULL,
            1000,
            1000
          );
      `);

      const rows = database
        .prepare(
          `SELECT id, configuration_json, failure_message
           FROM agent_profile_creation_requests
           ORDER BY id ASC`
        )
        .all() as Array<{
        configuration_json: string;
        failure_message: string | null;
        id: string;
      }>;
      expect(rows).toEqual([
        {
          configuration_json:
            '{"agentControllerPermissionMode":null,"agentControllerRef":null,"authorizeForOrganization":true,"defaultProjectId":null,"modelId":null,"openCodePermission":null,"reasoningLevel":null,"targetComputerId":null}',
          failure_message: "OpenMeld couldn't finish creating this Agent.",
          id: "request-failed",
        },
        {
          configuration_json:
            '{"agentControllerPermissionMode":null,"agentControllerRef":null,"authorizeForOrganization":true,"defaultProjectId":null,"modelId":null,"openCodePermission":null,"reasoningLevel":null,"targetComputerId":null}',
          failure_message: null,
          id: "request-pending",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("keeps every SQL migration registered exactly once in the drizzle journal", () => {
    const journal = readJournal();
    const sqlFiles = listSqlMigrationFiles();
    const journalSqlFiles = journal.entries.map((entry) => `${entry.tag}.sql`);

    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(
      journal.entries.length
    );
    expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(
      journal.entries.length
    );
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index)
    );
    expect(journalSqlFiles).toEqual(sqlFiles);
  });

  it("keeps LATEST_SHARED_MIGRATION_ID aligned with the drizzle journal entry count", () => {
    const journal = readJournal();
    expect(LATEST_SHARED_MIGRATION_ID).toBe(journal.entries.length);
  });

  it("keeps every journal entry backed by a snapshot", () => {
    const journal = readJournal();
    const snapshotFiles = new Set(listSnapshotFiles());
    const missingSnapshotTags = journal.entries
      .filter((entry) => !snapshotFiles.has(toSnapshotFileName(entry)))
      .map((entry) => entry.tag)
      .sort((left, right) => left.localeCompare(right));

    expect(missingSnapshotTags).toEqual([]);
  });

  it("does not keep orphan drizzle snapshots outside the journal", () => {
    const journal = readJournal();
    const expectedSnapshotFiles = new Set(
      journal.entries.map(toSnapshotFileName)
    );
    const orphanSnapshotFiles = listSnapshotFiles().filter((fileName) => {
      return !expectedSnapshotFiles.has(fileName);
    });

    expect(orphanSnapshotFiles).toEqual([]);
  });

  it("stores member and shared connector scopes with one shared app per service", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(listTableColumns(database, "connector_connections")).toContain(
        "scope"
      );
      expect(listTableIndexes(database, "connector_connections")).toEqual(
        expect.arrayContaining([
          "connector_connections_org_scope_user_service_unique",
          "connector_connections_org_shared_service_unique",
        ])
      );
    } finally {
      database.close();
    }
  });

  it("stores every connector service in the shared contract", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('connector-owner', 'Connector Owner', 'connector@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('connector-org', 'Connector Org', 'connector-org', 1);
      `);

      const insert = database.prepare(`
        INSERT INTO connector_connections (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms
        ) VALUES (?, 'connector-org', 'connector-owner', 'shared', ?, 'active', 1, 1, NULL)
      `);
      for (const service of CONNECTOR_SERVICES) {
        insert.run(`connection_${service}`, service);
      }

      expect(
        database
          .prepare(
            "SELECT service FROM connector_connections ORDER BY service ASC"
          )
          .all()
          .map((row) => row.service)
      ).toEqual([...CONNECTOR_SERVICES].sort());
    } finally {
      database.close();
    }
  });

  it("preserves existing connector rows while adding Notion service support", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const notionMigrationFile = "0055_pink_lucky_pierre.sql";
      const migrationFiles = listSqlMigrationFiles();
      const notionMigrationIndex = migrationFiles.indexOf(notionMigrationFile);
      expect(notionMigrationIndex).not.toBe(-1);
      applyMigrationFiles(
        database,
        migrationFiles.slice(0, notionMigrationIndex)
      );
      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('connector-owner', 'Connector Owner', 'connector@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('connector-org', 'Connector Org', 'connector-org', 1);
        INSERT INTO connector_connections (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms
        ) VALUES (
          'existing_github',
          'connector-org',
          'connector-owner',
          'shared',
          'github',
          'active',
          1,
          2,
          NULL
        );
      `);

      applyMigrationFiles(database, [notionMigrationFile]);

      expect(
        database
          .prepare(
            `SELECT
              connection_name AS connectionName,
              organization_id AS organizationId,
              user_id AS userId,
              scope,
              service,
              status,
              created_at_ms AS createdAtMs,
              updated_at_ms AS updatedAtMs,
              disconnected_at_ms AS disconnectedAtMs
            FROM connector_connections
            WHERE connection_name = 'existing_github'`
          )
          .get()
      ).toEqual({
        connectionName: "existing_github",
        organizationId: "connector-org",
        userId: "connector-owner",
        scope: "shared",
        service: "github",
        status: "active",
        createdAtMs: 1,
        updatedAtMs: 2,
        disconnectedAtMs: null,
      });
      expect(listTableIndexes(database, "connector_connections")).toEqual(
        expect.arrayContaining([
          "connector_connections_org_scope_user_service_unique",
          "connector_connections_org_shared_service_unique",
          "connector_connections_org_service_status_idx",
        ])
      );
      database.exec(`
        INSERT INTO connector_connections (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms
        ) VALUES (
          'notion_shared',
          'connector-org',
          'connector-owner',
          'shared',
          'notion',
          'active',
          3,
          3,
          NULL
        );
      `);
      expectStatementToThrow(
        database,
        `INSERT INTO connector_connections (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms
        ) VALUES (
          'unsupported_shared',
          'connector-org',
          'connector-owner',
          'shared',
          'unsupported',
          'active',
          4,
          4,
          NULL
        )`,
        "CHECK constraint failed: connector_connections_service_check"
      );
    } finally {
      database.close();
    }
  });

  it("creates the Slack OAuth state and encrypted workspace token tables", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(listTableColumns(database, "slack_oauth_states")).toEqual([
        "state_digest",
        "organization_id",
        "user_id",
        "actor_profile_id",
        "return_path",
        "expires_at_ms",
        "created_at_ms",
        "move_from_organization_id",
      ]);
      expect(listTableColumns(database, "slack_workspace_tokens")).toEqual([
        "slack_team_id",
        "encrypted_bot_token",
        "bot_user_id",
        "granted_bot_scopes",
        "installed_by_user_id",
        "organization_id",
        "created_at_ms",
        "updated_at_ms",
      ]);
      expect(listTableIndexes(database, "slack_workspace_tokens")).toContain(
        "slack_workspace_tokens_org_unique"
      );
    } finally {
      database.close();
    }
  });

  it("creates the durable Slack installation welcome delivery ledger", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(
        listTableColumns(database, "slack_installation_welcome_deliveries")
      ).toEqual([
        "slack_team_id",
        "organization_id",
        "recipient_slack_user_id",
        "connection_created_at_ms",
        "welcome_version",
        "message_kind",
        "status",
        "claim_id",
        "attempt_count",
        "message_ts",
        "failure_code",
        "created_at_ms",
        "updated_at_ms",
      ]);
      expect(
        listTableIndexes(database, "slack_installation_welcome_deliveries")
      ).toContain("idx_slack_installation_welcome_status_updated");
    } finally {
      database.close();
    }
  });

  it("creates Runtime Agent Controller Reports directly in the greenfield baseline", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const sqlFiles = listSqlMigrationFiles();

      expect(
        hasTable(database, "openMeldDaemon_runtime_capability_reports")
      ).toBe(false);
      expect(
        hasTable(database, "openMeldDaemon_runtime_agent_controller_reports")
      ).toBe(false);

      applyMigrationFiles(database, sqlFiles);

      expect(
        hasTable(database, "openMeldDaemon_runtime_capability_reports")
      ).toBe(false);
      expect(
        hasTable(database, "openMeldDaemon_runtime_agent_controller_reports")
      ).toBe(true);
      expect(
        listTableColumns(
          database,
          "openMeldDaemon_runtime_agent_controller_reports"
        )
      ).toEqual([
        "openmeld_service_runtime_id",
        "agent_controller_ref",
        "report_status",
        "observed_at_ms",
        "expires_at_ms",
        "reported_reason_codes_json",
        "agent_controller_interface_json",
        "accepted_at_ms",
        "updated_at_ms",
      ]);

      const indexes = listTableIndexes(
        database,
        "openMeldDaemon_runtime_agent_controller_reports"
      );
      expect(indexes).toContain(
        "openMeldDaemon_runtime_agent_controller_reports_runtime_agent_controller_unique"
      );
      expect(indexes).toContain(
        "idx_openMeldDaemon_runtime_agent_controller_reports_runtime_expires"
      );
      expect(indexes).toContain(
        "idx_openMeldDaemon_runtime_agent_controller_reports_agent_controller_status_expires"
      );
      expect(indexes).not.toContain(
        "openMeldDaemon_runtime_capability_reports_runtime_capability_unique"
      );
      expect(indexes).not.toContain(
        "idx_openMeldDaemon_runtime_capability_reports_runtime_expires"
      );
      expect(indexes).not.toContain(
        "idx_openMeldDaemon_runtime_capability_reports_capability_status_expires"
      );
    } finally {
      database.close();
    }
  });

  it("creates org foundation tables and constraints from a zero shared database", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());
      database.exec("PRAGMA foreign_keys = ON");

      expect(listTableColumns(database, "openmeld_profiles")).toContain(
        "organization_id"
      );
      expect(listTableIndexes(database, "openmeld_profiles")).toContain(
        "openmeld_profiles_organization_kind_idx"
      );
      expect(listTableColumns(database, "space_index_spaces")).toEqual([
        "space_id",
        "organization_id",
        "organization_visibility",
        "status",
        "space_name",
        "space_purpose",
        "creator_profile_id",
        "creator_kind",
        "creator_owner_user_id",
        "creator_profile_name",
        "space_created_at_ms",
        "space_updated_at_ms",
        "deleted_at_ms",
        "deleted_by_profile_id",
        "deleted_by_owner_user_id",
        "deleted_by_profile_name",
        "source_updated_at_ms",
        "projected_at_ms",
        "projection_event_id",
        "direct_message_pair_key",
        "active_member_count",
        "active_human_count",
        "active_agent_count",
        "direct_message_converted_at_ms",
      ]);
      expect(
        listTableColumns(database, "organization_binding_authorizations")
      ).toEqual([
        "id",
        "organization_id",
        "binding_id",
        "authorized_by",
        "created_at",
      ]);

      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('user-1', 'Ada Lovelace', 'ada@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('org-1', 'Northwind', 'northwind', 1);
        INSERT INTO openmeld_profiles (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          organization_id,
          owner_user_id,
          source
        )
        VALUES (
          'agt_00000000-0000-0000-0000-000000000001',
          'Ops Agent',
          'ops-agent',
          'agent',
          'org-1',
          'user-1',
          'cli_create'
        );
        INSERT INTO openmeld_profiles (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          owner_user_id,
          source
        )
        VALUES (
          '00000000-0000-0000-0000-000000000002',
          'Ada',
          'ada',
          'human',
          'user-1',
          'auth_bootstrap'
        );
        INSERT INTO space_index_spaces (
          space_id,
          organization_id,
          organization_visibility,
          status,
          source_updated_at_ms,
          projected_at_ms,
          projection_event_id
        )
        VALUES (
          'space-1',
          'org-1',
          'private',
          'active',
          1,
          1,
          'projection-1'
        );
        INSERT INTO openMeldDaemon_agent_profile_bindings (
          binding_id,
          owner_kind,
          owner_id,
          agent_profile_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          binding_state,
          created_at_ms,
          updated_at_ms
        )
        VALUES (
          'binding-1',
          'owner_account',
          'user-1',
          'agt_00000000-0000-0000-0000-000000000001',
          'runtime-1',
          'builtin:codex',
          'enabled_primary',
          1,
          1
        );
        INSERT INTO organization_binding_authorizations (
          id,
          organization_id,
          binding_id,
          authorized_by
        )
        VALUES ('authz-1', 'org-1', 'binding-1', 'user-1');
      `);

      expectStatementToThrow(
        database,
        `
          INSERT INTO openmeld_profiles (
            profile_id,
            profile_name,
            profile_handle,
            profile_kind,
            owner_user_id,
            source
          )
          VALUES (
            'agt_00000000-0000-0000-0000-000000000003',
            'No Org Agent',
            'no-org-agent',
            'agent',
            'user-1',
            'cli_create'
          );
        `,
        "openmeld_profiles_organization_profile_kind_check"
      );
      expectStatementToThrow(
        database,
        `
          INSERT INTO openmeld_profiles (
            profile_id,
            profile_name,
            profile_handle,
            profile_kind,
            organization_id,
            owner_user_id,
            source
          )
          VALUES (
            '00000000-0000-0000-0000-000000000004',
            'Human With Org',
            'human-with-org',
            'human',
            'org-1',
            'user-1',
            'auth_bootstrap'
          );
        `,
        "openmeld_profiles_organization_profile_kind_check"
      );
      expectStatementToThrow(
        database,
        `
          INSERT INTO space_index_spaces (
            space_id,
            organization_id,
            organization_visibility,
            status,
            source_updated_at_ms,
            projected_at_ms,
            projection_event_id
          )
          VALUES (
            'space-2',
            'org-1',
            'members_only',
            'active',
            1,
            1,
            'projection-2'
          );
        `,
        "space_index_spaces_organization_visibility_check"
      );
      expectStatementToThrow(
        database,
        `
          INSERT INTO organization_binding_authorizations (
            id,
            organization_id,
            binding_id,
            authorized_by
          )
          VALUES ('authz-2', 'org-1', 'binding-1', 'user-1');
        `,
        "UNIQUE constraint failed: organization_binding_authorizations.organization_id, organization_binding_authorizations.binding_id"
      );
    } finally {
      database.close();
    }
  });

  it("creates Center Agent memory mapping tables from a zero shared database", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(
        listTableColumns(database, "center_agent_memory_policies")
      ).toEqual([
        "organization_id",
        "organization_memory_opt_in",
        "updated_by_user_id",
        "created_at_ms",
        "updated_at_ms",
      ]);
      expect(
        listTableColumns(database, "center_agent_memory_subjects")
      ).toEqual([
        "subject_id",
        "organization_id",
        "subject_kind",
        "member_id",
        "member_user_id",
        "provider",
        "zep_user_id",
        "zep_graph_id",
        "status",
        "created_at_ms",
        "updated_at_ms",
        "deleted_at_ms",
        "last_error",
      ]);

      const subjectIndexes = listTableIndexes(
        database,
        "center_agent_memory_subjects"
      );
      expect(subjectIndexes).toContain(
        "center_agent_memory_subjects_member_user_idx"
      );
      expect(subjectIndexes).toContain(
        "center_agent_memory_subjects_org_kind_idx"
      );
      expect(subjectIndexes).toContain(
        "center_agent_memory_subjects_zep_graph_uq_idx"
      );
      expect(subjectIndexes).toContain(
        "center_agent_memory_subjects_zep_user_uq_idx"
      );
    } finally {
      database.close();
    }
  });

  it("creates the durable Remote Agent Slack ingress ledger", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(
        listTableColumns(database, "openMeldRemoteAgent_slack_event_ingress")
      ).toEqual([
        "event_key",
        "event_id",
        "slack_team_id",
        "state",
        "claim_id",
        "claim_expires_at_ms",
        "first_received_at_ms",
        "last_received_at_ms",
        "delivery_attempt_count",
        "slack_retry_num",
        "slack_retry_reason",
        "gateway_request_id",
        "queue_message_id",
        "queue_attempts",
        "outcome_status",
        "failure_code",
        "completed_at_ms",
        "updated_at_ms",
      ]);
      expect(
        listTableIndexes(database, "openMeldRemoteAgent_slack_event_ingress")
      ).toEqual(
        expect.arrayContaining([
          "idx_openMeldRemoteAgent_slack_event_ingress_state_claim",
          "idx_openMeldRemoteAgent_slack_event_ingress_team_received",
        ])
      );

      database.exec(`
        INSERT INTO openMeldRemoteAgent_slack_event_ingress (
          event_key,
          event_id,
          slack_team_id,
          first_received_at_ms,
          last_received_at_ms,
          gateway_request_id,
          updated_at_ms
        ) VALUES ('event-1', 'Ev1', 'T1', 1, 1, 'request-1', 1);
      `);
      expectStatementToThrow(
        database,
        `
          INSERT INTO openMeldRemoteAgent_slack_event_ingress (
            event_key,
            event_id,
            slack_team_id,
            first_received_at_ms,
            last_received_at_ms,
            gateway_request_id,
            updated_at_ms
          ) VALUES ('event-1', 'Ev1', 'T1', 2, 2, 'request-2', 2);
        `,
        "UNIQUE constraint failed: openMeldRemoteAgent_slack_event_ingress.event_key"
      );
    } finally {
      database.close();
    }
  });

  it("creates durable Routine definitions and retained Run history", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());
      database.exec("PRAGMA foreign_keys = ON");

      expect(listTableColumns(database, "routines")).toEqual([
        "id",
        "organization_id",
        "name",
        "instructions",
        "authorized_actions_json",
        "external_action_policy",
        "schedule_kind",
        "cron_expression",
        "timezone",
        "run_at_ms",
        "destination_kind",
        "target_space_id",
        "slack_team_id",
        "slack_channel_id",
        "slack_thread_ts",
        "slack_conversation_id",
        "slack_thread_label",
        "status",
        "next_due_at",
        "created_by_user_id",
        "updated_by_user_id",
        "created_at_ms",
        "updated_at_ms",
        "creation_attribution_json",
      ]);
      expect(listTableIndexes(database, "routines")).toEqual(
        expect.arrayContaining([
          "routines_status_next_due_idx",
          "routines_org_status_next_due_idx",
          "routines_org_updated_idx",
        ])
      );
      expect(listTableColumns(database, "routine_runs")).toEqual([
        "id",
        "routine_id",
        "organization_id",
        "scheduled_for",
        "status",
        "failure_code",
        "failure_detail",
        "native_delivery_id",
        "published_signal_id",
        "started_at_ms",
        "finished_at_ms",
        "routine_name_snapshot",
        "target_space_id_snapshot",
        "failure_publication_attempt_count",
        "next_failure_publication_attempt_at_ms",
        "execution_engine",
        "destination_kind_snapshot",
        "slack_team_id_snapshot",
        "slack_channel_id_snapshot",
        "slack_thread_ts_snapshot",
        "slack_conversation_id_snapshot",
        "slack_thread_label_snapshot",
        "continuation_delegation_id",
      ]);
      expect(listTableIndexes(database, "routine_runs")).toEqual(
        expect.arrayContaining([
          "routine_runs_org_scheduled_idx",
          "routine_runs_routine_scheduled_unique",
          "routine_runs_status_started_idx",
          "routine_runs_engine_status_started_idx",
        ])
      );

      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('routine-user', 'Routine Owner', 'routine@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('routine-org', 'Routine Org', 'routine-org', 1);
        INSERT INTO routines (
          id,
          organization_id,
          name,
          instructions,
          schedule_kind,
          cron_expression,
          timezone,
          target_space_id,
          status,
          next_due_at,
          created_by_user_id,
          updated_by_user_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'routine-1',
          'routine-org',
          'Daily review',
          'Review feedback.',
          'cron',
          '0 9 * * *',
          'America/Los_Angeles',
          'space-1',
          'enabled',
          2000,
          'routine-user',
          'routine-user',
          1000,
          1000
        );
        INSERT INTO routine_runs (
          id,
          routine_id,
          organization_id,
          scheduled_for,
          status,
          started_at_ms
        ) VALUES (
          'run-1',
          'routine-1',
          'routine-org',
          2000,
          'claimed',
          2001
        );
      `);

      expect(
        database
          .prepare(
            "SELECT creation_attribution_json AS creationAttributionJson FROM routines WHERE id = 'routine-1'"
          )
          .get()
      ).toEqual({ creationAttributionJson: null });
      database.exec("DELETE FROM routines WHERE id = 'routine-1'");

      expect(
        database.prepare("SELECT COUNT(*) AS count FROM routine_runs").get()
      ).toMatchObject({ count: 1 });
      expectStatementToThrow(
        database,
        `
          INSERT INTO routine_runs (
            id,
            routine_id,
            organization_id,
            scheduled_for,
            status,
            started_at_ms
          ) VALUES (
            'run-2',
            'routine-1',
            'routine-org',
            2000,
            'claimed',
            2002
          );
        `,
        "UNIQUE constraint failed: routine_runs.routine_id, routine_runs.scheduled_for"
      );
      expectStatementToThrow(
        database,
        `
          INSERT INTO routines (
            id,
            organization_id,
            name,
            instructions,
            schedule_kind,
            cron_expression,
            timezone,
            target_space_id,
            status,
            next_due_at,
            created_by_user_id,
            updated_by_user_id,
            created_at_ms,
            updated_at_ms
          ) VALUES (
            'routine-paused-invalid',
            'routine-org',
            'Paused review',
            'Review feedback.',
            'cron',
            '0 9 * * *',
            'UTC',
            'space-1',
            'paused',
            3000,
            'routine-user',
            'routine-user',
            1000,
            1000
          );
        `,
        "routines_status_next_due_check"
      );
    } finally {
      database.close();
    }
  });

  it("links each Routine Run to an ordered native delivery chain", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(
        listTableColumns(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).toEqual(
        expect.arrayContaining(["routine_run_id", "routine_name_snapshot"])
      );
      expect(
        listTableIndexes(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).toContain("idx_openMeldRemoteAgent_native_delivery_routine_run");
      expect(
        listTableIndexes(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).not.toContain("openMeldRemoteAgent_native_delivery_routine_run_unique");
      expect(listTableColumns(database, "routine_runs")).toEqual(
        expect.arrayContaining([
          "failure_publication_attempt_count",
          "next_failure_publication_attempt_at_ms",
          "routine_name_snapshot",
          "target_space_id_snapshot",
          "execution_engine",
        ])
      );
      expect(listTableIndexes(database, "routine_runs")).toContain(
        "routine_runs_failure_publication_due_idx"
      );
      expect(listTableIndexes(database, "routine_runs")).toContain(
        "routine_runs_engine_status_started_idx"
      );
      expectStatementToThrow(
        database,
        `
          INSERT INTO routine_runs (
            id,
            routine_id,
            organization_id,
            scheduled_for,
            status,
            execution_engine
          ) VALUES (
            'run-invalid-engine',
            'routine-missing',
            'routine-org',
            4000,
            'claimed',
            'workflows'
          );
        `,
        "routine_runs_execution_engine_check"
      );
      expect(
        listTableColumns(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).toEqual(
        expect.arrayContaining([
          "deadline_probe_enqueued_at_ms",
          "worker_submit_request_json",
        ])
      );
      expect(
        listTableColumns(database, "slack_invited_member_welcome_deliveries")
      ).toEqual(
        expect.arrayContaining([
          "interaction_id",
          "target_slack_user_id",
          "research_task_id",
          "status",
          "claim_id",
          "attempt_count",
          "message_ts",
          "failure_code",
          "created_at_ms",
          "updated_at_ms",
        ])
      );
    } finally {
      database.close();
    }
  });

  it("stores invited-member onboarding state on the invitation delivery", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(
        listTableColumns(database, "slack_teammate_invitation_deliveries")
      ).toEqual(
        expect.arrayContaining([
          "onboarding_status",
          "joined_user_id",
          "joined_profile_id",
          "research_task_id",
          "welcome_message_ts",
          "onboarding_failure_code",
        ])
      );
      expect(
        listTableColumns(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).not.toEqual(
        expect.arrayContaining([
          "onboarding_status",
          "joined_user_id",
          "joined_profile_id",
          "research_task_id",
          "welcome_message_ts",
          "onboarding_failure_code",
        ])
      );
    } finally {
      database.close();
    }
  });

  it("preserves existing documents and folders while adding Profile Report metadata", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const migrationFileName = listSqlMigrationFiles().find((fileName) =>
        fileName.startsWith("0115_")
      );
      expect(migrationFileName).toBeDefined();
      if (!migrationFileName) {
        return;
      }

      applyMigrationFiles(
        database,
        listSqlMigrationFiles().filter(
          (fileName) => fileName.localeCompare(migrationFileName) < 0
        )
      );
      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('profile-report-user', 'Profile Report User', 'profile-report@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('profile-report-org', 'Profile Report Org', 'profile-report-org', 1000);
        INSERT INTO organization_document_folders (
          id,
          organization_id,
          name,
          created_at,
          updated_at
        ) VALUES (
          'profile-report-folder',
          'profile-report-org',
          'People',
          1000,
          1000
        );
        INSERT INTO organization_document_folders (
          id,
          organization_id,
          parent_folder_id,
          name,
          created_at,
          updated_at
        ) VALUES (
          'profile-report-child-folder',
          'profile-report-org',
          'profile-report-folder',
          'Existing profiles',
          1000,
          1000
        );
        INSERT INTO organization_documents (
          id,
          organization_id,
          kind,
          subject_user_id,
          folder_id,
          title,
          content,
          created_at,
          updated_at
        ) VALUES (
          'profile-report-document',
          'profile-report-org',
          'member_profile',
          'profile-report-user',
          'profile-report-child-folder',
          'Existing work profile',
          'Existing profile content',
          1000,
          1000
        );
      `);

      applyMigrationFiles(database, [migrationFileName]);

      expect(
        database
          .prepare(
            `SELECT id, title, content, folder_id, profile_report_date, profile_report_type
             FROM organization_documents
             WHERE id = 'profile-report-document'`
          )
          .get()
      ).toEqual({
        content: "Existing profile content",
        folder_id: "profile-report-child-folder",
        id: "profile-report-document",
        profile_report_date: null,
        profile_report_type: null,
        title: "Existing work profile",
      });
      expect(
        database
          .prepare(
            `SELECT id, name, parent_folder_id, system_kind, subject_user_id
             FROM organization_document_folders
             WHERE id = 'profile-report-child-folder'`
          )
          .get()
      ).toEqual({
        id: "profile-report-child-folder",
        name: "Existing profiles",
        parent_folder_id: "profile-report-folder",
        subject_user_id: null,
        system_kind: null,
      });
    } finally {
      database.close();
    }
  });

  it("backfills existing non-skipped Routine Runs to the legacy engine", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const sqlFiles = listSqlMigrationFiles();
      applyMigrationFiles(
        database,
        sqlFiles.filter((fileName) => fileName < "0028_")
      );
      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('workflow-user', 'Workflow Owner', 'workflow@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('workflow-org', 'Workflow Org', 'workflow-org', 1);
        INSERT INTO routines (
          id, organization_id, name, instructions, schedule_kind,
          cron_expression, timezone, target_space_id, status, next_due_at,
          created_by_user_id, updated_by_user_id, created_at_ms, updated_at_ms
        ) VALUES (
          'workflow-routine', 'workflow-org', 'Daily review', 'Review feedback.',
          'cron', '0 9 * * *', 'UTC', 'space-1', 'enabled', 3000,
          'workflow-user', 'workflow-user', 1000, 1000
        );
        INSERT INTO routine_runs (
          id, routine_id, organization_id, scheduled_for, status, started_at_ms
        ) VALUES (
          'workflow-existing-claimed', 'workflow-routine', 'workflow-org',
          1000, 'claimed', 1000
        );
        INSERT INTO routine_runs (
          id, routine_id, organization_id, scheduled_for, status,
          failure_code, finished_at_ms
        ) VALUES (
          'workflow-existing-skipped', 'workflow-routine', 'workflow-org',
          2000, 'skipped', 'routine.occurrences_overdue', 2000
        );
      `);

      applyMigrationFiles(database, ["0028_routine_run_workflow.sql"]);

      expect(
        database
          .prepare("SELECT id, execution_engine FROM routine_runs ORDER BY id")
          .all()
      ).toEqual([
        { execution_engine: "legacy", id: "workflow-existing-claimed" },
        { execution_engine: null, id: "workflow-existing-skipped" },
      ]);
    } finally {
      database.close();
    }
  });

  it("adds persisted Remote Agent trigger text for Slack memory writes", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrationFiles(database, listSqlMigrationFiles());

      expect(
        listTableColumns(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).toContain("trigger_text");
    } finally {
      database.close();
    }
  });

  it("adds honest Slack final publication state and backfills legacy completed rows", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const sqlFiles = listSqlMigrationFiles();
      applyMigrationFiles(
        database,
        sqlFiles.filter((fileName) => fileName < "0019_")
      );
      const insert = database.prepare(`
        INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          dispatch_id,
          idempotency_key,
          submission_id,
          status,
          published_signal_id,
          created_at_ms,
          updated_at_ms,
          completed_at_ms
        )
        VALUES (?, 'org_1', 'slack', ?, 'profile_1', 'binding_1', ?, ?, ?, ?, 'completed', ?, 1000, 1200, 1200)
      `);
      insert.run(
        "delivery_published",
        "slack:T123:C123:1.1",
        "trigger_published",
        "dispatch_published",
        "idem_published",
        "sub_published",
        "1.2"
      );
      insert.run(
        "delivery_unknown",
        "slack:T123:C123:2.1",
        "trigger_unknown",
        "dispatch_unknown",
        "idem_unknown",
        "sub_unknown",
        null
      );

      applyMigrationFiles(
        database,
        sqlFiles.filter((fileName) => fileName >= "0019_")
      );

      expect(
        listTableColumns(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).toEqual(
        expect.arrayContaining([
          "final_publication_state",
          "final_publication_claim_id",
          "final_publication_claimed_at_ms",
          "final_publication_claim_expires_at_ms",
        ])
      );
      expect(
        database
          .prepare(
            `
              SELECT
                delivery_id,
                status,
                failure_code,
                final_publication_state,
                completed_at_ms
              FROM openMeldRemoteAgent_native_delivery_ledger
              ORDER BY delivery_id
            `
          )
          .all()
      ).toEqual([
        {
          completed_at_ms: 1200,
          delivery_id: "delivery_published",
          failure_code: null,
          final_publication_state: "published",
          status: "completed",
        },
        {
          completed_at_ms: null,
          delivery_id: "delivery_unknown",
          failure_code: "remote_agent.callback_publication_outcome_unknown",
          final_publication_state: "outcome_unknown",
          status: "accepted",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("keeps Organization document operations writable by the previous Core after the claim expansion", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const sqlFiles = listSqlMigrationFiles();
      applyMigrationFiles(
        database,
        sqlFiles.filter((fileName) => fileName < "0065_")
      );
      database.exec(`
        INSERT INTO users (id, name, email)
        VALUES ('claim-rollout-user', 'Claim Rollout User', 'claim-rollout@example.com');
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES ('claim-rollout-org', 'Claim Rollout Org', 'claim-rollout-org', 1000);
        INSERT INTO openmeld_profiles (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          organization_id,
          owner_user_id,
          source,
          managed_role
        ) VALUES (
          'agt_00000000-0000-0000-0000-000000000001',
          'Claim Rollout Center Agent',
          'claim-rollout-center-agent',
          'agent',
          'claim-rollout-org',
          'claim-rollout-user',
          'migration',
          'center_agent'
        );
        INSERT INTO center_agent_organization_document_operations (
          id,
          organization_id,
          actor_profile_id,
          represented_user_id,
          operation_id,
          operation_kind,
          request_signature,
          target_resource_id,
          response_json,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES (
          'legacy-pending-operation',
          'claim-rollout-org',
          'agt_00000000-0000-0000-0000-000000000001',
          'claim-rollout-user',
          'legacy-pending',
          'save_document',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'legacy-pending-document',
          NULL,
          'pending',
          1000,
          1000
        );
      `);

      applyMigrationFiles(
        database,
        sqlFiles.filter((fileName) => fileName >= "0065_" && fileName < "0066_")
      );

      expect(
        database
          .prepare(
            `
              SELECT claim_id, claim_expires_at_ms
              FROM center_agent_organization_document_operations
              WHERE id = 'legacy-pending-operation'
            `
          )
          .get()
      ).toEqual({
        claim_expires_at_ms: null,
        claim_id: null,
      });

      const legacyInsert = database.prepare(`
        INSERT OR IGNORE INTO center_agent_organization_document_operations (
          id,
          organization_id,
          actor_profile_id,
          represented_user_id,
          operation_id,
          operation_kind,
          request_signature,
          target_resource_id,
          response_json,
          status,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?)
      `);
      expect(
        legacyInsert.run(
          "legacy-core-operation",
          "claim-rollout-org",
          "agt_00000000-0000-0000-0000-000000000001",
          "claim-rollout-user",
          "legacy-core-create",
          "create_folder",
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "legacy-core-folder",
          1001,
          1001
        ).changes
      ).toBe(1);

      const legacyCompletion = database.prepare(`
        UPDATE center_agent_organization_document_operations
        SET response_json = ?, status = 'completed', updated_at_ms = ?
        WHERE id = ? AND status = 'pending'
      `);
      expect(
        legacyCompletion.run(
          JSON.stringify({ action: "create_folder" }),
          1002,
          "legacy-core-operation"
        ).changes
      ).toBe(1);
      expect(
        database
          .prepare(
            `
              SELECT status, response_json, claim_id, claim_expires_at_ms
              FROM center_agent_organization_document_operations
              WHERE id = 'legacy-core-operation'
            `
          )
          .get()
      ).toEqual({
        claim_expires_at_ms: null,
        claim_id: null,
        response_json: JSON.stringify({ action: "create_folder" }),
        status: "completed",
      });

      database
        .prepare(
          `
            INSERT INTO center_agent_organization_document_operations (
              id,
              organization_id,
              actor_profile_id,
              represented_user_id,
              operation_id,
              operation_kind,
              request_signature,
              target_resource_id,
              response_json,
              status,
              claim_id,
              claim_expires_at_ms,
              created_at_ms,
              updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?, ?)
          `
        )
        .run(
          "current-core-operation",
          "claim-rollout-org",
          "agt_00000000-0000-0000-0000-000000000001",
          "claim-rollout-user",
          "current-core-create",
          "create_folder",
          "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          "current-core-folder",
          "current-core-claim",
          301_000,
          1000,
          1000
        );
      expect(
        legacyCompletion.run(
          JSON.stringify({ action: "create_folder" }),
          1002,
          "current-core-operation"
        ).changes
      ).toBe(1);
      expect(
        database
          .prepare(
            `
              SELECT status, claim_id, claim_expires_at_ms
              FROM center_agent_organization_document_operations
              WHERE id = 'current-core-operation'
            `
          )
          .get()
      ).toEqual({
        claim_expires_at_ms: 301_000,
        claim_id: "current-core-claim",
        status: "completed",
      });
    } finally {
      database.close();
    }
  });

  it("backfills legacy personal Organizations to solo metadata and readable slugs idempotently", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const sqlFiles = listSqlMigrationFiles();
      applyMigrationFiles(
        database,
        sqlFiles.filter((fileName) => fileName < "0005_")
      );

      database
        .prepare(
          `
            INSERT INTO users (
              id,
              name,
              email,
              email_verified,
              created_at,
              updated_at,
              normalized_email
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          "user-a",
          "Felix Lyu",
          "felix@example.com",
          1,
          1_700_000_000_000,
          1_700_000_000_000,
          "felix@example.com"
        );
      database
        .prepare(
          `
            INSERT INTO organizations (
              id,
              name,
              slug,
              created_at,
              metadata
            )
            VALUES (?, ?, ?, ?, ?)
          `
        )
        .run(
          "org-personal",
          "Personal",
          "personal-user-a",
          1_700_000_000_000,
          null
        );
      database
        .prepare(
          `
            INSERT INTO members (
              id,
              organization_id,
              user_id,
              role,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `
        )
        .run(
          "member-personal",
          "org-personal",
          "user-a",
          "owner",
          1_700_000_000_000
        );

      const backfillMigrationFileName = sqlFiles.find((fileName) =>
        fileName.startsWith("0005_")
      );
      if (!backfillMigrationFileName) {
        throw new Error(
          "Expected 0005 personal Organization backfill migration"
        );
      }
      const migrationStatements = readMigrationStatements(
        backfillMigrationFileName
      );
      for (const statement of migrationStatements) {
        database.exec(statement);
      }
      const backfillStatement = migrationStatements.at(-1);
      if (!backfillStatement) {
        throw new Error("Expected 0005 backfill statement");
      }
      database.exec(backfillStatement);

      expect(
        database
          .prepare(
            `
              SELECT
                name,
                slug,
                json_extract(metadata, '$.personal') AS personal
              FROM organizations
              WHERE id = ?
            `
          )
          .get("org-personal")
      ).toEqual({
        name: "Felix Lyu",
        slug: "felix-lyu",
        personal: 1,
      });
    } finally {
      database.close();
    }
  });
});
