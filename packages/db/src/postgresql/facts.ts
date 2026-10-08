import type { DbFactSnapshot } from "@openmeld/schemas/types";
import { buildDbFactSnapshot } from "../diagnostics/fact-builders.ts";

/** Binding presence is a diagnostic observation, not database or Wake readiness. */
export function buildPostgresRuntimeDbFactSnapshot(input: {
  subject: "auth" | "core";
  bindingAvailable: boolean;
}): DbFactSnapshot {
  const bindingName = "OPENMELD_POSTGRESQL";
  return buildDbFactSnapshot({
    subject: input.subject,
    mode: "runtime",
    bindingName,
    schemaSources: [
      {
        kind: "schema_entrypoint",
        owner: "packages/db",
        path: "packages/db/src/schema.ts",
        note: "Shared relational tables use native PostgreSQL schemas; domain authority remains with Auth and Core.",
      },
    ],
    migrationSources: [
      {
        kind: "migration_dir",
        owner: "packages/db",
        path: "packages/db/postgresql/migrations",
        note: "The official Drizzle PostgreSQL journal is independent of preserved D1 history.",
      },
    ],
    target: {
      targetKind: "worker_binding",
      bindingName,
      databaseId: null,
      databaseName: null,
      localPath: null,
      resolvedFrom: input.bindingAvailable
        ? "runtime_binding_present"
        : "runtime_binding_missing",
    },
    // Retained nullable diagnostic field for existing clients.
    d1LocalDbPath: null,
    notes: [
      "Auth and Core share one cache-disabled Hyperdrive PostgreSQL binding. Space Durable Object SQLite and R2 retain their own ownership.",
    ],
  });
}
