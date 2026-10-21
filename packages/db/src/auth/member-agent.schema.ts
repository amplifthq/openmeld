import { relations, sql } from "drizzle-orm";
import { check, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  applicationTable,
  currentTimestampMilliseconds,
} from "../postgresql/schema.ts";
import { epochMilliseconds } from "../postgresql/schema-types.ts";
import { organizations, users } from "./auth.schema.ts";
import { openMeldProfiles } from "./openmeld-profile.schema.ts";

// Keep aligned with `HARNESS_KINDS` in @openmeld/schemas; a db test checks parity.
export const MEMBER_AGENT_HARNESS_KINDS = [
  "claude-code",
  "codex",
  "grok-build",
  "grok-bot",
  "cursor",
  "opencode",
  "antigravity",
  "openclaw",
  "hosted",
] as const;
export type MemberAgentHarnessKind =
  (typeof MEMBER_AGENT_HARNESS_KINDS)[number];

export const MEMBER_AGENT_SOURCES = ["detected", "migrated", "manual"] as const;
export type MemberAgentSourceValue = (typeof MEMBER_AGENT_SOURCES)[number];

// One organization member's instance of one Harness. Presence and state are
// derived at read time from the Profiles and computers; there is no status.
export const memberAgents = applicationTable(
  "member_agents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    harnessKind: text("harness_kind").$type<MemberAgentHarnessKind>().notNull(),
    // References (id, default_profile_id) -> openmeld_profiles
    // (member_agent_id, profile_id) with ON DELETE SET NULL (default_profile_id).
    // Drizzle cannot express the column-list action, so migration 0039 owns it.
    defaultProfileId: text("default_profile_id"),
    source: text("source").$type<MemberAgentSourceValue>().notNull(),
    archivedAt: epochMilliseconds("archived_at"),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    updatedAt: epochMilliseconds("updated_at")
      .default(currentTimestampMilliseconds)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("member_agents_owner_harness_uq_idx").on(
      table.organizationId,
      table.ownerUserId,
      table.harnessKind
    ),
    index("member_agents_owner_user_id_idx").on(table.ownerUserId),
    // Target of the Profile foreign key that keeps a Profile and its
    // MemberAgent in the same Organization and owner.
    uniqueIndex("member_agents_owner_scope_uq_idx").on(
      table.id,
      table.organizationId,
      table.ownerUserId
    ),
    check(
      "member_agents_id_check",
      sql`length(trim("id")) > 0 and length("id") <= 128`
    ),
    check(
      "member_agents_harness_kind_check",
      sql`"harness_kind" in ('claude-code', 'codex', 'grok-build', 'grok-bot', 'cursor', 'opencode', 'antigravity', 'openclaw', 'hosted')`
    ),
    check(
      "member_agents_source_check",
      sql`"source" in ('detected', 'migrated', 'manual')`
    ),
  ]
);

export const memberAgentsRelations = relations(memberAgents, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberAgents.organizationId],
    references: [organizations.id],
  }),
  owner: one(users, {
    fields: [memberAgents.ownerUserId],
    references: [users.id],
  }),
  defaultProfile: one(openMeldProfiles, {
    fields: [memberAgents.defaultProfileId],
    references: [openMeldProfiles.profileId],
  }),
}));
