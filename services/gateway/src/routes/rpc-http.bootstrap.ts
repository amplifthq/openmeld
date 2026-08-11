import {
  listSignalsQuerySchema,
  readListSignalsQueryRawValues,
  spaceBootstrapQuerySchema,
  spaceBootstrapResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { emitGatewayCloudflareRuntimeEvidence } from "../lib/cloudflare-runtime-evidence";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  executeRpcRoute,
  formatAuditValue,
  respondBadRequest,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams } from "./rpc-http.parsers";
import { buildListSignalsRpcInput } from "./rpc-http.signals";

const SPACE_BOOTSTRAP_ROUTE = "/v1/spaces/:spaceId/bootstrap";

type BootstrapTimingMetric = {
  name: string;
  durationMs: number;
};

type SpaceBootstrapWithTimingResult = {
  metrics?: readonly BootstrapTimingMetric[];
  serverTiming: string;
};

export function registerBootstrapRoute(app: Hono<HonoBindings>): void {
  app.get(SPACE_BOOTSTRAP_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_BOOTSTRAP_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const searchParams = new URL(c.req.url).searchParams;
    const query = readListSignalsQueryRawValues(searchParams);
    const parsedQuery = listSignalsQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      return respondBadRequest({
        c,
        route: SPACE_BOOTSTRAP_ROUTE,
        method: "GET",
        message: parsedQuery.error.issues[0]?.message ?? "Invalid query",
        spaceId,
      });
    }
    const parsedBootstrapQuery = spaceBootstrapQuerySchema.safeParse({
      includeAgentStreamPresence: searchParams.get(
        "includeAgentStreamPresence"
      ),
    });
    if (!parsedBootstrapQuery.success) {
      return respondBadRequest({
        c,
        route: SPACE_BOOTSTRAP_ROUTE,
        method: "GET",
        message:
          parsedBootstrapQuery.error.issues[0]?.message ?? "Invalid query",
        spaceId,
      });
    }

    const rpcInput = {
      ...buildListSignalsRpcInput({
        query: parsedQuery.data,
        hasLimit: query.hasLimit,
        spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        spaceId,
      }),
      ...(parsedBootstrapQuery.data.includeAgentStreamPresence === true
        ? { includeAgentStreamPresence: true }
        : {}),
    };

    return executeRpcRoute({
      c,
      route: SPACE_BOOTSTRAP_ROUTE,
      method: "GET",
      spaceId,
      includeLegacySpaceAddressingWireFields: true,
      execute: async () =>
        await c.var.coreRpc.getSpaceBootstrapWithTiming(rpcInput),
      onValidatedSuccess: ({ result, status }) => {
        emitBootstrapServerTimingEvidence({
          env: c.env,
          metrics: readBootstrapTimingMetrics(result),
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          spaceId,
          status,
          workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
        });
      },
      resolveSuccessHeaders: ({ result }) => ({
        "Server-Timing": (result as { serverTiming: string }).serverTiming,
      }),
      resolveSuccessPayload: (result) =>
        (result as { payload: unknown }).payload,
      responseSchema: spaceBootstrapResponseSchema,
    });
  });
}

function readBootstrapTimingMetrics(
  result: unknown
): readonly BootstrapTimingMetric[] {
  const metrics = (result as SpaceBootstrapWithTimingResult).metrics;
  return Array.isArray(metrics) ? metrics : [];
}

function emitBootstrapServerTimingEvidence(input: {
  env: CloudflareBindings;
  metrics: readonly BootstrapTimingMetric[];
  requestId: string;
  spaceId: string;
  status: number;
  workerEnvironment?: string | null;
}): void {
  for (const metric of input.metrics) {
    emitGatewayCloudflareRuntimeEvidence(input.env, {
      event: "gateway.openmeld.space.bootstrap_server_timing",
      workerEnvironment: input.workerEnvironment,
      runtimeKind: "http",
      status: "succeeded",
      operation: "getSpaceBootstrap",
      route: SPACE_BOOTSTRAP_ROUTE,
      method: "GET",
      statusCode: input.status,
      durationMs: metric.durationMs,
      reasonCode: metric.name,
      requestId: input.requestId,
      spaceId: input.spaceId,
    });
  }
}
