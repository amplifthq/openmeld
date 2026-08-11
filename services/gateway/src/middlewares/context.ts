import { jsonErrorResponse } from "@openmeld/gateway-contract";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { HonoBindings } from "../lib/bindings";
import {
  emitGatewayCloudflareRuntimeEvidence,
  readCloudflareRequestEvidence,
} from "../lib/cloudflare-runtime-evidence";
import { redactFeedbackRouteForLogging } from "../lib/feedback-route-log-redaction";
import { readGatewayIngressForwardingContext } from "../lib/ingress-forwarding-context";

export const gatewayContextMiddleware = createMiddleware<HonoBindings>(
  async (c, next) => {
    const openMeldContext = readGatewayIngressForwardingContext(
      c.req.raw.headers,
      crypto.randomUUID()
    );
    const runtimeEvidence = readCloudflareRequestEvidence(c.req.raw);
    c.set("startedAt", Date.now());
    c.set("ingressOpenMeldContext", openMeldContext);

    if (!c.env.OPENMELD_AUTH_WORKER) {
      const response = jsonErrorResponse({
        status: 503,
        code: "gateway.misconfigured",
        message: "missing worker binding: OPENMELD_AUTH_WORKER",
        requestId: openMeldContext.requestId,
      });
      emitGatewayRequestEvidence(c, response.status, "gateway.misconfigured", {
        openMeldContext,
        runtimeEvidence,
      });
      return response;
    }

    if (!c.env.OPENMELD_CORE_WORKER) {
      const response = jsonErrorResponse({
        status: 503,
        code: "gateway.misconfigured",
        message: "missing worker binding: OPENMELD_CORE_WORKER",
        requestId: openMeldContext.requestId,
      });
      emitGatewayRequestEvidence(c, response.status, "gateway.misconfigured", {
        openMeldContext,
        runtimeEvidence,
      });
      return response;
    }

    c.set(
      "coreRpc",
      c.env.OPENMELD_CORE_WORKER as HonoBindings["Variables"]["coreRpc"]
    );
    c.set(
      "authRpc",
      c.env.OPENMELD_AUTH_WORKER as HonoBindings["Variables"]["authRpc"]
    );
    let thrownError: unknown = null;
    try {
      await next();
    } catch (error) {
      thrownError = error;
      throw error;
    } finally {
      const statusCode = thrownError ? 500 : c.res.status;
      emitGatewayRequestEvidence(
        c,
        statusCode,
        statusCode >= 400 ? `http_${statusCode}` : null,
        {
          openMeldContext,
          runtimeEvidence,
          errorName: thrownError instanceof Error ? thrownError.name : null,
        }
      );
    }
  }
);

function emitGatewayRequestEvidence(
  c: Context<HonoBindings>,
  statusCode: number,
  reasonCode: string | null,
  input: {
    openMeldContext: ReturnType<typeof readGatewayIngressForwardingContext>;
    errorName?: string | null;
    runtimeEvidence: ReturnType<typeof readCloudflareRequestEvidence>;
  }
): void {
  emitGatewayCloudflareRuntimeEvidence(c.env, {
    event: "gateway.openmeld.http_request",
    workerEnvironment: c.env.OPENMELD_WORKER_ENVIRONMENT,
    runtimeKind: "http",
    status: statusCode >= 500 ? "failed" : "succeeded",
    route: redactFeedbackRouteForLogging(c.req.raw) ?? c.req.path,
    method: c.req.method,
    statusCode,
    durationMs: Date.now() - c.var.startedAt,
    reasonCode,
    errorName: input.errorName ?? null,
    cfRayId: input.runtimeEvidence.cfRayId,
    requestId: input.openMeldContext.requestId,
    traceId: input.runtimeEvidence.traceId,
  });
}
