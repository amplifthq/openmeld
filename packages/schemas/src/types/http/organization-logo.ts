import type { z } from "zod/v4";

type OrganizationLogoMimeTypeSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoMimeTypeSchema"];
type OrganizationLogoReferenceSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoReferenceSchema"];
type OrganizationLogoPrepareRpcInputSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoPrepareRpcInputSchema"];
type OrganizationLogoPrepareRpcResponseSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoPrepareRpcResponseSchema"];
type OrganizationLogoCommitRpcInputSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoCommitRpcInputSchema"];
type OrganizationLogoCommitRpcResponseSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoCommitRpcResponseSchema"];
type OrganizationLogoMutationErrorCodeSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoMutationErrorCodeSchema"];
type OrganizationLogoResponseSchema =
  typeof import("../../schemas/http/organization-logo")["organizationLogoResponseSchema"];

export type OrganizationLogoMimeType = z.infer<OrganizationLogoMimeTypeSchema>;
export type OrganizationLogoReference =
  z.infer<OrganizationLogoReferenceSchema>;
export type OrganizationLogoPrepareRpcInput =
  z.infer<OrganizationLogoPrepareRpcInputSchema>;
export type OrganizationLogoPrepareRpcResponse =
  z.infer<OrganizationLogoPrepareRpcResponseSchema>;
export type OrganizationLogoCommitRpcInput =
  z.infer<OrganizationLogoCommitRpcInputSchema>;
export type OrganizationLogoCommitRpcResponse =
  z.infer<OrganizationLogoCommitRpcResponseSchema>;
export type OrganizationLogoMutationErrorCode =
  z.infer<OrganizationLogoMutationErrorCodeSchema>;
export type OrganizationLogoResponse = z.infer<OrganizationLogoResponseSchema>;
