import { createPostgresOrganizationLogoMutationRepository } from "@openmeld/auth/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
  postgresTestBinding,
} from "../../../tooling/postgresql/test-harness";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";

const executionContext = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

let harness: PostgresHarness;

beforeEach(async () => {
  harness = await createPostgresHarness();
});

afterEach(async () => {
  await harness.close();
  vi.restoreAllMocks();
});

describe("organization logo RPC", () => {
  it("prepares and commits an owner logo update with compare-and-set", async () => {
    await seedOrganization({ role: "owner" });
    const rpc = createRpc();

    await expect(
      rpc.prepareOrganizationLogoMutation({
        actorUserId: "user-owner",
        organizationId: "org-acme",
      })
    ).resolves.toEqual({ currentLogo: null, ok: true });

    const nextLogo = {
      assetId: "22222222-2222-4222-8222-222222222222",
      url: "https://gateway.openmeld.ai/v1/organization-logos/org-acme/22222222-2222-4222-8222-222222222222.webp",
    };
    await expect(
      rpc.commitOrganizationLogoMutation({
        actorUserId: "user-owner",
        expectedLogo: null,
        nextLogo,
        organizationId: "org-acme",
      })
    ).resolves.toEqual({ logo: nextLogo.url, ok: true });
    expect(
      await harness.queryFirst({
        values: ["org-acme"],
        text: 'select logo from "openmeld"."organizations" where id = $1',
      })
    ).toEqual({ logo: nextLogo.url });

    await expect(
      rpc.commitOrganizationLogoMutation({
        actorUserId: "user-owner",
        expectedLogo: null,
        nextLogo: null,
        organizationId: "org-acme",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.conflict",
      ok: false,
    });
  });

  it("rejects admin, member, and personal organization mutations", async () => {
    await seedOrganization({
      organizationId: "org-admin",
      role: "admin",
      slug: "admin-team",
    });
    await seedOrganization({
      organizationId: "org-member",
      role: "member",
      slug: "member-team",
    });
    await seedOrganization({
      metadata: JSON.stringify({ personal: true }),
      organizationId: "org-personal",
      role: "owner",
      slug: "personal-owner",
    });
    const rpc = createRpc();

    for (const organizationId of ["org-admin", "org-member"]) {
      await expect(
        rpc.prepareOrganizationLogoMutation({
          actorUserId: "user-owner",
          organizationId,
        })
      ).resolves.toMatchObject({
        code: "organization.logo.forbidden",
        ok: false,
      });
    }
    await expect(
      rpc.prepareOrganizationLogoMutation({
        actorUserId: "user-owner",
        organizationId: "org-personal",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.personal_unsupported",
      ok: false,
    });
  });

  it("returns a structured failure for invalid RPC input", async () => {
    const rpc = createRpc();

    await expect(
      rpc.prepareOrganizationLogoMutation({
        actorUserId: "",
        organizationId: "../other",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.invalid_input",
      ok: false,
    });
  });

  it("prevents a stale owner authorization from winning the final database write", async () => {
    await seedOrganization({ role: "owner" });
    const repository = createPostgresOrganizationLogoMutationRepository(
      harness.db
    );
    const authorized = await repository.readForActor({
      actorUserId: "user-owner",
      organizationId: "org-acme",
    });
    expect(authorized?.role).toBe("owner");

    await harness.query({
      values: ["admin", "org-acme", "user-owner"],
      text: `
        update "openmeld"."members"
        set role = $1
        where organization_id = $2 and user_id = $3
      `,
    });
    expect(
      await harness.queryFirst({
        values: ["org-acme", "user-owner"],
        text: `
          select role from "openmeld"."members"
          where organization_id = $1 and user_id = $2
        `,
      })
    ).toEqual({ role: "admin" });

    await expect(
      repository.compareAndSetLogo({
        actorUserId: "user-owner",
        expectedLogo: null,
        expectedMetadata: authorized?.metadata ?? null,
        expectedRole: authorized?.role ?? "owner",
        expectedSlug: authorized?.slug ?? "acme",
        nextLogo:
          "https://gateway.openmeld.ai/v1/organization-logos/org-acme/22222222-2222-4222-8222-222222222222.webp",
        organizationId: "org-acme",
      })
    ).resolves.toBe(false);
    expect(
      await harness.queryFirst({
        values: ["org-acme"],
        text: 'select logo from "openmeld"."organizations" where id = $1',
      })
    ).toEqual({ logo: null });
  });

  it("prevents a personal-classification race from winning the final database write", async () => {
    await seedOrganization({ role: "owner" });
    const repository = createPostgresOrganizationLogoMutationRepository(
      harness.db
    );
    const authorized = await repository.readForActor({
      actorUserId: "user-owner",
      organizationId: "org-acme",
    });
    expect(authorized).toMatchObject({ metadata: null, slug: "acme" });

    await harness.query({
      values: [JSON.stringify({ personal: true }), "org-acme"],
      text: 'update "openmeld"."organizations" set metadata = $1 where id = $2',
    });

    await expect(
      repository.compareAndSetLogo({
        actorUserId: "user-owner",
        expectedLogo: null,
        expectedMetadata: authorized?.metadata ?? null,
        expectedRole: authorized?.role ?? "owner",
        expectedSlug: authorized?.slug ?? "acme",
        nextLogo:
          "https://gateway.openmeld.ai/v1/organization-logos/org-acme/22222222-2222-4222-8222-222222222222.webp",
        organizationId: "org-acme",
      })
    ).resolves.toBe(false);
    expect(
      await harness.queryFirst({
        values: ["org-acme"],
        text: 'select logo from "openmeld"."organizations" where id = $1',
      })
    ).toEqual({ logo: null });
  });
});

function createRpc(): AuthRpcEntrypoint {
  return new AuthRpcEntrypoint(executionContext, {
    AUTH_WORKER_NODE_ENV: "test",
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
  } as unknown as CloudflareBindings);
}

async function seedOrganization(input: {
  metadata?: string | null;
  organizationId?: string;
  role: "admin" | "member" | "owner";
  slug?: string;
}): Promise<void> {
  const organizationId = input.organizationId ?? "org-acme";
  const now = Date.now();
  if (
    !(await harness.queryFirst({
      values: ["user-owner"],
      text: 'select id from "openmeld"."users" where id = $1',
    }))
  ) {
    await harness.query({
      values: ["user-owner", "Owner", "owner@example.com", 1, now, now],
      text: `
        insert into "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6)
      `,
    });
  }
  await harness.query({
    values: [
      organizationId,
      `Organization ${organizationId}`,
      input.slug ?? "acme",
      now,
      input.metadata ?? null,
    ],
    text: `
      insert into "openmeld"."organizations" (id, name, slug, created_at, metadata)
      values ($1, $2, $3, $4, $5)
    `,
  });
  await harness.query({
    values: [
      `member-${organizationId}`,
      organizationId,
      "user-owner",
      input.role,
      now,
    ],
    text: `
      insert into "openmeld"."members" (id, organization_id, user_id, role, created_at)
      values ($1, $2, $3, $4, $5)
    `,
  });
}
