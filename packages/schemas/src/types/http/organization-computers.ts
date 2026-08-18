import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/organization-computers");

export type OrganizationComputerLocalAgent = z.infer<
  Schemas["organizationComputerLocalAgentSchema"]
>;
export type OrganizationComputerRecord = z.infer<
  Schemas["organizationComputerSchema"]
>;
export type OrganizationComputersResponse = z.infer<
  Schemas["organizationComputersResponseSchema"]
>;
