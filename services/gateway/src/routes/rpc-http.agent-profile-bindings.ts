import {
  agentExecutionReadinessRouteParamsSchema,
  agentProfileBindingRouteParamsSchema,
  authorizeAgentProfileBindingForOrganizationResponseSchema,
  disableAgentProfilePrimaryBindingResponseSchema,
  ensureAgentProfilePrimaryBindingBodySchema,
  ensureAgentProfilePrimaryBindingResponseSchema,
  getAgentExecutionReadinessBatchBodySchema,
  getAgentExecutionReadinessBatchResponseSchema,
  getAgentExecutionReadinessResponseSchema,
  getAgentProfilePrimaryBindingResponseSchema,
  listCurrentUserAgentProfileOrganizationWakeAccessResponseSchema,
  listOrganizationBindingAuthorizationsResponseSchema,
  notifyAgentProfileRouteCatalogChangedBodySchema,
  notifyAgentProfileRouteCatalogChangedResponseSchema,
  notifyAgentProfilesRouteCatalogChangedBodySchema,
  revokeAgentProfileBindingForOrganizationResponseSchema,
  updateAgentProfileDefaultProjectBodySchema,
  updateAgentProfileDefaultProjectResponseSchema,
  updateAgentProfileDefaultProjectRouteParamsSchema,
  updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema,
  updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema,
  updateAgentProfilePrimaryBindingModelSelectionBodySchema,
  updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const AGENT_PROFILE_BINDING_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding";
const AGENT_PROFILE_DEFAULT_PROJECT_ROUTE =
  "/v1/agent-profiles/:agentProfileId/default-project";
const AGENT_PROFILE_BINDING_MODEL_SELECTION_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/model-selection";
const AGENT_PROFILE_BINDING_AGENT_CONTROLLER_PERMISSION_MODE_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/agent-controller-permission-mode";
const AGENT_PROFILE_BINDING_AGENT_CONTROLLER_COLLABORATION_MODE_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/agent-controller-collaboration-mode";
const AGENT_PROFILE_BINDING_OPEN_CODE_PERMISSION_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/opencode-permission";
const AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATION_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/organization-authorization";
const AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATIONS_ROUTE =
  "/v1/agent-profiles/primary-bindings/organization-authorizations";
const AGENT_PROFILE_ORGANIZATION_WAKE_ACCESS_ROUTE =
  "/v1/agent-profiles/primary-bindings/organization-wake-access";
const AGENT_PROFILE_ROUTE_CATALOG_SYNC_ROUTE =
  "/v1/agent-profiles/:agentProfileId/route-catalog-sync";
const AGENT_PROFILES_ROUTE_CATALOG_SYNC_ROUTE =
  "/v1/agent-profiles/route-catalog-sync";
const AGENT_EXECUTION_READINESS_ROUTE =
  "/v1/agent-profiles/:agentProfileId/execution-readiness";
const AGENT_EXECUTION_READINESS_BATCH_ROUTE =
  "/v1/agent-profiles/execution-readiness/batch";

export function registerAgentProfileBindingRoutes(
  app: Hono<HonoBindings>
): void {
  app.patch(AGENT_PROFILE_DEFAULT_PROJECT_ROUTE, async (c) => {
    const routeParams =
      updateAgentProfileDefaultProjectRouteParamsSchema.safeParse({
        agentProfileId: c.req.param("agentProfileId"),
      });
    if (!routeParams.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_DEFAULT_PROJECT_ROUTE,
        method: "PATCH",
        code: "invalid_payload",
        message:
          routeParams.error.issues[0]?.message ??
          "Agent Profile default Project route is invalid",
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_DEFAULT_PROJECT_ROUTE,
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = updateAgentProfileDefaultProjectBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_DEFAULT_PROJECT_ROUTE,
        method: "PATCH",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Profile default Project payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_DEFAULT_PROJECT_ROUTE,
      method: "PATCH",
      responseSchema: updateAgentProfileDefaultProjectResponseSchema,
      execute: async () =>
        await c.var.coreRpc.updateAgentProfileDefaultProject({
          ...parsedBody.data,
          agentProfileId: routeParams.data.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(AGENT_PROFILE_BINDING_ROUTE, (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_ROUTE,
      method: "GET",
      responseSchema: getAgentProfilePrimaryBindingResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getAgentProfilePrimaryBinding({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.delete(AGENT_PROFILE_BINDING_ROUTE, (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_ROUTE,
        method: "DELETE",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_ROUTE,
      method: "DELETE",
      responseSchema: disableAgentProfilePrimaryBindingResponseSchema,
      execute: async () =>
        await c.var.coreRpc.disableAgentProfilePrimaryBinding({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.put(AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATION_ROUTE, (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATION_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATION_ROUTE,
      method: "PUT",
      responseSchema: authorizeAgentProfileBindingForOrganizationResponseSchema,
      execute: async () =>
        await c.var.coreRpc.authorizeAgentProfileBindingForOrganization({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATIONS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATIONS_ROUTE,
      method: "GET",
      responseSchema: listOrganizationBindingAuthorizationsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listOrganizationBindingAuthorizations({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.get(AGENT_PROFILE_ORGANIZATION_WAKE_ACCESS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: AGENT_PROFILE_ORGANIZATION_WAKE_ACCESS_ROUTE,
      method: "GET",
      responseSchema:
        listCurrentUserAgentProfileOrganizationWakeAccessResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listCurrentUserAgentProfileOrganizationWakeAccess({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.delete(AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATION_ROUTE, (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATION_ROUTE,
        method: "DELETE",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_ORGANIZATION_AUTHORIZATION_ROUTE,
      method: "DELETE",
      responseSchema: revokeAgentProfileBindingForOrganizationResponseSchema,
      execute: async () =>
        await c.var.coreRpc.revokeAgentProfileBindingForOrganization({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(AGENT_EXECUTION_READINESS_ROUTE, (c) => {
    const routeParams = parseAgentExecutionReadinessRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_EXECUTION_READINESS_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_EXECUTION_READINESS_ROUTE,
      method: "GET",
      responseSchema: getAgentExecutionReadinessResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getAgentExecutionReadiness({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(AGENT_EXECUTION_READINESS_BATCH_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_EXECUTION_READINESS_BATCH_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = getAgentExecutionReadinessBatchBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_EXECUTION_READINESS_BATCH_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Execution Readiness batch payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_EXECUTION_READINESS_BATCH_ROUTE,
      method: "POST",
      responseSchema: getAgentExecutionReadinessBatchResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getAgentExecutionReadinessBatch({
          agentProfileIds: parsedBody.data.agentProfileIds,
          ...(parsedBody.data.targetRuntime === undefined
            ? {}
            : { targetRuntime: parsedBody.data.targetRuntime }),
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.put(AGENT_PROFILE_BINDING_ROUTE, async (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = ensureAgentProfilePrimaryBindingBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Profile Binding payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_ROUTE,
      method: "PUT",
      responseSchema: ensureAgentProfilePrimaryBindingResponseSchema,
      execute: async () =>
        await c.var.coreRpc.ensureAgentProfilePrimaryBinding({
          agentProfileId: routeParams.value.agentProfileId,
          agentControllerRef: parsedBody.data.agentControllerRef,
          agentControllerConversationId:
            parsedBody.data.agentControllerConversationId,
          context: buildCoreRpcContext(c),
          deviceId: parsedBody.data.deviceId,
          lane: parsedBody.data.lane,
          openMeldServiceRuntimeId: parsedBody.data.openMeldServiceRuntimeId,
          ...(parsedBody.data.modelId
            ? { modelId: parsedBody.data.modelId }
            : {}),
          ...(parsedBody.data.reasoningLevel
            ? { reasoningLevel: parsedBody.data.reasoningLevel }
            : {}),
          ...(parsedBody.data.agentControllerPermissionMode
            ? {
                agentControllerPermissionMode:
                  parsedBody.data.agentControllerPermissionMode,
              }
            : {}),
          ...(parsedBody.data.agentControllerCollaborationMode
            ? {
                agentControllerCollaborationMode:
                  parsedBody.data.agentControllerCollaborationMode,
              }
            : {}),
          ...(parsedBody.data.openCodePermission
            ? { openCodePermission: parsedBody.data.openCodePermission }
            : {}),
          ...(parsedBody.data.sessionInventorySelection
            ? {
                sessionInventorySelection:
                  parsedBody.data.sessionInventorySelection,
              }
            : {}),
          writeMode: parsedBody.data.writeMode,
        }),
    });
  });

  app.patch(
    AGENT_PROFILE_BINDING_AGENT_CONTROLLER_COLLABORATION_MODE_ROUTE,
    async (c) => {
      const routeParams = parseAgentProfileBindingRouteParams({
        agentProfileId: c.req.param("agentProfileId"),
      });
      if (!routeParams.ok) {
        return respondBadRequest({
          c,
          route:
            AGENT_PROFILE_BINDING_AGENT_CONTROLLER_COLLABORATION_MODE_ROUTE,
          method: "PATCH",
          code: "invalid_payload",
          message: routeParams.message,
        });
      }

      const bodyResult = await readJsonRequestBody(c.req.raw);
      if (!bodyResult.ok) {
        return respondBadRequest({
          c,
          route:
            AGENT_PROFILE_BINDING_AGENT_CONTROLLER_COLLABORATION_MODE_ROUTE,
          method: "PATCH",
          code: "invalid_json",
          message: bodyResult.message,
        });
      }

      const parsedBody =
        updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema.safeParse(
          bodyResult.value
        );
      if (!parsedBody.success) {
        return respondBadRequest({
          c,
          route:
            AGENT_PROFILE_BINDING_AGENT_CONTROLLER_COLLABORATION_MODE_ROUTE,
          method: "PATCH",
          code: "invalid_payload",
          message:
            parsedBody.error.issues[0]?.message ??
            "Agent Profile Binding Agent Controller Collaboration Mode payload is invalid",
        });
      }

      return executeRpcRoute({
        c,
        route: AGENT_PROFILE_BINDING_AGENT_CONTROLLER_COLLABORATION_MODE_ROUTE,
        method: "PATCH",
        responseSchema: ensureAgentProfilePrimaryBindingResponseSchema,
        execute: async () =>
          await c.var.coreRpc.updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(
            {
              agentProfileId: routeParams.value.agentProfileId,
              agentControllerCollaborationMode:
                parsedBody.data.agentControllerCollaborationMode,
              context: buildCoreRpcContext(c),
            }
          ),
      });
    }
  );

  app.patch(
    AGENT_PROFILE_BINDING_AGENT_CONTROLLER_PERMISSION_MODE_ROUTE,
    async (c) => {
      const routeParams = parseAgentProfileBindingRouteParams({
        agentProfileId: c.req.param("agentProfileId"),
      });
      if (!routeParams.ok) {
        return respondBadRequest({
          c,
          route: AGENT_PROFILE_BINDING_AGENT_CONTROLLER_PERMISSION_MODE_ROUTE,
          method: "PATCH",
          code: "invalid_payload",
          message: routeParams.message,
        });
      }

      const bodyResult = await readJsonRequestBody(c.req.raw);
      if (!bodyResult.ok) {
        return respondBadRequest({
          c,
          route: AGENT_PROFILE_BINDING_AGENT_CONTROLLER_PERMISSION_MODE_ROUTE,
          method: "PATCH",
          code: "invalid_json",
          message: bodyResult.message,
        });
      }

      const parsedBody =
        updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema.safeParse(
          bodyResult.value
        );
      if (!parsedBody.success) {
        return respondBadRequest({
          c,
          route: AGENT_PROFILE_BINDING_AGENT_CONTROLLER_PERMISSION_MODE_ROUTE,
          method: "PATCH",
          code: "invalid_payload",
          message:
            parsedBody.error.issues[0]?.message ??
            "Agent Profile Binding Agent Controller Permission Mode payload is invalid",
        });
      }

      return executeRpcRoute({
        c,
        route: AGENT_PROFILE_BINDING_AGENT_CONTROLLER_PERMISSION_MODE_ROUTE,
        method: "PATCH",
        responseSchema: ensureAgentProfilePrimaryBindingResponseSchema,
        execute: async () =>
          await c.var.coreRpc.updateAgentProfilePrimaryBindingAgentControllerPermissionMode(
            {
              agentProfileId: routeParams.value.agentProfileId,
              agentControllerPermissionMode:
                parsedBody.data.agentControllerPermissionMode,
              context: buildCoreRpcContext(c),
            }
          ),
      });
    }
  );

  app.patch(AGENT_PROFILE_BINDING_OPEN_CODE_PERMISSION_ROUTE, async (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_OPEN_CODE_PERMISSION_ROUTE,
        method: "PATCH",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_OPEN_CODE_PERMISSION_ROUTE,
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody =
      updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema.safeParse(
        bodyResult.value
      );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_OPEN_CODE_PERMISSION_ROUTE,
        method: "PATCH",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Profile Binding OpenCode permissions payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_OPEN_CODE_PERMISSION_ROUTE,
      method: "PATCH",
      responseSchema: ensureAgentProfilePrimaryBindingResponseSchema,
      execute: async () =>
        await c.var.coreRpc.updateAgentProfilePrimaryBindingOpenCodePermission({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
          openCodePermission: parsedBody.data.openCodePermission,
        }),
    });
  });

  app.patch(AGENT_PROFILE_BINDING_MODEL_SELECTION_ROUTE, async (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_MODEL_SELECTION_ROUTE,
        method: "PATCH",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_MODEL_SELECTION_ROUTE,
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody =
      updateAgentProfilePrimaryBindingModelSelectionBodySchema.safeParse(
        bodyResult.value
      );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_BINDING_MODEL_SELECTION_ROUTE,
        method: "PATCH",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Profile Binding model selection payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_BINDING_MODEL_SELECTION_ROUTE,
      method: "PATCH",
      responseSchema: ensureAgentProfilePrimaryBindingResponseSchema,
      execute: async () =>
        await c.var.coreRpc.updateAgentProfilePrimaryBindingModelSelection({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
          modelId: parsedBody.data.modelId,
          ...(parsedBody.data.reasoningLevel
            ? { reasoningLevel: parsedBody.data.reasoningLevel }
            : {}),
        }),
    });
  });

  app.post(AGENT_PROFILE_ROUTE_CATALOG_SYNC_ROUTE, async (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_ROUTE_CATALOG_SYNC_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_ROUTE_CATALOG_SYNC_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody =
      notifyAgentProfileRouteCatalogChangedBodySchema.safeParse(
        bodyResult.value
      );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_ROUTE_CATALOG_SYNC_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Profile route catalog notification payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_ROUTE_CATALOG_SYNC_ROUTE,
      method: "POST",
      responseSchema: notifyAgentProfileRouteCatalogChangedResponseSchema,
      execute: async () =>
        await c.var.coreRpc.notifyAgentProfileRouteCatalogChanged({
          agentProfileId: routeParams.value.agentProfileId,
          context: buildCoreRpcContext(c),
          reason: parsedBody.data.reason,
        }),
    });
  });

  app.post(AGENT_PROFILES_ROUTE_CATALOG_SYNC_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILES_ROUTE_CATALOG_SYNC_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody =
      notifyAgentProfilesRouteCatalogChangedBodySchema.safeParse(
        bodyResult.value
      );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILES_ROUTE_CATALOG_SYNC_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Agent Profile route catalog notification payload is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILES_ROUTE_CATALOG_SYNC_ROUTE,
      method: "POST",
      responseSchema: notifyAgentProfileRouteCatalogChangedResponseSchema,
      execute: async () =>
        await c.var.coreRpc.notifyAgentProfilesRouteCatalogChanged({
          agentProfileIds: parsedBody.data.agentProfileIds,
          context: buildCoreRpcContext(c),
          reason: parsedBody.data.reason,
        }),
    });
  });
}

function parseAgentExecutionReadinessRouteParams(input: {
  agentProfileId: string;
}):
  | {
      ok: true;
      value: { agentProfileId: string };
    }
  | {
      message: string;
      ok: false;
    } {
  const parsed = agentExecutionReadinessRouteParamsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      message: parsed.error.issues[0]?.message ?? "agentProfileId is invalid",
      ok: false,
    };
  }
  return {
    ok: true,
    value: parsed.data,
  };
}

function parseAgentProfileBindingRouteParams(input: { agentProfileId: string }):
  | {
      ok: true;
      value: { agentProfileId: string };
    }
  | {
      message: string;
      ok: false;
    } {
  const parsed = agentProfileBindingRouteParamsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      message: parsed.error.issues[0]?.message ?? "agentProfileId is invalid",
      ok: false,
    };
  }
  return {
    ok: true,
    value: parsed.data,
  };
}
