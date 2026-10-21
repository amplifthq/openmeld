import { relations, sql } from "drizzle-orm";
import { bigint, index, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  applicationTable,
  currentTimestampMilliseconds,
} from "../postgresql/schema.ts";
import {
  epochMilliseconds,
  integerBoolean,
} from "../postgresql/schema-types.ts";

export const users = applicationTable("users", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integerBoolean("email_verified").default(sql`0`).notNull(),
  image: text("image"),
  createdAt: epochMilliseconds("created_at")
    .default(currentTimestampMilliseconds)
    .notNull(),
  updatedAt: epochMilliseconds("updated_at")
    .default(currentTimestampMilliseconds)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  normalizedEmail: text("normalized_email").unique(),
  lastSelectedOrganizationId: text("last_selected_organization_id"),
  // Retain a non-login reference for shared work; credentials and PII are erased.
  deletedAt: epochMilliseconds("deleted_at"),
});

export const sessions = applicationTable(
  "sessions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    expiresAt: epochMilliseconds("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    updatedAt: epochMilliseconds("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
    cliCredentialAt: epochMilliseconds("cli_credential_at"),
  },
  (table) => [index("sessions_userId_idx").on(table.userId)]
);

export const accounts = applicationTable(
  "accounts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: epochMilliseconds("access_token_expires_at"),
    refreshTokenExpiresAt: epochMilliseconds("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    updatedAt: epochMilliseconds("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("accounts_userId_idx").on(table.userId)]
);

export const verifications = applicationTable(
  "verifications",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: epochMilliseconds("expires_at").notNull(),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    updatedAt: epochMilliseconds("updated_at")
      .default(currentTimestampMilliseconds)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)]
);

export const organizations = applicationTable(
  "organizations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: epochMilliseconds("created_at").notNull(),
    metadata: text("metadata"),
    createdByUserId: text("created_by_user_id"),
    deletionRequestedAt: epochMilliseconds("deletion_requested_at"),
  },
  (table) => [
    uniqueIndex("organizations_slug_uidx").on(table.slug),
    uniqueIndex("organizations_personal_created_by_user_uidx")
      .on(table.createdByUserId)
      .where(
        sql`${table.createdByUserId} is not null and case when (${table.metadata} is json) then (${table.metadata})::jsonb -> 'personal' in ('true'::jsonb, '1'::jsonb) else false end`
      ),
  ]
);

export const members = applicationTable(
  "members",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: epochMilliseconds("created_at").notNull(),
  },
  (table) => [
    index("members_organizationId_idx").on(table.organizationId),
    index("members_userId_idx").on(table.userId),
  ]
);

export const invitations = applicationTable(
  "invitations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: epochMilliseconds("expires_at").notNull(),
    createdAt: epochMilliseconds("created_at")
      .default(currentTimestampMilliseconds)
      .notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitations_organizationId_idx").on(table.organizationId),
    index("invitations_email_idx").on(table.email),
  ]
);

export const deviceCodes = applicationTable("device_codes", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  userId: text("user_id"),
  expiresAt: epochMilliseconds("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: epochMilliseconds("last_polled_at"),
  pollingInterval: bigint("polling_interval", { mode: "number" }),
  clientId: text("client_id"),
  scope: text("scope"),
});

export const passkeys = applicationTable(
  "passkeys",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integerBoolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: epochMilliseconds("created_at"),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkeys_userId_idx").on(table.userId),
    index("passkeys_credentialID_idx").on(table.credentialID),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  members: many(members),
  invitations: many(invitations),
  passkeys: many(passkeys),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  users: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  users: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(members),
  invitations: many(invitations),
}));

export const membersRelations = relations(members, ({ one }) => ({
  organizations: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
  users: one(users, {
    fields: [members.userId],
    references: [users.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organizations: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  users: one(users, {
    fields: [invitations.inviterId],
    references: [users.id],
  }),
}));

export const passkeysRelations = relations(passkeys, ({ one }) => ({
  users: one(users, {
    fields: [passkeys.userId],
    references: [users.id],
  }),
}));
