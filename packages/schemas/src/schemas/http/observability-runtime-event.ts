import { z } from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION } from "./observability-correlation";

export const OBSERVABILITY_CLOUDFLARE_RUNTIME_EVENT_MODEL_VERSION =
  "openmeld.cloudflare.runtime_evidence.v1" as const;

export const OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS = [
  "event",
  "workerName",
  "runtimeKind",
  "status",
  "reasonCode",
  "spaceId",
  "clientMessageId",
  "sourceSignalId",
  "targetProfileId",
  "dispatchId",
  "runtimeCoordinatorExecutionId",
  "latestAttemptId",
  "claimLeaseId",
  "bindingId",
  "openMeldServiceRuntimeId",
  "agentControllerRef",
  "resultRef",
  "publishedSignalId",
  "replySignalId",
  "requestId",
] as const;

export const OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES = [
  "count",
  "durationMs",
  "statusCode",
  "messageCount",
  "activationTargetCount",
  "inputBytes",
  "toolCount",
] as const;

export type ObservabilityCloudflareRuntimeConsoleEvent = Record<
  string,
  number | string
>;

const observabilityIdentifierSchema = z.string().trim().min(1).max(512);
const nullableObservabilityIdentifierSchema =
  observabilityIdentifierSchema.nullable();
const nullableShortTextSchema = z.string().trim().min(1).max(160).nullable();
const nullableRouteTextSchema = z.string().trim().min(1).max(512).nullable();
const invalidRuntimeEventEvidenceMessage =
  "invalid observability cloudflare runtime event evidence";
const ANALYTICS_INDEX_HASH_MODULUS = 36 ** 10;

export const observabilityCloudflareWorkerNameSchema = z.enum([
  "openmeld-auth",
  "openmeld-core",
  "openmeld-gateway",
  "openmeld-remote-agent",
  "openmeld-web",
]);

export const observabilityCloudflareRuntimeKindSchema = z.enum([
  "durable_object",
  "http",
  "queue",
  "rpc",
  "workflow",
]);

export const observabilityRuntimeEvidenceStatusSchema = z.enum([
  "failed",
  "started",
  "succeeded",
]);

export const observabilityCloudflareRuntimeEventSchema = z.strictObject({
  modelVersion: z.literal(OBSERVABILITY_CLOUDFLARE_RUNTIME_EVENT_MODEL_VERSION),
  correlationModelVersion: z.literal(
    OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION
  ),
  event: observabilityIdentifierSchema,
  workerName: observabilityCloudflareWorkerNameSchema,
  workerEnvironment: nullableShortTextSchema,
  runtime: z.literal("cloudflare_workers"),
  runtimeKind: observabilityCloudflareRuntimeKindSchema,
  status: observabilityRuntimeEvidenceStatusSchema,
  operation: nullableRouteTextSchema,
  route: nullableRouteTextSchema,
  method: nullableShortTextSchema,
  statusCode: z.number().int().min(100).max(599).nullable(),
  durationMs: z.number().finite().nonnegative().nullable(),
  messageCount: z.number().int().nonnegative().nullable(),
  activationTargetCount: z.number().int().nonnegative().nullable(),
  inputBytes: z.number().int().nonnegative().nullable(),
  toolCount: z.number().int().nonnegative().nullable(),
  reasonCode: nullableShortTextSchema,
  errorName: nullableShortTextSchema,
  cfRayId: nullableObservabilityIdentifierSchema,
  requestId: nullableObservabilityIdentifierSchema,
  traceId: nullableObservabilityIdentifierSchema,
  spaceId: nullableObservabilityIdentifierSchema,
  clientMessageId: clientMessageIdSchema.nullable(),
  sourceSignalId: nullableObservabilityIdentifierSchema,
  targetProfileId: nullableObservabilityIdentifierSchema,
  dispatchId: nullableObservabilityIdentifierSchema,
  runtimeCoordinatorExecutionId: nullableObservabilityIdentifierSchema,
  latestAttemptId: nullableObservabilityIdentifierSchema,
  claimLeaseId: nullableObservabilityIdentifierSchema,
  bindingId: nullableObservabilityIdentifierSchema,
  openMeldServiceRuntimeId: nullableObservabilityIdentifierSchema,
  agentControllerRef: nullableObservabilityIdentifierSchema,
  resultRef: nullableObservabilityIdentifierSchema,
  publishedSignalId: nullableObservabilityIdentifierSchema,
  replySignalId: nullableObservabilityIdentifierSchema,
});

export const observabilityCloudflareAnalyticsDataPointSchema = z.strictObject({
  blobs: z
    .array(z.string())
    .length(OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.length),
  doubles: z
    .array(z.number().finite())
    .length(OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.length),
  indexes: z.array(z.string().min(1)).length(1),
});

type ObservabilityCloudflareRuntimeEvent = z.infer<
  typeof observabilityCloudflareRuntimeEventSchema
>;
type ObservabilityCloudflareAnalyticsBlobReader = (
  event: ObservabilityCloudflareRuntimeEvent
) => string;
type ObservabilityCloudflareAnalyticsDoubleReader = (
  event: ObservabilityCloudflareRuntimeEvent
) => number;

const OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOB_READERS = [
  (event) => event.event,
  (event) => event.workerName,
  (event) => event.runtimeKind,
  (event) => event.status,
  (event) => optionalAnalyticsString(event.reasonCode),
  (event) => optionalAnalyticsString(event.spaceId),
  (event) => optionalAnalyticsString(event.clientMessageId),
  (event) => optionalAnalyticsString(event.sourceSignalId),
  (event) => optionalAnalyticsString(event.targetProfileId),
  (event) => optionalAnalyticsString(event.dispatchId),
  (event) => optionalAnalyticsString(event.runtimeCoordinatorExecutionId),
  (event) => optionalAnalyticsString(event.latestAttemptId),
  (event) => optionalAnalyticsString(event.claimLeaseId),
  (event) => optionalAnalyticsString(event.bindingId),
  (event) => optionalAnalyticsString(event.openMeldServiceRuntimeId),
  (event) => optionalAnalyticsString(event.agentControllerRef),
  (event) => optionalAnalyticsString(event.resultRef),
  (event) => optionalAnalyticsString(event.publishedSignalId),
  (event) => optionalAnalyticsString(event.replySignalId),
  (event) => optionalAnalyticsString(event.requestId),
] as const satisfies readonly ObservabilityCloudflareAnalyticsBlobReader[];

const OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLE_READERS = [
  () => 1,
  (event) => optionalAnalyticsNumber(event.durationMs),
  (event) => optionalAnalyticsNumber(event.statusCode),
  (event) => optionalAnalyticsNumber(event.messageCount),
  (event) => optionalAnalyticsNumber(event.activationTargetCount),
  (event) => optionalAnalyticsNumber(event.inputBytes),
  (event) => optionalAnalyticsNumber(event.toolCount),
] as const satisfies readonly ObservabilityCloudflareAnalyticsDoubleReader[];

export type ProjectObservabilityCloudflareRuntimeEventInput = {
  activationTargetCount?: unknown;
  bindingId?: unknown;
  agentControllerRef?: unknown;
  cfRayId?: unknown;
  claimLeaseId?: unknown;
  clientMessageId?: unknown;
  dispatchId?: unknown;
  durationMs?: unknown;
  errorName?: unknown;
  event: unknown;
  inputBytes?: unknown;
  latestAttemptId?: unknown;
  messageCount?: unknown;
  method?: unknown;
  operation?: unknown;
  publishedSignalId?: unknown;
  reasonCode?: unknown;
  replySignalId?: unknown;
  requestId?: unknown;
  resultRef?: unknown;
  route?: unknown;
  runtimeCoordinatorExecutionId?: unknown;
  openMeldServiceRuntimeId?: unknown;
  runtimeKind: unknown;
  sourceSignalId?: unknown;
  spaceId?: unknown;
  status: unknown;
  statusCode?: unknown;
  targetProfileId?: unknown;
  toolCount?: unknown;
  traceId?: unknown;
  workerEnvironment?: unknown;
  workerName: unknown;
};

export function projectObservabilityCloudflareRuntimeEvent(
  input: ProjectObservabilityCloudflareRuntimeEventInput
): z.infer<typeof observabilityCloudflareRuntimeEventSchema> {
  const candidate = {
    modelVersion: OBSERVABILITY_CLOUDFLARE_RUNTIME_EVENT_MODEL_VERSION,
    correlationModelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
    event: input.event,
    workerName: input.workerName,
    workerEnvironment: normalizeOptionalShortText(input.workerEnvironment),
    runtime: "cloudflare_workers",
    runtimeKind: input.runtimeKind,
    status: input.status,
    operation: normalizeOptionalRouteText(input.operation),
    route: normalizeOptionalRouteText(input.route),
    method: normalizeOptionalShortText(input.method),
    statusCode: normalizeOptionalStatusCode(input.statusCode),
    durationMs: normalizeOptionalNonnegativeNumber(input.durationMs),
    messageCount: normalizeOptionalNonnegativeInteger(input.messageCount),
    activationTargetCount: normalizeOptionalNonnegativeInteger(
      input.activationTargetCount
    ),
    inputBytes: normalizeOptionalNonnegativeInteger(input.inputBytes),
    toolCount: normalizeOptionalNonnegativeInteger(input.toolCount),
    reasonCode: normalizeOptionalShortText(input.reasonCode),
    errorName: normalizeOptionalShortText(input.errorName),
    cfRayId: normalizeOptionalObservabilityId(input.cfRayId),
    requestId: normalizeOptionalObservabilityId(input.requestId),
    traceId: normalizeOptionalObservabilityId(input.traceId),
    spaceId: normalizeOptionalObservabilityId(input.spaceId),
    clientMessageId: normalizeOptionalClientMessageId(input.clientMessageId),
    sourceSignalId: normalizeOptionalObservabilityId(input.sourceSignalId),
    targetProfileId: normalizeOptionalObservabilityId(input.targetProfileId),
    dispatchId: normalizeOptionalObservabilityId(input.dispatchId),
    runtimeCoordinatorExecutionId: normalizeOptionalObservabilityId(
      input.runtimeCoordinatorExecutionId
    ),
    latestAttemptId: normalizeOptionalObservabilityId(input.latestAttemptId),
    claimLeaseId: normalizeOptionalObservabilityId(input.claimLeaseId),
    bindingId: normalizeOptionalObservabilityId(input.bindingId),
    openMeldServiceRuntimeId: normalizeOptionalObservabilityId(
      input.openMeldServiceRuntimeId
    ),
    agentControllerRef: normalizeOptionalObservabilityId(
      input.agentControllerRef
    ),
    resultRef: normalizeOptionalObservabilityId(input.resultRef),
    publishedSignalId: normalizeOptionalObservabilityId(
      input.publishedSignalId
    ),
    replySignalId: normalizeOptionalObservabilityId(input.replySignalId),
  };

  const parsed = observabilityCloudflareRuntimeEventSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("invalid observability cloudflare runtime event evidence");
  }
  return parsed.data;
}

export function projectObservabilityCloudflareAnalyticsDataPoint(
  event: z.infer<typeof observabilityCloudflareRuntimeEventSchema>
): z.infer<typeof observabilityCloudflareAnalyticsDataPointSchema> {
  const point = {
    blobs: projectObservabilityCloudflareAnalyticsBlobs(event),
    doubles: projectObservabilityCloudflareAnalyticsDoubles(event),
    indexes: [selectObservabilityCloudflareAnalyticsIndex(event)],
  };

  const parsed =
    observabilityCloudflareAnalyticsDataPointSchema.safeParse(point);
  if (!parsed.success) {
    throw new Error("invalid observability cloudflare analytics data point");
  }
  return parsed.data;
}

function selectObservabilityCloudflareAnalyticsIndex(
  event: ObservabilityCloudflareRuntimeEvent
): string {
  const selected =
    event.clientMessageId ??
    event.runtimeCoordinatorExecutionId ??
    event.dispatchId ??
    event.sourceSignalId ??
    event.requestId ??
    event.spaceId ??
    event.workerName;
  return normalizeCloudflareAnalyticsIndex(selected);
}

function projectObservabilityCloudflareAnalyticsBlobs(
  event: ObservabilityCloudflareRuntimeEvent
): string[] {
  return OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOB_READERS.map((read) =>
    read(event)
  );
}

function projectObservabilityCloudflareAnalyticsDoubles(
  event: ObservabilityCloudflareRuntimeEvent
): number[] {
  return OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLE_READERS.map((read) =>
    read(event)
  );
}

function optionalAnalyticsString(value: string | null): string {
  return value ?? "";
}

function optionalAnalyticsNumber(value: number | null): number {
  return value ?? 0;
}

function normalizeCloudflareAnalyticsIndex(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 96) {
    return trimmed;
  }
  const hash = hashAnalyticsIndex(trimmed);
  return `${trimmed.slice(0, 82)}:${hash}`.slice(0, 96);
}

function hashAnalyticsIndex(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash =
      (Math.imul(hash, 16_777_619) + value.charCodeAt(index)) %
      ANALYTICS_INDEX_HASH_MODULUS;
  }
  return Math.abs(hash).toString(36);
}

export function shouldLogObservabilityCloudflareRuntimeEvent(
  event: z.infer<typeof observabilityCloudflareRuntimeEventSchema>
): boolean {
  const parsed = observabilityCloudflareRuntimeEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(invalidRuntimeEventEvidenceMessage);
  }
  const canonicalEvent = parsed.data;
  if (canonicalEvent.status === "failed") {
    return true;
  }
  if (canonicalEvent.errorName) {
    return true;
  }
  if (canonicalEvent.statusCode !== null && canonicalEvent.statusCode >= 500) {
    return true;
  }
  if (canonicalEvent.status === "started") {
    return false;
  }
  return canonicalEvent.runtimeKind !== "http";
}

export function projectObservabilityCloudflareRuntimeConsoleEvent(
  event: z.infer<typeof observabilityCloudflareRuntimeEventSchema>
): ObservabilityCloudflareRuntimeConsoleEvent {
  const parsed = observabilityCloudflareRuntimeEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(invalidRuntimeEventEvidenceMessage);
  }
  const canonicalEvent = parsed.data;
  const output: ObservabilityCloudflareRuntimeConsoleEvent = {
    event: canonicalEvent.event,
    workerName: canonicalEvent.workerName,
    runtimeKind: canonicalEvent.runtimeKind,
    status: canonicalEvent.status,
  };

  appendConsoleText(
    output,
    "workerEnvironment",
    canonicalEvent.workerEnvironment
  );
  appendConsoleText(output, "operation", canonicalEvent.operation);
  appendConsoleText(output, "route", canonicalEvent.route);
  appendConsoleText(output, "method", canonicalEvent.method);
  appendConsoleNumber(output, "statusCode", canonicalEvent.statusCode);
  appendConsoleNumber(output, "durationMs", canonicalEvent.durationMs);
  appendConsoleNumber(output, "messageCount", canonicalEvent.messageCount);
  appendConsoleNumber(
    output,
    "activationTargetCount",
    canonicalEvent.activationTargetCount
  );
  appendConsoleNumber(output, "inputBytes", canonicalEvent.inputBytes);
  appendConsoleNumber(output, "toolCount", canonicalEvent.toolCount);
  appendConsoleText(output, "reasonCode", canonicalEvent.reasonCode);
  appendConsoleText(output, "errorName", canonicalEvent.errorName);
  appendConsoleText(output, "cfRayId", canonicalEvent.cfRayId);
  appendConsoleText(output, "requestId", canonicalEvent.requestId);
  appendConsoleText(output, "traceId", canonicalEvent.traceId);
  appendConsoleText(output, "spaceId", canonicalEvent.spaceId);
  appendConsoleText(output, "clientMessageId", canonicalEvent.clientMessageId);
  appendConsoleText(output, "sourceSignalId", canonicalEvent.sourceSignalId);
  appendConsoleText(output, "targetProfileId", canonicalEvent.targetProfileId);
  appendConsoleText(output, "dispatchId", canonicalEvent.dispatchId);
  appendConsoleText(
    output,
    "runtimeCoordinatorExecutionId",
    canonicalEvent.runtimeCoordinatorExecutionId
  );
  appendConsoleText(output, "latestAttemptId", canonicalEvent.latestAttemptId);
  appendConsoleText(output, "claimLeaseId", canonicalEvent.claimLeaseId);
  appendConsoleText(output, "bindingId", canonicalEvent.bindingId);
  appendConsoleText(
    output,
    "openMeldServiceRuntimeId",
    canonicalEvent.openMeldServiceRuntimeId
  );
  appendConsoleText(
    output,
    "agentControllerRef",
    canonicalEvent.agentControllerRef
  );
  appendConsoleText(output, "resultRef", canonicalEvent.resultRef);
  appendConsoleText(
    output,
    "publishedSignalId",
    canonicalEvent.publishedSignalId
  );
  appendConsoleText(output, "replySignalId", canonicalEvent.replySignalId);

  return output;
}

function appendConsoleNumber(
  output: ObservabilityCloudflareRuntimeConsoleEvent,
  key: string,
  value: number | null
): void {
  if (value !== null) {
    output[key] = value;
  }
}

function appendConsoleText(
  output: ObservabilityCloudflareRuntimeConsoleEvent,
  key: string,
  value: string | null
): void {
  if (value) {
    output[key] = value;
  }
}

function normalizeOptionalObservabilityId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = observabilityIdentifierSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(invalidRuntimeEventEvidenceMessage);
  }
  return parsed.data;
}

function normalizeOptionalClientMessageId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = clientMessageIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(invalidRuntimeEventEvidenceMessage);
  }
  return parsed.data;
}

function normalizeOptionalShortText(value: unknown): string | null {
  const parsed = nullableShortTextSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 160)
    : null;
}

function normalizeOptionalRouteText(value: unknown): string | null {
  const parsed = nullableRouteTextSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 512)
    : null;
}

function normalizeOptionalStatusCode(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value);
  return normalized >= 100 && normalized <= 599 ? normalized : null;
}

function normalizeOptionalNonnegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeOptionalNonnegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}
