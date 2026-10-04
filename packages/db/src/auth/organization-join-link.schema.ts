import { relations, sql } from "drizzle-orm";
import { index, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  applicationTable,
  currentTimestampMilliseconds,
} from "../postgresql/schema.ts";
import { epochMilliseconds } from "../postgresql/schema-types.ts";
import { organizations, users } from "./auth.schema.ts";

export const ORGANIZATION_JOIN_LINK_ROLES = ["member"] as const;
export type OrganizationJoinLinkRole =
  (typeof ORGANIZATION_JOIN_LINK_ROLES)[number];

export const organizationJoinLinks = applicationTable(
  "organization_join_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    mode: text("mode", { enum: ["direct", "request"] })
      .notNull()
      .default("request"),
    expiresAt: epochMilliseconds("expires_at"),
    spaceId: text("space_id"),
    role: text("role")
      .$type<OrganizationJoinLinkRole>()
      .default("member")
      .notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    revokedAt: epochMilliseconds("revoked_at"),
  },
  (table) => [
    uniqueIndex("organization_join_links_token_uidx").on(table.token),
    uniqueIndex("organization_join_links_active_organization_uidx")
      .on(table.organizationId, table.mode)
      .where(sql`"revoked_at" is null AND "space_id" is null`),
    uniqueIndex("organization_join_links_active_space_uidx")
      .on(table.organizationId, table.spaceId, table.mode)
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
