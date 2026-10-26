import {
  AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER,
  agentExecutionReadinessRouteParamsSchema,
  agentProfileBindingRouteParamsSchema,
  currentAgentProfileSessionLookupQuerySchema,
  currentAgentProfileSessionLookupResponseSchema,
  disableAgentProfilePrimaryBindingResponseSchema,
  ensureAgentProfilePrimaryBindingBodySchema,
  ensureAgentProfilePrimaryBindingResponseSchema,
  getAgentExecutionReadinessBatchBodySchema,
  getAgentExecutionReadinessBatchResponseSchema,
  getAgentExecutionReadinessResponseSchema,
  getAgentProfileControllerChangeEligibilityResponseSchema,
  getAgentProfilePrimaryBindingResponseSchema,
  notifyAgentProfileRouteCatalogChangedBodySchema,
  notifyAgentProfileRouteCatalogChangedResponseSchema,
  notifyAgentProfilesRouteCatalogChangedBodySchema,
  openMeldRequestContextSchema,
  updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema,
  updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema,
  updateAgentProfilePrimaryBindingModelSelectionBodySchema,
  updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildAgentExecutionReadinessBatchRoute,
  buildAgentExecutionReadinessRoute,
  buildAgentProfileControllerChangeEligibilityRoute,
  buildAgentProfilePrimaryBindingAgentControllerCollaborationModeRoute,
  buildAgentProfilePrimaryBindingAgentControllerPermissionModeRoute,
  buildAgentProfilePrimaryBindingModelSelectionRoute,
  buildAgentProfilePrimaryBindingOpenCodePermissionRoute,
  buildAgentProfilePrimaryBindingRoute,
  buildAgentProfileRouteCatalogSyncRoute,
  buildAgentProfilesRouteCatalogSyncRoute,
  buildCurrentAgentProfileSessionRoute,
} from "./routes";
import type {
  CreateAgentProfileBindingApi,
  DisableAgentProfilePrimaryBindingInput,
  EnsureAgentProfilePrimaryBindingInput,
  GetAgentExecutionReadinessBatchInput,
  GetAgentExecutionReadinessInput,
  GetCurrentAgentProfileSessionInput,
  NotifyAgentProfileRouteCatalogChangedInput,
  NotifyAgentProfilesRouteCatalogChangedInput,
  UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput,
  UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput,
  UpdateAgentProfilePrimaryBindingModelSelectionInput,
  UpdateAgentProfilePrimaryBindingOpenCodePermissionInput,
} from "./types";

const getAgentExecutionReadinessInputSchema =
  agentExecutionReadinessRouteParamsSchema.extend({
    requestContext: openMeldRequestContextSchema.optional(),
  });

const getCurrentAgentProfileSessionInputSchema =
  currentAgentProfileSessionLookupQuerySchema.extend({
    requestContext: openMeldRequestContextSchema.optional(),
  });

function requireValidCurrentAgentProfileSessionInput(
  input: GetCurrentAgentProfileSessionInput
): GetCurrentAgentProfileSessionInput {
  const parsed = getCurrentAgentProfileSessionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid current Agent Profile Session lookup."
    );
  }
  return parsed.data;
}

const getAgentExecutionReadinessBatchInputSchema =
  getAgentExecutionReadinessBatchBodySchema.extend({
    requestContext: openMeldRequestContextSchema.optional(),
  });

const ensureAgentProfilePrimaryBindingInputSchema =
  agentProfileBindingRouteParamsSchema
    .merge(ensureAgentProfilePrimaryBindingBodySchema)
    .extend({
      requestContext: openMeldRequestContextSchema.optional(),
    });

const notifyAgentProfileRouteCatalogChangedInputSchema =
  agentProfileBindingRouteParamsSchema
    .merge(notifyAgentProfileRouteCatalogChangedBodySchema)
    .extend({
      requestContext: openMeldRequestContextSchema.optional(),
    });

const notifyAgentProfilesRouteCatalogChangedInputSchema =
  notifyAgentProfilesRouteCatalogChangedBodySchema.extend({
    requestContext: openMeldRequestContextSchema.optional(),
  });

const updateAgentProfilePrimaryBindingModelSelectionInputSchema =
  agentProfileBindingRouteParamsSchema
    .merge(updateAgentProfilePrimaryBindingModelSelectionBodySchema)
    .extend({
      requestContext: openMeldRequestContextSchema.optional(),
    });

const updateAgentProfilePrimaryBindingAgentControllerPermissionModeInputSchema =
  agentProfileBindingRouteParamsSchema
    .merge(
      updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema
    )
    .extend({
      requestContext: openMeldRequestContextSchema.optional(),
    });

const updateAgentProfilePrimaryBindingAgentControllerCollaborationModeInputSchema =
  agentProfileBindingRouteParamsSchema
    .merge(
      updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema
    )
    .extend({
      requestContext: openMeldRequestContextSchema.optional(),
    });

const updateAgentProfilePrimaryBindingOpenCodePermissionInputSchema =
  agentProfileBindingRouteParamsSchema
    .merge(updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema)
    .extend({
      requestContext: openMeldRequestContextSchema.optional(),
    });

function requireValidBindingCommandBody(
  input: EnsureAgentProfilePrimaryBindingInput
) {
  const parsed = ensureAgentProfilePrimaryBindingInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Profile Binding payload."
    );
  }
  const {
    agentProfileId: _agentProfileId,
    requestContext: _requestContext,
    ...body
  } = parsed.data;
  return body;
}

function requireValidBindingRouteInput(
  input: DisableAgentProfilePrimaryBindingInput
) {
  const parsed = agentProfileBindingRouteParamsSchema
    .extend({
      requestContext: openMeldRequestContextSchema.optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Agent Profile Binding route."
    );
  }
  return parsed.data;
}

function requireValidRouteCatalogChangedBody(
  input: NotifyAgentProfileRouteCatalogChangedInput
) {
  const parsed =
    notifyAgentProfileRouteCatalogChangedInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Profile route catalog notification payload."
    );
  }
  const {
    agentProfileId: _agentProfileId,
    requestContext: _requestContext,
    ...body
  } = parsed.data;
  return body;
}

function requireValidRouteCatalogChangedBatchBody(
  input: NotifyAgentProfilesRouteCatalogChangedInput
) {
  const parsed =
    notifyAgentProfilesRouteCatalogChangedInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Profile route catalog notification payload."
    );
  }
  const { requestContext: _requestContext, ...body } = parsed.data;
  return body;
}

function requireValidModelSelectionPatchBody(
  input: UpdateAgentProfilePrimaryBindingModelSelectionInput
) {
  const parsed =
    updateAgentProfilePrimaryBindingModelSelectionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Profile Binding model selection payload."
    );
  }
  const {
    agentProfileId: _agentProfileId,
    requestContext: _requestContext,
    ...body
  } = parsed.data;
  return body;
}

function requireValidAgentControllerPermissionModePatchBody(
  input: UpdateAgentProfilePrimaryBindingAgentControllerPermissionModeInput
) {
  const parsed =
    updateAgentProfilePrimaryBindingAgentControllerPermissionModeInputSchema.safeParse(
      input
    );
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Profile Binding Agent Controller Permission Mode payload."
    );
  }
  const {
    agentProfileId: _agentProfileId,
    requestContext: _requestContext,
    ...body
  } = parsed.data;
  return body;
}

function requireValidAgentControllerCollaborationModePatchBody(
  input: UpdateAgentProfilePrimaryBindingAgentControllerCollaborationModeInput
) {
  const parsed =
    updateAgentProfilePrimaryBindingAgentControllerCollaborationModeInputSchema.safeParse(
      input
    );
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Profile Binding Agent Controller Collaboration Mode payload."
    );
  }
  const {
    agentProfileId: _agentProfileId,
    requestContext: _requestContext,
    ...body
  } = parsed.data;
  return body;
}

function requireValidOpenCodePermissionPatchBody(
  input: UpdateAgentProfilePrimaryBindingOpenCodePermissionInput
) {
  const parsed =
    updateAgentProfilePrimaryBindingOpenCodePermissionInputSchema.safeParse(
      input
    );
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Profile Binding OpenCode permissions payload."
    );
  }
  const {
    agentProfileId: _agentProfileId,
    requestContext: _requestContext,
    ...body
  } = parsed.data;
  return body;
}

function requireValidExecutionReadinessInput(
  input: GetAgentExecutionReadinessInput
): GetAgentExecutionReadinessInput {
  const parsed = getAgentExecutionReadinessInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Execution Readiness request."
    );
  }
  return parsed.data;
}

function requireValidExecutionReadinessBatchInput(
  input: GetAgentExecutionReadinessBatchInput
): GetAgentExecutionReadinessBatchInput {
  const parsed = getAgentExecutionReadinessBatchInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Agent Execution Readiness batch request."
    );
  }
  return parsed.data;
}

export const createAgentProfileBindingApi: CreateAgentProfileBindingApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    getControllerChangeEligibility: async (input) =>
      await client.requestJson({
        invalidMessage:
          "Invalid Agent Profile Controller change eligibility response.",
        method: "GET",
        operation: "agent_profile_binding.controller_change_eligibility.read",
        requestContext: input.requestContext,
        schema: getAgentProfileControllerChangeEligibilityResponseSchema,
        url: buildAgentProfileControllerChangeEligibilityRoute(
          input.agentProfileId
        ),
      }),
    getExecutionReadiness: async (input) => {
      const request = requireValidExecutionReadinessInput(input);

      return await client.requestJson({
        headers: {
          [AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER]: "2",
        },
        invalidMessage: "Invalid Agent Execution Readiness response.",
        method: "GET",
        operation: "agent_execution_readiness.read",
        requestContext: request.requestContext,
        schema: getAgentExecutionReadinessResponseSchema,
        url: buildAgentExecutionReadinessRoute(request.agentProfileId),
      });
    },
    getExecutionReadinessBatch: async (input) => {
      const { signal, ...body } = input;
      const request = requireValidExecutionReadinessBatchInput(body);

      return await client.requestJson({
        body: JSON.stringify({
          agentProfileIds: request.agentProfileIds,
          ...(request.targetRuntime === undefined
            ? {}
            : { targetRuntime: request.targetRuntime }),
        }),
        headers: {
          "content-type": "application/json",
          [AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER]: "2",
        },
        invalidMessage: "Invalid Agent Execution Readiness batch response.",
        method: "POST",
        operation: "agent_execution_readiness.batch_read",
        signal,
        requestContext: request.requestContext,
        schema: getAgentExecutionReadinessBatchResponseSchema,
        url: buildAgentExecutionReadinessBatchRoute(),
      });
    },
    getPrimaryBinding: async (input) =>
      await client.requestJson({
        invalidMessage: "Invalid Agent Profile Binding response.",
        method: "GET",
        operation: "agent_profile_binding.primary.read",
        requestContext: input.requestContext,
        schema: getAgentProfilePrimaryBindingResponseSchema,
        url: buildAgentProfilePrimaryBindingRoute(input.agentProfileId),
      }),
    getCurrentSession: async (input) => {
      const request = requireValidCurrentAgentProfileSessionInput(input);
      return await client.requestJson({
        invalidMessage: "Invalid current Agent Profile Session response.",
        method: "GET",
        operation: "agent_profile_binding.current_session.read",
        requestContext: request.requestContext,
        schema: currentAgentProfileSessionLookupResponseSchema,
        url: buildCurrentAgentProfileSessionRoute(request),
      });
    },
    ensurePrimaryBinding: async (input) => {
      const body = requireValidBindingCommandBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage: "Invalid Agent Profile Binding command response.",
        method: "PUT",
        operation: "agent_profile_binding.primary.ensure",
        requestContext: input.requestContext,
        schema: ensureAgentProfilePrimaryBindingResponseSchema,
        url: buildAgentProfilePrimaryBindingRoute(input.agentProfileId),
      });
    },
    disablePrimaryBinding: async (input) => {
      const request = requireValidBindingRouteInput(input);
      return await client.requestJson({
        invalidMessage: "Invalid Agent Profile Binding disable response.",
        method: "DELETE",
        operation: "agent_profile_binding.primary.disable",
        requestContext: request.requestContext,
        schema: disableAgentProfilePrimaryBindingResponseSchema,
        url: buildAgentProfilePrimaryBindingRoute(request.agentProfileId),
      });
    },
    notifyRouteCatalogChanged: async (input) => {
      const body = requireValidRouteCatalogChangedBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage:
          "Invalid Agent Profile route catalog notification response.",
        method: "POST",
        operation: "agent_profile_binding.route_catalog_sync",
        requestContext: input.requestContext,
        schema: notifyAgentProfileRouteCatalogChangedResponseSchema,
        url: buildAgentProfileRouteCatalogSyncRoute(input.agentProfileId),
      });
    },
    notifyRouteCatalogChangedBatch: async (input) => {
      const body = requireValidRouteCatalogChangedBatchBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage:
          "Invalid Agent Profile route catalog notification response.",
        method: "POST",
        operation: "agent_profile_binding.route_catalog_sync.batch",
        requestContext: input.requestContext,
        schema: notifyAgentProfileRouteCatalogChangedResponseSchema,
        url: buildAgentProfilesRouteCatalogSyncRoute(),
      });
    },
    updatePrimaryBindingModelSelection: async (input) => {
      const body = requireValidModelSelectionPatchBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage:
          "Invalid Agent Profile Binding model selection response.",
        method: "PATCH",
        operation: "agent_profile_binding.primary.model_selection.update",
        requestContext: input.requestContext,
        schema: ensureAgentProfilePrimaryBindingResponseSchema,
        url: buildAgentProfilePrimaryBindingModelSelectionRoute(
          input.agentProfileId
        ),
      });
    },
    updatePrimaryBindingAgentControllerPermissionMode: async (input) => {
      const body = requireValidAgentControllerPermissionModePatchBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage:
          "Invalid Agent Profile Binding Agent Controller Permission Mode response.",
        method: "PATCH",
        operation:
          "agent_profile_binding.primary.agent_controller_permission_mode.update",
        requestContext: input.requestContext,
        schema: ensureAgentProfilePrimaryBindingResponseSchema,
        url: buildAgentProfilePrimaryBindingAgentControllerPermissionModeRoute(
          input.agentProfileId
        ),
      });
    },
    updatePrimaryBindingAgentControllerCollaborationMode: async (input) => {
      const body = requireValidAgentControllerCollaborationModePatchBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage:
          "Invalid Agent Profile Binding Agent Controller Collaboration Mode response.",
        method: "PATCH",
        operation:
          "agent_profile_binding.primary.agent_controller_collaboration_mode.update",
        requestContext: input.requestContext,
        schema: ensureAgentProfilePrimaryBindingResponseSchema,
        url: buildAgentProfilePrimaryBindingAgentControllerCollaborationModeRoute(
          input.agentProfileId
        ),
      });
    },
    updatePrimaryBindingOpenCodePermission: async (input) => {
      const body = requireValidOpenCodePermissionPatchBody(input);

      return await client.requestJson({
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        invalidMessage:
          "Invalid Agent Profile Binding OpenCode permissions response.",
        method: "PATCH",
        operation: "agent_profile_binding.primary.opencode_permission.update",
        requestContext: input.requestContext,
        schema: ensureAgentProfilePrimaryBindingResponseSchema,
        url: buildAgentProfilePrimaryBindingOpenCodePermissionRoute(
          input.agentProfileId
        ),
      });
    },
  };
};
