import { describe, expect, it } from "vitest";
import {
  buildOrganizationLogoObjectKey,
  buildOrganizationLogoPublicPath,
  organizationLogoCommitRpcInputSchema,
  organizationLogoMimeTypeSchema,
  parseOrganizationLogoReferenceFromUrl,
} from "../../src";

const organizationId = "org-acme";
const assetId = "11111111-1111-4111-8111-111111111111";

describe("organization logo contracts", () => {
  it("builds one canonical object key and public path", () => {
    expect(buildOrganizationLogoObjectKey({ assetId, organizationId })).toBe(
      "organizations/org-acme/logos/11111111-1111-4111-8111-111111111111.webp"
    );
    expect(buildOrganizationLogoPublicPath({ assetId, organizationId })).toBe(
      "/v1/organization-logos/org-acme/11111111-1111-4111-8111-111111111111.webp"
    );
  });

  it("recognizes only canonical managed logo URLs", () => {
    expect(
      parseOrganizationLogoReferenceFromUrl(
        "https://gateway.openmeld.ai/v1/organization-logos/org-acme/11111111-1111-4111-8111-111111111111.webp"
      )
    ).toEqual({ assetId, organizationId });
    expect(
      parseOrganizationLogoReferenceFromUrl(
        "https://example.com/v1/organization-logos/org-acme/not-a-uuid.webp"
      )
    ).toBeNull();
    expect(
      parseOrganizationLogoReferenceFromUrl(
        "https://example.com/v1/organization-logos/org-acme/11111111-1111-4111-8111-111111111111.webp?size=small"
      )
    ).toBeNull();
  });

  it("accepts only the upload MIME types the server can normalize", () => {
    expect(organizationLogoMimeTypeSchema.safeParse("image/jpeg").success).toBe(
      true
    );
    expect(organizationLogoMimeTypeSchema.safeParse("image/png").success).toBe(
      true
    );
    expect(organizationLogoMimeTypeSchema.safeParse("image/webp").success).toBe(
      true
    );
    expect(
      organizationLogoMimeTypeSchema.safeParse("image/svg+xml").success
    ).toBe(false);
  });

  it("keeps relationship validation at the organization owner boundary", () => {
    expect(
      organizationLogoCommitRpcInputSchema.safeParse({
        actorUserId: "user-owner",
        expectedLogo: null,
        nextLogo: {
          assetId,
          url: "https://gateway.openmeld.ai/v1/organization-logos/org-other/11111111-1111-4111-8111-111111111111.webp",
        },
        organizationId,
      }).success
    ).toBe(true);
  });
});
