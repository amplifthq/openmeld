import type { z } from "zod/v4";

type AgentProfileBindingAuthoritySourceSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingAuthoritySourceSchema"];
type AgentProfileBindingAgentControllerPermissionModeSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingAgentControllerPermissionModeSchema"];
type AgentProfileBindingAgentControllerCollaborationModeSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingAgentControllerCollaborationModeSchema"];
type AgentProfileBindingDispatchEligibilitySchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingDispatchEligibilitySchema"];
type AgentProfileBindingModelSelectionSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingModelSelectionSchema"];
type AgentProfileBindingOpenCodePermissionSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingOpenCodePermissionSchema"];
type AgentProfileBindingProjectionSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingProjectionSchema"];
type AgentProfileBindingResolutionSourceSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingResolutionSourceSchema"];
type AgentProfileBindingRouteParamsSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingRouteParamsSchema"];
type AgentProfileBindingExecutionTargetSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingAgentControllerReportSchema"];
type AgentProfileBindingRuntimeIdSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingRuntimeIdSchema"];
type AgentProfileBindingStateSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingStateSchema"];
type AgentProfileBindingWriteModeSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingWriteModeSchema"];
type AgentProfileBindingSessionInventorySelectionSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileBindingSessionInventorySelectionSchema"];
type AgentProfileCreationDefaultsSchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileCreationDefaultsSchema"];
type GetAgentProfileCreationDefaultsResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["getAgentProfileCreationDefaultsResponseSchema"];
type SetAgentProfileCreationDefaultsBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["setAgentProfileCreationDefaultsBodySchema"];
type SetAgentProfileCreationDefaultsResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["setAgentProfileCreationDefaultsResponseSchema"];
type ListAgentProfileCreationDefaultsResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["listAgentProfileCreationDefaultsResponseSchema"];
type EnsureAgentProfilePrimaryBindingBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["ensureAgentProfilePrimaryBindingBodySchema"];
type EnsureAgentProfilePrimaryBindingResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["ensureAgentProfilePrimaryBindingResponseSchema"];
type AuthorizeAgentProfileBindingForOrganizationResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["authorizeAgentProfileBindingForOrganizationResponseSchema"];
type BulkAuthorizeAgentProfileBindingsForOrganizationBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["bulkAuthorizeAgentProfileBindingsForOrganizationBodySchema"];
type BulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["bulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema"];
type BulkOrganizationBindingAuthorizationSchema =
  typeof import("../../schemas/http/agent-profile-binding")["bulkOrganizationBindingAuthorizationSchema"];
type OrganizationBindingAuthorizationSchema =
  typeof import("../../schemas/http/agent-profile-binding")["organizationBindingAuthorizationSchema"];
type OrganizationBindingAuthorizationPreferenceSchema =
  typeof import("../../schemas/http/agent-profile-binding")["organizationBindingAuthorizationPreferenceSchema"];
type GetOrganizationBindingAuthorizationPreferenceResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["getOrganizationBindingAuthorizationPreferenceResponseSchema"];
type ListOrganizationBindingAuthorizationsResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["listOrganizationBindingAuthorizationsResponseSchema"];
type OrganizationBindingAuthorizationProfileStatusSchema =
  typeof import("../../schemas/http/agent-profile-binding")["organizationBindingAuthorizationProfileStatusSchema"];
type OrganizationBindingAuthorizationProfileSchema =
  typeof import("../../schemas/http/agent-profile-binding")["organizationBindingAuthorizationProfileSchema"];
type ListOrganizationBindingAuthorizationProfilesResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["listOrganizationBindingAuthorizationProfilesResponseSchema"];
type AgentProfileOrganizationWakeAccessEntrySchema =
  typeof import("../../schemas/http/agent-profile-binding")["agentProfileOrganizationWakeAccessEntrySchema"];
type ListCurrentUserAgentProfileOrganizationWakeAccessResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["listCurrentUserAgentProfileOrganizationWakeAccessResponseSchema"];
type RevokeAgentProfileBindingForOrganizationResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["revokeAgentProfileBindingForOrganizationResponseSchema"];
type SetOrganizationBindingAuthorizationPreferenceBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["setOrganizationBindingAuthorizationPreferenceBodySchema"];
type SetOrganizationBindingAuthorizationPreferenceResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["setOrganizationBindingAuthorizationPreferenceResponseSchema"];
type SaveOrganizationWakeAccessChoiceBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["saveOrganizationWakeAccessChoiceBodySchema"];
type SaveOrganizationWakeAccessChoiceResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["saveOrganizationWakeAccessChoiceResponseSchema"];
type DisableAgentProfilePrimaryBindingResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["disableAgentProfilePrimaryBindingResponseSchema"];
type GetAgentProfilePrimaryBindingResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["getAgentProfilePrimaryBindingResponseSchema"];
type GetAgentProfileControllerChangeEligibilityResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["getAgentProfileControllerChangeEligibilityResponseSchema"];
type NotifyAgentProfileRouteCatalogChangedBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["notifyAgentProfileRouteCatalogChangedBodySchema"];
type NotifyAgentProfilesRouteCatalogChangedBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["notifyAgentProfilesRouteCatalogChangedBodySchema"];
type NotifyAgentProfileRouteCatalogChangedResponseSchema =
  typeof import("../../schemas/http/agent-profile-binding")["notifyAgentProfileRouteCatalogChangedResponseSchema"];
type UpdateAgentProfilePrimaryBindingModelSelectionBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["updateAgentProfilePrimaryBindingModelSelectionBodySchema"];
type UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema"];
type UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema"];
type UpdateAgentProfilePrimaryBindingOpenCodePermissionBodySchema =
  typeof import("../../schemas/http/agent-profile-binding")["updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema"];

export type AgentProfileBindingAgentControllerPermissionMode =
  z.infer<AgentProfileBindingAgentControllerPermissionModeSchema>;
export type AgentProfileBindingAgentControllerCollaborationMode =
  z.infer<AgentProfileBindingAgentControllerCollaborationModeSchema>;
export type AgentProfileBindingAuthoritySource =
  z.infer<AgentProfileBindingAuthoritySourceSchema>;
export type AgentProfileBindingDispatchEligibility =
  z.infer<AgentProfileBindingDispatchEligibilitySchema>;
export type AgentProfileBindingModelSelection =
  z.infer<AgentProfileBindingModelSelectionSchema>;
export type AgentProfileBindingOpenCodePermission =
  z.infer<AgentProfileBindingOpenCodePermissionSchema>;
export type AgentProfileBindingProjection =
  z.infer<AgentProfileBindingProjectionSchema>;
export type AgentProfileBindingResolutionSource =
  z.infer<AgentProfileBindingResolutionSourceSchema>;
export type AgentProfileBindingRouteParams =
  z.infer<AgentProfileBindingRouteParamsSchema>;
export type AgentProfileBindingExecutionTarget =
  z.infer<AgentProfileBindingExecutionTargetSchema>;
export type AgentProfileBindingRuntimeId =
  z.infer<AgentProfileBindingRuntimeIdSchema>;
export type AgentProfileBindingState = z.infer<AgentProfileBindingStateSchema>;
export type AgentProfileBindingWriteMode =
  z.infer<AgentProfileBindingWriteModeSchema>;
export type AgentProfileCreationDefaults =
  z.infer<AgentProfileCreationDefaultsSchema>;
export type GetAgentProfileCreationDefaultsResponse =
  z.infer<GetAgentProfileCreationDefaultsResponseSchema>;
export type SetAgentProfileCreationDefaultsBody =
  z.infer<SetAgentProfileCreationDefaultsBodySchema>;
export type SetAgentProfileCreationDefaultsResponse =
  z.infer<SetAgentProfileCreationDefaultsResponseSchema>;
export type ListAgentProfileCreationDefaultsResponse =
  z.infer<ListAgentProfileCreationDefaultsResponseSchema>;
export type EnsureAgentProfilePrimaryBindingBody =
  z.infer<EnsureAgentProfilePrimaryBindingBodySchema>;
export type AgentProfileBindingSessionInventorySelection =
  z.infer<AgentProfileBindingSessionInventorySelectionSchema>;
export type EnsureAgentProfilePrimaryBindingResponse =
  z.infer<EnsureAgentProfilePrimaryBindingResponseSchema>;
export type AuthorizeAgentProfileBindingForOrganizationResponse =
  z.infer<AuthorizeAgentProfileBindingForOrganizationResponseSchema>;
export type BulkAuthorizeAgentProfileBindingsForOrganizationBody =
  z.infer<BulkAuthorizeAgentProfileBindingsForOrganizationBodySchema>;
export type BulkAuthorizeAgentProfileBindingsForOrganizationResponse =
  z.infer<BulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema>;
export type BulkOrganizationBindingAuthorization =
  z.infer<BulkOrganizationBindingAuthorizationSchema>;
export type OrganizationBindingAuthorization =
  z.infer<OrganizationBindingAuthorizationSchema>;
export type OrganizationBindingAuthorizationPreference =
  z.infer<OrganizationBindingAuthorizationPreferenceSchema>;
export type GetOrganizationBindingAuthorizationPreferenceResponse =
  z.infer<GetOrganizationBindingAuthorizationPreferenceResponseSchema>;
export type ListOrganizationBindingAuthorizationsResponse =
  z.infer<ListOrganizationBindingAuthorizationsResponseSchema>;
export type OrganizationBindingAuthorizationProfileStatus =
  z.infer<OrganizationBindingAuthorizationProfileStatusSchema>;
export type OrganizationBindingAuthorizationProfile =
  z.infer<OrganizationBindingAuthorizationProfileSchema>;
export type ListOrganizationBindingAuthorizationProfilesResponse =
  z.infer<ListOrganizationBindingAuthorizationProfilesResponseSchema>;
export type AgentProfileOrganizationWakeAccessEntry =
  z.infer<AgentProfileOrganizationWakeAccessEntrySchema>;
export type ListCurrentUserAgentProfileOrganizationWakeAccessResponse =
  z.infer<ListCurrentUserAgentProfileOrganizationWakeAccessResponseSchema>;
export type RevokeAgentProfileBindingForOrganizationResponse =
  z.infer<RevokeAgentProfileBindingForOrganizationResponseSchema>;
export type SetOrganizationBindingAuthorizationPreferenceBody =
  z.infer<SetOrganizationBindingAuthorizationPreferenceBodySchema>;
export type SetOrganizationBindingAuthorizationPreferenceResponse =
  z.infer<SetOrganizationBindingAuthorizationPreferenceResponseSchema>;
export type SaveOrganizationWakeAccessChoiceBody =
  z.infer<SaveOrganizationWakeAccessChoiceBodySchema>;
export type SaveOrganizationWakeAccessChoiceResponse =
  z.infer<SaveOrganizationWakeAccessChoiceResponseSchema>;
export type DisableAgentProfilePrimaryBindingResponse =
  z.infer<DisableAgentProfilePrimaryBindingResponseSchema>;
export type GetAgentProfilePrimaryBindingResponse =
  z.infer<GetAgentProfilePrimaryBindingResponseSchema>;
export type GetAgentProfileControllerChangeEligibilityResponse =
  z.infer<GetAgentProfileControllerChangeEligibilityResponseSchema>;
export type NotifyAgentProfileRouteCatalogChangedBody =
  z.infer<NotifyAgentProfileRouteCatalogChangedBodySchema>;
export type NotifyAgentProfilesRouteCatalogChangedBody =
  z.infer<NotifyAgentProfilesRouteCatalogChangedBodySchema>;
export type NotifyAgentProfileRouteCatalogChangedResponse =
  z.infer<NotifyAgentProfileRouteCatalogChangedResponseSchema>;
export type UpdateAgentProfilePrimaryBindingModelSelectionBody =
  z.infer<UpdateAgentProfilePrimaryBindingModelSelectionBodySchema>;
export type UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeBody =
  z.infer<UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema>;
export type UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeBody =
  z.infer<UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema>;
export type UpdateAgentProfilePrimaryBindingOpenCodePermissionBody =
  z.infer<UpdateAgentProfilePrimaryBindingOpenCodePermissionBodySchema>;
