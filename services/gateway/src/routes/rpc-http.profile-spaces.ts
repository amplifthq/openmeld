import {
  accountSpaceActiveWakeSummaryQuerySchema,
  accountSpaceActiveWakeSummaryResponseSchema,
  accountSpaceIndexQuerySchema,
  accountSpaceIndexResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import { sanitizeHeadersForAuthRpc } from "../lib/auth-rpc-client";
import { mapAuthRpcHttpError } from "../lib/auth-rpc-error";
import type { HonoBindings } from "../lib/bindings";
import {
  executeRpcRoute,
  formatAuditValue,
  respondBadRequest,
  respondProfileNotFound,
} from "./rpc-http.helpers";
import {
  normalizeProfileIdParam,
  parsePatchProfileSpaceHistoryStatusBody,
  parseProfileSpaceHistoryListQuery,
  parseUpsertProfileSpaceHistoryBody,
  readJsonRequestBody,
} from "./rpc-http.parsers";

const PROFILE_SPACES_ROUTE = "/v1/profiles/:profileId/spaces";
const PROFILE_SPACES_SPACE_ROUTE = "/v1/profiles/:profileId/spaces/:spaceId";
const PROFILE_SPACES_STATUS_ROUTE =
  "/v1/profiles/:profileId/spaces/:spaceId/status";
const ACCOUNT_SPACES_ROUTE = "/v1/account/spaces";
const ACCOUNT_SPACES_ACTIVE_WAKE_SUMMARY_ROUTE =
  "/v1/account/spaces/active-wake-summary";

export function registerProfileSpaceHistoryRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(ACCOUNT_SPACES_ACTIVE_WAKE_SUMMARY_ROUTE, (c) => {
    const url = new URL(c.req.url);
    const parsedQuery = accountSpaceActiveWakeSummaryQuerySchema.safeParse({
      gatewayHost: url.searchParams.get("gatewayHost") ?? undefined,
      selectedProfileId: url.searchParams.get("selectedProfileId"),
    });
    if (!parsedQuery.success) {
      return respondBadRequest({
        c,
        route: ACCOUNT_SPACES_ACTIVE_WAKE_SUMMARY_ROUTE,
        method: "GET",
        message:
          parsedQuery.error.issues[0]?.message ??
          "Invalid account space active wake summary query",
      });
    }
    if (
      parsedQuery.data.selectedProfileId !==
      c.var.resolvedProfile.openMeldProfileId
    ) {
      return respondProfileNotFound({
        c,
        route: ACCOUNT_SPACES_ACTIVE_WAKE_SUMMARY_ROUTE,
        method: "GET",
        reason: `profile_mismatch selected=${formatAuditValue(parsedQuery.data.selectedProfileId)} resolved=${formatAuditValue(c.var.resolvedProfile.openMeldProfileId)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: ACCOUNT_SPACES_ACTIVE_WAKE_SUMMARY_ROUTE,
      method: "GET",
      execute: async () => {
        return await c.var.coreRpc.listAccountSpaceActiveWakeSummary({
          gatewayHost: parsedQuery.data.gatewayHost ?? url.host,
          ownerUserId: c.var.resolvedProfile.ownerUserId,
          selectedProfileId: parsedQuery.data.selectedProfileId,
        });
      },
      responseSchema: accountSpaceActiveWakeSummaryResponseSchema,
    });
  });

  app.get(ACCOUNT_SPACES_ROUTE, (c) => {
    const url = new URL(c.req.url);
    const parsedQuery = accountSpaceIndexQuerySchema.safeParse({
      gatewayHost: url.searchParams.get("gatewayHost"),
      ...(url.searchParams.has("includeDirectMessageProfileIds")
        ? {
            includeDirectMessageProfileIds: url.searchParams.get(
              "includeDirectMessageProfileIds"
            ),
          }
        : {}),
      ...(url.searchParams.has("includeRecentlyDeletedItems")
        ? {
            includeRecentlyDeletedItems: url.searchParams.get(
              "includeRecentlyDeletedItems"
            ),
          }
        : {}),
      ...(url.searchParams.has("includePurposes")
        ? { includePurposes: url.searchParams.get("includePurposes") }
        : {}),
      ...(url.searchParams.has("includeMessagePreviews")
        ? {
            includeMessagePreviews: url.searchParams.get(
              "includeMessagePreviews"
            ),
          }
        : {}),
      ...(url.searchParams.has("includeMemberPreviews")
        ? {
            includeMemberPreviews: url.searchParams.get(
              "includeMemberPreviews"
            ),
          }
        : {}),
      ...(url.searchParams.has("limit")
        ? { limit: url.searchParams.get("limit") }
        : {}),
      ...(url.searchParams.has("scope")
        ? { scope: url.searchParams.get("scope") }
        : {}),
      selectedProfileId: url.searchParams.get("selectedProfileId"),
    });
    if (!parsedQuery.success) {
      return respondBadRequest({
        c,
        route: ACCOUNT_SPACES_ROUTE,
        method: "GET",
        message:
          parsedQuery.error.issues[0]?.message ??
          "Invalid account space index query",
      });
    }
    if (
      parsedQuery.data.selectedProfileId !==
      c.var.resolvedProfile.openMeldProfileId
    ) {
      return respondProfileNotFound({
        c,
        route: ACCOUNT_SPACES_ROUTE,
        method: "GET",
        reason: `profile_mismatch selected=${formatAuditValue(parsedQuery.data.selectedProfileId)} resolved=${formatAuditValue(c.var.resolvedProfile.openMeldProfileId)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: ACCOUNT_SPACES_ROUTE,
      method: "GET",
      execute: async () => {
        return await c.var.coreRpc.listAccountSpaces({
          gatewayHost: parsedQuery.data.gatewayHost,
          ownerUserId: c.var.resolvedProfile.ownerUserId,
          scope: parsedQuery.data.scope,
          selectedProfileId: parsedQuery.data.selectedProfileId,
          ...(parsedQuery.data.limit === undefined
            ? {}
            : { limit: parsedQuery.data.limit }),
          ...(parsedQuery.data.includeRecentlyDeletedItems === true
            ? { includeRecentlyDeletedItems: true }
            : {}),
          ...(parsedQuery.data.includeDirectMessageProfileIds === true
            ? { includeDirectMessageProfileIds: true }
            : {}),
          ...(parsedQuery.data.includePurposes === true
            ? { includePurposes: true }
            : {}),
          ...(parsedQuery.data.includeMemberPreviews === true
            ? { includeMemberPreviews: true }
            : {}),
          ...(parsedQuery.data.includeMessagePreviews === true
            ? { includeMessagePreviews: true }
            : {}),
        });
      },
      responseSchema: accountSpaceIndexResponseSchema,
    });
  });

  app.get(PROFILE_SPACES_ROUTE, (c) => {
    const profileIdRaw = c.req.param("profileId");
    const profileId = normalizeProfileIdParam(profileIdRaw);
    if (!profileId) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_ROUTE,
        method: "GET",
        message: "Invalid profileId",
        reason: `invalid_profile_id_param profileId=${formatAuditValue(profileIdRaw)}`,
      });
    }

    if (profileId !== c.var.resolvedProfile.openMeldProfileId) {
      return respondProfileNotFound({
        c,
        route: PROFILE_SPACES_ROUTE,
        method: "GET",
        reason: `profile_mismatch path=${formatAuditValue(profileId)} resolved=${formatAuditValue(c.var.resolvedProfile.openMeldProfileId)}`,
      });
    }

    const url = new URL(c.req.url);
    const statusList = url.searchParams.getAll("status");
    const parsedQuery = parseProfileSpaceHistoryListQuery({
      gatewayHost: url.searchParams.get("gatewayHost"),
      ...(statusList.length > 0
        ? {
            status: statusList.length === 1 ? statusList[0] : statusList,
          }
        : {}),
      ...(url.searchParams.has("limit")
        ? { limit: url.searchParams.get("limit") }
        : {}),
      ...(url.searchParams.has("pinned")
        ? { pinned: url.searchParams.get("pinned") }
        : {}),
    });
    if (!parsedQuery.ok) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_ROUTE,
        method: "GET",
        message: parsedQuery.message,
      });
    }

    return executeRpcRoute({
      c,
      route: PROFILE_SPACES_ROUTE,
      method: "GET",
      execute: async () => {
        const result = await c.var.authRpc.listProfileSpaceHistory({
          headers: sanitizeHeadersForAuthRpc(c.req.raw.headers),
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          openMeldProfileId: profileId,
          ...parsedQuery.value,
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

  app.patch(PROFILE_SPACES_SPACE_ROUTE, async (c) => {
    const profileIdRaw = c.req.param("profileId");
    const profileId = normalizeProfileIdParam(profileIdRaw);
    if (!profileId) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_SPACE_ROUTE,
        method: "PATCH",
        message: "Invalid profileId",
        reason: `invalid_profile_id_param profileId=${formatAuditValue(profileIdRaw)}`,
      });
    }

    if (profileId !== c.var.resolvedProfile.openMeldProfileId) {
      return respondProfileNotFound({
        c,
        route: PROFILE_SPACES_SPACE_ROUTE,
        method: "PATCH",
        reason: `profile_mismatch path=${formatAuditValue(profileId)} resolved=${formatAuditValue(c.var.resolvedProfile.openMeldProfileId)}`,
      });
    }

    const spaceIdRaw = c.req.param("spaceId");
    const spaceId = normalizeSpaceIdParam(spaceIdRaw);
    if (!spaceId) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_SPACE_ROUTE,
        method: "PATCH",
        message: "Invalid spaceId",
        reason: `invalid_space_id_param spaceId=${formatAuditValue(spaceIdRaw)}`,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_SPACE_ROUTE,
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
        reason: `invalid_profile_space_history_upsert body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }

    const parsedBody = parseUpsertProfileSpaceHistoryBody(bodyResult.value);
    if (!parsedBody.ok) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_SPACE_ROUTE,
        method: "PATCH",
        ...(parsedBody.message === "Invalid JSON"
          ? { code: "invalid_json" }
          : {}),
        message: parsedBody.message,
        reason: `invalid_profile_space_history_upsert body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: PROFILE_SPACES_SPACE_ROUTE,
      method: "PATCH",
      spaceId,
      execute: async () => {
        const result = await c.var.authRpc.upsertProfileSpaceHistory({
          headers: sanitizeHeadersForAuthRpc(c.req.raw.headers),
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          openMeldProfileId: profileId,
          spaceId,
          ...parsedBody.value,
        });
        if (!result.ok) {
          throw toAuthRpcHttpError(result);
        }

        return {
          item: result.item,
          spaceIndexOverlay: result.spaceIndexOverlay,
        };
      },
    });
  });

  app.patch(PROFILE_SPACES_STATUS_ROUTE, async (c) => {
    const profileIdRaw = c.req.param("profileId");
    const profileId = normalizeProfileIdParam(profileIdRaw);
    if (!profileId) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_STATUS_ROUTE,
        method: "PATCH",
        message: "Invalid profileId",
        reason: `invalid_profile_id_param profileId=${formatAuditValue(profileIdRaw)}`,
      });
    }

    if (profileId !== c.var.resolvedProfile.openMeldProfileId) {
      return respondProfileNotFound({
        c,
        route: PROFILE_SPACES_STATUS_ROUTE,
        method: "PATCH",
        reason: `profile_mismatch path=${formatAuditValue(profileId)} resolved=${formatAuditValue(c.var.resolvedProfile.openMeldProfileId)}`,
      });
    }

    const spaceIdRaw = c.req.param("spaceId");
    const spaceId = normalizeSpaceIdParam(spaceIdRaw);
    if (!spaceId) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_STATUS_ROUTE,
        method: "PATCH",
        message: "Invalid spaceId",
        reason: `invalid_space_id_param spaceId=${formatAuditValue(spaceIdRaw)}`,
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_STATUS_ROUTE,
        method: "PATCH",
        code: "invalid_json",
        message: bodyResult.message,
        reason: `invalid_profile_space_history_status body=${formatAuditValue(bodyResult.rawBody)}`,
      });
    }

    const parsedBody = parsePatchProfileSpaceHistoryStatusBody(
      bodyResult.value
    );
    if (!parsedBody.ok) {
      return respondBadRequest({
        c,
        route: PROFILE_SPACES_STATUS_ROUTE,
        method: "PATCH",
        ...(parsedBody.message === "Invalid JSON"
          ? { code: "invalid_json" }
          : {}),
        message: parsedBody.message,
        reason: `invalid_profile_space_history_status body=${formatAuditValue(bodyResult.value)}`,
      });
    }

    return executeRpcRoute({
      c,
      route: PROFILE_SPACES_STATUS_ROUTE,
      method: "PATCH",
      spaceId,
      execute: async () => {
        const result = await c.var.authRpc.updateProfileSpaceHistoryStatus({
          headers: sanitizeHeadersForAuthRpc(c.req.raw.headers),
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          openMeldProfileId: profileId,
          spaceId,
          ...parsedBody.value,
        });
        if (!result.ok) {
          throw toAuthRpcHttpError(result);
        }

        return result.item;
      },
    });
  });
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
