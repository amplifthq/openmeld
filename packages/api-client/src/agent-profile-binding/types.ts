import type {
  AgentExecutionReadinessRouteParams,
  AgentProfileBindingRouteParams,
  AuthorizeAgentProfileBindingForOrganizationResponse,
  DisableAgentProfilePrimaryBindingResponse,
  EnsureAgentProfilePrimaryBindingBody,
  EnsureAgentProfilePrimaryBindingResponse,
  GetAgentExecutionReadinessBatchBody,
  GetAgentExecutionReadinessBatchResponse,
  GetAgentExecutionReadinessResponse,
  GetAgentProfilePrimaryBindingResponse,
  ListCurrentUserAgentProfileOrganizationWakeAccessResponse,
  ListOrganizationBindingAuthorizationsResponse,
  NotifyAgentProfileRouteCatalogChangedBody,
  NotifyAgentProfileRouteCatalogChangedResponse,
  NotifyAgentProfilesRouteCatalogChangedBody,
  OpenMeldRequestContext,
  RevokeAgentProfileBindingForOrganizationResponse,
  UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeBody,
  UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeBody,
  UpdateAgentProfilePrimaryBindingModelSelectionBody,
  UpdateAgentProfilePrimaryBindingOpenCodePermissionBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type GetAgentProfilePrimaryBindingInput =
  AgentProfileBindingRouteParams & {
    requestContext?: OpenMeldRequestContext;
  };

export type GetAgentExecutionReadinessInput =
  AgentExecutionReadinessRouteParams & {
    requestContext?: OpenMeldRequestContext;
  };

export type GetAgentExecutionReadinessBatchInput =
  GetAgentExecutionReadinessBatchBody & {
    requestContext?: OpenMeldRequestContext;
  };

export type EnsureAgentProfilePrimaryBindingInput =
  AgentProfileBindingRouteParams &
    EnsureAgentProfilePrimaryBindingBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type AuthorizeAgentProfileBindingForOrganizationInput =
  AgentProfileBindingRouteParams & {
    requestContext?: OpenMeldRequestContext;
  };

export type RevokeAgentProfileBindingForOrganizationInput =
  AgentProfileBindingRouteParams & {
    requestContext?: OpenMeldRequestContext;
  };

export type DisableAgentProfilePrimaryBindingInput =
  AgentProfileBindingRouteParams & {
    requestContext?: OpenMeldRequestContext;
  };

export type ListOrganizationBindingAuthorizationsInput = {
  requestContext?: OpenMeldRequestContext;
};

export type ListCurrentUserAgentProfileOrganizationWakeAccessInput = {
  requestContext?: OpenMeldRequestContext;
};

export type NotifyAgentProfileRouteCatalogChangedInput =
  AgentProfileBindingRouteParams &
    NotifyAgentProfileRouteCatalogChangedBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type NotifyAgentProfilesRouteCatalogChangedInput =
  NotifyAgentProfilesRouteCatalogChangedBody & {
    requestContext?: OpenMeldRequestContext;
  };

export type UpdateAgentProfilePrimaryBindingModelSelectionInput =
  AgentProfileBindingRouteParams &
    UpdateAgentProfilePrimaryBindingModelSelectionBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput =
  AgentProfileBindingRouteParams &
    UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput =
  AgentProfileBindingRouteParams &
    UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type UpdateAgentProfilePrimaryBindingOpenCodePermissionInput =
  AgentProfileBindingRouteParams &
    UpdateAgentProfilePrimaryBindingOpenCodePermissionBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type CreateAgentProfileBindingApi = (
  client: OpenMeldApiClientFoundation
) => {
  ensurePrimaryBinding: (
    input: EnsureAgentProfilePrimaryBindingInput
  ) => Promise<EnsureAgentProfilePrimaryBindingResponse>;
  authorizePrimaryBindingForOrganization: (
    input: AuthorizeAgentProfileBindingForOrganizationInput
  ) => Promise<AuthorizeAgentProfileBindingForOrganizationResponse>;
  listOrganizationAuthorizations: (
    input?: ListOrganizationBindingAuthorizationsInput
  ) => Promise<ListOrganizationBindingAuthorizationsResponse>;
  listCurrentUserOrganizationWakeAccess: (
    input?: ListCurrentUserAgentProfileOrganizationWakeAccessInput
  ) => Promise<ListCurrentUserAgentProfileOrganizationWakeAccessResponse>;
  revokePrimaryBindingForOrganization: (
    input: RevokeAgentProfileBindingForOrganizationInput
  ) => Promise<RevokeAgentProfileBindingForOrganizationResponse>;
  disablePrimaryBinding: (
    input: DisableAgentProfilePrimaryBindingInput
  ) => Promise<DisableAgentProfilePrimaryBindingResponse>;
  getExecutionReadiness: (
    input: GetAgentExecutionReadinessInput
  ) => Promise<GetAgentExecutionReadinessResponse>;
  getExecutionReadinessBatch: (
    input: GetAgentExecutionReadinessBatchInput
  ) => Promise<GetAgentExecutionReadinessBatchResponse>;
  getPrimaryBinding: (
    input: GetAgentProfilePrimaryBindingInput
  ) => Promise<GetAgentProfilePrimaryBindingResponse>;
  notifyRouteCatalogChanged: (
    input: NotifyAgentProfileRouteCatalogChangedInput
  ) => Promise<NotifyAgentProfileRouteCatalogChangedResponse>;
  notifyRouteCatalogChangedBatch: (
    input: NotifyAgentProfilesRouteCatalogChangedInput
  ) => Promise<NotifyAgentProfileRouteCatalogChangedResponse>;
  updatePrimaryBindingModelSelection: (
    input: UpdateAgentProfilePrimaryBindingModelSelectionInput
  ) => Promise<EnsureAgentProfilePrimaryBindingResponse>;
  updatePrimaryBindingAgentControllerPermissionMode: (
    input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput
  ) => Promise<EnsureAgentProfilePrimaryBindingResponse>;
  updatePrimaryBindingAgentControllerCollaborationMode: (
    input: UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput
  ) => Promise<EnsureAgentProfilePrimaryBindingResponse>;
  updatePrimaryBindingOpenCodePermission: (
    input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput
  ) => Promise<EnsureAgentProfilePrimaryBindingResponse>;
};
