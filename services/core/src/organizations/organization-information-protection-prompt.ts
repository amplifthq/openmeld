import { summarizeInformationProtectionError } from "./organization-information-protection-observability";
import { readOrganizationInformationProtectionPolicy } from "./organization-information-protection-repository";

export async function readOrganizationInformationProtectionForPrompt(input: {
  db: D1Database;
  organizationId: string;
}): Promise<string | null> {
  try {
    const policy = await readOrganizationInformationProtectionPolicy(input);
    return policy.protectedInformation;
  } catch (error) {
    console.warn(
      "[core.organization_information_protection.prompt_policy_unavailable]",
      {
        error: summarizeInformationProtectionError(error),
        event:
          "core.organization_information_protection.prompt_policy_unavailable",
        organizationId: input.organizationId,
      }
    );
    return null;
  }
}
