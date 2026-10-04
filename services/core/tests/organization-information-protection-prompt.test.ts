import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrganizationInformationProtectionForPrompt } from "../src/organizations/organization-information-protection-prompt";
import { createProjectionPostgresDatabase } from "../test-support/postgresql-query.test-support";

describe("Organization information protection prompt projection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to built-in protection when the optional policy read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = createProjectionPostgresDatabase(() => {
      throw new Error("PostgreSQL table unavailable");
    });

    await expect(
      readOrganizationInformationProtectionForPrompt({
        db,
        organizationId: "org-1",
      })
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[core.organization_information_protection.prompt_policy_unavailable]",
      {
        error: "PostgreSQL table unavailable",
        event:
          "core.organization_information_protection.prompt_policy_unavailable",
        organizationId: "org-1",
      }
    );
  });

  it("keeps failure evidence bounded and on one line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = createProjectionPostgresDatabase(() => {
      throw new Error(`PostgreSQL unavailable\n${"x".repeat(400)}`);
    });

    await readOrganizationInformationProtectionForPrompt({
      db,
      organizationId: "org-1",
    });

    const evidence = warn.mock.calls[0]?.[1] as { error?: string };
    expect(evidence.error?.length).toBeLessThanOrEqual(240);
    expect(evidence.error).not.toContain("\n");
  });
});
