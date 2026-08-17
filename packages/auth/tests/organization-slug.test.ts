import { describe, expect, it, vi } from "vitest";
import {
  buildGeneratedOrganizationSlug,
  createWithGeneratedOrganizationSlug,
  OrganizationSlugConflictError,
} from "../src/organization/organization-slug";

describe("generated Organization URL slugs", () => {
  it("retries an exact collision without exposing an ordinal", async () => {
    const discriminators = ["k7m3qx", "r8v2c9"];
    const create = vi
      .fn<(slug: string) => Promise<string>>()
      .mockRejectedValueOnce(new OrganizationSlugConflictError())
      .mockImplementation(async (slug) => slug);

    await expect(
      createWithGeneratedOrganizationSlug({
        create,
        generateDiscriminator: () => discriminators.shift() ?? "000000",
        name: "Amplift",
      })
    ).resolves.toBe("amplift-r8v2c9");
    expect(create).toHaveBeenNthCalledWith(1, "amplift-k7m3qx");
    expect(create).toHaveBeenNthCalledWith(2, "amplift-r8v2c9");
  });

  it("keeps the personal prefix exclusive to personal Organizations", () => {
    expect(
      buildGeneratedOrganizationSlug({
        discriminator: "k7m3qx",
        name: "Personal Research",
      })
    ).toBe("org-personal-research-k7m3qx");
    expect(
      buildGeneratedOrganizationSlug({
        allowPersonalPrefix: true,
        discriminator: "k7m3qx",
        name: "Personal Research",
      })
    ).toBe("personal-research-k7m3qx");
  });

  it("uses an opaque fallback when a name has no URL-safe characters", () => {
    expect(
      buildGeneratedOrganizationSlug({
        discriminator: "k7m3qx",
        name: "研发团队",
      })
    ).toBe("org-k7m3qx");
    expect(
      buildGeneratedOrganizationSlug({
        allowPersonalPrefix: true,
        discriminator: "r8v2c9",
        name: "个人空间",
      })
    ).toBe("org-r8v2c9");
  });
});
