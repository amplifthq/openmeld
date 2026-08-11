import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

export const organizationSkills = sqliteTable(
  "organization_skills",
  {
    activeReleaseId: text("active_release_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    description: text("description").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    id: text("id").primaryKey(),
    maintainerUpdateToken: text("maintainer_update_token"),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    removedAt: integer("removed_at", { mode: "timestamp_ms" }),
    sourceCommitSha: text("source_commit_sha"),
    sourceKind: text("source_kind").notNull(),
    sourcePath: text("source_path"),
    sourceRepository: text("source_repository"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    version: integer("version").default(1).notNull(),
  },
  (table) => [
    uniqueIndex("organization_skills_org_name_active_unique")
      .on(table.organizationId, table.name)
      .where(sql`"removed_at" is null`),
    index("organization_skills_org_updated_idx").on(
      table.organizationId,
      desc(table.updatedAt)
    ),
    check(
      "organization_skills_source_kind_check",
      sql`"source_kind" in ('created', 'github')`
    ),
    check(
      "organization_skills_source_shape_check",
      sql`("source_kind" = 'created' and "source_repository" is null and "source_path" is null and "source_commit_sha" is null) or ("source_kind" = 'github' and "source_repository" is not null and "source_path" is not null and "source_commit_sha" is not null)`
    ),
    check("organization_skills_version_check", sql`"version" >= 1`),
    check(
      "organization_skills_updated_at_check",
      sql`"updated_at" >= "created_at"`
    ),
  ]
);

export const organizationSkillReleases = sqliteTable(
  "organization_skill_releases",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    digest: text("digest").notNull(),
    id: text("id").primaryKey(),
    manifestJson: text("manifest_json").notNull(),
    objectKey: text("object_key").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => organizationSkills.id, { onDelete: "cascade" }),
    sourceCommitSha: text("source_commit_sha"),
    sourceKind: text("source_kind").notNull(),
    sourcePath: text("source_path"),
    sourceRepository: text("source_repository"),
  },
  (table) => [
    uniqueIndex("organization_skill_releases_object_key_unique").on(
      table.objectKey
    ),
    index("organization_skill_releases_skill_created_idx").on(
      table.skillId,
      desc(table.createdAt)
    ),
    check(
      "organization_skill_releases_digest_check",
      sql`length("digest") = 64 and "digest" not glob '*[^a-f0-9]*'`
    ),
    check(
      "organization_skill_releases_source_kind_check",
      sql`"source_kind" in ('created', 'github')`
    ),
  ]
);

export const organizationSkillMaintainers = sqliteTable(
  "organization_skill_maintainers",
  {
    assignedAt: integer("assigned_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    assignedByUserId: text("assigned_by_user_id")
      .notNull()
      .references(() => users.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => organizationSkills.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({
      columns: [table.skillId, table.userId],
      name: "organization_skill_maintainers_pk",
    }),
    index("organization_skill_maintainers_org_user_idx").on(
      table.organizationId,
      table.userId
    ),
  ]
);

export const organizationSkillActivations = sqliteTable(
  "organization_skill_activations",
  {
    activatedAt: integer("activated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    digest: text("digest").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    releaseId: text("release_id")
      .notNull()
      .references(() => organizationSkillReleases.id),
    routineRunId: text("routine_run_id"),
    skillId: text("skill_id")
      .notNull()
      .references(() => organizationSkills.id),
    submissionId: text("submission_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.organizationId,
        table.submissionId,
        table.skillId,
        table.releaseId,
      ],
      name: "organization_skill_activations_pk",
    }),
    index("organization_skill_activations_skill_time_idx").on(
      table.organizationId,
      table.skillId,
      desc(table.activatedAt)
    ),
    check(
      "organization_skill_activations_digest_check",
      sql`length("digest") = 64 and "digest" not glob '*[^a-f0-9]*'`
    ),
  ]
);

export const centerAgentOrganizationSkillOperations = sqliteTable(
  "center_agent_organization_skill_operations",
  {
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    operationId: text("operation_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestSignature: text("request_signature").notNull(),
    responseJson: text("response_json"),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.operationId],
      name: "center_agent_organization_skill_operations_pk",
    }),
    check(
      "center_agent_organization_skill_operations_completion_check",
      sql`("completed_at" is null and "response_json" is null) or ("completed_at" is not null and "response_json" is not null)`
    ),
  ]
);
