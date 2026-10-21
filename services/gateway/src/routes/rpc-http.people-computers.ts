import {
  computerFileAccessPolicyResponseSchema,
  computerPowerRpcInputSchema,
  computerPowerStateSchema,
  currentLocalAgentInstallationsResponseSchema,
  currentLocalAgentInstallationsRouteParamsSchema,
  getCurrentAgentProfileWorkspaceQuerySchema,
  getCurrentAgentProfileWorkspaceResponseSchema,
  localAgentSetupRequestSchema,
  localAgentSetupStateSchema,
  localAgentUpdateRequestSchema,
  localAgentUpdateStateSchema,
  localFolderPickerResultSchema,
  localProjectControlDiscoverProjectsRequestSchema,
  localProjectControlDiscoverProjectsResponseSchema,
  peopleComputerFileAccessUpdateBodySchema,
  peopleComputerFolderPickerBodySchema,
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
  setCurrentOpenMeldToolsMaintenanceBodySchema,
  setCurrentOpenMeldToolsMaintenanceResponseSchema,
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
import { registerPeopleComputerProjectMutationRoutes } from "./rpc-http.people-computer-projects";
import { registerServiceConnectionEvidenceRoutes } from "./rpc-http.service-connection-evidence";

/** These names intentionally have no fallback to account-current RPC methods. */
export function registerPeopleComputerControlRoutes(
  app: Hono<HonoBindings>
): void {
  registerServiceConnectionEvidenceRoutes(app);
  const setupRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/connection-setup";
  app.on(["GET", "POST"], setupRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: c.req.param("deviceId"),
      runtimeLane: c.req.param("runtimeLane"),
    });
    const method = c.req.method === "POST" ? "POST" : "GET";
    if (!target.success || c.req.param("agentId") !== "grok-bot") {
      return respondBadRequest({
        c,
        route: setupRoute,
        method,
        code: "invalid_payload",
        message: "Invalid computer or Agent.",
      });
    }
    let request:
      | import("@openmeld/schemas/types").LocalAgentSetupRequest
      | undefined;
    if (method === "POST") {
      const body = await readJsonRequestBody(c.req.raw);
      const parsed = localAgentSetupRequestSchema.safeParse(
        body.ok ? body.value : null
      );
      if (!parsed.success) {
        return respondBadRequest({
          c,
          route: setupRoute,
          method,
          code: "invalid_payload",
          message: "Invalid connection setup request.",
        });
      }
      request = parsed.data;
    }
    return executeRpcRoute({
      c,
      route: setupRoute,
      method,
      responseSchema: localAgentSetupStateSchema,
      execute: () =>
        c.var.coreRpc.managePeopleComputerLocalAgentSetup({
          ...target.data,
          agentId: "grok-bot",
          ...(request ? { request } : {}),
          context: buildCoreRpcContext(c),
        }),
    });
  });
  const agentUpdateRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/installation-update";
  app.on(["GET", "POST"], agentUpdateRoute, async (c) => {
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: c.req.param("deviceId"),
      runtimeLane: c.req.param("runtimeLane"),
    });
    const agent = currentLocalAgentInstallationsRouteParamsSchema.safeParse({
      agentId: c.req.param("agentId"),
    });
    const method = c.req.method === "POST" ? "POST" : "GET";
    if (!(target.success && agent.success)) {
      return respondBadRequest({
        c,
        route: agentUpdateRoute,
        method,
        code: "invalid_payload",
        message: "Invalid computer or local agent.",
      });
    }
    let updateRequest:
      | import("@openmeld/schemas/types").LocalAgentUpdateRequest
      | undefined;
    if (method === "POST") {
      const body = await readJsonRequestBody(c.req.raw);
      const parsed = localAgentUpdateRequestSchema.safeParse(
        body.ok ? body.value : null
      );
      if (!parsed.success) {
        return respondBadRequest({
          c,
          route: agentUpdateRoute,
          method,
          code: "invalid_payload",
          message: "Invalid local agent update request.",
        });
      }
      updateRequest = parsed.data;
    }
    return executeRpcRoute({
      c,
      route: agentUpdateRoute,
      method,
      responseSchema: localAgentUpdateStateSchema,
      execute: () =>
        c.var.coreRpc.managePeopleComputerLocalAgentUpdate({
          ...target.data,
          ...agent.data,
          ...(updateRequest ? { request: updateRequest } : {}),
          context: buildCoreRpcContext(c),
        }),
    });
  });
  const powerRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/power-settings";
  app.use(powerRoute, async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.post(powerRoute, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    const parsed = body.ok
      ? computerPowerRpcInputSchema.safeParse({
          deviceId: c.req.param("deviceId"),
          runtimeLane: c.req.param("runtimeLane"),
          context: buildCoreRpcContext(c),
          request: body.value,
        })
      : null;
    if (!parsed?.success) {
      return respondBadRequest({
        c,
        route: powerRoute,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid sleep prevention request.",
      });
    }
    return executeRpcRoute({
      c,
      route: powerRoute,
      method: "POST",
      responseSchema: computerPowerStateSchema,
      execute: () => c.var.coreRpc.computerPowerSettings(parsed.data),
    });
  });
  const historyRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/session-history";
  app.post(historyRoute, async (c) => {
    c.header("Cache-Control", "no-store");
    const body = await readJsonRequestBody(c.req.raw);
    const parsed = body.ok
      ? sessionHistoryRpcInputSchema.safeParse({
          ...(body.value as Record<string, unknown>),
          deviceId: c.req.param("deviceId"),
          runtimeLane: c.req.param("runtimeLane"),
          context: buildCoreRpcContext(c),
        })
      : null;
    if (!parsed?.success) {
      return respondBadRequest({
        c,
        route: historyRoute,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid session history request.",
      });
    }
    return executeRpcRoute({
      c,
      route: historyRoute,
      method: "POST",
      responseSchema: sessionHistoryResultSchema,
      execute: () => c.var.coreRpc.computerSessionHistory(parsed.data),
    });
  });
  registerPeopleComputerProjectMutationRoutes(app);
  const workspaceRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/agent-profiles/:profileId/workspace";
  app.get(
    workspaceRoute,
    async (c, next) => {
      await next();
      c.header("Cache-Control", "no-store");
    },
    (c) => {
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      const profile =
        setCurrentAgentProfileWorkspaceRouteParamsSchema.safeParse({
          agentProfileId: c.req.param("profileId"),
        });
      const query = getCurrentAgentProfileWorkspaceQuerySchema.safeParse(
        c.req.query()
      );
      if (!(target.success && profile.success && query.success)) {
        return respondBadRequest({
          c,
          route: workspaceRoute,
          method: "GET",
          code: "invalid_payload",
          message: "Invalid computer working-folder read request.",
        });
      }
      return executeRpcRoute({
        c,
        route: workspaceRoute,
        method: "GET",
        responseSchema: getCurrentAgentProfileWorkspaceResponseSchema,
        execute: () =>
          c.var.coreRpc.getPeopleComputerAgentProfileWorkspace({
            ...target.data,
            ...profile.data,
            ...query.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );
  app.put(workspaceRoute, async (c) => {
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: c.req.param("deviceId"),
      runtimeLane: c.req.param("runtimeLane"),
    });
    const profile = setCurrentAgentProfileWorkspaceRouteParamsSchema.safeParse({
      agentProfileId: c.req.param("profileId"),
    });
    const body = await readJsonRequestBody(c.req.raw);
    const parsed = body.ok
      ? setCurrentAgentProfileWorkspaceBodySchema.safeParse(body.value)
      : null;
    if (!(target.success && profile.success && parsed?.success)) {
      return respondBadRequest({
        c,
        route: workspaceRoute,
        method: "PUT",
        code: "invalid_payload",
        message: "Invalid computer working folder request.",
      });
    }
    return executeRpcRoute({
      c,
      route: workspaceRoute,
      method: "PUT",
      responseSchema: setCurrentAgentProfileWorkspaceResponseSchema,
      execute: async () => {
        const request = {
          ...target.data,
          ...profile.data,
          ...parsed.data,
          context: buildCoreRpcContext(c),
          requestCredential: await buildCoreRpcCredential(c),
        };
        // A named required receiver prevents older Core from discarding the
        // precondition. Never fall back to an unguarded explicit-target write.
        return parsed.data.expectedBindingTarget
          ? c.var.coreRpc.setBoundPeopleComputerAgentProfileWorkspace(request)
          : c.var.coreRpc.setPeopleComputerAgentProfileWorkspace(request);
      },
    });
  });
  const projectDiscoveryRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/projects/discover";
  app.post(projectDiscoveryRoute, async (c) => {
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: c.req.param("deviceId"),
      runtimeLane: c.req.param("runtimeLane"),
    });
    if (!target.success) {
      return respondBadRequest({
        c,
        route: projectDiscoveryRoute,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid computer target.",
      });
    }
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        route: projectDiscoveryRoute,
        method: "POST",
        code: "invalid_json",
        message: "Invalid Project discovery request.",
      });
    }
    const parsed = localProjectControlDiscoverProjectsRequestSchema.safeParse(
      body.value
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: projectDiscoveryRoute,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid Project discovery request.",
      });
    }
    return executeRpcRoute({
      c,
      route: projectDiscoveryRoute,
      method: "POST",
      responseSchema: localProjectControlDiscoverProjectsResponseSchema,
      execute: () =>
        c.var.coreRpc.discoverPeopleComputerProjects({
          ...target.data,
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
  const folderPickerRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/folders/select";
  app.post(folderPickerRoute, async (c) => {
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: c.req.param("deviceId"),
      runtimeLane: c.req.param("runtimeLane"),
    });
    if (!target.success) {
      return respondBadRequest({
        c,
        route: folderPickerRoute,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid computer target.",
      });
    }
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        route: folderPickerRoute,
        method: "POST",
        code: "invalid_json",
        message: "Invalid folder picker request.",
      });
    }
    const parsed = peopleComputerFolderPickerBodySchema.safeParse(body.value);
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: folderPickerRoute,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid folder picker request.",
      });
    }
    return executeRpcRoute({
      c,
      route: folderPickerRoute,
      method: "POST",
      responseSchema: localFolderPickerResultSchema,
      execute: () =>
        c.var.coreRpc.selectPeopleComputerFolders({
          ...target.data,
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
  const fileAccessRoute =
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/file-access";
  app.get(fileAccessRoute, (c) => {
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: c.req.param("deviceId"),
      runtimeLane: c.req.param("runtimeLane"),
    });
    if (!target.success) {
      return respondBadRequest({
        c,
        route: fileAccessRoute,
        method: "GET",
        code: "invalid_payload",
        message: "Invalid computer target.",
      });
    }
    return executeRpcRoute({
      c,
      route: fileAccessRoute,
      method: "GET",
      responseSchema: computerFileAccessPolicyResponseSchema,
      execute: () =>
        c.var.coreRpc.readPeopleComputerFileAccessPolicy({
          ...target.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
  app.put(fileAccessRoute, async (c) => {
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: c.req.param("deviceId"),
      runtimeLane: c.req.param("runtimeLane"),
    });
    if (!target.success) {
      return respondBadRequest({
        c,
        route: fileAccessRoute,
        method: "PUT",
        code: "invalid_payload",
        message: "Invalid computer target.",
      });
    }
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        route: fileAccessRoute,
        method: "PUT",
        code: "invalid_json",
        message: "Invalid file access request.",
      });
    }
    const parsed = peopleComputerFileAccessUpdateBodySchema.safeParse(
      body.value
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: fileAccessRoute,
        method: "PUT",
        code: "invalid_payload",
        message: "Invalid file access request.",
      });
    }
    return executeRpcRoute({
      c,
      route: fileAccessRoute,
      method: "PUT",
      responseSchema: computerFileAccessPolicyResponseSchema,
      execute: () =>
        c.var.coreRpc.updatePeopleComputerFileAccessPolicy({
          ...target.data,
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });
  app.put(
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/enabled",
    async (c) => {
      const route =
        "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/enabled";
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      if (!target.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message: "Invalid computer target.",
        });
      }
      const agent = currentLocalAgentInstallationsRouteParamsSchema.safeParse({
        agentId: c.req.param("agentId"),
      });
      if (!agent.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message: "Invalid local agent.",
        });
      }
      const body = await readJsonRequestBody(c.req.raw);
      if (!body.ok) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_json",
          message: body.message,
        });
      }
      const parsed = setCurrentLocalAgentEnabledBodySchema.safeParse(
        body.value
      );
      if (!parsed.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message:
            parsed.error.issues[0]?.message ?? "Invalid computer action.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "PUT",
        responseSchema: setCurrentLocalAgentEnabledResponseSchema,
        execute: () =>
          c.var.coreRpc.setPeopleComputerLocalAgentEnabled({
            ...parsed.data,
            ...agent.data,
            ...target.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.get(
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/installations",
    (c) => {
      const route =
        "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/installations";
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      if (!target.success) {
        return respondBadRequest({
          c,
          route,
          method: "GET",
          code: "invalid_payload",
          message: "Invalid computer target.",
        });
      }
      const agent = currentLocalAgentInstallationsRouteParamsSchema.safeParse({
        agentId: c.req.param("agentId"),
      });
      if (!agent.success) {
        return respondBadRequest({
          c,
          route,
          method: "GET",
          code: "invalid_payload",
          message: "Invalid local agent.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "GET",
        responseSchema: currentLocalAgentInstallationsResponseSchema,
        execute: () =>
          c.var.coreRpc.getPeopleComputerLocalAgentInstallations({
            ...agent.data,
            ...target.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.put(
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/installations",
    async (c) => {
      const route =
        "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/:agentId/installations";
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      if (!target.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message: "Invalid computer target.",
        });
      }
      const agent = currentLocalAgentInstallationsRouteParamsSchema.safeParse({
        agentId: c.req.param("agentId"),
      });
      if (!agent.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message: "Invalid local agent.",
        });
      }
      const body = await readJsonRequestBody(c.req.raw);
      if (!body.ok) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_json",
          message: body.message,
        });
      }
      const parsed = selectCurrentLocalAgentInstallationBodySchema.safeParse(
        body.value
      );
      if (!parsed.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message:
            parsed.error.issues[0]?.message ?? "Invalid computer action.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "PUT",
        responseSchema: selectCurrentLocalAgentInstallationResponseSchema,
        execute: () =>
          c.var.coreRpc.selectPeopleComputerLocalAgentInstallation({
            ...parsed.data,
            ...agent.data,
            ...target.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.post(
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/refresh-catalog",
    (c) => {
      const route =
        "/v1/people-computers/:deviceId/lanes/:runtimeLane/local-agents/refresh-catalog";
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      if (!target.success) {
        return respondBadRequest({
          c,
          route,
          method: "POST",
          code: "invalid_payload",
          message: "Invalid computer target.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "POST",
        responseSchema: refreshCurrentLocalAgentCatalogResponseSchema,
        execute: () =>
          c.var.coreRpc.refreshPeopleComputerLocalAgentCatalog({
            ...target.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.post(
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/openmeld-tools/update",
    (c) => {
      const route =
        "/v1/people-computers/:deviceId/lanes/:runtimeLane/openmeld-tools/update";
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      if (!target.success) {
        return respondBadRequest({
          c,
          route,
          method: "POST",
          code: "invalid_payload",
          message: "Invalid computer target.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "POST",
        responseSchema: requestCurrentOpenMeldToolsUpdateResponseSchema,
        execute: () =>
          c.var.coreRpc.requestPeopleComputerOpenMeldToolsUpdate({
            ...target.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.put(
    "/v1/people-computers/:deviceId/lanes/:runtimeLane/openmeld-tools/maintenance",
    async (c) => {
      const route =
        "/v1/people-computers/:deviceId/lanes/:runtimeLane/openmeld-tools/maintenance";
      const target = peopleComputerTargetSchema.safeParse({
        deviceId: c.req.param("deviceId"),
        runtimeLane: c.req.param("runtimeLane"),
      });
      if (!target.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message: "Invalid computer target.",
        });
      }
      const body = await readJsonRequestBody(c.req.raw);
      if (!body.ok) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_json",
          message: body.message,
        });
      }
      const parsed = setCurrentOpenMeldToolsMaintenanceBodySchema.safeParse(
        body.value
      );
      if (!parsed.success) {
        return respondBadRequest({
          c,
          route,
          method: "PUT",
          code: "invalid_payload",
          message:
            parsed.error.issues[0]?.message ?? "Invalid computer action.",
        });
      }
      return executeRpcRoute({
        c,
        route,
        method: "PUT",
        responseSchema: setCurrentOpenMeldToolsMaintenanceResponseSchema,
        execute: () =>
          c.var.coreRpc.setPeopleComputerOpenMeldToolsMaintenance({
            ...parsed.data,
            ...target.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );
}

import {
  sessionHistoryResultSchema,
  sessionHistoryRpcInputSchema,
} from "@openmeld/schemas";
