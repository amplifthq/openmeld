import {
  computerFileAccessPolicyResponseSchema,
  currentLocalAgentInstallationsResponseSchema,
  currentLocalAgentInstallationsRouteParamsSchema,
  peopleComputerFileAccessUpdateBodySchema,
  peopleComputerTargetSchema,
  refreshCurrentLocalAgentCatalogResponseSchema,
  requestCurrentOpenMeldToolsUpdateResponseSchema,
  selectCurrentLocalAgentInstallationBodySchema,
  selectCurrentLocalAgentInstallationResponseSchema,
  setCurrentLocalAgentEnabledBodySchema,
  setCurrentLocalAgentEnabledResponseSchema,
  setCurrentOpenMeldToolsMaintenanceBodySchema,
  setCurrentOpenMeldToolsMaintenanceResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

/** These names intentionally have no fallback to account-current RPC methods. */
export function registerPeopleComputerControlRoutes(
  app: Hono<HonoBindings>
): void {
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
