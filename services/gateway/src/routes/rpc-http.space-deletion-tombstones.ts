import type { Context, Hono } from "hono";
import { sanitizeHeadersForAuthRpc } from "../lib/auth-rpc-client";
import { mapAuthRpcHttpError } from "../lib/auth-rpc-error";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  formatAuditValue,
  respondBadRequest,
} from "./rpc-http.helpers";
import {
  parseQuerySpaceDeletionTombstonesBody,
  parseUpsertSpaceDeletionTombstoneBody,
  readJsonRequestBody,
} from "./rpc-http.parsers";

const SPACE_DELETION_TOMBSTONES_QUERY_ROUTE =
  "/v1/spaces/deletion-tombstones/query";
const SPACE_DELETION_TOMBSTONE_ROUTE = "/v1/spaces/:spaceId/deletion-tombstone";

export function registerSpaceDeletionTombstoneRoutes(
  app: Hono<HonoBindings>
): void {
  app.post(SPACE_DELETION_TOMBSTONES_QUERY_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_DELETION_TOMBSTONES_QUERY_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        reason: `invalid_space_deletion_tombstone_query body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }

    const parsedBody = parseQuerySpaceDeletionTombstonesBody(bodyResult.value);
    if (!parsedBody.ok) {
      return respondBadRequest({
        c,
        route: SPACE_DELETION_TOMBSTONES_QUERY_ROUTE,
        method: "POST",
        ...(parsedBody.message === "Invalid JSON"
          ? { code: "invalid_json" }
          : {}),
        message: parsedBody.message,
        reason: `invalid_space_deletion_tombstone_query body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_DELETION_TOMBSTONES_QUERY_ROUTE,
      method: "POST",
      execute: async () => {
        const result = await c.var.authRpc.querySpaceDeletionTombstones({
          headers: sanitizeHeadersForAuthRpc(c.req.raw.headers),
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          openMeldProfileId: c.var.resolvedProfile.openMeldProfileId,
          ...parsedBody.value,
        });
        if (!result.ok) {
          throw toAuthRpcHttpError(result);
        }

        return {
          items: result.items,
        };
      },
    });
  });

  app.put(SPACE_DELETION_TOMBSTONE_ROUTE, async (c) => {
    const spaceIdRaw = c.req.param("spaceId");
    const spaceId = normalizeSpaceIdParam(spaceIdRaw);
    if (!spaceId) {
      return respondBadRequest({
        c,
        route: SPACE_DELETION_TOMBSTONE_ROUTE,
        method: "PUT",
        message: "Invalid spaceId",
        reason: `invalid_space_id_param spaceId=${formatAuditValue(spaceIdRaw)}`,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_DELETION_TOMBSTONE_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
        reason: `invalid_space_deletion_tombstone_upsert body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }

    const parsedBody = parseUpsertSpaceDeletionTombstoneBody(bodyResult.value);
    if (!parsedBody.ok) {
      return respondBadRequest({
        c,
        route: SPACE_DELETION_TOMBSTONE_ROUTE,
        method: "PUT",
        ...(parsedBody.message === "Invalid JSON"
          ? { code: "invalid_json" }
          : {}),
        message: parsedBody.message,
        reason: `invalid_space_deletion_tombstone_upsert body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_DELETION_TOMBSTONE_ROUTE,
      method: "PUT",
      spaceId,
      execute: async () => {
        await assertSpaceIsAlreadyDeleted({
          c,
          spaceId,
        });
        const result = await c.var.authRpc.upsertSpaceDeletionTombstone({
          headers: sanitizeHeadersForAuthRpc(c.req.raw.headers),
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          openMeldProfileId: c.var.resolvedProfile.openMeldProfileId,
          spaceId,
          gatewayHost: parsedBody.value.gatewayHost,
          spaceName: parsedBody.value.spaceName,
          creatorProfileId: parsedBody.value.creatorProfileId,
          creatorKind: parsedBody.value.creatorKind,
          deletedAt: parsedBody.value.deletedAt,
        });
        if (!result.ok) {
          throw toAuthRpcHttpError(result);
        }

        return {
          item: result.item,
        };
      },
    });
  });
}

async function assertSpaceIsAlreadyDeleted(input: {
  c: Context<HonoBindings>;
  spaceId: string;
}): Promise<void> {
  try {
    await input.c.var.coreRpc.getSpaceMeta({
      spaceId: input.spaceId,
      context: buildCoreRpcContext(input.c),
    });
  } catch (error) {
    if (isSpaceNotFoundError(error)) {
      return;
    }
    throw error;
  }

  throw createRouteHttpError({
    status: 409,
    code: "bad_request",
    message: "space must be deleted before writing a tombstone",
  });
}

function isSpaceNotFoundError(error: unknown): boolean {
  if (!(error && typeof error === "object")) {
    return false;
  }

  const maybeError = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (maybeError.status === 404 && maybeError.code === "space.not_found") {
    return true;
  }
  return maybeError.status === 404 && maybeError.message === "space not found";
}

function createRouteHttpError(input: {
  status: number;
  code: string;
  message: string;
}): Error {
  const error = new Error(input.message) as Error & {
    status?: number;
    code?: string;
  };
  error.status = input.status;
  error.code = input.code;
  return error;
}

function normalizeSpaceIdParam(value: string): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toAuthRpcHttpError(input: { code?: string; message?: string }): {
  status: number;
  code: string;
  message: string;
} {
  const mapped = mapAuthRpcHttpError(input);
  return {
    status: mapped.status,
    code: mapped.code,
    message: mapped.message,
  };
}
