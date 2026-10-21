import {
  ACCOUNT_ORGANIZATION_CONTEXT_PATH,
  ACCOUNT_SESSION_PATH,
  type ProjectObservabilityCloudflareRuntimeEventInput,
  projectObservabilityCloudflareAnalyticsDataPoint,
  projectObservabilityCloudflareRuntimeConsoleEvent,
  projectObservabilityCloudflareRuntimeEvent,
  shouldLogObservabilityCloudflareRuntimeEvent,
} from "@openmeld/schemas";
import type { Context } from "hono";
import type { AuthBindings } from "../bindings";
import type { AppContext } from "../context";

type AuthCloudflareRuntimeEvidenceInput = Omit<
  ProjectObservabilityCloudflareRuntimeEventInput,
  "workerName"
>;

const TRACEPARENT_TRACE_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function startAccountReadStage(
  context: Context<AppContext>,
  stage: "request" | "session" | "memberships" | "preference"
) {
  const route = context.req.path;
  if (
    route !== ACCOUNT_ORGANIZATION_CONTEXT_PATH &&
    route !== ACCOUNT_SESSION_PATH
  ) {
    return (_status: "succeeded" | "failed", _reasonCode?: string) => undefined;
  }
  const eventPrefix =
    route === ACCOUNT_ORGANIZATION_CONTEXT_PATH
      ? "auth.openmeld.organization_context"
      : "auth.openmeld.account_session";
  const startedAt = Date.now();
  const evidence = {
    ...readCloudflareRequestEvidence(context.req.raw),
    event: `${eventPrefix}.${stage}`,
    method: context.req.method,
    requestId: context.var.requestId,
    route,
    runtimeKind: "http",
    workerEnvironment: context.env.OPENMELD_WORKER_ENVIRONMENT,
  };
  emitAuthCloudflareRuntimeEvidence(context.env, {
    ...evidence,
    status: "started",
  });
  return (status: "succeeded" | "failed", reasonCode?: string) => {
    emitAuthCloudflareRuntimeEvidence(context.env, {
      ...evidence,
      durationMs: Date.now() - startedAt,
      reasonCode,
      status,
    });
  };
}

export async function observeAccountOrganizationContextRead<T>(
  context: Context<AppContext>,
  stage: "memberships" | "preference",
  read: () => Promise<T>
): Promise<T> {
  const complete = startAccountReadStage(context, stage);
  try {
    const result = await read();
    complete("succeeded");
    return result;
  } catch (error) {
    complete("failed", "read_failed");
    throw error;
  }
}

export function emitAuthCloudflareRuntimeEvidence(
  env: AuthBindings,
  input: AuthCloudflareRuntimeEvidenceInput
): void {
  try {
    const event = projectObservabilityCloudflareRuntimeEvent({
      ...input,
      workerName: "openmeld-auth",
    });
    if (shouldLogObservabilityCloudflareRuntimeEvent(event)) {
      console.info(projectObservabilityCloudflareRuntimeConsoleEvent(event));
    }
    env.OPENMELD_OBSERVABILITY?.writeDataPoint(
      projectObservabilityCloudflareAnalyticsDataPoint(event)
    );
  } catch (error) {
    console.error({
      event: "auth.openmeld.observability.runtime_evidence_projection_failed",
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      requestId:
        typeof input.requestId === "string" && input.requestId.trim()
          ? input.requestId.trim()
          : null,
    });
  }
}

export function readCloudflareRequestEvidence(request: Request): {
  cfRayId: string | null;
  requestId: string | null;
  traceId: string | null;
} {
  return {
    cfRayId: readHeader(request, "cf-ray"),
    requestId:
      readHeader(request, "x-openmeld-request-id") ??
      readHeader(request, "x-request-id"),
    traceId: readTraceparentTraceId(request),
  };
}

function readTraceparentTraceId(request: Request): string | null {
  const traceparent = readHeader(request, "traceparent");
  if (!traceparent) {
    return null;
  }
  const traceId = traceparent.split("-")[1]?.trim();
  return traceId && TRACEPARENT_TRACE_ID_PATTERN.test(traceId) ? traceId : null;
}

function readHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value ? value : null;
}
