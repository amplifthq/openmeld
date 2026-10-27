import {
  AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER,
  agentExecutionReadinessRouteParamsSchema,
  agentProfileBindingRouteParamsSchema,
  agentProfileExecutionModeResponseSchema,
  currentAgentProfileSessionLookupQuerySchema,
  currentAgentProfileSessionLookupResponseSchema,
  disableAgentProfilePrimaryBindingResponseSchema,
  ensureAgentProfilePrimaryBindingBodySchema,
  ensureAgentProfilePrimaryBindingResponseSchema,
  executeAgentProfileWorkRecoveryBodySchema,
  executeAgentProfileWorkRecoveryResponseSchema,
  getAgentExecutionReadinessBatchBodySchema,
  getAgentExecutionReadinessBatchResponseSchema,
  getAgentExecutionReadinessResponseSchema,
  getAgentProfileControllerChangeEligibilityResponseSchema,
  getAgentProfileFoldersResponseSchema,
  getAgentProfileFoldersRouteParamsSchema,
  getAgentProfilePrimaryBindingResponseSchema,
  manageAgentProfileFoldersBodySchema,
  manageAgentProfileFoldersResponseSchema,
  notifyAgentProfileRouteCatalogChangedBodySchema,
  notifyAgentProfileRouteCatalogChangedResponseSchema,
  notifyAgentProfilesRouteCatalogChangedBodySchema,
  updateAgentProfileDefaultProjectBodySchema,
  updateAgentProfileDefaultProjectResponseSchema,
  updateAgentProfileDefaultProjectRouteParamsSchema,
  updateAgentProfileExecutionModeBodySchema,
  updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema,
  updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema,
  updateAgentProfilePrimaryBindingModelSelectionBodySchema,
  updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const AGENT_PROFILE_BINDING_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding";
const CURRENT_AGENT_PROFILE_SESSION_ROUTE =
  "/v1/agent-profiles/current-session";
const AGENT_PROFILE_CONTROLLER_CHANGE_ELIGIBILITY_ROUTE =
  "/v1/agent-profiles/:agentProfileId/controller-change-eligibility";
const AGENT_PROFILE_DEFAULT_PROJECT_ROUTE =
  "/v1/agent-profiles/:agentProfileId/default-project";
const AGENT_PROFILE_FOLDERS_ROUTE =
  "/v1/agent-profiles/:agentProfileId/folders";
const AGENT_PROFILE_BINDING_MODEL_SELECTION_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/model-selection";
const AGENT_PROFILE_BINDING_AGENT_CONTROLLER_PERMISSION_MODE_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/agent-controller-permission-mode";
const AGENT_PROFILE_BINDING_AGENT_CONTROLLER_COLLABORATION_MODE_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/agent-controller-collaboration-mode";
const AGENT_PROFILE_BINDING_OPEN_CODE_PERMISSION_ROUTE =
  "/v1/agent-profiles/:agentProfileId/primary-binding/opencode-permission";
const AGENT_PROFILE_ROUTE_CATALOG_SYNC_ROUTE =
  "/v1/agent-profiles/:agentProfileId/route-catalog-sync";
const AGENT_PROFILES_ROUTE_CATALOG_SYNC_ROUTE =
  "/v1/agent-profiles/route-catalog-sync";
const AGENT_EXECUTION_READINESS_ROUTE =
  "/v1/agent-profiles/:agentProfileId/execution-readiness";
const AGENT_EXECUTION_READINESS_BATCH_ROUTE =
  "/v1/agent-profiles/execution-readiness/batch";
const AGENT_PROFILE_WORK_RECOVERY_ROUTE =
  "/v1/agent-profiles/:agentProfileId/work-recovery";

export function registerAgentProfileBindingRoutes(
  app: Hono<HonoBindings>
): void {
  const executionModeRoute =
    "/v1/agent-profiles/:agentProfileId/execution-mode";
  app.on(["GET", "PATCH"], executionModeRoute, async (c) => {
    const params = agentProfileBindingRouteParamsSchema.safeParse({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!params.success) {
      return respondBadRequest({
        c,
        route: executionModeRoute,
        method: c.req.method as "GET" | "PATCH",
        code: "invalid_payload",
        message: "Invalid Agent Profile ID.",
      });
    }
    let body: { mode: "parallel" | "serial" } | undefined;
    if (c.req.method === "PATCH") {
      const raw = await readJsonRequestBody(c.req.raw);
      const parsed = raw.ok
        ? updateAgentProfileExecutionModeBodySchema.safeParse(raw.value)
        : null;
      if (!parsed?.success) {
        return respondBadRequest({
          c,
          route: executionModeRoute,
          method: "PATCH",
          code: "invalid_payload",
          message: "Execution mode must be parallel or serial.",
        });
      }
      body = parsed.data;
    }
    return executeRpcRoute({
      c,
      route: executionModeRoute,
      method: c.req.method as "GET" | "PATCH",
      responseSchema: agentProfileExecutionModeResponseSchema,
      execute: async () =>
        c.var.coreRpc.agentProfileExecutionMode({
          requestCredential: await buildCoreRpcCredential(c),
          agentProfileId: params.data.agentProfileId,
          body,
          context: buildCoreRpcContext(c),
        }),
    });
  });
  app.get(CURRENT_AGENT_PROFILE_SESSION_ROUTE, (c) => {
    const query = currentAgentProfileSessionLookupQuerySchema.safeParse({
      agentControllerConversationId: c.req.query(
        "agentControllerConversationId"
      ),
      agentControllerRef: c.req.query("agentControllerRef"),
    });
    if (!query.success) {
      return respondBadRequest({
        c,
        route: CURRENT_AGENT_PROFILE_SESSION_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message:
          query.error.issues[0]?.message ??
          "Current Agent Profile Session lookup is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: CURRENT_AGENT_PROFILE_SESSION_ROUTE,
      method: "GET",
      responseSchema: currentAgentProfileSessionLookupResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentAgentProfileSession({
          ...query.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(AGENT_PROFILE_WORK_RECOVERY_ROUTE, async (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_WORK_RECOVERY_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_WORK_RECOVERY_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const body = executeAgentProfileWorkRecoveryBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_WORK_RECOVERY_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Agent Profile work recovery payload is invalid",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_WORK_RECOVERY_ROUTE,
      method: "POST",
      responseSchema: executeAgentProfileWorkRecoveryResponseSchema,
      execute: async () =>
        await c.var.coreRpc.executeAgentProfileWorkRecovery({
          requestCredential: await buildCoreRpcCredential(c),
          agentProfileId: routeParams.value.agentProfileId,
          body: body.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(
    AGENT_PROFILE_FOLDERS_ROUTE,
    async (c, next) => {
      await next();
      c.header("Cache-Control", "no-store");
    },
    (c) => {
      const routeParams = getAgentProfileFoldersRouteParamsSchema.safeParse({
        agentProfileId: c.req.param("agentProfileId"),
      });
      if (!routeParams.success) {
        return respondBadRequest({
          c,
          route: AGENT_PROFILE_FOLDERS_ROUTE,
          method: "GET",
          code: "invalid_payload",
          message: "Invalid Agent Profile id.",
        });
      }
      return executeRpcRoute({
        c,
        route: AGENT_PROFILE_FOLDERS_ROUTE,
        method: "GET",
        responseSchema: getAgentProfileFoldersResponseSchema,
        execute: () =>
          c.var.coreRpc.getAgentProfileFolders({
            agentProfileId: routeParams.data.agentProfileId,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.post(AGENT_PROFILE_FOLDERS_ROUTE, async (c) => {
    const routeParams = getAgentProfileFoldersRouteParamsSchema.safeParse({
      agentProfileId: c.req.param("agentProfileId"),
    });
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!(routeParams.success && bodyResult.ok)) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_FOLDERS_ROUTE,
        method: "POST",
        code: routeParams.success ? "invalid_json" : "invalid_payload",
        message: routeParams.success
          ? "Invalid folder change."
          : "Invalid Agent Profile id.",
      });
    }
    const parsedBody = manageAgentProfileFoldersBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_FOLDERS_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ?? "Invalid folder change.",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_FOLDERS_ROUTE,
      method: "POST",
      responseSchema: manageAgentProfileFoldersResponseSchema,
      execute: async () =>
        await c.var.coreRpc.manageAgentProfileFolders({
          requestCredential: await buildCoreRpcCredential(c),
          ...parsedBody.data,
          agentProfileId: routeParams.data.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

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
      execute: async () => {
        const request = {
          ...parsedBody.data,
          agentProfileId: routeParams.data.agentProfileId,
          context: buildCoreRpcContext(c),
          requestCredential: await buildCoreRpcCredential(c),
        };
        return parsedBody.data.expectedBindingTarget
          ? c.var.coreRpc.updateBoundAgentProfileDefaultProject(request)
          : c.var.coreRpc.updateAgentProfileDefaultProject(request);
      },
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

  app.get(AGENT_PROFILE_CONTROLLER_CHANGE_ELIGIBILITY_ROUTE, (c) => {
    const routeParams = parseAgentProfileBindingRouteParams({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_CONTROLLER_CHANGE_ELIGIBILITY_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: routeParams.message,
      });
    }

    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_CONTROLLER_CHANGE_ELIGIBILITY_ROUTE,
      method: "GET",
      responseSchema: getAgentProfileControllerChangeEligibilityResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getAgentProfileControllerChangeEligibility({
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
          requestCredential: await buildCoreRpcCredential(c),
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
          ...(c.req.header(
            AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER
          ) === "2"
            ? { responseVersion: 2 as const }
            : {}),
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
          ...(c.req.header(
            AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER
          ) === "2"
            ? { responseVersion: 2 as const }
            : {}),
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
          requestCredential: await buildCoreRpcCredential(c),
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
              requestCredential: await buildCoreRpcCredential(c),
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
              requestCredential: await buildCoreRpcCredential(c),
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
          requestCredential: await buildCoreRpcCredential(c),
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
          requestCredential: await buildCoreRpcCredential(c),
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
