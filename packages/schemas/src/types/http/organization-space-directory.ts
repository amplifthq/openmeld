import type { z } from "zod/v4";

type OrganizationSpaceDirectoryItemSchema =
  typeof import("../../schemas/http/organization-space-directory")["organizationSpaceDirectoryItemSchema"];
type OrganizationSpaceDirectoryResponseSchema =
  typeof import("../../schemas/http/organization-space-directory")["organizationSpaceDirectoryResponseSchema"];
type OrganizationSpaceDirectoryWithMemberCountsItemSchema =
  typeof import("../../schemas/http/organization-space-directory")["organizationSpaceDirectoryWithMemberCountsItemSchema"];
type OrganizationSpaceDirectoryWithMemberCountsResponseSchema =
  typeof import("../../schemas/http/organization-space-directory")["organizationSpaceDirectoryWithMemberCountsResponseSchema"];

export type OrganizationSpaceDirectoryItem =
  z.infer<OrganizationSpaceDirectoryItemSchema>;
export type OrganizationSpaceDirectoryResponse =
  z.infer<OrganizationSpaceDirectoryResponseSchema>;
export type OrganizationSpaceDirectoryWithMemberCountsItem =
  z.infer<OrganizationSpaceDirectoryWithMemberCountsItemSchema>;
export type OrganizationSpaceDirectoryWithMemberCountsResponse =
  z.infer<OrganizationSpaceDirectoryWithMemberCountsResponseSchema>;
