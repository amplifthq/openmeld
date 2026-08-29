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
type OrganizationMemberWebActivityResponseSchema =
  typeof import("../../schemas/http/organization-directory")["organizationMemberWebActivityResponseSchema"];
type CenterAgentListOrganizationMembersBodySchema =
  typeof import("../../schemas/http/organization-directory")["centerAgentListOrganizationMembersBodySchema"];
type CenterAgentListOrganizationMembersResponseSchema =
  typeof import("../../schemas/http/organization-directory")["centerAgentListOrganizationMembersResponseSchema"];
type CenterAgentListOrganizationMembersToolRpcInputSchema =
  typeof import("../../schemas/http/organization-directory")["centerAgentListOrganizationMembersToolRpcInputSchema"];

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
export type OrganizationMemberWebActivityResponse =
  z.infer<OrganizationMemberWebActivityResponseSchema>;
export type CenterAgentListOrganizationMembersBody =
  z.infer<CenterAgentListOrganizationMembersBodySchema>;
export type CenterAgentListOrganizationMembersResponse =
  z.infer<CenterAgentListOrganizationMembersResponseSchema>;
export type CenterAgentListOrganizationMembersToolRpcInput =
  z.infer<CenterAgentListOrganizationMembersToolRpcInputSchema>;
