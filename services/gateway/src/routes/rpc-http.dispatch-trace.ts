import {
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_HEADER,
  spaceDispatchTraceResponseContractVersionHeaderSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";

const SPACE_DISPATCH_TRACE_ROUTE =
  "/v1/spaces/:spaceId/dispatches/:dispatchId/trace";

export function registerDispatchTraceRoutes(app: Hono<HonoBindings>): void {
  app.get(SPACE_DISPATCH_TRACE_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const dispatchId = String(c.req.param("dispatchId") ?? "").trim();
    const includeRemoteAgentRuntimeDiagnostics =
      c.req.query("includeRemoteAgentRuntimeDiagnostics") === "true";
    const responseContractVersionHeader = c.req.header(
      SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_HEADER
    );
    const responseContractVersion =
      responseContractVersionHeader === undefined
        ? undefined
        : spaceDispatchTraceResponseContractVersionHeaderSchema.safeParse(
            responseContractVersionHeader
          );
    const password = readSpacePasswordHeader(c.req.raw.headers);
    if (dispatchId.length === 0) {
      return respondBadRequest({
        c,
        route: SPACE_DISPATCH_TRACE_ROUTE,
        method: "GET",
        message: "dispatchId is required",
        spaceId,
      });
    }
    if (responseContractVersion && !responseContractVersion.success) {
      return respondBadRequest({
        c,
        route: SPACE_DISPATCH_TRACE_ROUTE,
        method: "GET",
        message: "dispatch trace response version is invalid",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_DISPATCH_TRACE_ROUTE,
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceDispatchTrace({
          spaceId,
          dispatchId,
          ...(includeRemoteAgentRuntimeDiagnostics
            ? { includeRemoteAgentRuntimeDiagnostics: true }
            : {}),
          ...(responseContractVersion?.success
            ? { responseContractVersion: responseContractVersion.data }
            : {}),
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
