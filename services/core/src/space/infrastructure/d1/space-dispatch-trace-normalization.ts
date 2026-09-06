import {
  spaceDispatchTraceAttemptStatusSchema,
  spaceDispatchTraceDispatchStatusSchema,
} from "@openmeld/schemas";
import type {
  SpaceDispatchTraceAttemptStatus,
  SpaceDispatchTraceDispatchStatus,
  SpaceDispatchTraceSnapshot,
} from "@openmeld/schemas/types";

type DispatchTraceOriginRecord = NonNullable<
  SpaceDispatchTraceSnapshot["origin"]
>;
type DispatchTracePromptRecord = NonNullable<
  SpaceDispatchTraceSnapshot["prompt"]
>;
type DispatchTraceRuntimeRecord = NonNullable<
  SpaceDispatchTraceSnapshot["runtime"]
>;

export type DispatchRuntimeTelemetryDecisionPayload = {
  agentControllerConversationId?: unknown;
  effectiveRuntimeWorkingDirectory?: unknown;
  runtimeWorkspaceFingerprint?: unknown;
  exitCode?: unknown;
  exitObservedAtMs?: unknown;
  exitSignal?: unknown;
  firstStderrAtMs?: unknown;
  openClawGatewayAgentId?: unknown;
  openClawGatewayRestartAttempted?: unknown;
  openClawGatewayVisibility?: unknown;
  promptFingerprint?: unknown;
  promptLength?: unknown;
  promptPreview?: unknown;
  processId?: unknown;
  processSpawnedAtMs?: unknown;
  stdinClosedAtMs?: unknown;
  timeoutTriggeredAtMs?: unknown;
  agentControllerRef?: unknown;
  resolvedAgentControllerConversationId?: unknown;
  agentControllerConversationKind?: unknown;
};

export const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
};

export const toSafeInteger = (value: unknown): number => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  return Math.max(0, Math.trunc(normalized));
};

export const toNullableInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return Math.trunc(normalized);
};

export const toIsoDateTime = (value: unknown): string => {
  return new Date(toSafeInteger(value)).toISOString();
};

export const toNullableIsoDateTime = (value: unknown): string | null => {
  const normalized = toNullableInteger(value);
  return normalized === null ? null : new Date(normalized).toISOString();
};

export const toDispatchTraceDispatchStatus = (
  value: unknown
): SpaceDispatchTraceDispatchStatus | null => {
  const parsed = spaceDispatchTraceDispatchStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const toDispatchTraceAttemptStatus = (
  value: unknown
): SpaceDispatchTraceAttemptStatus | null => {
  const parsed = spaceDispatchTraceAttemptStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const normalizeDispatchRuntimeTraceRecord = (
  payload: DispatchRuntimeTelemetryDecisionPayload | null
): DispatchTraceRuntimeRecord | null => {
  if (!payload) {
    return null;
  }
  const processIdValue =
    typeof payload.processId === "number" &&
    Number.isInteger(payload.processId) &&
    payload.processId > 0
      ? Number(payload.processId)
      : null;

  return {
    exitCode:
      Number.isInteger(payload.exitCode) || payload.exitCode === null
        ? (payload.exitCode as number | null)
        : null,
    exitObservedAt: toNullableIsoDateTime(payload.exitObservedAtMs),
    exitSignal:
      typeof payload.exitSignal === "string" &&
      payload.exitSignal.trim().length > 0
        ? payload.exitSignal
        : null,
    firstStderrAt: toNullableIsoDateTime(payload.firstStderrAtMs),
    processId: processIdValue,
    processSpawnedAt: toNullableIsoDateTime(payload.processSpawnedAtMs),
    stdinClosedAt: toNullableIsoDateTime(payload.stdinClosedAtMs),
    timeoutTriggeredAt: toNullableIsoDateTime(payload.timeoutTriggeredAtMs),
  };
};

export const normalizeDispatchOriginTraceRecord = (
  payload: DispatchRuntimeTelemetryDecisionPayload | null
): DispatchTraceOriginRecord | null => {
  if (!payload) {
    return null;
  }
  const agentControllerConversationId =
    normalizeOptionalText(payload.agentControllerConversationId) ?? null;
  const agentControllerRef =
    normalizeOptionalText(payload.agentControllerRef) ?? null;
  const resolvedAgentControllerConversationId =
    normalizeOptionalText(payload.resolvedAgentControllerConversationId) ??
    null;
  const agentControllerConversationKind =
    normalizeOptionalText(payload.agentControllerConversationKind) ?? null;
  const effectiveRuntimeWorkingDirectory =
    normalizeOptionalText(payload.effectiveRuntimeWorkingDirectory) ?? null;
  const runtimeWorkspaceFingerprint =
    normalizeOptionalText(payload.runtimeWorkspaceFingerprint) ?? null;
  if (
    !(
      agentControllerConversationId ||
      agentControllerRef ||
      resolvedAgentControllerConversationId ||
      agentControllerConversationKind ||
      effectiveRuntimeWorkingDirectory ||
      runtimeWorkspaceFingerprint
    )
  ) {
    return null;
  }
  return {
    agentControllerConversationId,
    effectiveRuntimeWorkingDirectory,
    runtimeWorkspaceFingerprint,
    agentControllerRef,
    resolvedAgentControllerConversationId,
    agentControllerConversationKind,
  };
};

export const normalizeDispatchPromptTraceRecord = (
  payload: DispatchRuntimeTelemetryDecisionPayload | null
): DispatchTracePromptRecord | null => {
  if (!payload) {
    return null;
  }
  const fingerprint = normalizeOptionalText(payload.promptFingerprint) ?? null;
  const preview = normalizeOptionalText(payload.promptPreview) ?? null;
  const promptLength =
    typeof payload.promptLength === "number" &&
    Number.isFinite(payload.promptLength) &&
    payload.promptLength >= 0
      ? Math.trunc(payload.promptLength)
      : null;
  if (!(fingerprint || preview || promptLength !== null)) {
    return null;
  }
  return {
    fingerprint,
    length: promptLength,
    preview,
  };
};

export const normalizeDispatchOpenClawGatewayVisibilityTraceRecord = (
  payload: DispatchRuntimeTelemetryDecisionPayload | null
): SpaceDispatchTraceSnapshot["openClawGatewayVisibility"] => {
  if (!payload) {
    return null;
  }
  const agentId = normalizeOptionalText(payload.openClawGatewayAgentId);
  const gatewayVisibility = normalizeOptionalText(
    payload.openClawGatewayVisibility
  );
  if (
    !(
      agentId &&
      (gatewayVisibility === "visible" ||
        gatewayVisibility === "missing_before_restart" ||
        gatewayVisibility === "visible_after_restart" ||
        gatewayVisibility === "missing_after_restart")
    )
  ) {
    return null;
  }
  return {
    agentId,
    gatewayRestartAttempted: payload.openClawGatewayRestartAttempted === true,
    gatewayVisibility,
  };
};
