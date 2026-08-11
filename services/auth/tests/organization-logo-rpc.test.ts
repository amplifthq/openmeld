import { createD1OrganizationLogoMutationRepository } from "@openmeld/auth/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

const executionContext = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

let harness: SqliteD1Harness;

beforeEach(() => {
  harness = createSqliteD1Harness();
  applyDrizzleMigrations(harness.database);
});

afterEach(() => {
  harness.close();
  vi.restoreAllMocks();
});

describe("organization logo RPC", () => {
  it("prepares and commits an owner logo update with compare-and-set", async () => {
    seedOrganization({ role: "owner" });
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
      harness.queryFirst({
        params: ["org-acme"],
        sql: "select logo from organizations where id = ?",
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
    seedOrganization({
      organizationId: "org-admin",
      role: "admin",
      slug: "admin-team",
    });
    seedOrganization({
      organizationId: "org-member",
      role: "member",
      slug: "member-team",
    });
    seedOrganization({
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
    seedOrganization({ role: "owner" });
    const repository = createD1OrganizationLogoMutationRepository(harness.db);
    const authorized = await repository.readForActor({
      actorUserId: "user-owner",
      organizationId: "org-acme",
    });
    expect(authorized?.role).toBe("owner");

    harness.run({
      params: ["admin", "org-acme", "user-owner"],
      sql: `
        update members
        set role = ?
        where organization_id = ? and user_id = ?
      `,
    });
    expect(
      harness.queryFirst({
        params: ["org-acme", "user-owner"],
        sql: `
          select role from members
          where organization_id = ? and user_id = ?
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
      harness.queryFirst({
        params: ["org-acme"],
        sql: "select logo from organizations where id = ?",
      })
    ).toEqual({ logo: null });
  });

  it("prevents a personal-classification race from winning the final database write", async () => {
    seedOrganization({ role: "owner" });
    const repository = createD1OrganizationLogoMutationRepository(harness.db);
    const authorized = await repository.readForActor({
      actorUserId: "user-owner",
      organizationId: "org-acme",
    });
    expect(authorized).toMatchObject({ metadata: null, slug: "acme" });

    harness.run({
      params: [JSON.stringify({ personal: true }), "org-acme"],
      sql: "update organizations set metadata = ? where id = ?",
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
      harness.queryFirst({
        params: ["org-acme"],
        sql: "select logo from organizations where id = ?",
      })
    ).toEqual({ logo: null });
  });
});

function createRpc(): AuthRpcEntrypoint {
  return new AuthRpcEntrypoint(executionContext, {
    AUTH_WORKER_NODE_ENV: "test",
    OPENMELD_DB: harness.db,
  } as unknown as CloudflareBindings);
}

function seedOrganization(input: {
  metadata?: string | null;
  organizationId?: string;
  role: "admin" | "member" | "owner";
  slug?: string;
}): void {
  const organizationId = input.organizationId ?? "org-acme";
  const now = Date.now();
  if (
    !harness.queryFirst({
      params: ["user-owner"],
      sql: "select id from users where id = ?",
    })
  ) {
    harness.run({
      params: ["user-owner", "Owner", "owner@example.com", 1, now, now],
      sql: `
        insert into users (id, name, email, email_verified, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?)
      `,
    });
  }
  harness.run({
    params: [
      organizationId,
      `Organization ${organizationId}`,
      input.slug ?? "acme",
      now,
      input.metadata ?? null,
    ],
    sql: `
      insert into organizations (id, name, slug, created_at, metadata)
      values (?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
      `member-${organizationId}`,
      organizationId,
      "user-owner",
      input.role,
      now,
    ],
    sql: `
      insert into members (id, organization_id, user_id, role, created_at)
      values (?, ?, ?, ?, ?)
    `,
  });
}
