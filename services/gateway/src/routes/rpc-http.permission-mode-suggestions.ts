import {
  listPermissionModeSuggestionsBodySchema,
  listPermissionModeSuggestionsResponseSchema,
  resolvePermissionModeSuggestionBodySchema,
  resolvePermissionModeSuggestionResponseSchema,
  suggestPermissionModeRequestSchema,
  suggestPermissionModeResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import * as z from "zod/v4";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

// Contract: developing/product/organizations-and-center-agent.md
// (Permission-mode advisor).
const SUGGESTIONS_ROUTE =
  "/v1/organizations/current/permission-mode-suggestions";
const LIST_ROUTE = `${SUGGESTIONS_ROUTE}/list`;
const RESOLVE_ROUTE = `${SUGGESTIONS_ROUTE}/resolve`;

const organizationQuerySchema = z.strictObject({
  expectedOrganizationId: z.string().trim().min(1),
});

export function registerPermissionModeSuggestionRoutes(
  app: Hono<HonoBindings>
) {
  app.post(SUGGESTIONS_ROUTE, async (c) => {
    const expectedOrganizationId = parseOrganization(c, SUGGESTIONS_ROUTE);
    if (expectedOrganizationId instanceof Response) {
      return expectedOrganizationId;
    }
    const request = suggestPermissionModeRequestSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!request.success) {
      return respondBadRequest({
        c,
        method: "POST",
        message: "Choose a valid permission-mode suggestion.",
        route: SUGGESTIONS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: () =>
        c.var.coreRpc.suggestPermissionMode({
          context: buildCoreRpcContext(c),
          expectedOrganizationId,
          request: request.data,
        }),
      method: "POST",
      responseSchema: suggestPermissionModeResponseSchema,
      retryMode: "none",
      route: SUGGESTIONS_ROUTE,
    });
  });
  app.post(LIST_ROUTE, async (c) => {
    const expectedOrganizationId = parseOrganization(c, LIST_ROUTE);
    if (expectedOrganizationId instanceof Response) {
      return expectedOrganizationId;
    }
    const body = listPermissionModeSuggestionsBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        method: "POST",
        message: "Choose a valid Space.",
        route: LIST_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: () =>
        c.var.coreRpc.listPermissionModeSuggestions({
          context: buildCoreRpcContext(c),
          expectedOrganizationId,
          spaceId: body.data.spaceId,
        }),
      method: "POST",
      responseSchema: listPermissionModeSuggestionsResponseSchema,
      retryMode: "none",
      route: LIST_ROUTE,
    });
  });
  app.post(RESOLVE_ROUTE, async (c) => {
    const expectedOrganizationId = parseOrganization(c, RESOLVE_ROUTE);
    if (expectedOrganizationId instanceof Response) {
      return expectedOrganizationId;
    }
    const body = resolvePermissionModeSuggestionBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        method: "POST",
        message: "Choose a valid permission-mode suggestion.",
        route: RESOLVE_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: () =>
        c.var.coreRpc.resolvePermissionModeSuggestion({
          context: buildCoreRpcContext(c),
          expectedOrganizationId,
          resolution: body.data.resolution,
          suggestionId: body.data.suggestionId,
        }),
      method: "POST",
      responseSchema: resolvePermissionModeSuggestionResponseSchema,
      retryMode: "none",
      route: RESOLVE_ROUTE,
    });
  });
}

function parseOrganization(
  c: Context<HonoBindings>,
  route: string
): string | Response {
  const query = organizationQuerySchema.safeParse({
    expectedOrganizationId: c.req.query("expectedOrganizationId"),
  });
  if (query.success) {
    return query.data.expectedOrganizationId;
  }
  return respondBadRequest({
    c,
    code: "invalid_payload",
    message: "The expected Organization is required.",
    method: "POST",
    route,
  });
}
