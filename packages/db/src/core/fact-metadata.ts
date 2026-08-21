import type { DbFactSource } from "@openmeld/schemas/types";

export const CORE_DB_BINDING_NAME = "OPENMELD_DB" as const;
export const CORE_DB_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/dispatch.schema.ts";
export const CORE_SPACE_INDEX_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/space-index.schema.ts";
export const CORE_SPACE_ATTACHMENT_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/space-attachment.schema.ts";
export const CORE_FEEDBACK_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/feedback.schema.ts";
export const CORE_INBOX_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/inbox.schema.ts";
export const CORE_CONNECTOR_CONNECTION_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/connector-connection.schema.ts";
export const CORE_CENTER_AGENT_MEMBER_RESEARCH_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/center-agent-member-research.schema.ts";
export const CORE_CENTER_AGENT_TASKS_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/center-agent-tasks.schema.ts";
export const CORE_ROUTINE_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/routine.schema.ts";
export const CORE_PROJECT_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/project.schema.ts";
export const CORE_ORGANIZATION_DOCUMENT_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/organization-document.schema.ts";
export const CORE_CENTER_AGENT_ORGANIZATION_DOCUMENT_OPERATION_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/organization-document-operation.schema.ts";
export const CORE_CENTER_AGENT_PUBLICATION_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/center-agent-publication.schema.ts";
export const CORE_ORGANIZATION_INFORMATION_PROTECTION_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/organization-information-protection.schema.ts";
export const CORE_ORGANIZATION_MEMBER_ACTIVITY_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/organization-member-activity.schema.ts";
export const CORE_OPPORTUNITY_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/opportunity.schema.ts";
export const CORE_AGENT_ACTIVITY_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/agent-activity.schema.ts";
export const CORE_AGENT_PROFILE_CREATION_REQUEST_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/agent-profile-creation-request.schema.ts";
export const CORE_EVAL_REPORT_SCHEMA_DEFINITION_PATH =
  "packages/db/src/core/eval-report.schema.ts";
export const CORE_DB_MIGRATIONS_PATH = "packages/db/drizzle";

export const CORE_DB_RELEASE_NOTES = [
  "Core D1 canonical schema truth now lives in packages/db and runs through the shared migration history.",
  "Space Durable Object SQLite stays outside the shared OPENMELD_DB release gate.",
] as const;

export const getCoreDbSchemaSources = (): DbFactSource[] => {
  return [
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_AGENT_PROFILE_CREATION_REQUEST_SCHEMA_DEFINITION_PATH,
      note: "Core owns Agent Profile creation requests and member approval preferences in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_OPPORTUNITY_SCHEMA_DEFINITION_PATH,
      note: "Core owns recipient-private Organization Opportunity decisions and their source provenance in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_INBOX_SCHEMA_DEFINITION_PATH,
      note: "Core owns member-private Inbox items, account notification preferences, and durable email delivery attempts in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_ORGANIZATION_MEMBER_ACTIVITY_SCHEMA_DEFINITION_PATH,
      note: "Core owns the Organization-scoped last Human activity projection derived only from accepted Human-authored text Signals.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_ORGANIZATION_INFORMATION_PROTECTION_SCHEMA_DEFINITION_PATH,
      note: "Core owns the admin-managed Organization information protection policy in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_CENTER_AGENT_TASKS_SCHEMA_DEFINITION_PATH,
      note: "Core owns requester-private Center Agent Task containers, execution attempts, and safe visible activity in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_CENTER_AGENT_MEMBER_RESEARCH_SCHEMA_DEFINITION_PATH,
      note: "Core owns Center Agent member research batch and task orchestration in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_ORGANIZATION_DOCUMENT_SCHEMA_DEFINITION_PATH,
      note: "Core owns Organization Documents and pending Center Agent drafts in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_CENTER_AGENT_ORGANIZATION_DOCUMENT_OPERATION_SCHEMA_DEFINITION_PATH,
      note: "Core owns idempotent Center Agent document mutation records in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_CENTER_AGENT_PUBLICATION_SCHEMA_DEFINITION_PATH,
      note: "Core owns fenced Center Agent publication operations in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_EVAL_REPORT_SCHEMA_DEFINITION_PATH,
      note: "Core owns the rebuildable Organization-scoped weekly eval report projection.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_AGENT_ACTIVITY_SCHEMA_DEFINITION_PATH,
      note: "Core owns append-only Agent Activity evidence, current session projections, digests, daily aggregates, and authority-written execution links.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_PROJECT_SCHEMA_DEFINITION_PATH,
      note: "Core owns Organization Project definitions used by Agent Activity opt-in.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_ROUTINE_SCHEMA_DEFINITION_PATH,
      note: "Core owns Organization Routine definitions and durable Run history in shared D1.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_CONNECTOR_CONNECTION_SCHEMA_DEFINITION_PATH,
      note: "Connector connection ownership is Core-owned and migrates through the shared OPENMELD_DB history.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_DB_SCHEMA_DEFINITION_PATH,
      note: "Core D1 canonical schema definitions now live in packages/db.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_SPACE_INDEX_SCHEMA_DEFINITION_PATH,
      note: "Space Index projection schema is Core-owned and currently migrates through the shared OPENMELD_DB history.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_SPACE_ATTACHMENT_SCHEMA_DEFINITION_PATH,
      note: "Space attachment metadata is Core-owned and migrates through the shared OPENMELD_DB history.",
    },
    {
      kind: "schema_module",
      owner: "packages/db",
      path: CORE_FEEDBACK_SCHEMA_DEFINITION_PATH,
      note: "Feedback Inbox, Feedback Issue, and Feedback reporting policy truth is Core-owned and migrates through the shared OPENMELD_DB history.",
    },
  ];
};

export const getCoreDbMigrationSources = (): DbFactSource[] => {
  return [
    {
      kind: "migration_dir",
      owner: "packages/db",
      path: CORE_DB_MIGRATIONS_PATH,
      note: "Core now participates in the shared OPENMELD_DB migration history under packages/db/drizzle.",
    },
  ];
};
