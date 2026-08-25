import { remoteAgentTurnRuntimeEvidenceSchema } from "@openmeld/schemas";
import type { RemoteAgentTurnRuntimeEvidence } from "@openmeld/schemas/types";
import type { RemoteAgentStorage } from "./callback-context";
import { REMOTE_AGENT_TOOL_CALL_LIMIT } from "./tool-progress";

export const REMOTE_AGENT_TURN_OBSERVABILITY_KEY_PREFIX =
  "openmeld:remote-agent:turn-observability:";

const TURN_OBSERVABILITY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TURN_OBSERVABILITY_WRITE_MAX_ATTEMPTS = 128;
const RECENT_PROVIDER_REQUEST_LIMIT = 16;
const RECENT_CAPABILITY_DISCOVERY_LIMIT = 16;
const RECENT_TOOL_CALL_LIMIT = 32;

type RemoteAgentTurnObservabilityState = RemoteAgentTurnRuntimeEvidence & {
  expiresAtMs: number;
  v: 1;
};

type RemoteAgentTurnObservabilityEvent =
  | {
      availableToolCount: number;
      exposedToolCount: number;
      modelId: string | null;
      observedAtMs: number;
      type: "provider_request_prepared";
    }
  | {
      modelId: string | null;
      observedAtMs: number;
      type: "provider_response_headers";
    }
  | {
      assistantText: boolean;
      observedAtMs: number;
      type: "model_event";
    }
  | { observedAtMs: number; type: "visible_content" }
  | { observedAtMs: number; type: "model_completed" }
  | {
      capabilityNames: string[];
      observedAtMs: number;
      operation: "describe" | "search";
      resultCount: number;
      type: "capability_discovery";
    }
  | {
      observedAtMs: number;
      source: "code_mode" | "direct";
      toolName: string;
      type: "tool_call";
    }
  | { observedAtMs: number; type: "tool_budget_exhausted" };

export type RemoteAgentTurnObservabilityWriteResult = {
  evidence: RemoteAgentTurnRuntimeEvidence;
  firstAssistantTextRecorded: boolean;
  firstModelEventRecorded: boolean;
  firstVisibleContentRecorded: boolean;
};

export async function recordRemoteAgentTurnObservability(input: {
  event: RemoteAgentTurnObservabilityEvent;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<RemoteAgentTurnObservabilityWriteResult> {
  const submissionId = requireIdentifier(input.submissionId, "submission id");
  const observedAtMs = requireTimestamp(input.event.observedAtMs);
  const key = buildRemoteAgentTurnObservabilityKey(submissionId);
  const expiresAtMs = observedAtMs + TURN_OBSERVABILITY_RETENTION_MS;

  for (
    let attempt = 0;
    attempt < TURN_OBSERVABILITY_WRITE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const stored = await input.storage.get<unknown>(key);
    const current = parseState(stored, observedAtMs, submissionId);
    const next = applyEvent(
      current ?? createInitialState(submissionId, expiresAtMs, observedAtMs),
      input.event,
      expiresAtMs
    );
    const written =
      stored !== undefined
        ? await input.storage.compareAndSetExpiring(
            key,
            stored,
            next,
            expiresAtMs
          )
        : await input.storage.putIfAbsentExpiring(key, next, expiresAtMs);
    if (written) {
      return {
        evidence: projectEvidence(next),
        firstAssistantTextRecorded:
          (current?.firstAssistantTextAtMs ?? null) === null &&
          next.firstAssistantTextAtMs !== null,
        firstModelEventRecorded:
          (current?.firstModelEventAtMs ?? null) === null &&
          next.firstModelEventAtMs !== null,
        firstVisibleContentRecorded:
          (current?.firstVisibleContentAtMs ?? null) === null &&
          next.firstVisibleContentAtMs !== null,
      };
    }
  }

  throw new Error(
    `Remote Agent turn observability ${submissionId} could not be updated after concurrent writes.`
  );
}

export async function recordRemoteAgentTurnObservabilityBestEffort(
  input: Parameters<typeof recordRemoteAgentTurnObservability>[0]
): Promise<RemoteAgentTurnObservabilityWriteResult | null> {
  try {
    return await recordRemoteAgentTurnObservability(input);
  } catch (error) {
    console.error("[remote_agent.turn_observability.write_failed]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      submissionId: input.submissionId,
      type: input.event.type,
    });
    return null;
  }
}

export async function readRemoteAgentTurnObservability(input: {
  nowMs?: number;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<RemoteAgentTurnRuntimeEvidence | null> {
  const submissionId = requireIdentifier(input.submissionId, "submission id");
  const state = parseState(
    await input.storage.get<unknown>(
      buildRemoteAgentTurnObservabilityKey(submissionId)
    ),
    input.nowMs ?? Date.now(),
    submissionId
  );
  return state ? projectEvidence(state) : null;
}

export function projectStoredRemoteAgentTurnObservability(input: {
  nowMs: number;
  submissionId: string;
  value: unknown;
}): RemoteAgentTurnRuntimeEvidence | null {
  const state = parseState(input.value, input.nowMs, input.submissionId);
  return state ? projectEvidence(state) : null;
}

function createInitialState(
  submissionId: string,
  expiresAtMs: number,
  updatedAtMs: number
): RemoteAgentTurnObservabilityState {
  return {
    budgetExhaustedAtMs: null,
    capabilityDescribeCount: 0,
    capabilitySearchCount: 0,
    codeModeToolCallCount: 0,
    directToolCallCount: 0,
    expiresAtMs,
    firstAssistantTextAtMs: null,
    firstModelEventAtMs: null,
    firstProviderRequestPreparedAtMs: null,
    firstProviderResponseHeadersAtMs: null,
    firstVisibleContentAtMs: null,
    lastModelCompletedAtMs: null,
    modelCallCount: 0,
    modelId: null,
    providerAvailableToolCount: 0,
    providerDeferredToolCount: 0,
    providerExposedToolCount: 0,
    providerRequestCount: 0,
    recentCapabilityDiscovery: [],
    recentProviderRequests: [],
    recentToolCalls: [],
    submissionId,
    toolCallCount: 0,
    toolCallLimit: REMOTE_AGENT_TOOL_CALL_LIMIT,
    updatedAtMs,
    v: 1,
  };
}

function applyEvent(
  current: RemoteAgentTurnObservabilityState,
  event: RemoteAgentTurnObservabilityEvent,
  expiresAtMs: number
): RemoteAgentTurnObservabilityState {
  const next = {
    ...current,
    expiresAtMs: Math.max(current.expiresAtMs, expiresAtMs),
    updatedAtMs: Math.max(current.updatedAtMs, event.observedAtMs),
  };

  switch (event.type) {
    case "provider_request_prepared": {
      const availableToolCount = requireCount(event.availableToolCount);
      const exposedToolCount = requireCount(event.exposedToolCount);
      const deferredToolCount = Math.max(
        0,
        availableToolCount - exposedToolCount
      );
      return {
        ...next,
        firstProviderRequestPreparedAtMs: firstTimestamp(
          current.firstProviderRequestPreparedAtMs,
          event.observedAtMs
        ),
        modelId: normalizeModelId(event.modelId) ?? current.modelId,
        providerAvailableToolCount: availableToolCount,
        providerDeferredToolCount: deferredToolCount,
        providerExposedToolCount: exposedToolCount,
        providerRequestCount: current.providerRequestCount + 1,
        recentProviderRequests: [
          ...current.recentProviderRequests,
          {
            availableToolCount,
            deferredToolCount,
            exposedToolCount,
            modelId: normalizeModelId(event.modelId),
            preparedAtMs: event.observedAtMs,
          },
        ].slice(-RECENT_PROVIDER_REQUEST_LIMIT),
      };
    }
    case "provider_response_headers":
      return {
        ...next,
        firstProviderResponseHeadersAtMs: firstTimestamp(
          current.firstProviderResponseHeadersAtMs,
          event.observedAtMs
        ),
        modelId: normalizeModelId(event.modelId) ?? current.modelId,
      };
    case "model_event":
      return {
        ...next,
        firstAssistantTextAtMs: event.assistantText
          ? firstTimestamp(current.firstAssistantTextAtMs, event.observedAtMs)
          : current.firstAssistantTextAtMs,
        firstModelEventAtMs: firstTimestamp(
          current.firstModelEventAtMs,
          event.observedAtMs
        ),
      };
    case "visible_content":
      return {
        ...next,
        firstVisibleContentAtMs: firstTimestamp(
          current.firstVisibleContentAtMs,
          event.observedAtMs
        ),
      };
    case "model_completed":
      return {
        ...next,
        lastModelCompletedAtMs: Math.max(
          current.lastModelCompletedAtMs ?? 0,
          event.observedAtMs
        ),
        modelCallCount: current.modelCallCount + 1,
      };
    case "capability_discovery": {
      const capabilityNames = event.capabilityNames
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, 12);
      return {
        ...next,
        capabilityDescribeCount:
          current.capabilityDescribeCount +
          (event.operation === "describe" ? 1 : 0),
        capabilitySearchCount:
          current.capabilitySearchCount +
          (event.operation === "search" ? 1 : 0),
        recentCapabilityDiscovery: [
          ...current.recentCapabilityDiscovery,
          {
            capabilityNames,
            observedAtMs: event.observedAtMs,
            operation: event.operation,
            resultCount: requireCount(event.resultCount),
          },
        ].slice(-RECENT_CAPABILITY_DISCOVERY_LIMIT),
      };
    }
    case "tool_call": {
      const toolName = requireIdentifier(event.toolName, "tool name");
      return {
        ...next,
        codeModeToolCallCount:
          current.codeModeToolCallCount +
          (event.source === "code_mode" ? 1 : 0),
        directToolCallCount:
          current.directToolCallCount + (event.source === "direct" ? 1 : 0),
        recentToolCalls: [
          ...current.recentToolCalls,
          {
            calledAtMs: event.observedAtMs,
            source: event.source,
            toolName,
          },
        ].slice(-RECENT_TOOL_CALL_LIMIT),
        toolCallCount: current.toolCallCount + 1,
      };
    }
    case "tool_budget_exhausted":
      return {
        ...next,
        budgetExhaustedAtMs: firstTimestamp(
          current.budgetExhaustedAtMs,
          event.observedAtMs
        ),
      };
    default: {
      const unhandledEvent: never = event;
      return unhandledEvent;
    }
  }
}

function parseState(
  value: unknown,
  nowMs: number,
  submissionId: string
): RemoteAgentTurnObservabilityState | null {
  if (value === undefined) {
    return null;
  }
  if (!(isRecord(value) && value.v === 1)) {
    throw new Error(
      `Remote Agent turn observability ${submissionId} is invalid.`
    );
  }
  const expiresAtMs = Number(value.expiresAtMs);
  if (!(Number.isSafeInteger(expiresAtMs) && expiresAtMs > 0)) {
    throw new Error(
      `Remote Agent turn observability ${submissionId} has invalid retention.`
    );
  }
  if (expiresAtMs <= nowMs) {
    return null;
  }
  const parsed = remoteAgentTurnRuntimeEvidenceSchema.safeParse(
    stripInternalState(value)
  );
  if (!parsed.success) {
    throw new Error(
      `Remote Agent turn observability ${submissionId} is invalid.`
    );
  }
  return { ...parsed.data, expiresAtMs, v: 1 };
}

function projectEvidence(
  state: RemoteAgentTurnObservabilityState
): RemoteAgentTurnRuntimeEvidence {
  return remoteAgentTurnRuntimeEvidenceSchema.parse(stripInternalState(state));
}

function stripInternalState(
  value: Record<string, unknown>
): Record<string, unknown> {
  const { expiresAtMs: _expiresAtMs, v: _v, ...evidence } = value;
  return evidence;
}

function buildRemoteAgentTurnObservabilityKey(submissionId: string): string {
  return `${REMOTE_AGENT_TURN_OBSERVABILITY_KEY_PREFIX}${encodeURIComponent(
    submissionId
  )}`;
}

function firstTimestamp(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}

function normalizeModelId(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function requireIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Remote Agent turn observability requires ${name}.`);
  }
  return normalized;
}

function requireTimestamp(value: number): number {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new Error(
      "Remote Agent turn observability requires a non-negative timestamp."
    );
  }
  return value;
}

function requireCount(value: number): number {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new Error(
      "Remote Agent turn observability requires a non-negative count."
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
