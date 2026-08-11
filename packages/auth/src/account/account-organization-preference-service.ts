import type { AccountOrganizationPreferenceRepository } from "./account-organization-preference-repository";

export class AccountOrganizationMembershipRequiredError extends Error {
  constructor() {
    super("You must be a member of this organization before selecting it.");
    this.name = "AccountOrganizationMembershipRequiredError";
  }
}

export type AccountOrganizationPreferenceService = ReturnType<
  typeof createAccountOrganizationPreferenceService
>;

export function createAccountOrganizationPreferenceService(
  repository: Pick<
    AccountOrganizationPreferenceRepository,
    "setLastSelectedOrganization"
  >
) {
  return {
    async selectOrganization(input: {
      organizationId: string;
      userId: string;
    }): Promise<{ organizationId: string }> {
      const selected = await repository.setLastSelectedOrganization(input);
      if (!selected) {
        throw new AccountOrganizationMembershipRequiredError();
      }
      return { organizationId: input.organizationId };
    },
  };
}
