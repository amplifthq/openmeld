import type { z } from "zod/v4";

type Schemas =
  typeof import("../../schemas/http/organization-working-language");

export type CenterAgentSetOrganizationWorkingLanguageToolRpcInput = z.infer<
  Schemas["centerAgentSetOrganizationWorkingLanguageToolRpcInputSchema"]
>;
export type CenterAgentSetOrganizationWorkingLanguageToolResponse = z.infer<
  Schemas["centerAgentSetOrganizationWorkingLanguageToolResponseSchema"]
>;
export type OrganizationWorkingLanguagePreferenceResponse = z.infer<
  Schemas["organizationWorkingLanguagePreferenceResponseSchema"]
>;
export type SetOrganizationWorkingLanguagePreferenceBody = z.infer<
  Schemas["setOrganizationWorkingLanguagePreferenceBodySchema"]
>;
