import { describe, expect, it } from "vitest";
import {
  organizationDocumentPromptContextResponseSchema,
  organizationDocumentPromptContextRpcInputSchema,
} from "../../src/schemas/http/organization-documents";
import {
  ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS,
  organizationInformationProtectionPolicyResponseSchema,
  updateOrganizationInformationProtectionPolicyBodySchema,
} from "../../src/schemas/http/organization-information-protection";

describe("organization information protection HTTP schemas", () => {
  it("normalizes a bounded policy for an admin update", () => {
    const result =
      updateOrganizationInformationProtectionPolicyBodySchema.parse({
        protectedInformation:
          "  Customer contract pricing and unreleased Board forecasts.  ",
      });

    expect(result).toEqual({
      protectedInformation:
        "Customer contract pricing and unreleased Board forecasts.",
    });
  });

  it("uses null to clear the organization policy", () => {
    expect(
      updateOrganizationInformationProtectionPolicyBodySchema.parse({
        protectedInformation: null,
      })
    ).toEqual({ protectedInformation: null });
  });

  it("rejects empty and oversized organization policy text", () => {
    expect(
      updateOrganizationInformationProtectionPolicyBodySchema.safeParse({
        protectedInformation: "   ",
      }).success
    ).toBe(false);
    expect(
      updateOrganizationInformationProtectionPolicyBodySchema.safeParse({
        protectedInformation: "x".repeat(
          ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS + 1
        ),
      }).success
    ).toBe(false);
  });

  it("keeps audit metadata in the admin-only response", () => {
    const response =
      organizationInformationProtectionPolicyResponseSchema.parse({
        organizationId: "org_1",
        protectedInformation: "Private customer pricing.",
        updatedAt: "2026-07-21T12:00:00.000Z",
        updatedByUserId: "user_1",
      });

    expect(response.protectedInformation).toBe("Private customer pricing.");
  });

  it("adds protected information to Center Agent prompt context only when requested", () => {
    expect(
      organizationDocumentPromptContextRpcInputSchema.parse({
        context: {
          activeOrganizationId: "org_1",
          actorContext: {
            profileKind: "system",
            requestId: "request_1",
            openMeldProfileId: "openmeld-system",
          },
        },
        includeOrganizationProtectedInformation: true,
      }).includeOrganizationProtectedInformation
    ).toBe(true);

    const legacyResponse =
      organizationDocumentPromptContextResponseSchema.parse({
        briefContent: null,
        documentTitles: [],
        organizationId: "org_1",
      });
    expect(legacyResponse).not.toHaveProperty(
      "organizationProtectedInformation"
    );

    expect(
      organizationDocumentPromptContextResponseSchema.parse({
        ...legacyResponse,
        organizationProtectedInformation: "Private customer pricing.",
      }).organizationProtectedInformation
    ).toBe("Private customer pricing.");
  });
});
