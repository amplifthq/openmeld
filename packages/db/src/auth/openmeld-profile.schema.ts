import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  applicationTable,
  currentTimestampMilliseconds,
} from "../postgresql/schema.ts";
import {
  epochMilliseconds,
  integerBoolean,
} from "../postgresql/schema-types.ts";
import { organizations, users } from "./auth.schema.ts";
import { memberAgents } from "./member-agent.schema.ts";

export const OPENMELD_PROFILE_KINDS = ["human", "agent", "system"] as const;
export type OpenMeldProfileKind = (typeof OPENMELD_PROFILE_KINDS)[number];

export const OPENMELD_PROFILE_SOURCES = [
  "auth_bootstrap",
  "web_create",
  "cli_create",
  "local_agent_create",
  "center_agent_create",
  "migration",
  "auto_detected",
] as const;
export type OpenMeldProfileSource = (typeof OPENMELD_PROFILE_SOURCES)[number];

export const OPENMELD_PROFILE_MANAGED_ROLES = [
  "openmeld_assistant",
  "center_agent",
] as const;
export type OpenMeldProfileManagedRole =
  (typeof OPENMELD_PROFILE_MANAGED_ROLES)[number];

export const OPENMELD_PROFILE_STATUSES = ["active", "disabled"] as const;
export type OpenMeldProfileStatus = (typeof OPENMELD_PROFILE_STATUSES)[number];

const buildUuidConstraintSql = (expression: string): string =>
  [
    `length(${expression}) = 36`,
    `${expression} !~ '^.*[^0-9a-f-].*$'`,
    `length(replace(${expression}, '-', '')) = 32`,
    `substr(${expression}, 9, 1) = '-'`,
    `substr(${expression}, 14, 1) = '-'`,
    `substr(${expression}, 19, 1) = '-'`,
    `substr(${expression}, 24, 1) = '-'`,
  ].join(" and ");

const UUID_PROFILE_ID_SQL = buildUuidConstraintSql(`"profile_id"`);
const AGENT_PROFILE_ID_SQL = [
  `length("profile_id") = 40`,
  `substr("profile_id", 1, 4) = 'agt_'`,
  buildUuidConstraintSql(`substr("profile_id", 5)`),
].join(" and ");

export const openMeldProfiles = applicationTable(
  "openmeld_profiles",
  {
    profileId: text("profile_id").primaryKey(),
    profileName: text("profile_name").notNull(),
    profileHandle: text("profile_handle").notNull(),
    profileKind: text("profile_kind").$type<OpenMeldProfileKind>().notNull(),
    isDefault: integerBoolean("is_default").notNull().default(sql`0`),
    status: text("status")
      .$type<OpenMeldProfileStatus>()
      .notNull()
      .default("active"),
    organizationId: text("organization_id")
      .references(() => organizations.id, {
        onDelete: "cascade",
      })
      .default(sql`null`),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    creatorProfileId: text("creator_profile_id"),
    creationActorProfileId: text("creation_actor_profile_id"),
    source: text("source").$type<OpenMeldProfileSource>().notNull(),
    managedRole: text("managed_role").$type<OpenMeldProfileManagedRole>(),
    creationIdempotencyKey: text("creation_idempotency_key"),
    // The MemberAgent this Profile belongs to; null while unassigned.
    memberAgentId: text("member_agent_id"),
    defaultProjectId: text("default_project_id"),
    defaultProjectRevision: integer("default_project_revision"),
    avatarStyle: text("avatar_style"),
    avatarOptions: jsonb("avatar_options").$type<{
      palette?: "original" | "balanced" | "soft";
      color?: "sage" | "sky" | "lavender" | "rose" | "amber" | "clay";
      imageUrl?: string;
    }>(),
    lastUsedAt: epochMilliseconds("last_used_at"),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    updatedAt: epochMilliseconds("updated_at")
      .default(currentTimestampMilliseconds)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      "openmeld_profiles_default_project_revision_check",
      sql`${table.defaultProjectRevision} is null or ${table.defaultProjectRevision} >= 0`
    ),
    index("openmeld_profiles_owner_user_id_idx").on(table.ownerUserId),
    index("openmeld_profiles_owner_kind_idx").on(
      table.ownerUserId,
      table.profileKind
    ),
    index("openmeld_profiles_organization_kind_idx").on(
      table.organizationId,
      table.profileKind
    ),
    uniqueIndex("openmeld_profiles_owner_handle_uq_idx").on(
      table.ownerUserId,
      table.profileHandle
    ),
    index("openmeld_profiles_owner_default_idx").on(
      table.ownerUserId,
      table.isDefault
    ),
    uniqueIndex("openmeld_profiles_owner_default_human_uq_idx")
      .on(table.ownerUserId)
      .where(sql`"profile_kind" = 'human' and "is_default" = 1`),
    uniqueIndex("openmeld_profiles_owner_managed_role_uq_idx")
      .on(table.ownerUserId, table.managedRole)
      .where(
        sql`"managed_role" is not null and "managed_role" != 'center_agent' and "status" = 'active'`
      ),
    uniqueIndex("openmeld_profiles_org_center_agent_uq_idx")
      .on(table.organizationId, table.managedRole)
      .where(sql`"managed_role" = 'center_agent' and "status" = 'active'`),
    uniqueIndex("openmeld_profiles_owner_creation_idempotency_uq_idx")
      .on(table.ownerUserId, table.creationIdempotencyKey)
      .where(sql`"creation_idempotency_key" is not null`),
    index("openmeld_profiles_owner_status_idx").on(
      table.ownerUserId,
      table.status
    ),
    // Lists a MemberAgent's Profiles and is the target of the MemberAgent
    // default-Profile reference (migration 0039).
    uniqueIndex("openmeld_profiles_member_agent_profile_uq_idx").on(
      table.memberAgentId,
      table.profileId
    ),
    // A Profile and its MemberAgent always share Organization and owner.
    foreignKey({
      name: "openmeld_profiles_member_agent_fk",
      columns: [table.memberAgentId, table.organizationId, table.ownerUserId],
      foreignColumns: [
        memberAgents.id,
        memberAgents.organizationId,
        memberAgents.ownerUserId,
      ],
    }),
    check(
      "openmeld_profiles_member_agent_check",
      sql`"member_agent_id" is null or ("profile_kind" = 'agent' and "managed_role" is null and "organization_id" is not null and "owner_user_id" is not null)`
    ),
    check(
      "openmeld_profiles_profile_kind_check",
      sql`"profile_kind" in ('human', 'agent', 'system')`
    ),
    check(
      "openmeld_profiles_status_check",
      sql`"status" in ('active', 'disabled')`
    ),
    check(
      "openmeld_profiles_source_check",
      sql`"source" in ('auth_bootstrap', 'web_create', 'cli_create', 'local_agent_create', 'center_agent_create', 'migration', 'auto_detected')`
    ),
    check(
      "openmeld_profiles_ownership_check",
      sql`("managed_role" = 'center_agent' and "organization_id" is not null and "owner_user_id" is null) or (coalesce("managed_role", '') != 'center_agent' and "owner_user_id" is not null)`
    ),
    check(
      "openmeld_profiles_managed_role_check",
      sql`"managed_role" is null or ("profile_kind" = 'agent' and "managed_role" in ('openmeld_assistant', 'center_agent'))`
    ),
    check(
      "openmeld_profiles_default_project_check",
      sql`"default_project_id" is null or (length(trim("default_project_id")) > 0 and "profile_kind" = 'agent' and "managed_role" is null and "organization_id" is not null)`
    ),
    check(
      "openmeld_profiles_default_profile_check",
      sql`"is_default" = 0 or "profile_kind" = 'human'`
    ),
    check(
      "openmeld_profiles_profile_handle_check",
      sql`length(trim("profile_handle")) > 0 and "profile_handle" !~ '^.*[^A-Za-z0-9._-].*$' and substr(trim("profile_handle"), 1, 1) ~ '^[A-Za-z0-9]$' and length(trim("profile_handle")) <= 128`
    ),
    check(
      "openmeld_profiles_profile_id_format_check",
      sql.raw(
        `( ("profile_kind" = 'agent' and ${AGENT_PROFILE_ID_SQL}) or ("profile_kind" in ('human', 'system') and ${UUID_PROFILE_ID_SQL}) )`
      )
    ),
    check(
      "openmeld_profiles_organization_profile_kind_check",
      sql`(("profile_kind" = 'agent' and "organization_id" is not null) or ("profile_kind" in ('human', 'system') and "organization_id" is null))`
    ),
  ]
);

export const openMeldProfilesRelations = relations(
  openMeldProfiles,
  ({ one }) => ({
    owner: one(users, {
      fields: [openMeldProfiles.ownerUserId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [openMeldProfiles.organizationId],
      references: [organizations.id],
    }),
    createdBy: one(users, {
      fields: [openMeldProfiles.createdByUserId],
      references: [users.id],
    }),
    memberAgent: one(memberAgents, {
      fields: [openMeldProfiles.memberAgentId],
      references: [memberAgents.id],
    }),
  })
);
