import { describe, expect, it, vi } from "vitest";
import { readOrganizationInformationProtectionPolicyForSpace } from "../src/organizations/organization-information-protection-repository";

function createDb(firstRow: unknown): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => firstRow),
      })),
    })),
  } as unknown as D1Database;
}

describe("Organization information protection Space projection", () => {
  it("distinguishes a resolved Organization with no custom policy", async () => {
    await expect(
      readOrganizationInformationProtectionPolicyForSpace({
        db: createDb({
          protected_information: null,
          space_organization_id: "org-1",
          updated_at_ms: null,
          updated_by_user_id: null,
        }),
        spaceId: "space-1",
      })
    ).resolves.toEqual({
      organizationId: "org-1",
      protectedInformation: null,
      updatedAtMs: null,
      updatedByUserId: null,
    });
  });

  it("returns null only when the Space-to-Organization projection is missing", async () => {
    await expect(
      readOrganizationInformationProtectionPolicyForSpace({
        db: createDb(null),
        spaceId: "space-missing",
      })
    ).resolves.toBeNull();
  });
});
