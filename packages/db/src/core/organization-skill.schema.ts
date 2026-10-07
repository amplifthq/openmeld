import { desc, sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import {
  applicationTable,
  currentTimestampMilliseconds,
} from "../postgresql/schema.ts";
import {
  epochMilliseconds,
  integerBoolean,
} from "../postgresql/schema-types.ts";

export const organizationSkills = applicationTable(
  "organization_skills",
  {
    activeReleaseId: text("active_release_id").notNull(),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    description: text("description").notNull(),
    enabled: integerBoolean("enabled").default(sql`1`).notNull(),
    id: text("id").primaryKey(),
    maintainerUpdateToken: text("maintainer_update_token"),
    name: text("name").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    removedAt: epochMilliseconds("removed_at"),
    sourceCommitSha: text("source_commit_sha"),
    sourceKind: text("source_kind").notNull(),
    sourcePath: text("source_path"),
    sourceRepository: text("source_repository"),
    updatedAt: epochMilliseconds("updated_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    version: bigint("version", { mode: "number" }).default(1).notNull(),
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

export const organizationSkillReleases = applicationTable(
  "organization_skill_releases",
  {
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
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
      sql`length("digest") = 64 and "digest" !~ '^.*[^a-f0-9].*$'`
    ),
    check(
      "organization_skill_releases_source_kind_check",
      sql`"source_kind" in ('created', 'github')`
    ),
  ]
);

export const organizationSkillMaintainers = applicationTable(
  "organization_skill_maintainers",
  {
    assignedAt: epochMilliseconds("assigned_at")
      .default(currentTimestampMilliseconds)
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

export const organizationSkillActivations = applicationTable(
  "organization_skill_activations",
  {
    activatedAt: epochMilliseconds("activated_at")
      .default(currentTimestampMilliseconds)
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
      sql`length("digest") = 64 and "digest" !~ '^.*[^a-f0-9].*$'`
    ),
  ]
);

export const centerAgentOrganizationSkillOperations = applicationTable(
  "center_agent_organization_skill_operations",
  {
    completedAt: epochMilliseconds("completed_at"),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
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

export const organizationSkillImportOperations = applicationTable(
  "organization_skill_import_operations",
  {
    completedAt: epochMilliseconds("completed_at"),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
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
      name: "organization_skill_import_operations_pk",
    }),
    check(
      "organization_skill_import_operations_completion_check",
      sql`("completed_at" is null and "response_json" is null) or ("completed_at" is not null and "response_json" is not null)`
    ),
  ]
);

export const organizationSkillImportBatches = applicationTable(
  "organization_skill_import_batches",
  {
    batchId: text("batch_id").notNull(),
    commitSha: text("commit_sha").notNull(),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull(),
    previewJson: text("preview_json").notNull(),
    repository: text("repository").notNull(),
    resultsJson: text("results_json").notNull(),
    sourceUrl: text("source_url").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.batchId],
      name: "organization_skill_import_batches_pk",
    }),
  ]
);
