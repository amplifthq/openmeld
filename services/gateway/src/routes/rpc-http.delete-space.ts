import type { SpaceMeta } from "@openmeld/protocol";
import type { Context, Hono } from "hono";
import {
  resolveProfile,
  sanitizeHeadersForAuthRpc,
} from "../lib/auth-rpc-client";
import { mapAuthRpcHttpError } from "../lib/auth-rpc-error";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  readSpacePasswordHeader,
} from "./rpc-http.helpers";

const DELETE_SPACE_ROUTE = "/v1/spaces/:spaceId";

export function registerDeleteSpaceRoute(app: Hono<HonoBindings>): void {
  app.delete("/v1/spaces/:spaceId/personal-history", (c) =>
    executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/personal-history",
      method: "DELETE",
      spaceId: c.req.param("spaceId"),
      execute: () =>
        c.var.coreRpc.deleteConversationForMe({
          spaceId: c.req.param("spaceId"),
          context: buildCoreRpcContext(c),
        }),
    })
  );
  app.delete(DELETE_SPACE_ROUTE, (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);

    return executeRpcRoute({
      c,
      route: DELETE_SPACE_ROUTE,
      method: "DELETE",
      spaceId,
      execute: async () => {
        const context = buildCoreRpcContext(c);
        const meta = await c.var.coreRpc.getSpaceMeta({
          spaceId,
          ...(password === undefined ? {} : { password }),
          context,
        });
        const approvedAgentCreatorProfileId =
          await resolveApprovedAgentCreatorProfileId({
            c,
            meta,
          });
        const deleted = await c.var.coreRpc.deleteSpace({
          requestCredential: await buildCoreRpcCredential(c),
          spaceId,
          ...(approvedAgentCreatorProfileId
            ? { approvedAgentCreatorProfileId }
            : {}),
          ...(password === undefined ? {} : { password }),
          context,
        });
        await recordDeletedSpaceTombstone({
          c,
          spaceId,
          meta,
        });
        return deleted;
      },
    });
  });
}

async function resolveApprovedAgentCreatorProfileId(input: {
  c: Context<HonoBindings>;
  meta: SpaceMeta;
}): Promise<string | undefined> {
  // TODO(approval-flow): replace CLI-only human confirmation with web/email
  // out-of-band approval once product-level approval surfaces are available.
  const creator = resolveSpaceCreator(input.meta);
  if (!(creator.profileId && creator.kind === "agent")) {
    return undefined;
  }

  if (input.c.var.resolvedProfile.profileKind !== "human") {
    return undefined;
  }

  const result = await resolveProfile({
    authRpc: input.c.var.authRpc,
    headers: input.c.req.raw.headers,
    requestId: input.c.var.openMeldRequestContext.actorContext.requestId,
    openMeldProfileId: creator.profileId,
    profileKind: "agent",
  });
  if (!result?.ok) {
    throw toRouteHttpError({
      code: result?.code,
      message: result?.message,
    });
  }
  if (!result.resolvedProfile) {
    return undefined;
  }
  if (result.resolvedProfile.profileKind !== "agent") {
    return undefined;
  }
  if (
    result.resolvedProfile.ownerUserId !==
    input.c.var.resolvedProfile.ownerUserId
  ) {
    return undefined;
  }

  return creator.profileId;
}

function toRouteHttpError(input: { code?: string; message?: string }): Error {
  const mapped = mapAuthRpcHttpError(input);
  const error = new Error(mapped.message) as Error & {
    status?: number;
    code?: string;
  };
  error.status = mapped.status;
  error.code = mapped.code;
  return error;
}

function resolveSpaceCreator(meta: SpaceMeta): {
  profileId?: string;
  kind?: "human" | "agent" | "system";
} {
  const creator = meta.creator;
  if (!(creator && typeof creator === "object")) {
    return {};
  }

  let profileId = "";
  if (typeof creator.profileId === "string") {
    profileId = creator.profileId.trim();
  } else if (typeof creator.profile === "string") {
    profileId = creator.profile.trim();
  }
  const kind =
    creator.kind === "human" ||
    creator.kind === "agent" ||
    creator.kind === "system"
      ? creator.kind
      : undefined;

  return {
    ...(profileId.length > 0 ? { profileId } : {}),
    ...(kind ? { kind } : {}),
  };
}

async function recordDeletedSpaceTombstone(input: {
  c: Context<HonoBindings>;
  spaceId: string;
  meta: SpaceMeta;
}): Promise<void> {
  const gatewayHost = resolveGatewayHostFromRequest(input.c);
  if (!gatewayHost) {
    return;
  }

  const creator = resolveSpaceCreator(input.meta);
  const spaceName = resolveOptionalText(input.meta.name);
  try {
    const result = await input.c.var.authRpc.upsertSpaceDeletionTombstone({
      headers: sanitizeHeadersForAuthRpc(input.c.req.raw.headers),
      requestId: input.c.var.openMeldRequestContext.actorContext.requestId,
      openMeldProfileId: input.c.var.resolvedProfile.openMeldProfileId,
      spaceId: input.spaceId,
      gatewayHost,
      ...(spaceName ? { spaceName } : {}),
      ...(creator.profileId ? { creatorProfileId: creator.profileId } : {}),
      ...(creator.kind ? { creatorKind: creator.kind } : {}),
      deletedByProfileId: input.c.var.resolvedProfile.openMeldProfileId,
      deletedByProfileName: input.c.var.resolvedProfile.profileName,
      deletedByOwnerUserId: input.c.var.resolvedProfile.ownerUserId,
      deletedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      return;
    }
  } catch {
    return;
  }
}

function resolveGatewayHostFromRequest(
  c: Context<HonoBindings>
): string | null {
  const forwardedHost = normalizeGatewayHostHeader(
    c.req.raw.headers.get("x-forwarded-host")
  );
  if (forwardedHost) {
    return forwardedHost;
  }

  const hostHeader = normalizeGatewayHostHeader(c.req.raw.headers.get("host"));
  if (hostHeader) {
    return hostHeader;
  }

  try {
    return new URL(c.req.url).host.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeGatewayHostHeader(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const candidate = value.split(",")[0]?.trim().toLowerCase() ?? "";
  if (candidate.length === 0) {
    return null;
  }

  try {
    return new URL(`http://${candidate}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function resolveOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
