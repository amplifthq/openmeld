import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  formatAuditValue,
  readSpacePasswordHeader,
  respondBadRequest,
  respondProfileNotFound,
} from "./rpc-http.helpers";
import {
  normalizeProfileIdParam,
  parsePatchSpaceCursorBody,
  readJsonRequestBody,
} from "./rpc-http.parsers";

export function registerCursorRoutes(app: Hono<HonoBindings>): void {
  app.get("/v1/spaces/:spaceId/cursors/:profileId", (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const profileIdRaw = c.req.param("profileId");
    const profileId = normalizeProfileIdParam(profileIdRaw);
    if (!profileId) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/cursors/:profileId",
        method: "GET",
        message: "Invalid profileId",
        spaceId,
        reason: `invalid_profile_id_param profileId=${formatAuditValue(profileIdRaw)}`,
      });
    }

    if (profileId !== c.var.resolvedProfile.openMeldProfileId) {
      return respondProfileNotFound({
        c,
        route: "/v1/spaces/:spaceId/cursors/:profileId",
        method: "GET",
        spaceId,
        reason: `profile_mismatch path=${formatAuditValue(profileId)} resolved=${formatAuditValue(c.var.resolvedProfile.openMeldProfileId)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/cursors/:profileId",
      method: "GET",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.getSpaceCursor({
          spaceId,
          profileId,
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });

  app.patch("/v1/spaces/:spaceId/cursors/:profileId", async (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const profileIdRaw = c.req.param("profileId");
    const profileId = normalizeProfileIdParam(profileIdRaw);
    if (!profileId) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/cursors/:profileId",
        method: "PATCH",
        message: "Invalid profileId",
        spaceId,
        reason: `invalid_profile_id_param profileId=${formatAuditValue(profileIdRaw)}`,
      });
    }

    if (profileId !== c.var.resolvedProfile.openMeldProfileId) {
      return respondProfileNotFound({
        c,
        route: "/v1/spaces/:spaceId/cursors/:profileId",
        method: "PATCH",
        spaceId,
        reason: `profile_mismatch path=${formatAuditValue(profileId)} resolved=${formatAuditValue(c.var.resolvedProfile.openMeldProfileId)}`,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/cursors/:profileId",
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
        reason: `invalid_patch_cursor_body profileId=${formatAuditValue(profileId)} error=${bodyResult.message} body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }

    const parsed = parsePatchSpaceCursorBody(bodyResult.value);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/cursors/:profileId",
        method: "PATCH",
        ...(parsed.message === "Invalid JSON" ? { code: "invalid_json" } : {}),
        message: parsed.message,
        spaceId,
        reason: `invalid_patch_cursor_body profileId=${formatAuditValue(profileId)} error=${parsed.message} body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/cursors/:profileId",
      method: "PATCH",
      spaceId,
      execute: async () => {
        return await c.var.coreRpc.updateSpaceCursor({
          spaceId,
          profileId,
          ...(typeof parsed.value.lastSeenTs === "number"
            ? { lastSeenTs: parsed.value.lastSeenTs }
            : {}),
          ...(typeof parsed.value.role === "string"
            ? { role: parsed.value.role }
            : {}),
          ...(typeof parsed.value.mentionAlias === "string"
            ? { mentionAlias: parsed.value.mentionAlias }
            : {}),
          ...(password === undefined ? {} : { password }),
          context: buildCoreRpcContext(c),
        });
      },
    });
  });
}
