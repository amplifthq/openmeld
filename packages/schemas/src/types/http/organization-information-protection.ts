import type { z } from "zod/v4";

type Schemas =
  typeof import("../../schemas/http/organization-information-protection");

export type OrganizationInformationProtectionPolicyResponse = z.infer<
  Schemas["organizationInformationProtectionPolicyResponseSchema"]
>;

export type UpdateOrganizationInformationProtectionPolicyBody = z.infer<
  Schemas["updateOrganizationInformationProtectionPolicyBodySchema"]
>;
