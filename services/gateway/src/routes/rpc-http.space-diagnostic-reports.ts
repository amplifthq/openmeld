import {
  createSpaceDiagnosticReportBodySchema,
  createSpaceDiagnosticReportResponseSchema,
} from "@openmeld/schemas";
import type { CreateSpaceDiagnosticReportResponse } from "@openmeld/schemas/types";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  emitGatewayCloudflareRuntimeEvidence,
  readCloudflareRequestEvidence,
} from "../lib/cloudflare-runtime-evidence";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  formatAuditValue,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams, readJsonRequestBody } from "./rpc-http.parsers";

const SPACE_DIAGNOSTIC_REPORTS_ROUTE = "/v1/spaces/:spaceId/diagnostic-reports";

export function registerSpaceDiagnosticReportRoutes(
  app: Hono<HonoBindings>
): void {
  app.post(SPACE_DIAGNOSTIC_REPORTS_ROUTE, async (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        route: SPACE_DIAGNOSTIC_REPORTS_ROUTE,
        method: "POST",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_DIAGNOSTIC_REPORTS_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsedBody = createSpaceDiagnosticReportBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsedBody.success) {
      return respondBadRequest({
        c,
        route: SPACE_DIAGNOSTIC_REPORTS_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          parsedBody.error.issues[0]?.message ??
          "diagnostic report payload is invalid",
        spaceId,
      });
    }

    const password = readSpacePasswordHeader(c.req.raw.headers);
    const requestEvidence = readCloudflareRequestEvidence(c.req.raw);

    return executeRpcRoute({
      c,
      route: SPACE_DIAGNOSTIC_REPORTS_ROUTE,
      method: "POST",
      spaceId,
      successStatus: 201,
      responseSchema: createSpaceDiagnosticReportResponseSchema,
      execute: async () => {
        const requestId = c.var.openMeldRequestContext.actorContext.requestId;
        emitGatewayDiagnosticReportRuntimeEvidence({
          env: c.env,
          event: "gateway.openmeld.space.diagnostic_report_create_started",
          requestEvidence,
          requestId,
          spaceId,
          startedAt: c.var.startedAt,
          status: "started",
          workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
        });

        try {
          return await c.var.coreRpc.createSpaceDiagnosticReport({
            spaceId,
            body: parsedBody.data,
            ...(password === undefined ? {} : { password }),
            context: buildCoreRpcContext(c),
          });
        } catch (error) {
          emitGatewayDiagnosticReportRuntimeEvidence({
            env: c.env,
            errorName: error instanceof Error ? error.name : typeof error,
            event: "gateway.openmeld.space.diagnostic_report_create_failed",
            reasonCode: "core_rpc_failed",
            requestEvidence,
            requestId,
            spaceId,
            startedAt: c.var.startedAt,
            status: "failed",
            workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
          });
          throw error;
        }
      },
      onInvalidSuccessPayload: () => {
        emitGatewayDiagnosticReportRuntimeEvidence({
          env: c.env,
          event: "gateway.openmeld.space.diagnostic_report_create_failed",
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
        const report = createSpaceDiagnosticReportResponseSchema.parse(payload);
        const evidence = resolveDiagnosticReportRuntimeEvidence(report);
        emitGatewayDiagnosticReportRuntimeEvidence({
          env: c.env,
          event: "gateway.openmeld.space.diagnostic_report_created",
          reportEvidence: evidence,
          reasonCode: report.wakePointerDerivation.status,
          requestEvidence,
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          spaceId: report.spaceId,
          startedAt: c.var.startedAt,
          status: "succeeded",
          statusCode: status,
          workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
        });
      },
    });
  });
}

type DiagnosticReportRuntimeEvidence = {
  activationTargetCount: number;
  clientMessageId: string | null;
  replySignalId: string | null;
  sourceSignalId: string | null;
  targetProfileId: string | null;
};

type CloudflareRequestEvidence = ReturnType<
  typeof readCloudflareRequestEvidence
>;

function resolveDiagnosticReportRuntimeEvidence(
  report: CreateSpaceDiagnosticReportResponse
): DiagnosticReportRuntimeEvidence {
  const firstPointer = report.wakePointers[0] ?? null;
  const exactPointer =
    report.wakePointerDerivation.status === "exact" ? firstPointer : null;
  return {
    activationTargetCount: report.wakePointers.length,
    clientMessageId: firstPointer?.clientMessageId ?? null,
    replySignalId: report.replyToSignalId ? report.reportedSignalId : null,
    sourceSignalId: firstPointer?.sourceSignalId ?? null,
    targetProfileId: exactPointer?.targetProfileId ?? null,
  };
}

function emitGatewayDiagnosticReportRuntimeEvidence(input: {
  env: CloudflareBindings;
  errorName?: string | null;
  event:
    | "gateway.openmeld.space.diagnostic_report_create_failed"
    | "gateway.openmeld.space.diagnostic_report_create_started"
    | "gateway.openmeld.space.diagnostic_report_created";
  reasonCode?: string | null;
  reportEvidence?: DiagnosticReportRuntimeEvidence;
  requestEvidence: CloudflareRequestEvidence;
  requestId: string;
  spaceId: string;
  startedAt: number;
  status: "failed" | "started" | "succeeded";
  statusCode?: number | null;
  workerEnvironment?: string | null;
}): void {
  emitGatewayCloudflareRuntimeEvidence(input.env, {
    event: input.event,
    workerEnvironment: input.workerEnvironment,
    runtimeKind: "rpc",
    status: input.status,
    operation: "createDiagnosticReport",
    route: SPACE_DIAGNOSTIC_REPORTS_ROUTE,
    method: "POST",
    statusCode: input.statusCode ?? null,
    durationMs: Date.now() - input.startedAt,
    reasonCode: input.reasonCode ?? null,
    errorName: input.errorName ?? null,
    cfRayId: input.requestEvidence.cfRayId,
    requestId: input.requestId,
    traceId: input.requestEvidence.traceId,
    spaceId: input.spaceId,
    clientMessageId: input.reportEvidence?.clientMessageId ?? null,
    sourceSignalId: input.reportEvidence?.sourceSignalId ?? null,
    targetProfileId: input.reportEvidence?.targetProfileId ?? null,
    replySignalId: input.reportEvidence?.replySignalId ?? null,
    activationTargetCount: input.reportEvidence?.activationTargetCount ?? null,
  });
}
