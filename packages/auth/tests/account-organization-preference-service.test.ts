import { describe, expect, it, vi } from "vitest";
import {
  AccountOrganizationMembershipRequiredError,
  createAccountOrganizationPreferenceService,
} from "../src/account/account-organization-preference-service";

describe("Account Organization preference service", () => {
  it("persists an Organization only when the account is still a member", async () => {
    const repository = {
      setLastSelectedOrganization: vi.fn().mockResolvedValue(true),
    };
    const service = createAccountOrganizationPreferenceService(repository);

    await expect(
      service.selectOrganization({
        organizationId: "org-beta",
        userId: "user-123",
      })
    ).resolves.toEqual({ organizationId: "org-beta" });
    expect(repository.setLastSelectedOrganization).toHaveBeenCalledWith({
      organizationId: "org-beta",
      userId: "user-123",
    });
  });

  it("rejects a stale or unauthorized Organization without changing the preference", async () => {
    const repository = {
      setLastSelectedOrganization: vi.fn().mockResolvedValue(false),
    };
    const service = createAccountOrganizationPreferenceService(repository);

    await expect(
      service.selectOrganization({
        organizationId: "org-revoked",
        userId: "user-123",
      })
    ).rejects.toBeInstanceOf(AccountOrganizationMembershipRequiredError);
  });
});
