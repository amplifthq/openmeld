import { afterEach, describe, expect, it, vi } from "vitest";
import { readOrganizationInformationProtectionForPrompt } from "../src/organizations/organization-information-protection-prompt";

describe("Organization information protection prompt projection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to built-in protection when the optional policy read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = {
      prepare: vi.fn(() => {
        throw new Error("D1 table unavailable");
      }),
    } as unknown as D1Database;

    await expect(
      readOrganizationInformationProtectionForPrompt({
        db,
        organizationId: "org-1",
      })
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[core.organization_information_protection.prompt_policy_unavailable]",
      {
        error: "D1 table unavailable",
        event:
          "core.organization_information_protection.prompt_policy_unavailable",
        organizationId: "org-1",
      }
    );
  });

  it("keeps failure evidence bounded and on one line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db = {
      prepare: vi.fn(() => {
        throw new Error(`D1 unavailable\n${"x".repeat(400)}`);
      }),
    } as unknown as D1Database;

    await readOrganizationInformationProtectionForPrompt({
      db,
      organizationId: "org-1",
    });

    const evidence = warn.mock.calls[0]?.[1] as { error?: string };
    expect(evidence.error?.length).toBeLessThanOrEqual(240);
    expect(evidence.error).not.toContain("\n");
  });
});
