import {
  type ProjectObservabilityCloudflareRuntimeEventInput,
  projectObservabilityCloudflareAnalyticsDataPoint,
  projectObservabilityCloudflareRuntimeConsoleEvent,
  projectObservabilityCloudflareRuntimeEvent,
  shouldLogObservabilityCloudflareRuntimeEvent,
} from "@openmeld/schemas";

type GatewayCloudflareRuntimeEvidenceInput = Omit<
  ProjectObservabilityCloudflareRuntimeEventInput,
  "workerName"
>;

const TRACEPARENT_TRACE_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function emitGatewayCloudflareRuntimeEvidence(
  env: CloudflareBindings,
  input: GatewayCloudflareRuntimeEvidenceInput
): void {
  try {
    const event = projectObservabilityCloudflareRuntimeEvent({
      ...input,
      workerName: "openmeld-gateway",
    });
    if (shouldLogObservabilityCloudflareRuntimeEvent(event)) {
      console.info(projectObservabilityCloudflareRuntimeConsoleEvent(event));
    }
    env.OPENMELD_OBSERVABILITY?.writeDataPoint(
      projectObservabilityCloudflareAnalyticsDataPoint(event)
    );
  } catch (error) {
    console.error({
      event:
        "gateway.openmeld.observability.runtime_evidence_projection_failed",
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
