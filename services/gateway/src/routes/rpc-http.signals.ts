import { OPENMELD_SPACE_ADDRESSING_VERSION } from "@openmeld/gateway-contract";
import { buildProfileDisplay } from "@openmeld/protocol";
import {
  catchupResponseSchema,
  listSignalsQuerySchema,
  postNormalMessageResponseSchema,
  readListSignalsQueryRawValues,
  SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
  validateSpaceSignalClientMessageIdPolicy,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  emitGatewayCloudflareRuntimeEvidence,
  readCloudflareRequestEvidence,
} from "../lib/cloudflare-runtime-evidence";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  buildCoreRpcContext,
  executePublicRpcRoute,
  executeRpcRoute,
  formatAuditValue,
  readSpacePasswordHeader,
  respondBadRequest,
  respondPublicBadRequest,
} from "./rpc-http.helpers";
import {
  parsePostSignalBody,
  parseSpaceRouteParams,
  readJsonRequestBody,
} from "./rpc-http.parsers";

type SignalsQueryRawValues = ReturnType<typeof readListSignalsQueryRawValues>;

type PostSignalRuntimeFactSource = {
  messageEnvelope?: { activationTargets: readonly unknown[] } | null;
  meta?: { clientMessageId?: string | null } | null;
};

type PostSignalRuntimeFacts = {
  activationTargetCount: number;
  activationTargetProfileIds: readonly string[];
  clientMessageId: string | null;
  targetProfileId: string | null;
};

type ParsedPostSignal = Extract<
  ReturnType<typeof parsePostSignalBody>,
  { ok: true }
>["value"];

type CloudflareRequestEvidence = ReturnType<
  typeof readCloudflareRequestEvidence
>;

const SIGNALS_QUERY_ISSUE_PATHS = new Set([
  "afterTs",
  "limit",
  "afterSignalId",
  "aroundSignalId",
  "beforeCount",
  "afterCount",
  "signalTypes",
]);

const buildPostSignalCoreRpcInput = (input: {
  context: ReturnType<typeof buildCoreRpcContext>;
  parsed: ParsedPostSignal;
  password: string | undefined;
  profile: ReturnType<typeof buildProfileDisplay>;
  spaceId: string;
}) => ({
  spaceId: input.spaceId,
  profile: input.profile,
  text: input.parsed.text,
  authoringPolicy: "user_authored" as const,
  ...(input.parsed.attachments
    ? { attachments: input.parsed.attachments }
    : {}),
  ...(input.parsed.files ? { files: input.parsed.files } : {}),
  ...(input.parsed.messageEnvelope
    ? { messageEnvelope: input.parsed.messageEnvelope }
    : {}),
  ...(input.parsed.meta ? { meta: input.parsed.meta } : {}),
  ...(input.parsed.replyTo ? { replyTo: input.parsed.replyTo } : {}),
  ...(input.password === undefined ? {} : { password: input.password }),
  context: input.context,
});

const resolveSignalsQueryIssuePath = (issuePath: unknown): string | null =>
  typeof issuePath === "string" && SIGNALS_QUERY_ISSUE_PATHS.has(issuePath)
    ? issuePath
    : null;

const resolveSignalsQueryIssueRawValue = (
  query: SignalsQueryRawValues,
  issuePath: string | null
): string | null => {
  switch (issuePath) {
    case "afterTs":
      return query.afterTs;
    case "limit":
      return query.limit;
    case "afterSignalId":
      return query.afterSignalId;
    case "aroundSignalId":
      return query.aroundSignalId;
    case "beforeCount":
      return query.beforeCount;
    case "afterCount":
      return query.afterCount;
    case "signalTypes":
      return query.signalTypes.join(",");
    default:
      return null;
  }
};

export const buildListSignalsRpcInput = (input: {
  query: ReturnType<typeof listSignalsQuerySchema.parse>;
  hasLimit: boolean;
  spaceAccess: ReturnType<typeof buildGatewaySpaceAccessContext>;
  spaceId: string;
}) => ({
  spaceId: input.spaceId,
  ...(input.query.afterTs === null ? {} : { afterTs: input.query.afterTs }),
  ...(input.hasLimit ? { limit: input.query.limit } : {}),
  ...(input.query.cursor === null ? {} : { cursor: input.query.cursor }),
  ...(input.query.recentOnly ? { recent: true } : {}),
  ...(input.query.afterSignalId
    ? { afterSignalId: input.query.afterSignalId }
    : {}),
  ...(input.query.aroundSignalId
    ? { aroundSignalId: input.query.aroundSignalId }
    : {}),
  ...(input.query.beforeCount === null
    ? {}
    : { beforeCount: input.query.beforeCount }),
  ...(input.query.afterCount === null
    ? {}
    : { afterCount: input.query.afterCount }),
  ...(input.query.fromProfileIds.length > 0
    ? { fromProfileIds: input.query.fromProfileIds }
    : {}),
  ...(input.query.signalTypes.length > 0
    ? { signalTypes: input.query.signalTypes }
    : {}),
  spaceAccess: input.spaceAccess,
});

const buildPostSignalRuntimeFacts = (
  value: PostSignalRuntimeFactSource
): PostSignalRuntimeFacts => {
  const activationTargets = value.messageEnvelope?.activationTargets ?? [];
  const activationTargetProfileIds = activationTargets
    .filter((targetProfileId): targetProfileId is string => {
      return typeof targetProfileId === "string";
    })
    .slice(0, 20);

  return {
    activationTargetCount: activationTargets.length,
    activationTargetProfileIds,
    clientMessageId: value.meta?.clientMessageId ?? null,
    targetProfileId: activationTargetProfileIds[0] ?? null,
  };
};

const emitGatewaySignalPostRuntimeEvidence = (input: {
  env: CloudflareBindings;
  errorName?: string | null;
  event:
    | "gateway.openmeld.space.signal_post_failed"
    | "gateway.openmeld.space.signal_post_started"
    | "gateway.openmeld.space.signal_posted";
  postSignalFacts: PostSignalRuntimeFacts;
  reasonCode?: string | null;
  requestEvidence: CloudflareRequestEvidence;
  requestId: string;
  sourceSignalId?: string | null;
  spaceId: string;
  startedAt: number;
  status: "failed" | "started" | "succeeded";
  statusCode?: number | null;
  workerEnvironment?: string | null;
}): void => {
  emitGatewayCloudflareRuntimeEvidence(input.env, {
    event: input.event,
    workerEnvironment: input.workerEnvironment,
    runtimeKind: "rpc",
    status: input.status,
    operation: "postSignal",
    route: "/v1/spaces/:spaceId/signals",
    method: "POST",
    statusCode: input.statusCode ?? null,
    durationMs: Date.now() - input.startedAt,
    reasonCode: input.reasonCode ?? null,
    errorName: input.errorName ?? null,
    cfRayId: input.requestEvidence.cfRayId,
    requestId: input.requestId,
    traceId: input.requestEvidence.traceId,
    spaceId: input.spaceId,
    clientMessageId: input.postSignalFacts.clientMessageId,
    sourceSignalId: input.sourceSignalId ?? null,
    targetProfileId: input.postSignalFacts.targetProfileId,
    activationTargetCount: input.postSignalFacts.activationTargetCount,
  });
};

const readValidatedSignalId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const signalId = (payload as { id?: unknown }).id;
  return typeof signalId === "string" && signalId.trim().length > 0
    ? signalId.trim()
    : null;
};

const registerGetSignalsRoute = (app: Hono<HonoBindings>): void => {
  app.get("/v1/spaces/:spaceId/signals", (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondPublicBadRequest({
        c,
        route: "/v1/spaces/:spaceId/signals",
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const query = readListSignalsQueryRawValues(
      new URL(c.req.url).searchParams
    );
    const parsedQuery = listSignalsQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      const firstIssue = parsedQuery.error.issues[0];
      const issuePath = resolveSignalsQueryIssuePath(firstIssue?.path[0]);
      const issueRawValue = resolveSignalsQueryIssueRawValue(query, issuePath);

      return respondPublicBadRequest({
        c,
        route: "/v1/spaces/:spaceId/signals",
        method: "GET",
        message: firstIssue?.message ?? "Invalid query",
        ...(issuePath
          ? {
              reason: `invalid_query_param ${issuePath}=${formatAuditValue(issueRawValue)}`,
            }
          : {}),
      });
    }

    const rpcInput = buildListSignalsRpcInput({
      query: parsedQuery.data,
      hasLimit: query.hasLimit,
      spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
      spaceId,
    });

    return executePublicRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/signals",
      method: "GET",
      includeLegacySpaceAddressingWireFields: true,
      execute: async () => {
        return await c.var.coreRpc.listSignals(
          rpcInput,
          OPENMELD_SPACE_ADDRESSING_VERSION
        );
      },
      responseSchema: catchupResponseSchema,
    });
  });
};

export function registerSignalsRoutes(app: Hono<HonoBindings>): void {
  registerGetSignalsRoute(app);

  app.post("/v1/spaces/:spaceId/signals", async (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/signals",
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/signals",
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = parsePostSignalBody(bodyResult.value);
    if (!parsed.ok) {
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/signals",
        method: "POST",
        code: "invalid_payload",
        message: parsed.message,
        spaceId,
      });
    }

    const requestEvidence = readCloudflareRequestEvidence(c.req.raw);
    const postSignalFacts = buildPostSignalRuntimeFacts(parsed.value);
    const policyResult = validateSpaceSignalClientMessageIdPolicy({
      authoringPolicy: "user_authored",
      messageEnvelope: parsed.value.messageEnvelope,
      meta: parsed.value.meta,
    });
    if (!policyResult.ok) {
      emitGatewaySignalPostRuntimeEvidence({
        env: c.env,
        event: "gateway.openmeld.space.signal_post_failed",
        postSignalFacts,
        reasonCode: policyResult.code,
        requestEvidence,
        requestId: c.var.openMeldRequestContext.actorContext.requestId,
        spaceId,
        startedAt: c.var.startedAt,
        status: "failed",
        statusCode: 400,
        workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
      });
      return respondBadRequest({
        c,
        route: "/v1/spaces/:spaceId/signals",
        method: "POST",
        code: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
        message: policyResult.message,
        reason: policyResult.code,
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/signals",
      method: "POST",
      spaceId,
      includeLegacySpaceAddressingWireFields: true,
      execute: async () => {
        const requestId = c.var.openMeldRequestContext.actorContext.requestId;
        emitGatewaySignalPostRuntimeEvidence({
          env: c.env,
          event: "gateway.openmeld.space.signal_post_started",
          postSignalFacts,
          requestEvidence,
          requestId,
          spaceId,
          startedAt: c.var.startedAt,
          workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
          status: "started",
        });

        const profile = buildProfileDisplay(c.var.resolvedProfile);
        let signal: Awaited<ReturnType<typeof c.var.coreRpc.postSignal>>;
        try {
          signal = await c.var.coreRpc.postSignal(
            buildPostSignalCoreRpcInput({
              context: buildCoreRpcContext(c),
              parsed: parsed.value,
              password,
              profile,
              spaceId,
            }),
            OPENMELD_SPACE_ADDRESSING_VERSION
          );
        } catch (error) {
          emitGatewaySignalPostRuntimeEvidence({
            env: c.env,
            event: "gateway.openmeld.space.signal_post_failed",
            postSignalFacts,
            requestEvidence,
            requestId,
            spaceId,
            startedAt: c.var.startedAt,
            workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
            status: "failed",
            reasonCode: "core_rpc_failed",
            errorName: error instanceof Error ? error.name : typeof error,
          });
          throw error;
        }
        return signal;
      },
      onInvalidSuccessPayload: () => {
        emitGatewaySignalPostRuntimeEvidence({
          env: c.env,
          event: "gateway.openmeld.space.signal_post_failed",
          postSignalFacts,
          reasonCode: "invalid_success_payload",
          requestEvidence,
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          spaceId,
          startedAt: c.var.startedAt,
          status: "failed",
          statusCode: 502,
          workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
        });
      },
      onValidatedSuccess: ({ payload, status }) => {
        const sourceSignalId = readValidatedSignalId(payload);
        emitGatewaySignalPostRuntimeEvidence({
          env: c.env,
          event: "gateway.openmeld.space.signal_posted",
          postSignalFacts,
          requestEvidence,
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          sourceSignalId,
          spaceId,
          startedAt: c.var.startedAt,
          status: "succeeded",
          statusCode: status,
          workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
        });
      },
      responseSchema: postNormalMessageResponseSchema,
    });
  });
}
