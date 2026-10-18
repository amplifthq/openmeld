import {
  AGENT_ACCESS_REQUEST_DECISION_ROUTE,
  AGENT_ACCESS_REQUEST_ROUTE,
  AGENT_ACCESS_REQUEST_WITHDRAW_ROUTE,
  AGENT_ACCESS_REQUESTS_ROUTE,
  AGENT_PROFILE_ACCESS_GRANT_REVOKE_ROUTE,
  AGENT_PROFILE_ACCESS_GRANTS_ROUTE,
  agentAccessRequestRouteParamsSchema,
  agentProfileAccessGrantRevokeRouteParamsSchema,
  agentProfileAccessGrantsRouteParamsSchema,
  createSpaceAgentRequestBodySchema,
  createSpaceAgentRequestResponseSchema,
  decideAgentAccessRequestBodySchema,
  decideAgentAccessRequestResponseSchema,
  getAgentAccessRequestResponseSchema,
  listAgentAccessRequestsQuerySchema,
  listAgentAccessRequestsResponseSchema,
  listAgentProfileAccessGrantsResponseSchema,
  revokeAgentProfileAccessGrantResponseSchema,
  SPACE_AGENT_REQUESTS_ROUTE,
  spaceAgentRequestRouteParamsSchema,
  withdrawAgentAccessRequestResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

// Colleague use of an Agent: owner consent requests and grants
// (design-plans/member-agent-program.md §4.6). Every route is a no-store
// read or write for the signed-in member; Core authorizes each one.

function noStore(): (
  c: Context<HonoBindings>,
  next: () => Promise<void>
) => Promise<void> {
  return async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  };
}

export function registerAgentAccessRoutes(app: Hono<HonoBindings>): void {
  app.get(AGENT_ACCESS_REQUESTS_ROUTE, noStore(), (c) => {
    const query = listAgentAccessRequestsQuerySchema.safeParse({
      ...(c.req.query("spaceId") ? { spaceId: c.req.query("spaceId") } : {}),
      ...(c.req.query("role") ? { role: c.req.query("role") } : {}),
      ...(c.req.query("status") ? { status: c.req.query("status") } : {}),
    });
    if (!query.success) {
      return respondBadRequest({
        c,
        route: AGENT_ACCESS_REQUESTS_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: "Invalid request filter.",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_ACCESS_REQUESTS_ROUTE,
      method: "GET",
      responseSchema: listAgentAccessRequestsResponseSchema,
      execute: () =>
        c.var.coreRpc.listAgentAccessRequests({
          context: buildCoreRpcContext(c),
          query: query.data,
        }),
    });
  });

  app.get(AGENT_ACCESS_REQUEST_ROUTE, noStore(), (c) => {
    const params = agentAccessRequestRouteParamsSchema.safeParse({
      requestId: c.req.param("requestId"),
    });
    if (!params.success) {
      return respondBadRequest({
        c,
        route: AGENT_ACCESS_REQUEST_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: "Invalid request ID.",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_ACCESS_REQUEST_ROUTE,
      method: "GET",
      responseSchema: getAgentAccessRequestResponseSchema,
      execute: () =>
        c.var.coreRpc.getAgentAccessRequest({
          context: buildCoreRpcContext(c),
          requestId: params.data.requestId,
        }),
    });
  });

  app.post(AGENT_ACCESS_REQUEST_DECISION_ROUTE, noStore(), async (c) => {
    const params = agentAccessRequestRouteParamsSchema.safeParse({
      requestId: c.req.param("requestId"),
    });
    const raw = await readJsonRequestBody(c.req.raw);
    const body = raw.ok
      ? decideAgentAccessRequestBodySchema.safeParse(raw.value)
      : null;
    if (!(params.success && body?.success)) {
      return respondBadRequest({
        c,
        route: AGENT_ACCESS_REQUEST_DECISION_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Choose how to answer this request.",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_ACCESS_REQUEST_DECISION_ROUTE,
      method: "POST",
      responseSchema: decideAgentAccessRequestResponseSchema,
      execute: () =>
        c.var.coreRpc.decideAgentAccessRequest({
          requestCredential: buildCoreRpcCredential(c),
          context: buildCoreRpcContext(c),
          decision: body.data.decision,
          requestId: params.data.requestId,
        }),
    });
  });

  app.post(AGENT_ACCESS_REQUEST_WITHDRAW_ROUTE, noStore(), (c) => {
    const params = agentAccessRequestRouteParamsSchema.safeParse({
      requestId: c.req.param("requestId"),
    });
    if (!params.success) {
      return respondBadRequest({
        c,
        route: AGENT_ACCESS_REQUEST_WITHDRAW_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid request ID.",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_ACCESS_REQUEST_WITHDRAW_ROUTE,
      method: "POST",
      responseSchema: withdrawAgentAccessRequestResponseSchema,
      execute: () =>
        c.var.coreRpc.withdrawAgentAccessRequest({
          context: buildCoreRpcContext(c),
          requestId: params.data.requestId,
        }),
    });
  });

  app.post(SPACE_AGENT_REQUESTS_ROUTE, noStore(), async (c) => {
    const params = spaceAgentRequestRouteParamsSchema.safeParse({
      spaceId: c.req.param("spaceId"),
    });
    const raw = await readJsonRequestBody(c.req.raw);
    const body = raw.ok
      ? createSpaceAgentRequestBodySchema.safeParse(raw.value)
      : null;
    if (!(params.success && body?.success)) {
      return respondBadRequest({
        c,
        route: SPACE_AGENT_REQUESTS_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Choose an Agent to ask for.",
      });
    }
    return executeRpcRoute({
      c,
      route: SPACE_AGENT_REQUESTS_ROUTE,
      method: "POST",
      responseSchema: createSpaceAgentRequestResponseSchema,
      execute: () =>
        c.var.coreRpc.createSpaceAgentRequest({
          agentProfileId: body.data.agentProfileId,
          context: buildCoreRpcContext(c),
          spaceId: params.data.spaceId,
          ...(body.data.signalId ? { signalId: body.data.signalId } : {}),
        }),
    });
  });

  app.get(AGENT_PROFILE_ACCESS_GRANTS_ROUTE, noStore(), (c) => {
    const params = agentProfileAccessGrantsRouteParamsSchema.safeParse({
      agentProfileId: c.req.param("agentProfileId"),
    });
    if (!params.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_ACCESS_GRANTS_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: "Invalid Agent Profile ID.",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_ACCESS_GRANTS_ROUTE,
      method: "GET",
      responseSchema: listAgentProfileAccessGrantsResponseSchema,
      execute: () =>
        c.var.coreRpc.listAgentProfileAccessGrants({
          agentProfileId: params.data.agentProfileId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(AGENT_PROFILE_ACCESS_GRANT_REVOKE_ROUTE, noStore(), (c) => {
    const params = agentProfileAccessGrantRevokeRouteParamsSchema.safeParse({
      agentProfileId: c.req.param("agentProfileId"),
      grantId: c.req.param("grantId"),
    });
    if (!params.success) {
      return respondBadRequest({
        c,
        route: AGENT_PROFILE_ACCESS_GRANT_REVOKE_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Invalid access grant.",
      });
    }
    return executeRpcRoute({
      c,
      route: AGENT_PROFILE_ACCESS_GRANT_REVOKE_ROUTE,
      method: "POST",
      responseSchema: revokeAgentProfileAccessGrantResponseSchema,
      execute: () =>
        c.var.coreRpc.revokeAgentProfileAccessGrant({
          requestCredential: buildCoreRpcCredential(c),
          agentProfileId: params.data.agentProfileId,
          context: buildCoreRpcContext(c),
          grantId: params.data.grantId,
        }),
    });
  });
}
