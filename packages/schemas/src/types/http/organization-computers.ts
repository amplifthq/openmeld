import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/organization-computers");

export type OrganizationComputerLocalAgentDetails = z.infer<
  Schemas["organizationComputerLocalAgentDetailsSchema"]
>;
export type OrganizationComputerLocalAgent = z.infer<
  Schemas["organizationComputerLocalAgentSchema"]
>;
export type OrganizationComputerOpenMeldTools = z.infer<
  Schemas["organizationComputerOpenMeldToolsSchema"]
>;
export type OrganizationComputerRecord = z.infer<
  Schemas["organizationComputerSchema"]
>;
export type OrganizationComputersResponse = z.infer<
  Schemas["organizationComputersResponseSchema"]
>;
