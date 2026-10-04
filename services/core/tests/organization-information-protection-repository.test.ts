import type { QueryResultRow } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { readOrganizationInformationProtectionPolicyForSpace } from "../src/organizations/organization-information-protection-repository";
import { createProjectionPostgresDatabase } from "../test-support/postgresql-query.test-support";

function createDb(firstRow: QueryResultRow | null) {
  return createProjectionPostgresDatabase(() => (firstRow ? [firstRow] : []));
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
