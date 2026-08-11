import type { z } from "zod/v4";

type OrganizationJoinLinkTokenSchema =
  typeof import("../../schemas/http/organization-join-link")["organizationJoinLinkTokenSchema"];
type OrganizationJoinLinkManagementQuerySchema =
  typeof import("../../schemas/http/organization-join-link")["organizationJoinLinkManagementQuerySchema"];
type OrganizationJoinLinkSchema =
  typeof import("../../schemas/http/organization-join-link")["organizationJoinLinkSchema"];
type GetOrganizationJoinLinkResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["getOrganizationJoinLinkResponseSchema"];
type CenterAgentGetOrganizationInviteLinkToolRpcInputSchema =
  typeof import("../../schemas/http/organization-join-link")["centerAgentGetOrganizationInviteLinkToolRpcInputSchema"];
type CenterAgentOrganizationInviteLinkGenerationGuidanceSchema =
  typeof import("../../schemas/http/organization-join-link")["centerAgentOrganizationInviteLinkGenerationGuidanceSchema"];
type CenterAgentGetOrganizationInviteLinkResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["centerAgentGetOrganizationInviteLinkResponseSchema"];
type CenterAgentCreateOrganizationInviteLinkToolRpcInputSchema =
  typeof import("../../schemas/http/organization-join-link")["centerAgentCreateOrganizationInviteLinkToolRpcInputSchema"];
type CenterAgentCreateOrganizationInviteLinkResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["centerAgentCreateOrganizationInviteLinkResponseSchema"];
type EnsureOrganizationJoinLinkOnBehalfOfRpcInputSchema =
  typeof import("../../schemas/http/organization-join-link")["ensureOrganizationJoinLinkOnBehalfOfRpcInputSchema"];
type EnsureOrganizationJoinLinkOnBehalfOfRpcResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema"];
type OrganizationJoinLinkEnsureErrorCodeSchema =
  typeof import("../../schemas/http/organization-join-link")["organizationJoinLinkEnsureErrorCodeSchema"];
type RevokeOrganizationJoinLinkResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["revokeOrganizationJoinLinkResponseSchema"];
type PreviewOrganizationJoinLinkQuerySchema =
  typeof import("../../schemas/http/organization-join-link")["previewOrganizationJoinLinkQuerySchema"];
type PreviewOrganizationJoinLinkResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["previewOrganizationJoinLinkResponseSchema"];
type AcceptOrganizationJoinLinkBodySchema =
  typeof import("../../schemas/http/organization-join-link")["acceptOrganizationJoinLinkBodySchema"];
type AcceptOrganizationJoinLinkResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["acceptOrganizationJoinLinkResponseSchema"];
type OrganizationJoinLinkErrorCodeSchema =
  typeof import("../../schemas/http/organization-join-link")["organizationJoinLinkErrorCodeSchema"];
type OrganizationJoinLinkErrorResponseSchema =
  typeof import("../../schemas/http/organization-join-link")["organizationJoinLinkErrorResponseSchema"];

export type OrganizationJoinLinkToken =
  z.infer<OrganizationJoinLinkTokenSchema>;
export type OrganizationJoinLinkManagementQuery =
  z.infer<OrganizationJoinLinkManagementQuerySchema>;
export type OrganizationJoinLink = z.infer<OrganizationJoinLinkSchema>;
export type GetOrganizationJoinLinkResponse =
  z.infer<GetOrganizationJoinLinkResponseSchema>;
export type CenterAgentGetOrganizationInviteLinkToolRpcInput =
  z.infer<CenterAgentGetOrganizationInviteLinkToolRpcInputSchema>;
export type CenterAgentOrganizationInviteLinkGenerationGuidance =
  z.infer<CenterAgentOrganizationInviteLinkGenerationGuidanceSchema>;
export type CenterAgentGetOrganizationInviteLinkResponse =
  z.infer<CenterAgentGetOrganizationInviteLinkResponseSchema>;
export type CenterAgentCreateOrganizationInviteLinkToolRpcInput =
  z.infer<CenterAgentCreateOrganizationInviteLinkToolRpcInputSchema>;
export type CenterAgentCreateOrganizationInviteLinkResponse =
  z.infer<CenterAgentCreateOrganizationInviteLinkResponseSchema>;
export type EnsureOrganizationJoinLinkOnBehalfOfRpcInput =
  z.infer<EnsureOrganizationJoinLinkOnBehalfOfRpcInputSchema>;
export type EnsureOrganizationJoinLinkOnBehalfOfRpcResponse =
  z.infer<EnsureOrganizationJoinLinkOnBehalfOfRpcResponseSchema>;
export type OrganizationJoinLinkEnsureErrorCode =
  z.infer<OrganizationJoinLinkEnsureErrorCodeSchema>;
export type RevokeOrganizationJoinLinkResponse =
  z.infer<RevokeOrganizationJoinLinkResponseSchema>;
export type PreviewOrganizationJoinLinkQuery =
  z.infer<PreviewOrganizationJoinLinkQuerySchema>;
export type PreviewOrganizationJoinLinkResponse =
  z.infer<PreviewOrganizationJoinLinkResponseSchema>;
export type AcceptOrganizationJoinLinkBody =
  z.infer<AcceptOrganizationJoinLinkBodySchema>;
export type AcceptOrganizationJoinLinkResponse =
  z.infer<AcceptOrganizationJoinLinkResponseSchema>;
export type OrganizationJoinLinkErrorCode =
  z.infer<OrganizationJoinLinkErrorCodeSchema>;
export type OrganizationJoinLinkErrorResponse =
  z.infer<OrganizationJoinLinkErrorResponseSchema>;
