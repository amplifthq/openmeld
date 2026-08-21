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
const LIFECYCLE_ERROR_PATTERN = /lifecycle/;
const UNIQUE_ERROR_PATTERN = /UNIQUE/;

const readSharedMigrationStatements = (): readonly string[] => {
  const migrationDirectoryPath = path.resolve(
    repoRootDirectoryPath,
    "packages/db/drizzle"
  );
  return fs
    .readdirSync(migrationDirectoryPath)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) =>
      fs.readFileSync(path.resolve(migrationDirectoryPath, entry), "utf8")
    )
    .join("\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
};

const applySharedMigrations = (database: DatabaseSync) => {
  for (const statement of readSharedMigrationStatements()) {
    database.exec(statement);
  }
};

describe("Agent Profile Binding storage schema", () => {
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
      ).toThrow(UNIQUE_ERROR_PATTERN);

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
        agentProfileId: "agent-profile-2",
        bindingId: "binding_conversation_1",
        openMeldServiceRuntimeId: "runtime_conversation_1",
      });
      insertBinding(database, {
        agentControllerConversationId: "native-session-1",
        agentProfileId: "agent-profile-3",
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
    ownerKind?: string;
    openMeldServiceRuntimeId?: string;
  }
) {
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
        VALUES (?, ?, 'owner-1', ?, ?, ?, ?, ?, 1000, 1000, ?, 'profile-1', 'agent_profile_binding.test')
      `
    )
    .run(
      input.bindingId,
      input.ownerKind ?? "owner_account",
      input.agentProfileId ?? "agent-profile-1",
      input.openMeldServiceRuntimeId ?? "runtime_opaque_1",
      input.agentControllerRef ?? "builtin:codex",
      input.agentControllerConversationId ?? null,
      input.bindingState ?? "enabled_primary",
      input.disabledAtMs ?? null
    );
}
