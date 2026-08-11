import type { z } from "zod/v4";

type Schemas =
  typeof import("../../schemas/http/organization-member-openmeld-service-status");

export type OrganizationMemberOpenMeldServiceState = z.infer<
  Schemas["organizationMemberOpenMeldServiceStateSchema"]
>;
export type OrganizationMemberOpenMeldServiceStatus = z.infer<
  Schemas["organizationMemberOpenMeldServiceStatusSchema"]
>;
export type CenterAgentReadMemberOpenMeldServiceStatusBody = z.infer<
  Schemas["centerAgentReadMemberOpenMeldServiceStatusBodySchema"]
>;
export type CenterAgentReadMemberOpenMeldServiceStatusResponse = z.infer<
  Schemas["centerAgentReadMemberOpenMeldServiceStatusResponseSchema"]
>;
export type OrganizationMemberOpenMeldServiceStatusesResponse = z.infer<
  Schemas["organizationMemberOpenMeldServiceStatusesResponseSchema"]
>;
