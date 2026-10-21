import { sql } from "drizzle-orm";
import { bigint, check, index, text } from "drizzle-orm/pg-core";
import { organizations, users } from "../auth/auth.schema.ts";
import { openMeldProfiles } from "../auth/openmeld-profile.schema.ts";
import { applicationTable } from "../postgresql/schema.ts";

/**
 * Core-bound confirmation evidence for a Center Agent permission-mode change
 * (developing/product/organizations-and-center-agent.md, MemberAgent
 * management operations). Core issues one in the turn that asks for the
 * change and accepts it only from a later turn of the same member, for the
 * same Agent Profile and mode. Only the token hash is stored.
 */
export const centerAgentPermissionModeConfirmations = applicationTable(
  "center_agent_permission_mode_confirmations",
  {
    tokenHash: text("token_hash").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorProfileId: text("actor_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    representedUserId: text("represented_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    representedProfileId: text("represented_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    agentProfileId: text("agent_profile_id")
      .notNull()
      .references(() => openMeldProfiles.profileId, { onDelete: "cascade" }),
    agentControllerPermissionMode: text(
      "agent_controller_permission_mode"
    ).notNull(),
    issuedNativeDeliveryId: text("issued_native_delivery_id").notNull(),
    expiresAtMs: bigint("expires_at_ms", { mode: "number" }).notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
    consumedAtMs: bigint("consumed_at_ms", { mode: "number" }),
    consumedNativeDeliveryId: text("consumed_native_delivery_id"),
  },
  (table) => [
    index("center_agent_permission_mode_confirmations_org_expiry_idx").on(
      table.organizationId,
      table.expiresAtMs
    ),
    index("center_agent_permission_mode_confirmations_profile_idx").on(
      table.agentProfileId
    ),
    check(
      "center_agent_permission_mode_confirmations_token_shape_check",
      sql`length("token_hash") = 64
        and "token_hash" !~ '^.*[^0-9a-f].*$'`
    ),
    check(
      "center_agent_permission_mode_confirmations_identity_check",
      sql`length(trim("agent_controller_permission_mode")) > 0
        and length(trim("issued_native_delivery_id")) > 0`
    ),
    check(
      "center_agent_permission_mode_confirmations_expiry_check",
      sql`"expires_at_ms" > "created_at_ms"`
    ),
    check(
      "center_agent_permission_mode_confirmations_consumed_check",
      sql`(
        "consumed_at_ms" is null and "consumed_native_delivery_id" is null
      ) or (
        "consumed_at_ms" is not null
        and "consumed_native_delivery_id" is not null
        and "consumed_native_delivery_id" <> "issued_native_delivery_id"
      )`
    ),
  ]
);
