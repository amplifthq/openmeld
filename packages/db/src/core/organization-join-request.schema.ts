import { sql } from "drizzle-orm";
import { bigint, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

// Core owns the decision. Better Auth remains the only membership writer.
export const organizationJoinRequests = applicationTable(
  "organization_join_requests",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: text("space_id"),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    applicantUserId: text("applicant_user_id").references(() => users.id),
    joinedAt: bigint("joined_at", { mode: "number" }),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "cancelled"],
    }).notNull(),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    reviewedAt: bigint("reviewed_at", { mode: "number" }),
    invitationSentAt: bigint("invitation_sent_at", { mode: "number" }),
  },
  (table) => [
    index("organization_join_requests_review_idx").on(
      table.organizationId,
      table.status
    ),
    index("organization_join_requests_requester_idx").on(
      table.requestedByUserId,
      table.status
    ),
    uniqueIndex("organization_join_requests_pending_recipient_uidx")
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'pending' AND ${table.spaceId} IS NULL`),
    uniqueIndex("organization_join_requests_pending_space_recipient_uidx")
      .on(table.organizationId, table.spaceId, table.email)
      .where(sql`${table.status} = 'pending' AND ${table.spaceId} IS NOT NULL`),
  ]
);
