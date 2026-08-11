import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readOrganizationAccountIdentityProjection,
  readOrganizationCreatorUserId,
  readOrganizationRouteSlug,
  resolveOrganizationOwnerOrAdminMembership,
} from "../src/organizations/organization-context";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("organization context owner contracts", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE organizations (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL,
          created_by_user_id TEXT
        )
      `,
    });
    harness.run({
      sql: `
        CREATE TABLE members (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL
        )
      `,
    });
    harness.run({
      sql: "INSERT INTO organizations (id, slug, created_by_user_id) VALUES ('org-1', 'acme', 'user-creator')",
    });
  });

  afterEach(() => harness.close());

  it("resolves the organization route slug through the identity owner", async () => {
    await expect(
      readOrganizationRouteSlug({
        env: { OPENMELD_DB: harness.db },
        organizationId: "org-1",
      })
    ).resolves.toBe("acme");
  });

  it("resolves the immutable organization creator through the identity owner", async () => {
    await expect(
      readOrganizationCreatorUserId({
        env: { OPENMELD_DB: harness.db },
        organizationId: "org-1",
      })
    ).resolves.toBe("user-creator");
  });

  it("allows a current organization admin to finish OAuth", async () => {
    harness.run({
      sql: "INSERT INTO members (id, organization_id, user_id, role) VALUES ('member-1', 'org-1', 'user-1', 'admin')",
    });

    await expect(
      resolveOrganizationOwnerOrAdminMembership({
        env: { OPENMELD_DB: harness.db },
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toMatchObject({ ok: true, role: "admin" });
  });

  it("fails closed after the installer loses the owner or admin role", async () => {
    harness.run({
      sql: "INSERT INTO members (id, organization_id, user_id, role) VALUES ('member-1', 'org-1', 'user-1', 'member')",
    });

    await expect(
      resolveOrganizationOwnerOrAdminMembership({
        env: { OPENMELD_DB: harness.db },
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toMatchObject({
      code: "organization.role_required",
      ok: false,
      status: 403,
    });
  });

  it("consumes the Auth-owned Organization account identity projection", async () => {
    const resolveOrganizationAccountIdentity = async () => ({
      account: {
        defaultHumanProfile: {
          profileId: "22222222-2222-4222-8222-222222222222",
          profileName: "Ari Human",
        },
        displayName: "Ari Human",
        email: "ari@example.test",
        membership: { memberId: "member-1", role: "owner" as const },
        userId: "user-1",
      },
      ok: true as const,
      organization: {
        id: "org-1",
        memberCount: 1,
        name: "OpenMeld Labs",
        personal: false,
        slug: "acme",
      },
    });

    await expect(
      readOrganizationAccountIdentityProjection({
        account: { kind: "user_id", userId: "user-1" },
        authWorker: { resolveOrganizationAccountIdentity },
        organizationId: "org-1",
      })
    ).resolves.toMatchObject({
      account: {
        defaultHumanProfile: { profileName: "Ari Human" },
        membership: { memberId: "member-1" },
      },
      ok: true,
    });
  });

  it("fails closed on a malformed owner projection", async () => {
    await expect(
      readOrganizationAccountIdentityProjection({
        authWorker: {
          resolveOrganizationAccountIdentity: async () =>
            ({ ok: true }) as never,
        },
        organizationId: "org-1",
      })
    ).resolves.toBeNull();
  });
});
