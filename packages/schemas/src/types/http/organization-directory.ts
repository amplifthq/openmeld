import type { z } from "zod/v4";

type OrganizationDirectoryHumanProfileSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryHumanProfileSchema"];
type OrganizationDirectoryMemberSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryMemberSchema"];
type OrganizationDirectoryAgentProfileSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryAgentProfileSchema"];
type OrganizationDirectoryAgentProfileIdentitySchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryAgentProfileIdentitySchema"];
type OrganizationDirectoryResponseSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryResponseSchema"];

export type OrganizationDirectoryHumanProfile =
  z.infer<OrganizationDirectoryHumanProfileSchema>;
export type OrganizationDirectoryMember =
  z.infer<OrganizationDirectoryMemberSchema>;
export type OrganizationDirectoryAgentProfile =
  z.infer<OrganizationDirectoryAgentProfileSchema>;
export type OrganizationDirectoryAgentProfileIdentity =
  z.infer<OrganizationDirectoryAgentProfileIdentitySchema>;
export type OrganizationDirectoryResponse =
  z.infer<OrganizationDirectoryResponseSchema>;
