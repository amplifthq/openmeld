import type {
  AgentExecutionReadinessRouteParams,
  AgentProfileBindingRouteParams,
  CurrentAgentProfileSessionLookupQuery,
  CurrentAgentProfileSessionLookupResponse,
  DisableAgentProfilePrimaryBindingResponse,
  EnsureAgentProfilePrimaryBindingBody,
  EnsureAgentProfilePrimaryBindingResponse,
  GetAgentExecutionReadinessBatchBody,
  GetAgentExecutionReadinessBatchResponse,
  GetAgentExecutionReadinessResponse,
  GetAgentProfileControllerChangeEligibilityResponse,
  GetAgentProfilePrimaryBindingResponse,
  NotifyAgentProfileRouteCatalogChangedBody,
  NotifyAgentProfileRouteCatalogChangedResponse,
  NotifyAgentProfilesRouteCatalogChangedBody,
  OpenMeldRequestContext,
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

export type GetCurrentAgentProfileSessionInput =
  CurrentAgentProfileSessionLookupQuery & {
    requestContext?: OpenMeldRequestContext;
  };

export type GetAgentProfileControllerChangeEligibilityInput =
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
    signal?: AbortSignal;
  };

export type EnsureAgentProfilePrimaryBindingInput =
  AgentProfileBindingRouteParams &
    EnsureAgentProfilePrimaryBindingBody & {
      requestContext?: OpenMeldRequestContext;
    };

export type DisableAgentProfilePrimaryBindingInput =
  AgentProfileBindingRouteParams & {
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
  getCurrentSession: (
    input: GetCurrentAgentProfileSessionInput
  ) => Promise<CurrentAgentProfileSessionLookupResponse>;
  getControllerChangeEligibility: (
    input: GetAgentProfileControllerChangeEligibilityInput
  ) => Promise<GetAgentProfileControllerChangeEligibilityResponse>;
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
