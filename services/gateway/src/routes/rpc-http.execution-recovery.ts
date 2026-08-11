import {
  executeExecutionRecoveryBodySchema,
  executeExecutionRecoveryResponseSchema,
  inspectExecutionRecoveryResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const EXECUTION_RECOVERY_ROUTE =
  "/v1/spaces/:spaceId/dispatches/:dispatchId/recovery";
const SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE =
  "/v1/executions/:dispatchId/recovery";

export function registerExecutionRecoveryRoutes(app: Hono<HonoBindings>): void {
  app.get(EXECUTION_RECOVERY_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const dispatchId = String(c.req.param("dispatchId") ?? "").trim();
    const password = readSpacePasswordHeader(c.req.raw.headers);
    if (!dispatchId) {
      return respondBadRequest({
        c,
        method: "GET",
        message: "dispatchId is required",
        route: EXECUTION_RECOVERY_ROUTE,
        spaceId,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.inspectExecutionRecovery({
          context: buildCoreRpcContext(c),
          dispatchId,
          ...(password === undefined ? {} : { password }),
          spaceId,
        }),
      method: "GET",
      responseSchema: inspectExecutionRecoveryResponseSchema,
      route: EXECUTION_RECOVERY_ROUTE,
      spaceId,
    });
  });

  app.post(EXECUTION_RECOVERY_ROUTE, async (c) => {
    const spaceId = c.req.param("spaceId");
    const dispatchId = String(c.req.param("dispatchId") ?? "").trim();
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        method: "POST",
        message: body.message,
        route: EXECUTION_RECOVERY_ROUTE,
        spaceId,
      });
    }
    const parsed = executeExecutionRecoveryBodySchema.safeParse(body.value);
    if (
      !parsed.success ||
      parsed.data.expectedIdentity.dispatchId !== dispatchId
    ) {
      return respondBadRequest({
        c,
        method: "POST",
        message: parsed.success
          ? "dispatchId does not match expected execution identity"
          : (parsed.error.issues[0]?.message ??
            "execution recovery payload is invalid"),
        route: EXECUTION_RECOVERY_ROUTE,
        spaceId,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.executeExecutionRecovery({
          body: parsed.data,
          context: buildCoreRpcContext(c),
          ...(password === undefined ? {} : { password }),
          spaceId,
        }),
      method: "POST",
      responseSchema: executeExecutionRecoveryResponseSchema,
      route: EXECUTION_RECOVERY_ROUTE,
      spaceId,
    });
  });

  app.get(SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE, (c) => {
    const dispatchId = String(c.req.param("dispatchId") ?? "").trim();
    const conversationId = String(c.req.query("conversationId") ?? "").trim();
    if (!(dispatchId && conversationId && conversationId.length <= 512)) {
      return respondBadRequest({
        c,
        method: "GET",
        message: "dispatchId and conversationId are required",
        route: SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE,
        spaceId: conversationId,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.inspectExecutionRecovery({
          context: buildCoreRpcContext(c),
          dispatchId,
          spaceId: conversationId,
        }),
      method: "GET",
      responseSchema: inspectExecutionRecoveryResponseSchema,
      route: SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE,
      spaceId: conversationId,
    });
  });

  app.post(SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE, async (c) => {
    const dispatchId = String(c.req.param("dispatchId") ?? "").trim();
    const conversationId = String(c.req.query("conversationId") ?? "").trim();
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        method: "POST",
        message: body.message,
        route: SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE,
        spaceId: conversationId,
      });
    }
    const parsed = executeExecutionRecoveryBodySchema.safeParse(body.value);
    if (!conversationId || conversationId.length > 512) {
      return respondBadRequest({
        c,
        method: "POST",
        message: "conversationId is required",
        route: SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE,
        spaceId: conversationId,
      });
    }
    if (
      !parsed.success ||
      parsed.data.expectedIdentity.dispatchId !== dispatchId ||
      parsed.data.expectedIdentity.spaceId !== conversationId
    ) {
      return respondBadRequest({
        c,
        method: "POST",
        message: parsed.success
          ? "path identity does not match expected execution identity"
          : (parsed.error.issues[0]?.message ??
            "execution recovery payload is invalid"),
        route: SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE,
        spaceId: conversationId,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.executeExecutionRecovery({
          body: parsed.data,
          context: buildCoreRpcContext(c),
          spaceId: conversationId,
        }),
      method: "POST",
      responseSchema: executeExecutionRecoveryResponseSchema,
      route: SURFACE_NEUTRAL_EXECUTION_RECOVERY_ROUTE,
      spaceId: conversationId,
    });
  });
}
