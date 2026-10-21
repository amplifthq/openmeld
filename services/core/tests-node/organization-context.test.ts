import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConcurrentOrganizationMembershipReads,
  readOrganizationAccountIdentityProjection,
  readOrganizationCreatorUserId,
  readOrganizationPersonalClassification,
  readOrganizationRouteSlug,
  resolveOrganizationMembershipWithRouteSlug,
  resolveOrganizationOwnerOrAdminMembership,
} from "../src/organizations/organization-context";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

describe("organization context owner contracts", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;

  beforeEach(async () => {
    harness = await createPostgresHarness();
    await harness.query({
      text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('user-creator','Creator','creator@example.com'), ('user-1','Member','member@example.com')`,
    });

    await harness.query({
      text: "INSERT INTO \"openmeld\".\"organizations\" (id, slug, created_by_user_id, \"name\", \"created_at\") VALUES ('org-1', 'acme', 'user-creator', 'Test Organization', 1700000000000)",
    });
  });

  afterEach(async () => await harness.close());

  it("resolves the organization route slug through the identity owner", async () => {
    await expect(
      readOrganizationRouteSlug({
        env: { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) },
        organizationId: "org-1",
      })
    ).resolves.toBe("acme");
  });

  it("reads membership and the route slug in one query", async () => {
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, \"created_at\") VALUES ('member-1', 'org-1', 'user-1', 'member', 1700000000000)",
    });
    const env = { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) };

    await expect(
      resolveOrganizationMembershipWithRouteSlug({
        env,
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toEqual({
      ok: true,
      membership: {
        ok: true,
        memberId: "member-1",
        organizationId: "org-1",
        role: "member",
        userId: "user-1",
      },
      organizationSlug: "acme",
    });
    for (const [organizationId, userId] of [
      ["org-1", "user-creator"],
      ["org-missing", "user-1"],
    ] as const) {
      await expect(
        resolveOrganizationMembershipWithRouteSlug({
          env,
          organizationId,
          userId,
        })
      ).resolves.toMatchObject({
        ok: false,
        code: "organization.membership_required",
        status: 403,
      });
    }
  });

  it("fails closed when the combined membership read is unavailable", async () => {
    await expect(
      resolveOrganizationMembershipWithRouteSlug({
        env: {
          OPENMELD_POSTGRESQL: {
            connectionString: "postgresql://invalid:invalid@127.0.0.1:1/none",
          } as never,
        },
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toMatchObject({
      ok: false,
      code: "organization.context_unavailable",
      status: 503,
    });
  });

  it("shares concurrent membership reads and rereads after they settle", async () => {
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, \"created_at\") VALUES ('member-1', 'org-1', 'user-1', 'member', 1700000000000)",
    });
    const reads = new ConcurrentOrganizationMembershipReads();
    const env = { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) };
    const input = { env, organizationId: "org-1", userId: "user-1" };

    const first = reads.read(input);
    expect(reads.read(input)).toBe(first);
    await expect(first).resolves.toMatchObject({ ok: true });

    await harness.query({
      text: 'DELETE FROM "openmeld"."members" WHERE id = \'member-1\'',
    });
    await expect(reads.read(input)).resolves.toMatchObject({
      ok: false,
      code: "organization.membership_required",
    });
  });

  it("classifies a Personal Workspace from Auth-owned organization metadata", async () => {
    await harness.query({
      values: [JSON.stringify({ personal: true })],
      text: 'UPDATE "openmeld"."organizations" SET metadata = $1 WHERE id = \'org-1\'',
    });

    await expect(
      readOrganizationPersonalClassification({
        env: { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) },
        organizationId: "org-1",
      })
    ).resolves.toEqual({ ok: true, personal: true });
  });

  it("fails closed when Personal Workspace classification is malformed", async () => {
    await harness.query({
      text: "UPDATE \"openmeld\".\"organizations\" SET metadata = '{not-json' WHERE id = 'org-1'",
    });

    await expect(
      readOrganizationPersonalClassification({
        env: { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) },
        organizationId: "org-1",
      })
    ).resolves.toEqual({ ok: false });
  });

  it("resolves the immutable organization creator through the identity owner", async () => {
    await expect(
      readOrganizationCreatorUserId({
        env: { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) },
        organizationId: "org-1",
      })
    ).resolves.toBe("user-creator");
  });

  it("allows a current organization admin to finish OAuth", async () => {
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, \"created_at\") VALUES ('member-1', 'org-1', 'user-1', 'admin', 1700000000000)",
    });

    await expect(
      resolveOrganizationOwnerOrAdminMembership({
        env: { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) },
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toMatchObject({ ok: true, role: "admin" });
  });

  it("fails closed after the installer loses the owner or admin role", async () => {
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, \"created_at\") VALUES ('member-1', 'org-1', 'user-1', 'member', 1700000000000)",
    });

    await expect(
      resolveOrganizationOwnerOrAdminMembership({
        env: { OPENMELD_POSTGRESQL: postgresTestBinding(harness.db) },
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
