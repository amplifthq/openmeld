import { describe, expect, it, vi } from "vitest";
import type {
  OrganizationJoinLinkRecord,
  OrganizationJoinLinkRepository,
} from "../src/organization/join-link-repository";
import {
  createOrganizationJoinLinkService,
  OrganizationJoinLinkServiceError,
} from "../src/organization/join-link-service";

const ORGANIZATION_ID = "org-acme";
const WEB_APP_URL = "https://openmeld.example";

type InsertPath = "ensure" | "reset";

describe("organization join link concurrent creation", () => {
  it.each<InsertPath>([
    "ensure",
    "reset",
  ])("returns the active link when %s loses the active-link insert race", async (insertPath) => {
    const activeLink = createJoinLinkRecord({ id: "link-winner" });
    const uniqueConstraintError = new Error(
      "D1_ERROR: UNIQUE constraint failed: organization_join_links.organization_id: SQLITE_CONSTRAINT"
    );
    const repository = createStubRepository({
      findActiveByOrganizationId: vi.fn().mockResolvedValue(activeLink),
      [insertPath === "ensure" ? "ensureActive" : "resetActive"]: vi
        .fn()
        .mockRejectedValue(uniqueConstraintError),
    });

    const result = await runInsertPath(insertPath, repository);

    expect(result.joinLink).toMatchObject({
      id: activeLink.id,
      token: activeLink.token,
      url: `${WEB_APP_URL}/join-organization?token=${activeLink.token}`,
    });
    expect(repository.findActiveByOrganizationId).toHaveBeenCalledOnce();
    expect(repository.findActiveByOrganizationId).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      undefined
    );
  });

  it.each<InsertPath>([
    "ensure",
    "reset",
  ])("rethrows a non-constraint %s insert failure", async (insertPath) => {
    const databaseError = new Error(
      "D1_ERROR: database is locked: SQLITE_BUSY"
    );
    const repository = createStubRepository({
      [insertPath === "ensure" ? "ensureActive" : "resetActive"]: vi
        .fn()
        .mockRejectedValue(databaseError),
    });

    await expect(runInsertPath(insertPath, repository)).rejects.toBe(
      databaseError
    );
    expect(repository.findActiveByOrganizationId).not.toHaveBeenCalled();
  });

  it.each<InsertPath>([
    "ensure",
    "reset",
  ])("returns a structured error when the active link disappears after a %s insert conflict", async (insertPath) => {
    const uniqueConstraintError = new Error(
      "UNIQUE constraint failed: organization_join_links.organization_id"
    );
    const repository = createStubRepository({
      findActiveByOrganizationId: vi.fn().mockResolvedValue(null),
      [insertPath === "ensure" ? "ensureActive" : "resetActive"]: vi
        .fn()
        .mockRejectedValue(uniqueConstraintError),
    });

    const operation = runInsertPath(insertPath, repository);

    await expect(operation).rejects.toMatchObject({
      code: "organization.join_link.inactive",
      message:
        "Concurrent organization join link creation did not leave an active link.",
    });
    await expect(operation).rejects.toBeInstanceOf(
      OrganizationJoinLinkServiceError
    );
    expect(repository.findActiveByOrganizationId).toHaveBeenCalledOnce();
  });
});

describe("verified workspace member enrollment", () => {
  it("adds a verified account to a non-personal organization", async () => {
    const addMember = vi.fn().mockResolvedValue(undefined);
    const repository = createStubRepository({
      findMembership: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "member-created", role: "member" }),
    });
    const service = createOrganizationJoinLinkService({
      repository,
      webAppUrl: WEB_APP_URL,
    });

    await expect(
      service.enrollVerifiedWorkspaceMember({
        addMember,
        emailVerified: true,
        organizationId: ORGANIZATION_ID,
        userId: "workspace-user",
      })
    ).resolves.toEqual({
      alreadyMember: false,
      organizationId: ORGANIZATION_ID,
      organizationName: "Acme Research",
      organizationSlug: "acme-research",
      role: "member",
    });
    expect(addMember).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      role: "member",
      userId: "workspace-user",
    });
  });

  it("returns the existing membership without adding it again", async () => {
    const addMember = vi.fn();
    const service = createOrganizationJoinLinkService({
      repository: createStubRepository({
        findMembership: vi
          .fn()
          .mockResolvedValue({ id: "member-existing", role: "admin" }),
      }),
      webAppUrl: WEB_APP_URL,
    });

    await expect(
      service.enrollVerifiedWorkspaceMember({
        addMember,
        emailVerified: true,
        organizationId: ORGANIZATION_ID,
        userId: "workspace-user",
      })
    ).resolves.toMatchObject({
      alreadyMember: true,
      role: "admin",
    });
    expect(addMember).not.toHaveBeenCalled();
  });

  it("rejects unverified accounts and personal organizations", async () => {
    const addMember = vi.fn();
    const service = createOrganizationJoinLinkService({
      repository: createStubRepository(),
      webAppUrl: WEB_APP_URL,
    });

    await expect(
      service.enrollVerifiedWorkspaceMember({
        addMember,
        emailVerified: false,
        organizationId: ORGANIZATION_ID,
        userId: "workspace-user",
      })
    ).rejects.toMatchObject({
      code: "organization.join_link.email_verification_required",
    });

    const personalService = createOrganizationJoinLinkService({
      repository: createStubRepository({
        findMembership: vi.fn().mockResolvedValue(null),
        findOrganizationById: vi.fn().mockResolvedValue({
          id: ORGANIZATION_ID,
          metadata: JSON.stringify({ personal: true }),
          name: "Personal",
          slug: "personal",
        }),
      }),
      webAppUrl: WEB_APP_URL,
    });
    await expect(
      personalService.enrollVerifiedWorkspaceMember({
        addMember,
        emailVerified: true,
        organizationId: ORGANIZATION_ID,
        userId: "workspace-user",
      })
    ).rejects.toMatchObject({
      code: "organization.personal_no_members",
    });
    expect(addMember).not.toHaveBeenCalled();
  });
});

async function runInsertPath(
  insertPath: InsertPath,
  repository: OrganizationJoinLinkRepository
): Promise<{ joinLink: ReturnTypeShape }> {
  const service = createOrganizationJoinLinkService({
    repository,
    webAppUrl: WEB_APP_URL,
  });
  if (insertPath === "ensure") {
    const result = await service.ensure({
      actorUserId: "owner-user",
      organizationId: ORGANIZATION_ID,
    });
    return { joinLink: result.joinLink };
  }
  return {
    joinLink: await service.reset({
      createdBy: "owner-user",
      organizationId: ORGANIZATION_ID,
    }),
  };
}

type ReturnTypeShape = Awaited<
  ReturnType<ReturnType<typeof createOrganizationJoinLinkService>["getActive"]>
>;

function createStubRepository(
  overrides: Partial<OrganizationJoinLinkRepository> = {}
): OrganizationJoinLinkRepository {
  return {
    ensureActive: vi.fn().mockResolvedValue(createJoinLinkRecord()),
    findActiveByOrganizationId: vi.fn().mockResolvedValue(null),
    findActiveByToken: vi.fn().mockResolvedValue(null),
    findMembership: vi
      .fn()
      .mockResolvedValue({ id: "member-owner", role: "owner" }),
    findOrganizationById: vi.fn().mockResolvedValue({
      id: ORGANIZATION_ID,
      metadata: JSON.stringify({ personal: false }),
      name: "Acme Research",
      slug: "acme-research",
    }),
    resetActive: vi.fn().mockResolvedValue(createJoinLinkRecord()),
    revokeActive: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function createJoinLinkRecord(
  overrides: Partial<OrganizationJoinLinkRecord> = {}
): OrganizationJoinLinkRecord {
  return {
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    createdBy: "owner-user",
    id: "link-created",
    organizationId: ORGANIZATION_ID,
    revokedAt: null,
    spaceId: null,
    role: "member",
    token: `joinlink_${"a".repeat(64)}`,
    ...overrides,
  };
}
