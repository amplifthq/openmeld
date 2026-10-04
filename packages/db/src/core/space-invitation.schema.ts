import { sql } from "drizzle-orm";
import { bigint, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";
import { integerBoolean } from "../postgresql/schema-types.ts";

// Core owns the Space grant. Better Auth owns the separate Organization invite.
export const spaceInvitations = applicationTable(
  "space_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: text("space_id").notNull(),
    email: text("email").notNull(),
    audience: text("audience", { enum: ["organization", "guest"] })
      .notNull()
      .default("organization"),
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationInvitationId: text("organization_invitation_id"),
    sponsorUserId: text("sponsor_user_id"),
    organizationInvitationOwned: integerBoolean("organization_invitation_owned")
      .notNull()
      .default(sql`0`),
    status: text("status", {
      enum: ["pending", "accepting", "accepted", "revoked"],
    }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("idx_space_invitations_recipient").on(table.email, table.status),
    index("idx_space_invitations_space").on(table.spaceId, table.status),
    uniqueIndex("idx_space_invitations_pending_recipient")
      .on(table.spaceId, table.email)
      .where(sql`${table.status} IN ('pending', 'accepting')`),
  ]
);
