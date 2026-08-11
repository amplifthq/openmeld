import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRootDirectoryPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const UNIQUE_CONSTRAINT_ERROR_PATTERN = /UNIQUE/u;

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

const applySharedMigrations = (database: DatabaseSync): void => {
  for (const statement of readSharedMigrationStatements()) {
    database.exec(statement);
  }
};

const listColumns = (database: DatabaseSync, tableName: string): string[] =>
  database
    .prepare(`PRAGMA table_info('${tableName}')`)
    .all()
    .map((column) => String(column.name));

describe("Message Channel storage", () => {
  it("separates Lark-platform public connection facts from credentials", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      const connectionColumns = listColumns(
        database,
        "openMeldRemoteAgent_lark_platform_channel_connections"
      );
      expect(connectionColumns).toEqual([
        "connection_id",
        "organization_id",
        "provider",
        "app_id",
        "tenant_key",
        "bot_open_id",
        "bot_name",
        "transport",
        "status",
        "installed_by_user_id",
        "permission_bundle_version",
        "granted_capability_groups_json",
        "connection_generation",
        "last_verified_at_ms",
        "failure_reason_code",
        "created_at_ms",
        "updated_at_ms",
        "events_webhook_verified_at_ms",
        "callbacks_webhook_verified_at_ms",
      ]);
      expect(connectionColumns).not.toEqual(
        expect.arrayContaining([
          "encrypted_app_secret",
          "encrypted_verification_token",
          "encrypted_event_encrypt_key",
        ])
      );
      expect(
        listColumns(
          database,
          "openMeldRemoteAgent_lark_platform_channel_credentials"
        )
      ).toEqual([
        "connection_id",
        "encrypted_app_secret",
        "encrypted_verification_token",
        "encrypted_event_encrypt_key",
        "credential_format_version",
        "created_at_ms",
        "updated_at_ms",
      ]);
    } finally {
      database.close();
    }
  });

  it("allows Slack, Lark, and Feishu to coexist while enforcing one connection per provider", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);
      database.exec("PRAGMA foreign_keys = OFF");

      insertConnection(database, {
        appId: "cli_lark",
        connectionId: "connection_lark",
        provider: "lark",
      });
      insertConnection(database, {
        appId: "cli_feishu",
        connectionId: "connection_feishu",
        provider: "feishu",
      });
      database
        .prepare(
          `
            INSERT INTO openMeldRemoteAgent_slack_workspace_bindings (
              slack_team_id,
              organization_id,
              created_at_ms,
              updated_at_ms
            )
            VALUES ('team_slack', 'org_123', 1000, 1000)
          `
        )
        .run();
      expect(() =>
        insertConnection(database, {
          appId: "cli_lark_other",
          connectionId: "connection_lark_other",
          provider: "lark",
        })
      ).toThrow(UNIQUE_CONSTRAINT_ERROR_PATTERN);

      expect(
        database
          .prepare(
            "SELECT provider FROM openMeldRemoteAgent_lark_platform_channel_connections ORDER BY provider"
          )
          .all()
      ).toEqual([{ provider: "feishu" }, { provider: "lark" }]);
      expect(
        database
          .prepare(
            "SELECT slack_team_id FROM openMeldRemoteAgent_slack_workspace_bindings WHERE organization_id = 'org_123'"
          )
          .all()
      ).toEqual([{ slack_team_id: "team_slack" }]);
    } finally {
      database.close();
    }
  });

  it("keeps generic ingress payload-free and extends Native Delivery with one typed locator", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applySharedMigrations(database);

      const ingressColumns = listColumns(
        database,
        "openMeldRemoteAgent_message_channel_event_ingress"
      );
      expect(ingressColumns).toEqual(
        expect.arrayContaining([
          "provider",
          "connection_id",
          "provider_event_id",
          "gateway_request_id",
          "native_delivery_id",
          "failure_reason_code",
        ])
      );
      expect(ingressColumns).not.toEqual(
        expect.arrayContaining([
          "message_text",
          "raw_payload_json",
          "access_token",
          "card_token",
        ])
      );

      expect(
        listColumns(database, "openMeldRemoteAgent_native_delivery_ledger")
      ).toEqual(
        expect.arrayContaining([
          "message_channel_provider",
          "message_channel_connection_id",
          "message_channel_locator_json",
          "provider_publication_idempotency_key",
          "provider_publication_result_id",
        ])
      );
    } finally {
      database.close();
    }
  });
});

function insertConnection(
  database: DatabaseSync,
  input: {
    appId: string;
    connectionId: string;
    provider: "lark" | "feishu";
  }
): void {
  database
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (
          connection_id,
          organization_id,
          provider,
          app_id,
          transport,
          status,
          installed_by_user_id,
          permission_bundle_version,
          granted_capability_groups_json,
          connection_generation,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, 'org_123', ?, ?, 'webhook', 'connected', 'user_123', 'channel-v1', '["messages","cards"]', 1, 1000, 1000)
      `
    )
    .run(input.connectionId, input.provider, input.appId);
}
