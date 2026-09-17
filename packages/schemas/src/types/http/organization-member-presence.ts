import type { z } from "zod/v4";

export type OrganizationMemberPresenceBody = z.infer<
  typeof import("../../schemas/http/organization-member-presence").organizationMemberPresenceBodySchema
>;
export type OrganizationMemberPresenceResponse = z.infer<
  typeof import("../../schemas/http/organization-member-presence").organizationMemberPresenceResponseSchema
>;
