import {
  larkPlatformActiveRegistrationListResponseSchema,
  larkPlatformProviderSchema,
  larkPlatformRegistrationAttemptIdSchema,
  larkPlatformRegistrationBeginModeSchema,
  larkPlatformRegistrationResponseSchema,
  messageChannelConnectionListResponseSchema,
  messageChannelIdentityLinkConsumeBodySchema,
  messageChannelIdentityLinkConsumeResponseSchema,
  messageChannelIdentityLinkIdSchema,
  messageChannelIdentityLinkPreviewBodySchema,
  messageChannelIdentityLinkPreviewResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { z } from "zod/v4";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";

export const MESSAGE_CHANNEL_CONNECTIONS_ROUTE =
  "/v1/organizations/current/message-channels";
export const LARK_PLATFORM_ACTIVE_REGISTRATIONS_ROUTE = `${MESSAGE_CHANNEL_CONNECTIONS_ROUTE}/registrations`;
export const LARK_PLATFORM_REGISTRATION_ATTEMPTS_ROUTE = `${MESSAGE_CHANNEL_CONNECTIONS_ROUTE}/:provider/registration-attempts`;
export const LARK_PLATFORM_REGISTRATION_POLL_ROUTE = `${LARK_PLATFORM_REGISTRATION_ATTEMPTS_ROUTE}/:attemptId/poll`;
export const LARK_PLATFORM_CONNECTION_ROUTE = `${MESSAGE_CHANNEL_CONNECTIONS_ROUTE}/:provider`;
export const MESSAGE_CHANNEL_IDENTITY_LINK_PREVIEW_ROUTE =
  "/v1/message-channels/identity-link/preview";
export const MESSAGE_CHANNEL_IDENTITY_LINK_CONSUME_ROUTE =
  "/v1/message-channels/identity-link/consume";
export const MESSAGE_CHANNEL_IDENTITY_LINK_ROUTE = `${MESSAGE_CHANNEL_CONNECTIONS_ROUTE}/identity-links/:identityLinkId`;

export function registerMessageChannelRoutes(app: Hono<HonoBindings>): void {
  app.get(MESSAGE_CHANNEL_CONNECTIONS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listMessageChannelConnections({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: messageChannelConnectionListResponseSchema,
      route: MESSAGE_CHANNEL_CONNECTIONS_ROUTE,
    })
  );
  app.delete(MESSAGE_CHANNEL_IDENTITY_LINK_ROUTE, (c) => {
    const identityLinkId = c.req.param("identityLinkId").trim();
    if (!messageChannelIdentityLinkIdSchema.safeParse(identityLinkId).success) {
      return respondBadRequest({
        c,
        message: "The connected account reference is invalid.",
        method: "DELETE",
        route: MESSAGE_CHANNEL_IDENTITY_LINK_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.disconnectMessageChannelIdentityLink({
          context: buildCoreRpcContext(c),
          identityLinkId,
        }),
      method: "DELETE",
      responseSchema: messageChannelConnectionListResponseSchema,
      route: MESSAGE_CHANNEL_IDENTITY_LINK_ROUTE,
    });
  });
  app.get(LARK_PLATFORM_ACTIVE_REGISTRATIONS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listActiveLarkPlatformRegistrations({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: larkPlatformActiveRegistrationListResponseSchema,
      route: LARK_PLATFORM_ACTIVE_REGISTRATIONS_ROUTE,
    })
  );
  app.post(MESSAGE_CHANNEL_IDENTITY_LINK_PREVIEW_ROUTE, async (c) => {
    const parsed = await parseJsonBody(
      c,
      messageChannelIdentityLinkPreviewBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.previewMessageChannelIdentityLink({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: messageChannelIdentityLinkPreviewResponseSchema,
      route: MESSAGE_CHANNEL_IDENTITY_LINK_PREVIEW_ROUTE,
    });
  });
  app.post(MESSAGE_CHANNEL_IDENTITY_LINK_CONSUME_ROUTE, async (c) => {
    const parsed = await parseJsonBody(
      c,
      messageChannelIdentityLinkConsumeBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.consumeMessageChannelIdentityLink({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: messageChannelIdentityLinkConsumeResponseSchema,
      route: MESSAGE_CHANNEL_IDENTITY_LINK_CONSUME_ROUTE,
    });
  });
  app.post(LARK_PLATFORM_REGISTRATION_ATTEMPTS_ROUTE, (c) => {
    const provider = larkPlatformProviderSchema.safeParse(
      c.req.param("provider")
    );
    const mode = larkPlatformRegistrationBeginModeSchema.safeParse(
      c.req.query("mode") ?? "resume"
    );
    if (!(provider.success && mode.success)) {
      return respondBadRequest({
        c,
        message: "The Message Channel registration request is invalid.",
        method: "POST",
        reason: [
          ...(provider.success ? [] : provider.error.issues),
          ...(mode.success ? [] : mode.error.issues),
        ]
          .map((issue) => issue.message)
          .join("; "),
        route: LARK_PLATFORM_REGISTRATION_ATTEMPTS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.beginLarkPlatformRegistration({
          context: buildCoreRpcContext(c),
          mode: mode.data,
          provider: provider.data,
        }),
      method: "POST",
      responseSchema: larkPlatformRegistrationResponseSchema,
      route: LARK_PLATFORM_REGISTRATION_ATTEMPTS_ROUTE,
    });
  });
  app.post(LARK_PLATFORM_REGISTRATION_POLL_ROUTE, (c) => {
    const provider = larkPlatformProviderSchema.safeParse(
      c.req.param("provider")
    );
    const attemptId = larkPlatformRegistrationAttemptIdSchema.safeParse(
      c.req.param("attemptId")
    );
    if (!(provider.success && attemptId.success)) {
      return respondBadRequest({
        c,
        message: "The Message Channel registration request is invalid.",
        method: "POST",
        reason: [
          ...(provider.success ? [] : provider.error.issues),
          ...(attemptId.success ? [] : attemptId.error.issues),
        ]
          .map((issue) => issue.message)
          .join("; "),
        route: LARK_PLATFORM_REGISTRATION_POLL_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.pollLarkPlatformRegistration({
          attemptId: attemptId.data,
          context: buildCoreRpcContext(c),
          provider: provider.data,
        }),
      method: "POST",
      responseSchema: larkPlatformRegistrationResponseSchema,
      route: LARK_PLATFORM_REGISTRATION_POLL_ROUTE,
    });
  });
  app.delete(LARK_PLATFORM_CONNECTION_ROUTE, (c) => {
    const provider = larkPlatformProviderSchema.safeParse(
      c.req.param("provider")
    );
    if (!provider.success) {
      return respondBadRequest({
        c,
        message: "The Message Channel provider is invalid.",
        method: "DELETE",
        reason: provider.error.message,
        route: LARK_PLATFORM_CONNECTION_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.disconnectLarkPlatformRegistration({
          context: buildCoreRpcContext(c),
          provider: provider.data,
        }),
      method: "DELETE",
      responseSchema: messageChannelConnectionListResponseSchema,
      route: LARK_PLATFORM_CONNECTION_ROUTE,
    });
  });
}

type JsonBodyParseResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      ok: false;
      response: Response;
    };

async function parseJsonBody<T>(
  c: Context<HonoBindings>,
  schema: z.ZodType<T>
): Promise<JsonBodyParseResult<T>> {
  let body: unknown = {};
  const rawBody = (await c.req.text()).trim();
  if (rawBody.length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return {
        ok: false,
        response: respondBadRequest({
          c,
          code: "invalid_json",
          message: "Invalid JSON",
          method: "POST",
          route: c.req.path,
        }),
      };
    }
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: respondBadRequest({
        c,
        code: "invalid_payload",
        message: parsed.error.issues[0]?.message ?? "Invalid payload.",
        method: "POST",
        route: c.req.path,
      }),
    };
  }
  return { data: parsed.data, ok: true };
}
