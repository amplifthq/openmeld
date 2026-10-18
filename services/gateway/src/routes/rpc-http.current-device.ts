import {
  computerFileAccessPolicyResponseSchema,
  computerFileAccessReadRequestSchema,
  computerFileAccessUpdateRequestSchema,
  currentDeviceTargetResponseSchema,
  currentLocalAgentInstallationsResponseSchema,
  currentLocalAgentInstallationsRouteParamsSchema,
  currentLocalRuntimeReplyReadinessResponseSchema,
  forgetComputerResponseSchema,
  forgetCurrentComputerResponseSchema,
  getCurrentAgentProfileWorkspaceQuerySchema,
  getCurrentAgentProfileWorkspaceResponseSchema,
  localFolderPickerRequestSchema,
  localFolderPickerResultSchema,
  localRuntimeEnrollmentBodySchema,
  localRuntimeEnrollmentResponseSchema,
  localRuntimesQuerySchema,
  localRuntimesResponseSchema,
  peopleComputersResponseSchema,
  peopleComputerTargetSchema,
  refreshCurrentLocalAgentCatalogResponseSchema,
  requestCurrentOpenMeldToolsUpdateResponseSchema,
  selectCurrentLocalAgentInstallationBodySchema,
  selectCurrentLocalAgentInstallationResponseSchema,
  setCurrentAgentProfileWorkspaceBodySchema,
  setCurrentAgentProfileWorkspaceResponseSchema,
  setCurrentAgentProfileWorkspaceRouteParamsSchema,
  setCurrentLocalAgentEnabledBodySchema,
  setCurrentLocalAgentEnabledResponseSchema,
  setCurrentLocalAgentEnabledRouteParamsSchema,
  setCurrentOpenMeldToolsMaintenanceBodySchema,
  setCurrentOpenMeldToolsMaintenanceResponseSchema,
  setLocalRuntimeDisplayNameBodySchema,
  writeCurrentDeviceObservedMetadataBodySchema,
  writeCurrentDeviceObservedMetadataResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { parseDeviceRouteParams } from "./rpc-http.device-route-params";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executePublicRpcRoute,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";
import { registerPeopleComputerControlRoutes } from "./rpc-http.people-computers";

const CURRENT_DEVICE_ROUTE = "/v1/devices/current";
const FORGET_CURRENT_COMPUTER_ROUTE = "/v1/devices/current/forget";
const FORGET_COMPUTER_ROUTE = "/v1/devices/:deviceId/forget";
const CURRENT_LOCAL_RUNTIME_REPLY_READINESS_ROUTE =
  "/v1/local-runtimes/current/reply-readiness";
const CURRENT_COMPUTER_FILE_ACCESS_ROUTE =
  "/v1/local-runtimes/current/file-access";
const CURRENT_LOCAL_FOLDER_PICKER_ROUTE =
  "/v1/local-runtimes/current/folder-picker";
const CURRENT_LOCAL_RUNTIME_OBSERVED_METADATA_ROUTE =
  "/v1/local-runtimes/current/observed-metadata";
const CURRENT_LOCAL_AGENT_ENABLED_ROUTE =
  "/v1/local-runtimes/current/local-agents/:agentId/enabled";
const CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE =
  "/v1/local-runtimes/current/local-agents/:agentId/installations";
const CURRENT_LOCAL_AGENT_CATALOG_REFRESH_ROUTE =
  "/v1/local-runtimes/current/local-agents/refresh-catalog";
const CURRENT_OPENMELD_TOOLS_UPDATE_ROUTE =
  "/v1/local-runtimes/current/openmeld-tools/update";
const CURRENT_OPENMELD_TOOLS_MAINTENANCE_ROUTE =
  "/v1/local-runtimes/current/openmeld-tools/maintenance";
const CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE =
  "/v1/local-runtimes/current/agent-profiles/:agentProfileId/workspace";
const LOCAL_RUNTIMES_ROUTE = "/v1/local-runtimes";
const LOCAL_RUNTIME_DISPLAY_NAME_ROUTE =
  "/v1/local-runtimes/:deviceId/display-name";
const LOCAL_RUNTIME_ENROLLMENT_ROUTE_PATTERN =
  "/v1/local-runtimes/:deviceId/enrollment";
const CURRENT_DEVICE_OBSERVED_METADATA_ROUTE =
  "/v1/devices/:deviceId/observed-metadata";
const START_SESSION_RETIRED_MESSAGE =
  "Legacy Start Session setup is retired. Upgrade OpenMeld CLI, then run openmeld setup.";

export function registerCurrentDeviceTargetRoutes(
  app: Hono<HonoBindings>
): void {
  registerPeopleComputerControlRoutes(app);
  app.get("/v1/people-computers", (c) =>
    executeRpcRoute({
      c,
      route: "/v1/people-computers",
      method: "GET",
      responseSchema: peopleComputersResponseSchema,
      execute: async () =>
        c.var.coreRpc.listPeopleComputers({
          context: buildCoreRpcContext(c),
          ...(c.req.query("includeUsageLimits") === "true"
            ? { includeUsageLimits: "true" as const }
            : {}),
        }),
    })
  );

  app.get(
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/reply-readiness",
    (c) => {
      const route =
        "/v1/people-computers/:deviceId/lanes/:runtimeLane/reply-readiness";
      const parsed = peopleComputerTargetSchema.safeParse(c.req.param());
      if (!parsed.success) {
        return respondBadRequest({
          c,
          route,
          method: "GET",
          code: "invalid_payload",
          message: "Invalid computer target.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "GET",
        responseSchema: currentLocalRuntimeReplyReadinessResponseSchema,
        execute: async () =>
          c.var.coreRpc.getPeopleComputerReplyReadiness({
            ...parsed.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.get(LOCAL_RUNTIMES_ROUTE, (c) => {
    const parsedQuery = localRuntimesQuerySchema.safeParse({
      connectionIdentityAdoption: c.req.query("connectionIdentityAdoption"),
      includeUsageLimits: c.req.query("includeUsageLimits"),
    });
    if (!parsedQuery.success) {
      return respondBadRequest({
        c,
        route: LOCAL_RUNTIMES_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message:
          parsedQuery.error.issues[0]?.message ??
          "local runtimes query is invalid",
      });
    }

    return executeRpcRoute({
      c,
      route: LOCAL_RUNTIMES_ROUTE,
      method: "GET",
      responseSchema: localRuntimesResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listLocalRuntimes({
          ...parsedQuery.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(CURRENT_LOCAL_RUNTIME_REPLY_READINESS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_LOCAL_RUNTIME_REPLY_READINESS_ROUTE,
      method: "GET",
      responseSchema: currentLocalRuntimeReplyReadinessResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentLocalRuntimeReplyReadiness({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.get(CURRENT_COMPUTER_FILE_ACCESS_ROUTE, (c) => {
    const parsed = computerFileAccessReadRequestSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          parsed.error.issues[0]?.message ??
          "Invalid Computer file access request",
        method: "GET",
        route: CURRENT_COMPUTER_FILE_ACCESS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.readComputerFileAccessPolicy({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: computerFileAccessPolicyResponseSchema,
      route: CURRENT_COMPUTER_FILE_ACCESS_ROUTE,
    });
  });

  app.put(CURRENT_COMPUTER_FILE_ACCESS_ROUTE, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: body.message,
        method: "PUT",
        route: CURRENT_COMPUTER_FILE_ACCESS_ROUTE,
      });
    }
    const parsed = computerFileAccessUpdateRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          parsed.error.issues[0]?.message ??
          "Invalid Computer file access request",
        method: "PUT",
        route: CURRENT_COMPUTER_FILE_ACCESS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.updateComputerFileAccessPolicy({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
      method: "PUT",
      responseSchema: computerFileAccessPolicyResponseSchema,
      route: CURRENT_COMPUTER_FILE_ACCESS_ROUTE,
    });
  });

  app.post(CURRENT_LOCAL_FOLDER_PICKER_ROUTE, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: body.message,
        method: "POST",
        route: CURRENT_LOCAL_FOLDER_PICKER_ROUTE,
      });
    }
    const parsed = localFolderPickerRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          parsed.error.issues[0]?.message ??
          "Invalid Local Folder Picker request",
        method: "POST",
        route: CURRENT_LOCAL_FOLDER_PICKER_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.selectLocalFolders({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: localFolderPickerResultSchema,
      route: CURRENT_LOCAL_FOLDER_PICKER_ROUTE,
    });
  });

  app.put(CURRENT_LOCAL_RUNTIME_OBSERVED_METADATA_ROUTE, (c) => {
    return executePublicRpcRoute({
      c,
      route: CURRENT_LOCAL_RUNTIME_OBSERVED_METADATA_ROUTE,
      method: "PUT",
      execute: () => {
        throw createRetiredStartSessionSetupError();
      },
    });
  });

  app.get(CURRENT_DEVICE_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_DEVICE_ROUTE,
      method: "GET",
      responseSchema: currentDeviceTargetResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentDeviceTarget({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.post(FORGET_CURRENT_COMPUTER_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: FORGET_CURRENT_COMPUTER_ROUTE,
      method: "POST",
      responseSchema: forgetCurrentComputerResponseSchema,
      execute: async () =>
        await c.var.coreRpc.forgetCurrentComputer({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.post(FORGET_COMPUTER_ROUTE, (c) => {
    const routeParams = parseDeviceRouteParams(c.req.param("deviceId"));
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: FORGET_COMPUTER_ROUTE,
        method: "POST",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }

    return executeRpcRoute({
      c,
      route: FORGET_COMPUTER_ROUTE,
      method: "POST",
      responseSchema: forgetComputerResponseSchema,
      execute: async () =>
        await c.var.coreRpc.forgetComputer({
          deviceId: routeParams.value.deviceId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(LOCAL_RUNTIME_ENROLLMENT_ROUTE_PATTERN, async (c) => {
    const routeParams = parseDeviceRouteParams(c.req.param("deviceId"));
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: LOCAL_RUNTIME_ENROLLMENT_ROUTE_PATTERN,
        method: "POST",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: LOCAL_RUNTIME_ENROLLMENT_ROUTE_PATTERN,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = parseLocalRuntimeEnrollmentBody(bodyResult.value);
    if (!parsedBody.ok) {
      return respondBadRequest({
        c,
        route: LOCAL_RUNTIME_ENROLLMENT_ROUTE_PATTERN,
        method: "POST",
        code: "invalid_payload",
        message: parsedBody.message,
      });
    }

    return executeRpcRoute({
      c,
      route: LOCAL_RUNTIME_ENROLLMENT_ROUTE_PATTERN,
      method: "POST",
      responseSchema: localRuntimeEnrollmentResponseSchema,
      execute: async () =>
        await c.var.coreRpc.enrollLocalRuntime({
          deviceId: routeParams.value.deviceId,
          ...(parsedBody.value.connectedComputerId === undefined
            ? {}
            : { connectedComputerId: parsedBody.value.connectedComputerId }),
          runtimeLane: parsedBody.value.runtimeLane,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.put(
    LOCAL_RUNTIME_DISPLAY_NAME_ROUTE,
    async (c) => await handleLocalRuntimeDisplayNameWrite(c)
  );

  app.put(
    CURRENT_LOCAL_AGENT_ENABLED_ROUTE,
    async (c) => await handleCurrentLocalAgentEnabledWrite(c)
  );

  app.post(CURRENT_OPENMELD_TOOLS_UPDATE_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.requestCurrentOpenMeldToolsUpdate({
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: requestCurrentOpenMeldToolsUpdateResponseSchema,
      route: CURRENT_OPENMELD_TOOLS_UPDATE_ROUTE,
    })
  );
  app.put(CURRENT_OPENMELD_TOOLS_MAINTENANCE_ROUTE, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: body.message,
        method: "PUT",
        route: CURRENT_OPENMELD_TOOLS_MAINTENANCE_ROUTE,
      });
    }
    const parsed = setCurrentOpenMeldToolsMaintenanceBodySchema.safeParse(
      body.value
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: parsed.error.issues[0]?.message ?? "Invalid update setting.",
        method: "PUT",
        route: CURRENT_OPENMELD_TOOLS_MAINTENANCE_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.setCurrentOpenMeldToolsMaintenance({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
      method: "PUT",
      responseSchema: setCurrentOpenMeldToolsMaintenanceResponseSchema,
      route: CURRENT_OPENMELD_TOOLS_MAINTENANCE_ROUTE,
    });
  });

  app.get(
    CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
    async (c) => await handleCurrentLocalAgentInstallationsRead(c)
  );
  app.put(
    CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
    async (c) => await handleCurrentLocalAgentInstallationWrite(c)
  );

  app.put(
    CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
    async (c) => await handleCurrentAgentProfileWorkspaceWrite(c)
  );
  app.get(
    CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
    async (c, next) => {
      await next();
      c.header("Cache-Control", "no-store");
    },
    (c) => {
      const profile =
        setCurrentAgentProfileWorkspaceRouteParamsSchema.safeParse({
          agentProfileId: c.req.param("agentProfileId"),
        });
      const query = getCurrentAgentProfileWorkspaceQuerySchema.safeParse(
        c.req.query()
      );
      if (!(profile.success && query.success)) {
        return respondBadRequest({
          c,
          route: CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
          method: "GET",
          code: "invalid_payload",
          message: "Invalid Agent Profile id.",
        });
      }
      return executeRpcRoute({
        c,
        route: CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
        method: "GET",
        responseSchema: getCurrentAgentProfileWorkspaceResponseSchema,
        execute: () =>
          c.var.coreRpc.getCurrentAgentProfileWorkspace({
            ...profile.data,
            ...query.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.post(CURRENT_LOCAL_AGENT_CATALOG_REFRESH_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_LOCAL_AGENT_CATALOG_REFRESH_ROUTE,
      method: "POST",
      responseSchema: refreshCurrentLocalAgentCatalogResponseSchema,
      execute: async () =>
        await c.var.coreRpc.refreshCurrentLocalAgentCatalog({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.put(CURRENT_DEVICE_OBSERVED_METADATA_ROUTE, async (c) => {
    const routeParams = parseDeviceRouteParams(c.req.param("deviceId"));
    if (!routeParams.ok) {
      return respondBadRequest({
        c,
        route: CURRENT_DEVICE_OBSERVED_METADATA_ROUTE,
        method: "PUT",
        code: "invalid_device_id",
        message: routeParams.message,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: CURRENT_DEVICE_OBSERVED_METADATA_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }

    const parsedBody = writeCurrentDeviceObservedMetadataBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: CURRENT_DEVICE_OBSERVED_METADATA_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "Invalid current device observed metadata payload",
      });
    }

    return executeRpcRoute({
      c,
      route: CURRENT_DEVICE_OBSERVED_METADATA_ROUTE,
      method: "PUT",
      responseSchema: writeCurrentDeviceObservedMetadataResponseSchema,
      execute: async () =>
        await c.var.coreRpc.writeCurrentDeviceObservedMetadata({
          deviceId: routeParams.value.deviceId,
          metadata: parsedBody.data.metadata,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}

function createRetiredStartSessionSetupError(): Error {
  const error = new Error(START_SESSION_RETIRED_MESSAGE) as Error & {
    code: string;
    status: number;
  };
  error.status = 410;
  error.code = "start.session.retired";
  return error;
}

async function handleLocalRuntimeDisplayNameWrite(c: Context<HonoBindings>) {
  const routeParams = parseDeviceRouteParams(c.req.param("deviceId"));
  if (!routeParams.ok) {
    return respondBadRequest({
      c,
      route: LOCAL_RUNTIME_DISPLAY_NAME_ROUTE,
      method: "PUT",
      code: "invalid_device_id",
      message: routeParams.message,
    });
  }

  const bodyResult = await readJsonRequestBody(c.req.raw);
  if (!bodyResult.ok) {
    return respondBadRequest({
      c,
      route: LOCAL_RUNTIME_DISPLAY_NAME_ROUTE,
      method: "PUT",
      code: "invalid_json",
      message: bodyResult.message,
    });
  }

  const parsedBody = setLocalRuntimeDisplayNameBodySchema.safeParse(
    bodyResult.value
  );
  if (!parsedBody.success) {
    return respondBadRequest({
      c,
      route: LOCAL_RUNTIME_DISPLAY_NAME_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message:
        parsedBody.error.issues[0]?.message ??
        "Invalid local runtime display name payload",
    });
  }

  return executeRpcRoute({
    c,
    route: LOCAL_RUNTIME_DISPLAY_NAME_ROUTE,
    method: "PUT",
    responseSchema: localRuntimesResponseSchema,
    execute: async () =>
      await c.var.coreRpc.setLocalRuntimeDisplayName({
        deviceId: routeParams.value.deviceId,
        displayName: parsedBody.data.displayName,
        context: buildCoreRpcContext(c),
      }),
  });
}

async function handleCurrentLocalAgentEnabledWrite(c: Context<HonoBindings>) {
  const routeParams = setCurrentLocalAgentEnabledRouteParamsSchema.safeParse({
    agentId: c.req.param("agentId"),
  });
  if (!routeParams.success) {
    return respondBadRequest({
      c,
      route: CURRENT_LOCAL_AGENT_ENABLED_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message: routeParams.error.issues[0]?.message ?? "Invalid local agent id",
    });
  }

  const bodyResult = await readJsonRequestBody(c.req.raw);
  if (!bodyResult.ok) {
    return respondBadRequest({
      c,
      route: CURRENT_LOCAL_AGENT_ENABLED_ROUTE,
      method: "PUT",
      code: "invalid_json",
      message: bodyResult.message,
    });
  }

  const parsedBody = setCurrentLocalAgentEnabledBodySchema.safeParse(
    bodyResult.value
  );
  if (!parsedBody.success) {
    return respondBadRequest({
      c,
      route: CURRENT_LOCAL_AGENT_ENABLED_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message:
        parsedBody.error.issues[0]?.message ??
        "Invalid local agent enabled payload",
    });
  }

  return executeRpcRoute({
    c,
    route: CURRENT_LOCAL_AGENT_ENABLED_ROUTE,
    method: "PUT",
    responseSchema: setCurrentLocalAgentEnabledResponseSchema,
    execute: async () =>
      await c.var.coreRpc.setCurrentLocalAgentEnabled({
        agentId: routeParams.data.agentId,
        enabled: parsedBody.data.enabled,
        context: buildCoreRpcContext(c),
      }),
  });
}

function handleCurrentLocalAgentInstallationsRead(c: Context<HonoBindings>) {
  const routeParams = currentLocalAgentInstallationsRouteParamsSchema.safeParse(
    {
      agentId: c.req.param("agentId"),
    }
  );
  if (!routeParams.success) {
    return respondBadRequest({
      c,
      route: CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
      method: "GET",
      code: "invalid_payload",
      message: routeParams.error.issues[0]?.message ?? "Invalid local agent id",
    });
  }
  return executeRpcRoute({
    c,
    route: CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
    method: "GET",
    responseSchema: currentLocalAgentInstallationsResponseSchema,
    execute: async () =>
      await c.var.coreRpc.getCurrentLocalAgentInstallations({
        agentId: routeParams.data.agentId,
        context: buildCoreRpcContext(c),
      }),
  });
}

async function handleCurrentLocalAgentInstallationWrite(
  c: Context<HonoBindings>
) {
  const routeParams = currentLocalAgentInstallationsRouteParamsSchema.safeParse(
    {
      agentId: c.req.param("agentId"),
    }
  );
  if (!routeParams.success) {
    return respondBadRequest({
      c,
      route: CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message: routeParams.error.issues[0]?.message ?? "Invalid local agent id",
    });
  }
  const bodyResult = await readJsonRequestBody(c.req.raw);
  if (!bodyResult.ok) {
    return respondBadRequest({
      c,
      route: CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
      method: "PUT",
      code: "invalid_json",
      message: bodyResult.message,
    });
  }
  const parsedBody = selectCurrentLocalAgentInstallationBodySchema.safeParse(
    bodyResult.value
  );
  if (!parsedBody.success) {
    return respondBadRequest({
      c,
      route: CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message:
        parsedBody.error.issues[0]?.message ??
        "Invalid local agent installation",
    });
  }
  return executeRpcRoute({
    c,
    route: CURRENT_LOCAL_AGENT_INSTALLATIONS_ROUTE,
    method: "PUT",
    responseSchema: selectCurrentLocalAgentInstallationResponseSchema,
    execute: async () =>
      await c.var.coreRpc.selectCurrentLocalAgentInstallation({
        agentId: routeParams.data.agentId,
        installationId: parsedBody.data.installationId,
        context: buildCoreRpcContext(c),
      }),
  });
}

async function handleCurrentAgentProfileWorkspaceWrite(
  c: Context<HonoBindings>
) {
  const routeParams =
    setCurrentAgentProfileWorkspaceRouteParamsSchema.safeParse({
      agentProfileId: c.req.param("agentProfileId"),
    });
  if (!routeParams.success) {
    return respondBadRequest({
      c,
      route: CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message:
        routeParams.error.issues[0]?.message ?? "Invalid Agent Profile id",
    });
  }

  const bodyResult = await readJsonRequestBody(c.req.raw);
  if (!bodyResult.ok) {
    return respondBadRequest({
      c,
      route: CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
      method: "PUT",
      code: "invalid_json",
      message: bodyResult.message,
    });
  }

  const parsedBody = setCurrentAgentProfileWorkspaceBodySchema.safeParse(
    bodyResult.value
  );
  if (!parsedBody.success) {
    return respondBadRequest({
      c,
      route: CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message:
        parsedBody.error.issues[0]?.message ??
        "Invalid profile workspace payload",
    });
  }

  if (parsedBody.data.expectedBindingTarget) {
    return respondBadRequest({
      c,
      route: CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
      method: "PUT",
      code: "invalid_payload",
      message:
        "A bound working-folder save requires its exact Computer target.",
    });
  }
  return executeRpcRoute({
    c,
    route: CURRENT_AGENT_PROFILE_WORKSPACE_ROUTE,
    method: "PUT",
    responseSchema: setCurrentAgentProfileWorkspaceResponseSchema,
    execute: async () =>
      await c.var.coreRpc.setCurrentAgentProfileWorkspace({
        requestCredential: await buildCoreRpcCredential(c),
        agentProfileId: routeParams.data.agentProfileId,
        workspaceMode: parsedBody.data.workspaceMode,
        ...(parsedBody.data.workspacePath === undefined
          ? {}
          : { workspacePath: parsedBody.data.workspacePath }),
        context: buildCoreRpcContext(c),
      }),
  });
}

function parseLocalRuntimeEnrollmentBody(body: unknown):
  | {
      ok: true;
      value: {
        connectedComputerId?: string;
        runtimeLane: "prod" | "dev-local" | "canary";
      };
    }
  | {
      ok: false;
      message: string;
    } {
  const parsed = localRuntimeEnrollmentBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Invalid current device target",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}
