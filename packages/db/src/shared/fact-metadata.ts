import type { DbFactSource } from "@openmeld/schemas/types";
import {
  AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
  AUTH_DB_BINDING_NAME,
  AUTH_DB_DRIZZLE_CONFIG_PATH,
  AUTH_DB_MIGRATIONS_PATH,
  AUTH_DB_SCHEMA_ENTRYPOINT_PATH,
  AUTH_DB_SCHEMA_GLOB_PATH,
} from "../auth/fact-metadata.ts";
import {
  CORE_AGENT_PROFILE_CREATION_REQUEST_SCHEMA_DEFINITION_PATH,
  CORE_CENTER_AGENT_ORGANIZATION_DOCUMENT_OPERATION_SCHEMA_DEFINITION_PATH,
  CORE_CENTER_AGENT_PUBLICATION_SCHEMA_DEFINITION_PATH,
  CORE_CENTER_AGENT_TASKS_SCHEMA_DEFINITION_PATH,
  CORE_DB_SCHEMA_DEFINITION_PATH,
  CORE_EVAL_REPORT_SCHEMA_DEFINITION_PATH,
  CORE_FEEDBACK_SCHEMA_DEFINITION_PATH,
  CORE_OPPORTUNITY_SCHEMA_DEFINITION_PATH,
  CORE_ORGANIZATION_DOCUMENT_SCHEMA_DEFINITION_PATH,
  CORE_PROJECT_SCHEMA_DEFINITION_PATH,
  CORE_ROUTINE_SCHEMA_DEFINITION_PATH,
  CORE_SPACE_ATTACHMENT_SCHEMA_DEFINITION_PATH,
  CORE_SPACE_INDEX_SCHEMA_DEFINITION_PATH,
  CORE_SPACE_TASK_GITHUB_SCHEMA_DEFINITION_PATH,
} from "../core/fact-metadata.ts";
import { getDiagnosticsDbSchemaSources } from "../diagnostics/fact-metadata.ts";

export const SHARED_DB_BINDING_NAME = AUTH_DB_BINDING_NAME;
export const SHARED_DB_DATABASE_ID = "15f16284-5240-4675-b626-3b7144e1d684";
export const SHARED_DB_DATABASE_NAME = "openmeld-db-prod";

/**
 * Highest `d1_migrations.id` a fully migrated shared OPENMELD_DB reports. Drizzle
 * applies migrations 1-indexed, so this equals the drizzle journal entry count.
 * Keep in sync with packages/db/drizzle/meta/_journal.json; the shared migration
 * history integrity test guards the two against drift.
 */
export const LATEST_SHARED_MIGRATION_ID = 193;
export const SHARED_DB_SCHEMA_ENTRYPOINT_PATH = "packages/db/src/schema.ts";
export const SHARED_DB_RELEASE_NOTES = [
  "Root db:* commands now report the shared OPENMELD_DB schema and migration contract instead of an auth-only view.",
  "Active drizzle tooling input now targets the shared packages/db schema entrypoint.",
  "Shared db:migrate now maps directly to Wrangler D1 migration apply, while shared db:verify runs the legacy-shape and physical-contract checks as an explicit follow-up step.",
  "Runtime DB diagnostics now report only the current OPENMELD_DB binding availability instead of assuming a canonical runtime database identity.",
  "Diagnostics now has a logical OPENMELD_DIAGNOSTICS_DB domain that is currently co-located in the shared OPENMELD_DB aggregate.",
] as const;

export const getSharedDbSchemaSources = (): DbFactSource[] => {
  return [
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_AGENT_PROFILE_CREATION_REQUEST_SCHEMA_DEFINITION_PATH,
      note: "Core-owned Agent Profile creation requests and member approval preferences are part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_ORGANIZATION_DOCUMENT_SCHEMA_DEFINITION_PATH,
      note: "Core-owned Organization Documents and draft review state are part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_CENTER_AGENT_ORGANIZATION_DOCUMENT_OPERATION_SCHEMA_DEFINITION_PATH,
      note: "Core-owned idempotency records make Center Agent document mutations safe to retry.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_CENTER_AGENT_PUBLICATION_SCHEMA_DEFINITION_PATH,
      note: "Core-owned publication claims prevent duplicate Center Agent external writes.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_CENTER_AGENT_TASKS_SCHEMA_DEFINITION_PATH,
      note: "Retired Center Agent Task tables remain in the physical aggregate for deployment ordering only; active Task code has been removed.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_OPPORTUNITY_SCHEMA_DEFINITION_PATH,
      note: "Core-owned recipient-private Opportunities and member decisions are part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "shared_schema_entrypoint",
      owner: "packages/db",
      path: SHARED_DB_SCHEMA_ENTRYPOINT_PATH,
      note: "The active drizzle gate now reads the whole shared OPENMELD_DB schema from this aggregate entrypoint.",
    },
    {
      kind: "auth_schema_entrypoint",
      owner: "packages/db",
      path: AUTH_DB_SCHEMA_ENTRYPOINT_PATH,
      note: "Auth schema truth remains part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "auth_schema_glob",
      owner: "packages/db",
      path: AUTH_DB_SCHEMA_GLOB_PATH,
      note: "Auth schema files stay discoverable through the canonical packages/db glob.",
    },
    {
      kind: "generated_auth_schema",
      owner: "packages/db",
      path: AUTH_DB_BETTER_AUTH_GENERATED_SCHEMA_PATH,
      note: "Better Auth still generates the canonical auth schema output into packages/db.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_DB_SCHEMA_DEFINITION_PATH,
      note: "Core dispatch schema truth is part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_EVAL_REPORT_SCHEMA_DEFINITION_PATH,
      note: "Core-owned weekly Organization eval reports are rebuildable projections in the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_SPACE_INDEX_SCHEMA_DEFINITION_PATH,
      note: "Core Space Index projection schema is part of the shared OPENMELD_DB aggregate until the logical binding is moved to a physical Core DB.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_SPACE_ATTACHMENT_SCHEMA_DEFINITION_PATH,
      note: "Core-owned Space attachment metadata is part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_SPACE_TASK_GITHUB_SCHEMA_DEFINITION_PATH,
      note: "Linked GitHub issue lookup and GitHub App webhook delivery ledger are Core-owned query projections in the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_FEEDBACK_SCHEMA_DEFINITION_PATH,
      note: "Core-owned Feedback Inbox, Feedback Issue, and Feedback reporting policy truth is part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_PROJECT_SCHEMA_DEFINITION_PATH,
      note: "Core-owned Organization Project truth is part of the shared OPENMELD_DB aggregate.",
    },
    {
      kind: "core_schema_module",
      owner: "packages/db",
      path: CORE_ROUTINE_SCHEMA_DEFINITION_PATH,
      note: "Core-owned Organization Routine definitions and Run history are part of the shared OPENMELD_DB aggregate.",
    },
    ...getDiagnosticsDbSchemaSources(),
    {
      kind: "drizzle_config",
      owner: "packages/db",
      path: AUTH_DB_DRIZZLE_CONFIG_PATH,
      note: "Root db:* commands and CI now reuse this shared drizzle config.",
    },
  ];
};

export const getSharedDbMigrationSources = (): DbFactSource[] => {
  return [
    {
      kind: "migration_dir",
      owner: "packages/db",
      path: AUTH_DB_MIGRATIONS_PATH,
      note: "The shared OPENMELD_DB migration history lives in packages/db/drizzle.",
    },
  ];
};
