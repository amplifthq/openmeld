import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const OWNER_KIND_ERROR_PATTERN = /owner_kind/;
const HOSTED_IDENTITY_ERROR_PATTERN = /hosted_identity/;
const LIFECYCLE_ERROR_PATTERN = /lifecycle/;
const CANONICAL_ENABLED_ERROR_PATTERN =
  /agent_profile_binding_canonical_enabled_check/;
const CANONICAL_ENABLED_TRIGGER_MARKER =
  "openMeldDaemon_agent_profile_bindings_canonical_enabled_";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SECOND_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const THIRD_AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

const readSharedMigrationStatements = (
  beforePersonalRemote = false
): readonly string[] => {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .filter((entry) => !beforePersonalRemote || entry < "0159_")
    .sort((left, right) => left.localeCompare(right))
    .map((entry) =>
      fs.readFileSync(path.resolve(migrationDirectoryPath, entry), "utf8")
    )
    .join("\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

const applySharedMigrations = (
  database: DatabaseSync,
  input: { skipCanonicalEnabledBindingTriggers?: boolean } = {}
) => {
  for (const statement of readSharedMigrationStatements()) {
    if (
      input.skipCanonicalEnabledBindingTriggers &&
      statement.includes(CANONICAL_ENABLED_TRIGGER_MARKER)
    ) {
      continue;
    }
    database.exec(statement);
  }
};

const applyCanonicalEnabledBindingTriggers = (database: DatabaseSync) => {
  for (const statement of readSharedMigrationStatements().filter((candidate) =>
    candidate.includes(CANONICAL_ENABLED_TRIGGER_MARKER)
  )) {
    database.exec(statement);
  }
};

describe("Agent Profile Binding storage schema", () => {
  it("preserves existing Local and Center Bindings and ownership guards when enabling personal Remote Agents", () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const statement of readSharedMigrationStatements(true)) {
        database.exec(statement);
      }
      insertBinding(database, {
        bindingId: "local",
        agentControllerConversationId: "existing-local-session",
      });
      insertBinding(database, {
        bindingId: "center",
        agentProfileId: SECOND_AGENT_PROFILE_ID,
      });
      database.exec(
        `UPDATE openMeldDaemon_agent_profile_bindings SET runtime_kind = 'hosted_center_agent', hosted_runtime_identity_json = '{"kind":"hosted_center_agent"}', agent_controller_ref = 'hosted:center-agent' WHERE binding_id = 'center'`
      );
      const before = database
        .prepare(
          "SELECT * FROM openMeldDaemon_agent_profile_bindings ORDER BY binding_id"
        )
        .all();
      const migration = fs.readFileSync(
        path.join(
          repoRootDirectoryPath,
          "packages/db/drizzle/0159_lazy_ma_gnuci.sql"
        ),
        "utf8"
      );
      database.exec(migration);
      expect(
        database
          .prepare(
            "SELECT * FROM openMeldDaemon_agent_profile_bindings ORDER BY binding_id"
          )
          .all()
      ).toEqual(before);
      insertBinding(database, {
        bindingId: "personal",
        agentProfileId: THIRD_AGENT_PROFILE_ID,
      });
      database.exec(
        `UPDATE openMeldDaemon_agent_profile_bindings SET runtime_kind = 'hosted_remote_agent', hosted_runtime_identity_json = '{"kind":"hosted_remote_agent"}', agent_controller_ref = 'hosted:remote-agent' WHERE binding_id = 'personal'`
      );
      expect(() =>
        database.exec(
          "UPDATE openMeldDaemon_agent_profile_bindings SET hosted_runtime_identity_json = NULL WHERE binding_id = 'personal'"
        )
      ).toThrow(HOSTED_IDENTITY_ERROR_PATTERN);
      expect(() =>
        database.exec(
          "UPDATE openMeldDaemon_agent_profile_bindings SET owner_id = 'another-owner' WHERE binding_id = 'personal'"
        )
      ).toThrow(CANONICAL_ENABLED_ERROR_PATTERN);
      expect(() =>
        database.exec(
          "UPDATE openMeldDaemon_agent_profile_bindings SET runtime_kind = 'unknown' WHERE binding_id = 'personal'"
        )
      ).toThrow();
    } finally {
      database.close();
    }
  });
  it("creates a dedicated Binding truth table with active-primary uniqueness and read indexes", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      const columns = database
        .prepare("PRAGMA table_info('openMeldDaemon_agent_profile_bindings')")
        .all()
        .map((column) => column.name);
      expect(columns).toEqual([
        "binding_id",
        "owner_kind",
        "owner_id",
        "agent_profile_id",
        "openmeld_service_runtime_id",
        "agent_controller_ref",
        "agent_controller_conversation_id",
        "model_id",
        "reasoning_level",
        "agent_controller_permission_mode",
        "binding_state",
        "created_at_ms",
        "updated_at_ms",
        "disabled_at_ms",
        "created_by_profile_id",
        "reason_code",
        "opencode_permission",
        "runtime_kind",
        "hosted_runtime_identity_json",
        "agent_controller_collaboration_mode",
        "configuration_revision",
      ]);

      const indexes = database
        .prepare("PRAGMA index_list('openMeldDaemon_agent_profile_bindings')")
        .all()
        .map((index) => index.name);
      expect(indexes).toContain(
        "openMeldDaemon_agent_profile_bindings_enabled_primary_unique"
      );
      expect(indexes).not.toContain(
        "openMeldDaemon_agent_profile_bindings_enabled_controller_conversation_unique"
      );
      expect(indexes).toContain(
        "idx_openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_agent_controller"
      );
      expect(indexes).toContain(
        "idx_openMeldDaemon_agent_profile_bindings_owner_profile_state"
      );
      expect(indexes).toContain(
        "idx_openMeldDaemon_agent_profile_bindings_profile_enabled_owner"
      );
    } finally {
      database.close();
    }
  });

  it("enforces lifecycle checks without rewriting historical conversation duplicates", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      expect(() =>
        insertBinding(database, {
          bindingId: "binding_bad_owner",
          bindingState: "disabled_historical",
          disabledAtMs: 2000,
          ownerKind: "owner_principal",
        })
      ).toThrow(OWNER_KIND_ERROR_PATTERN);
      expect(() =>
        insertBinding(database, {
          bindingId: "binding_bad_disabled",
          bindingState: "disabled_historical",
          disabledAtMs: null,
        })
      ).toThrow(LIFECYCLE_ERROR_PATTERN);

      insertBinding(database, {
        bindingId: "binding_opaque_1",
      });
      expect(() =>
        insertBinding(database, {
          bindingId: "binding_opaque_2",
          openMeldServiceRuntimeId: "runtime_opaque_2",
        })
      ).toThrow();
      expect(
        database
          .prepare(
            `
              SELECT binding_id
              FROM openMeldDaemon_agent_profile_bindings
              WHERE agent_profile_id = ?
                AND binding_state = 'enabled_primary'
            `
          )
          .all(AGENT_PROFILE_ID)
      ).toEqual([{ binding_id: "binding_opaque_1" }]);

      insertBinding(database, {
        bindingId: "binding_disabled_1",
        bindingState: "disabled_historical",
        disabledAtMs: 2000,
        openMeldServiceRuntimeId: "runtime_opaque_old_1",
      });
      insertBinding(database, {
        bindingId: "binding_disabled_2",
        bindingState: "disabled_historical",
        disabledAtMs: 3000,
        openMeldServiceRuntimeId: "runtime_opaque_old_2",
      });

      insertBinding(database, {
        agentControllerConversationId: "native-session-1",
        agentProfileId: SECOND_AGENT_PROFILE_ID,
        bindingId: "binding_conversation_1",
        openMeldServiceRuntimeId: "runtime_conversation_1",
      });
      insertBinding(database, {
        agentControllerConversationId: "native-session-1",
        agentProfileId: THIRD_AGENT_PROFILE_ID,
        bindingId: "binding_conversation_2",
        openMeldServiceRuntimeId: "runtime_conversation_2",
      });

      expect(
        database
          .prepare(
            "SELECT binding_id FROM openMeldDaemon_agent_profile_bindings"
          )
          .all()
      ).toHaveLength(5);
    } finally {
      database.close();
    }
  });

  it("blocks an old writer from recreating a noncanonical enabled Binding after legacy reconciliation", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database, {
        skipCanonicalEnabledBindingTriggers: true,
      });

      insertBinding(database, {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_legacy_admin",
        ownerId: "admin-1",
        profileOwnerId: "owner-1",
      });

      // Production can already contain legacy rows when this migration lands.
      // Installing the triggers must preserve that data while rejecting new
      // noncanonical writes from an older in-flight Core deployment.
      applyCanonicalEnabledBindingTriggers(database);
      database
        .prepare(
          `
            UPDATE openMeldDaemon_agent_profile_bindings
            SET binding_state = 'disabled_historical',
                disabled_at_ms = 2000,
                updated_at_ms = 2000
            WHERE binding_id = 'binding_legacy_admin'
          `
        )
        .run();

      expect(() =>
        insertBinding(database, {
          agentProfileId: AGENT_PROFILE_ID,
          bindingId: "binding_old_writer_admin",
          openMeldServiceRuntimeId: "runtime_old_writer_admin",
          ownerId: "admin-1",
          profileOwnerId: "owner-1",
        })
      ).toThrow(CANONICAL_ENABLED_ERROR_PATTERN);

      insertBinding(database, {
        agentProfileId: AGENT_PROFILE_ID,
        bindingId: "binding_canonical_owner",
        openMeldServiceRuntimeId: "runtime_canonical_owner",
        ownerId: "owner-1",
      });

      expect(
        database
          .prepare(
            `
              SELECT binding_id, owner_id
              FROM openMeldDaemon_agent_profile_bindings
              WHERE agent_profile_id = ?
                AND binding_state = 'enabled_primary'
            `
          )
          .all(AGENT_PROFILE_ID)
      ).toEqual([
        {
          binding_id: "binding_canonical_owner",
          owner_id: "owner-1",
        },
      ]);
    } finally {
      database.close();
    }
  });
});

function insertBinding(
  database: DatabaseSync,
  input: {
    agentControllerConversationId?: string | null;
    agentControllerRef?: string;
    agentProfileId?: string;
    bindingId: string;
    bindingState?: "enabled_primary" | "disabled_historical";
    disabledAtMs?: number | null;
    ownerId?: string;
    ownerKind?: string;
    openMeldServiceRuntimeId?: string;
    profileOwnerId?: string;
  }
) {
  const agentProfileId = input.agentProfileId ?? AGENT_PROFILE_ID;
  const ownerId = input.ownerId ?? "owner-1";
  ensureAgentProfile(database, {
    ownerId: input.profileOwnerId ?? ownerId,
    profileId: agentProfileId,
  });
  database
    .prepare(
      `
        INSERT INTO openMeldDaemon_agent_profile_bindings (
          binding_id,
          owner_kind,
          owner_id,
          agent_profile_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          agent_controller_conversation_id,
          binding_state,
          created_at_ms,
          updated_at_ms,
          disabled_at_ms,
          created_by_profile_id,
          reason_code
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, 1000, ?, 'profile-1', 'agent_profile_binding.test')
      `
    )
    .run(
      input.bindingId,
      input.ownerKind ?? "owner_account",
      ownerId,
      agentProfileId,
      input.openMeldServiceRuntimeId ?? "runtime_opaque_1",
      input.agentControllerRef ?? "builtin:codex",
      input.agentControllerConversationId ?? null,
      input.bindingState ?? "enabled_primary",
      input.disabledAtMs ?? null
    );
}

function ensureAgentProfile(
  database: DatabaseSync,
  input: { ownerId: string; profileId: string }
) {
  database
    .prepare(
      `
        INSERT OR IGNORE INTO users (
          id, name, email, email_verified, created_at, updated_at
        ) VALUES (?, ?, ?, 1, 1000, 1000)
      `
    )
    .run(input.ownerId, input.ownerId, `${input.ownerId}@example.com`);
  database
    .prepare(
      `
        INSERT OR IGNORE INTO organizations (
          id, name, slug, created_at
        ) VALUES ('org-1', 'Organization', 'organization', 1000)
      `
    )
    .run();
  database
    .prepare(
      `
        INSERT OR IGNORE INTO openmeld_profiles (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          source,
          created_at,
          updated_at
        ) VALUES (?, 'Agent', ?, 'agent', 0, 'active', 'org-1', ?, 'migration', 1000, 1000)
      `
    )
    .run(input.profileId, input.profileId, input.ownerId);
}
