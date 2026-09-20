import type { z } from "zod/v4";

export type AuthRpcProfileFact = z.infer<
  typeof import("../../schemas/http/auth-rpc")["authRpcProfileFactSchema"]
>;
export type AuthRpcResolveProfileByIdResult = z.infer<
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveProfileByIdResultSchema"]
>;
export type AuthRpcResolveProfilesByIdsInput = z.infer<
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveProfilesByIdsInputSchema"]
>;
export type AuthRpcResolveProfilesByIdsResult = z.infer<
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveProfilesByIdsResultSchema"]
>;

type OpenMeldRequestedOrganizationSelectorSchema =
  typeof import("../../schemas/http/auth-rpc")["openMeldRequestedOrganizationSelectorSchema"];
type AuthOrganizationContextSourceSchema =
  typeof import("../../schemas/http/auth-rpc")["authOrganizationContextSourceSchema"];
type AuthRpcMethodSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcMethodSchema"];
type AuthRpcClaimsSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcClaimsSchema"];
type AuthRpcResolveRequestAuthInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveRequestAuthInputSchema"];
type AuthRpcResolveRequestAuthResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveRequestAuthResultSchema"];
type AuthRpcResolveProfileInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveProfileInputSchema"];
type AuthRpcResolveProfileResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveProfileResultSchema"];
type AuthRpcResolveRequestAuthWithProfileInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveRequestAuthWithProfileInputSchema"];
type AuthRpcResolveRequestAuthWithProfileResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveRequestAuthWithProfileResultSchema"];
type AuthRpcResolveUserDisplayNameInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveUserDisplayNameInputSchema"];
type AuthRpcResolveUserDisplayNameResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveUserDisplayNameResultSchema"];
type AuthRpcSendInboxUrgentEmailInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcSendInboxUrgentEmailInputSchema"];
type AuthRpcSendInboxUrgentEmailResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcSendInboxUrgentEmailResultSchema"];
type AuthRpcResolveOrganizationAccountIdentityInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveOrganizationAccountIdentityInputSchema"];
type AuthRpcResolveOrganizationAccountIdentityResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveOrganizationAccountIdentityResultSchema"];
type AuthRpcResolveOrganizationDirectoryAgentProfilesInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveOrganizationDirectoryAgentProfilesInputSchema"];
type AuthRpcResolveOrganizationDirectoryAgentProfilesResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveOrganizationDirectoryAgentProfilesResultSchema"];
type AuthRpcResolveOrganizationDirectoryMembersInputSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveOrganizationDirectoryMembersInputSchema"];
type AuthRpcResolveOrganizationDirectoryMembersResultSchema =
  typeof import("../../schemas/http/auth-rpc")["authRpcResolveOrganizationDirectoryMembersResultSchema"];

export type OpenMeldRequestedOrganizationSelector =
  z.infer<OpenMeldRequestedOrganizationSelectorSchema>;
export type AuthOrganizationContextSource =
  z.infer<AuthOrganizationContextSourceSchema>;
export type AuthRpcMethod = z.infer<AuthRpcMethodSchema>;
export type AuthRpcClaims = z.infer<AuthRpcClaimsSchema>;
export type AuthRpcResolveRequestAuthInput =
  z.infer<AuthRpcResolveRequestAuthInputSchema>;
export type AuthRpcResolveRequestAuthResult =
  z.infer<AuthRpcResolveRequestAuthResultSchema>;
export type AuthRpcResolveProfileInput =
  z.infer<AuthRpcResolveProfileInputSchema>;
export type AuthRpcResolveProfileResult =
  z.infer<AuthRpcResolveProfileResultSchema>;
export type AuthRpcResolveRequestAuthWithProfileInput =
  z.infer<AuthRpcResolveRequestAuthWithProfileInputSchema>;
export type AuthRpcResolveRequestAuthWithProfileResult =
  z.infer<AuthRpcResolveRequestAuthWithProfileResultSchema>;
export type AuthRpcResolveUserDisplayNameInput =
  z.infer<AuthRpcResolveUserDisplayNameInputSchema>;
export type AuthRpcResolveUserDisplayNameResult =
  z.infer<AuthRpcResolveUserDisplayNameResultSchema>;
export type AuthRpcSendInboxUrgentEmailInput =
  z.infer<AuthRpcSendInboxUrgentEmailInputSchema>;
export type AuthRpcSendInboxUrgentEmailResult =
  z.infer<AuthRpcSendInboxUrgentEmailResultSchema>;
export type AuthRpcResolveOrganizationAccountIdentityInput =
  z.infer<AuthRpcResolveOrganizationAccountIdentityInputSchema>;
export type AuthRpcResolveOrganizationAccountIdentityResult =
  z.infer<AuthRpcResolveOrganizationAccountIdentityResultSchema>;
export type AuthRpcResolveOrganizationDirectoryAgentProfilesInput =
  z.infer<AuthRpcResolveOrganizationDirectoryAgentProfilesInputSchema>;
export type AuthRpcResolveOrganizationDirectoryAgentProfilesResult =
  z.infer<AuthRpcResolveOrganizationDirectoryAgentProfilesResultSchema>;
export type AuthRpcResolveOrganizationDirectoryMembersInput =
  z.infer<AuthRpcResolveOrganizationDirectoryMembersInputSchema>;
export type AuthRpcResolveOrganizationDirectoryMembersResult =
  z.infer<AuthRpcResolveOrganizationDirectoryMembersResultSchema>;
