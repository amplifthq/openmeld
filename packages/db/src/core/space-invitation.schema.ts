import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "../auth/auth.schema.ts";

// Core owns the Space grant. Better Auth owns the separate Organization invite.
export const spaceInvitations = sqliteTable(
  "space_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    email: text("email").notNull(),
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationInvitationId: text("organization_invitation_id"),
    organizationInvitationOwned: integer("organization_invitation_owned", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    status: text("status", {
      enum: ["pending", "accepting", "accepted", "revoked"],
    }).notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("idx_space_invitations_recipient").on(table.email, table.status),
    index("idx_space_invitations_space").on(table.spaceId, table.status),
    uniqueIndex("idx_space_invitations_pending_recipient")
      .on(table.spaceId, table.email)
      .where(sql`${table.status} IN ('pending', 'accepting')`),
  ]
);
