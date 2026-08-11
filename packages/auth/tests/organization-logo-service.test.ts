import { describe, expect, it, vi } from "vitest";
import {
  createOrganizationLogoService,
  type OrganizationLogoMutationRecord,
  type OrganizationLogoMutationRepository,
} from "../src/organization/logo-service";

const ownerRecord: OrganizationLogoMutationRecord = {
  logo: "https://gateway.openmeld.ai/v1/organization-logos/org-acme/11111111-1111-4111-8111-111111111111.webp",
  metadata: null,
  organizationId: "org-acme",
  role: "owner",
  slug: "acme",
};

function createRepository(input?: {
  compareAndSetResult?: boolean;
  record?: OrganizationLogoMutationRecord | null;
}) {
  const repository = {
    compareAndSetLogo: vi.fn(async () => input?.compareAndSetResult ?? true),
    readForActor: vi.fn(async () =>
      input && Object.hasOwn(input, "record")
        ? (input.record ?? null)
        : ownerRecord
    ),
  } satisfies OrganizationLogoMutationRepository;
  return repository;
}

describe("organization logo service", () => {
  it("prepares the current logo for an organization owner", async () => {
    const repository = createRepository();
    const service = createOrganizationLogoService({ repository });

    await expect(
      service.prepare({
        actorUserId: "user-owner",
        organizationId: "org-acme",
      })
    ).resolves.toEqual({
      currentLogo: ownerRecord.logo,
      ok: true,
    });
  });

  it.each([
    "admin",
    "member",
  ])("rejects a %s before any logo write", async (role) => {
    const repository = createRepository({
      record: { ...ownerRecord, role },
    });
    const service = createOrganizationLogoService({ repository });

    await expect(
      service.prepare({
        actorUserId: "user-not-owner",
        organizationId: "org-acme",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.forbidden",
      ok: false,
    });
    expect(repository.compareAndSetLogo).not.toHaveBeenCalled();
  });

  it("rejects personal organizations", async () => {
    const repository = createRepository({
      record: {
        ...ownerRecord,
        metadata: JSON.stringify({ personal: true }),
        slug: "personal-owner",
      },
    });
    const service = createOrganizationLogoService({ repository });

    await expect(
      service.prepare({
        actorUserId: "user-owner",
        organizationId: "org-acme",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.personal_unsupported",
      ok: false,
    });
  });

  it("fails closed on malformed organization metadata", async () => {
    const repository = createRepository({
      record: { ...ownerRecord, metadata: "not-json" },
    });
    const service = createOrganizationLogoService({ repository });

    await expect(
      service.prepare({
        actorUserId: "user-owner",
        organizationId: "org-acme",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.metadata_invalid",
      ok: false,
    });
  });

  it("commits a managed URL only when the expected logo still matches", async () => {
    const repository = createRepository();
    const service = createOrganizationLogoService({ repository });
    const nextLogo = {
      assetId: "22222222-2222-4222-8222-222222222222",
      url: "https://gateway.openmeld.ai/v1/organization-logos/org-acme/22222222-2222-4222-8222-222222222222.webp",
    };

    await expect(
      service.commit({
        actorUserId: "user-owner",
        expectedLogo: ownerRecord.logo,
        nextLogo,
        organizationId: "org-acme",
      })
    ).resolves.toEqual({ logo: nextLogo.url, ok: true });
    expect(repository.compareAndSetLogo).toHaveBeenCalledWith({
      actorUserId: "user-owner",
      expectedLogo: ownerRecord.logo,
      expectedMetadata: ownerRecord.metadata,
      expectedRole: "owner",
      expectedSlug: ownerRecord.slug,
      nextLogo: nextLogo.url,
      organizationId: "org-acme",
    });
  });

  it("reports a conflict when another write wins the compare-and-set", async () => {
    const repository = createRepository({ compareAndSetResult: false });
    const service = createOrganizationLogoService({ repository });

    await expect(
      service.commit({
        actorUserId: "user-owner",
        expectedLogo: ownerRecord.logo,
        nextLogo: null,
        organizationId: "org-acme",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.conflict",
      ok: false,
    });
  });

  it("rejects a managed URL that points at another organization", async () => {
    const repository = createRepository();
    const service = createOrganizationLogoService({ repository });

    await expect(
      service.commit({
        actorUserId: "user-owner",
        expectedLogo: ownerRecord.logo,
        nextLogo: {
          assetId: "22222222-2222-4222-8222-222222222222",
          url: "https://gateway.openmeld.ai/v1/organization-logos/org-other/22222222-2222-4222-8222-222222222222.webp",
        },
        organizationId: "org-acme",
      })
    ).resolves.toMatchObject({
      code: "organization.logo.invalid_reference",
      ok: false,
    });
    expect(repository.compareAndSetLogo).not.toHaveBeenCalled();
  });
});
