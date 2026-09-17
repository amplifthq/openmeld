import type { z } from "zod/v4";

type OrganizationDirectoryHumanProfileSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryHumanProfileSchema"];
type OrganizationDirectoryMemberSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryMemberSchema"];
type OrganizationDirectoryAgentProfileSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryAgentProfileSchema"];
type OrganizationDirectoryAgentProfileOperationalContextSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryAgentProfileOperationalContextSchema"];
type OrganizationDirectoryAgentProfileWorkLocationSchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryAgentProfileWorkLocationSchema"];
type OrganizationDirectoryAgentProfileIdentitySchema =
  typeof import("../../schemas/http/organization-directory")["organizationDirectoryAgentProfileIdentitySchema"];
type OrganizationProfileDirectoryAgentProfileSchema =
  typeof import("../../schemas/http/organization-directory")["organizationProfileDirectoryAgentProfileSchema"];
type OrganizationProfileDirectoryResponseSchema =
  typeof import("../../schemas/http/organization-directory")["organizationProfileDirectoryResponseSchema"];
type OrganizationAgentRuntimeOverviewItemSchema =
  typeof import("../../schemas/http/organization-directory")["organizationAgentRuntimeOverviewItemSchema"];
type OrganizationAgentRuntimeOverviewResponseSchema =
  typeof import("../../schemas/http/organization-directory")["organizationAgentRuntimeOverviewResponseSchema"];
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

export type OrganizationProfileDirectoryReadOptions = z.infer<
  typeof import("../../schemas/http/organization-directory")["organizationProfileDirectoryReadOptionsSchema"]
>;

export type OrganizationDirectoryHumanProfile =
  z.infer<OrganizationDirectoryHumanProfileSchema>;
export type OrganizationDirectoryMember =
  z.infer<OrganizationDirectoryMemberSchema>;
export type OrganizationDirectoryAgentProfile =
  z.infer<OrganizationDirectoryAgentProfileSchema>;
export type OrganizationDirectoryAgentProfileOperationalContext =
  z.infer<OrganizationDirectoryAgentProfileOperationalContextSchema>;
export type OrganizationDirectoryAgentProfileWorkLocation =
  z.infer<OrganizationDirectoryAgentProfileWorkLocationSchema>;
export type OrganizationDirectoryAgentProfileIdentity =
  z.infer<OrganizationDirectoryAgentProfileIdentitySchema>;
export type OrganizationProfileDirectoryAgentProfile =
  z.infer<OrganizationProfileDirectoryAgentProfileSchema>;
export type OrganizationProfileDirectoryResponse =
  z.infer<OrganizationProfileDirectoryResponseSchema>;
export type OrganizationAgentRuntimeOverviewItem =
  z.infer<OrganizationAgentRuntimeOverviewItemSchema>;
export type OrganizationAgentRuntimeOverviewResponse =
  z.infer<OrganizationAgentRuntimeOverviewResponseSchema>;
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
