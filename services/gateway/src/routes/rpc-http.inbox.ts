import {
  OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
  OPENMELD_INBOX_SOURCE_TARGET_VERSION,
} from "@openmeld/gateway-contract";
import {
  centerAgentInboxSummaryResponseSchema,
  dismissInboxItemResponseSchema,
  getInboxItemResponseSchema,
  inboxItemRouteParamsSchema,
  inboxNotificationPreferencesResponseSchema,
  inboxSummaryResponseSchema,
  listInboxItemsQuerySchema,
  listInboxItemsResponseSchema,
  markAllInboxItemsReadResponseSchema,
  markCenterAgentInboxReadThroughBodySchema,
  markCenterAgentInboxReadThroughResponseSchema,
  markInboxItemReadBodySchema,
  markInboxItemReadResponseSchema,
  markSpaceInboxReadThroughBodySchema,
  markSpaceInboxReadThroughResponseSchema,
  spaceInboxSummaryResponseSchema,
  updateInboxNotificationPreferencesBodySchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { z } from "zod/v4";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";
import type { RpcHttpMethod } from "./rpc-http.types";

const INBOX_ROUTE = "/v1/inbox";
const INBOX_SUMMARY_ROUTE = `${INBOX_ROUTE}/summary`;
const CENTER_AGENT_INBOX_SUMMARY_ROUTE = `${INBOX_ROUTE}/center-agent/summary`;
const CENTER_AGENT_INBOX_READ_THROUGH_ROUTE = `${INBOX_ROUTE}/center-agent/read-through`;
const SPACE_INBOX_SUMMARY_ROUTE = `${INBOX_ROUTE}/spaces/summary`;
const SPACE_INBOX_READ_THROUGH_ROUTE = `${INBOX_ROUTE}/spaces/read-through`;
const INBOX_MARK_ALL_READ_ROUTE = `${INBOX_ROUTE}/mark-all-read`;
const INBOX_PREFERENCES_ROUTE = `${INBOX_ROUTE}/preferences`;
const INBOX_ITEM_READ_ROUTE = `${INBOX_ROUTE}/items/:itemId/read`;
const INBOX_ITEM_DISMISS_ROUTE = `${INBOX_ROUTE}/items/:itemId/dismiss`;
const INBOX_ITEM_ROUTE = `${INBOX_ROUTE}/items/:itemId`;

export function registerInboxRoutes(app: Hono<HonoBindings>): void {
  app.get(CENTER_AGENT_INBOX_SUMMARY_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentInboxSummary({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: centerAgentInboxSummaryResponseSchema,
      route: CENTER_AGENT_INBOX_SUMMARY_ROUTE,
    })
  );

  app.post(CENTER_AGENT_INBOX_READ_THROUGH_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      CENTER_AGENT_INBOX_READ_THROUGH_ROUTE,
      "POST",
      markCenterAgentInboxReadThroughBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.markCenterAgentInboxReadThrough({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: markCenterAgentInboxReadThroughResponseSchema,
      route: CENTER_AGENT_INBOX_READ_THROUGH_ROUTE,
    });
  });

  app.get(SPACE_INBOX_SUMMARY_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getSpaceInboxSummary({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: spaceInboxSummaryResponseSchema,
      route: SPACE_INBOX_SUMMARY_ROUTE,
    })
  );

  app.post(SPACE_INBOX_READ_THROUGH_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      SPACE_INBOX_READ_THROUGH_ROUTE,
      "POST",
      markSpaceInboxReadThroughBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.markSpaceInboxReadThrough({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: markSpaceInboxReadThroughResponseSchema,
      route: SPACE_INBOX_READ_THROUGH_ROUTE,
    });
  });

  app.get(INBOX_ROUTE, (c) => {
    const query = listInboxItemsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return invalidPayloadResponse(
        c,
        INBOX_ROUTE,
        "GET",
        query.error.issues[0]?.message
      );
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listInboxItems({
          ...query.data,
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      resolveSuccessPayload: (result) =>
        resolveInboxListResponse({
          result,
          supportsCurrentSourceTargets: supportsCurrentInboxSourceTargets(c),
        }),
      responseSchema: listInboxItemsResponseSchema,
      route: INBOX_ROUTE,
    });
  });

  app.get(INBOX_SUMMARY_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getInboxSummary({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: inboxSummaryResponseSchema,
      route: INBOX_SUMMARY_ROUTE,
    })
  );

  app.get(INBOX_ITEM_ROUTE, (c) => {
    const params = inboxItemRouteParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return invalidPayloadResponse(
        c,
        INBOX_ITEM_ROUTE,
        "GET",
        params.error.issues[0]?.message
      );
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getInboxItem({
          context: buildCoreRpcContext(c),
          itemId: params.data.itemId,
        }),
      method: "GET",
      resolveSuccessPayload: (result) =>
        resolveInboxItemResponse({
          result,
          schema: getInboxItemResponseSchema,
          supportsCurrentSourceTargets: supportsCurrentInboxSourceTargets(c),
        }),
      responseSchema: getInboxItemResponseSchema,
      route: INBOX_ITEM_ROUTE,
    });
  });

  app.put(INBOX_ITEM_DISMISS_ROUTE, (c) => {
    const params = inboxItemRouteParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return invalidPayloadResponse(
        c,
        INBOX_ITEM_DISMISS_ROUTE,
        "PUT",
        params.error.issues[0]?.message
      );
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.dismissInboxItem({
          context: buildCoreRpcContext(c),
          itemId: params.data.itemId,
        }),
      method: "PUT",
      responseSchema: dismissInboxItemResponseSchema,
      route: INBOX_ITEM_DISMISS_ROUTE,
    });
  });

  app.patch(INBOX_ITEM_READ_ROUTE, async (c) => {
    const params = inboxItemRouteParamsSchema.safeParse(c.req.param());
    if (!params.success) {
      return invalidPayloadResponse(
        c,
        INBOX_ITEM_READ_ROUTE,
        "PATCH",
        params.error.issues[0]?.message
      );
    }
    const body = await parseBody(
      c,
      INBOX_ITEM_READ_ROUTE,
      "PATCH",
      markInboxItemReadBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.markInboxItemRead({
          ...body.data,
          context: buildCoreRpcContext(c),
          itemId: params.data.itemId,
        }),
      method: "PATCH",
      resolveSuccessPayload: (result) =>
        resolveInboxItemResponse({
          result,
          schema: markInboxItemReadResponseSchema,
          supportsCurrentSourceTargets: supportsCurrentInboxSourceTargets(c),
        }),
      responseSchema: markInboxItemReadResponseSchema,
      route: INBOX_ITEM_READ_ROUTE,
    });
  });

  app.post(INBOX_MARK_ALL_READ_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.markAllInboxItemsRead({
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: markAllInboxItemsReadResponseSchema,
      route: INBOX_MARK_ALL_READ_ROUTE,
    })
  );

  app.get(INBOX_PREFERENCES_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getInboxNotificationPreferences({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: inboxNotificationPreferencesResponseSchema,
      route: INBOX_PREFERENCES_ROUTE,
    })
  );

  app.patch(INBOX_PREFERENCES_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      INBOX_PREFERENCES_ROUTE,
      "PATCH",
      updateInboxNotificationPreferencesBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.updateInboxNotificationPreferences({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "PATCH",
      responseSchema: inboxNotificationPreferencesResponseSchema,
      route: INBOX_PREFERENCES_ROUTE,
    });
  });
}

function resolveInboxListResponse(input: {
  result: unknown;
  supportsCurrentSourceTargets: boolean;
}): z.infer<typeof listInboxItemsResponseSchema> {
  const response = listInboxItemsResponseSchema.parse(input.result);
  if (input.supportsCurrentSourceTargets) {
    return response;
  }
  return {
    ...response,
    items: response.items.map(projectLegacyInboxSourceTarget),
  };
}

type InboxItemResponse = z.infer<typeof getInboxItemResponseSchema>;

function resolveInboxItemResponse(input: {
  result: unknown;
  schema: { parse: (value: unknown) => InboxItemResponse };
  supportsCurrentSourceTargets: boolean;
}): InboxItemResponse {
  const response = input.schema.parse(input.result);
  if (input.supportsCurrentSourceTargets) {
    return response;
  }
  return {
    ...response,
    item: projectLegacyInboxSourceTarget(response.item),
  };
}

function projectLegacyInboxSourceTarget(
  item: z.infer<typeof listInboxItemsResponseSchema>["items"][number]
): z.infer<typeof listInboxItemsResponseSchema>["items"][number] {
  if (item.sourceTarget.kind !== "message_channel") {
    return item;
  }
  return {
    ...item,
    sourceTarget: { kind: "center_agent" },
  };
}

function supportsCurrentInboxSourceTargets(c: Context<HonoBindings>): boolean {
  return (
    c.req.header(OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION) ===
    OPENMELD_INBOX_SOURCE_TARGET_VERSION
  );
}

async function parseBody<T>(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod,
  schema: z.ZodType<T>
): Promise<
  { data: T; ok: true } | { ok: false; response: Response | Promise<Response> }
> {
  const raw = await readJsonRequestBody(c.req.raw);
  if (!raw.ok) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, raw.message),
    };
  }
  const parsed = schema.safeParse(raw.value);
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(
        c,
        route,
        method,
        parsed.error.issues[0]?.message
      ),
    };
  }
  return { data: parsed.data, ok: true };
}

function invalidPayloadResponse(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod,
  message?: string
): Response | Promise<Response> {
  return respondBadRequest({
    c,
    code: "invalid_payload",
    message: message ?? "Inbox request is invalid.",
    method,
    route,
  });
}
