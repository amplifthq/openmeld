import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "./auth.schema.ts";

export const ORGANIZATION_JOIN_LINK_ROLES = ["member"] as const;
export type OrganizationJoinLinkRole =
  (typeof ORGANIZATION_JOIN_LINK_ROLES)[number];

export const organizationJoinLinks = sqliteTable(
  "organization_join_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    spaceId: text("space_id"),
    role: text("role")
      .$type<OrganizationJoinLinkRole>()
      .default("member")
      .notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("organization_join_links_token_uidx").on(table.token),
    uniqueIndex("organization_join_links_active_organization_uidx")
      .on(table.organizationId)
      .where(sql`"revoked_at" is null AND "space_id" is null`),
    uniqueIndex("organization_join_links_active_space_uidx")
      .on(table.organizationId, table.spaceId)
      .where(sql`"revoked_at" is null AND "space_id" is not null`),
    index("organization_join_links_created_by_idx").on(table.createdBy),
  ]
);

export const organizationJoinLinksRelations = relations(
  organizationJoinLinks,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationJoinLinks.organizationId],
      references: [organizations.id],
    }),
    creator: one(users, {
      fields: [organizationJoinLinks.createdBy],
      references: [users.id],
    }),
  })
);
