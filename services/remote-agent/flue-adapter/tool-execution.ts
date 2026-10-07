import type { JsonValue } from "@flue/runtime";
import {
  REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE,
  sanitizeDispatchErrorSummary,
} from "@openmeld/schemas";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { readRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  ConnectorActionOutcomeUnknownError,
  ConnectorActionTerminalReceipt,
} from "../agent-core/connector-tools";
import {
  assertRemoteAgentExecutionCanContinue,
  buildRemoteAgentExecutionIdentity,
  requestRemoteAgentExecutionFailure,
} from "../agent-core/execution-state";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  beginRemoteAgentToolAttempt,
  RemoteAgentNoProgressError,
  type RemoteAgentToolAttempt,
  RemoteAgentToolCallBudgetExceededError,
  RemoteAgentToolProgressStateInvalidError,
  recordRemoteAgentToolResultProgress,
} from "../agent-core/tool-progress";
import {
  isRemoteAgentToolResultWithinBudget,
  REMOTE_AGENT_TOOL_RESULT_MAX_BYTES,
} from "../agent-core/tool-result-boundary";
import {
  assertRemoteAgentTurnAllowsToolExecution,
  markRemoteAgentTurnEnded,
} from "../agent-core/turn-end";
import { recordRemoteAgentTurnObservabilityBestEffort } from "../agent-core/turn-observability";

const toolExecutionQueues = new WeakMap<object, Map<string, Promise<void>>>();

export async function requireRemoteAgentToolExecutionContext(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<RemoteAgentCallbackContext> {
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
  if (!context) {
    throw new Error("Remote Agent execution context is unavailable.");
  }
  await assertRemoteAgentExecutionCanContinue({
    identity: buildRemoteAgentExecutionIdentity(context),
    storage: input.storage,
  });
  return context;
}

export async function executeRemoteAgentToolDefinition(input: {
  callLimit?: number;
  definition: RemoteAgentToolDefinition;
  signal?: AbortSignal;
  source?: "code_mode" | "direct";
  storage: RemoteAgentStorage;
  submissionId: string;
  toolInput: Record<string, unknown>;
  onStarted?: () => void | Promise<void>;
}): Promise<unknown> {
  return await runRemoteAgentToolSerially(input, async () => {
    input.signal?.throwIfAborted();
    await requireRemoteAgentToolExecutionContext(input);
    const attempt = await beginRemoteAgentToolExecutionAttempt({
      callLimit: input.callLimit,
      progressTracking: input.definition.progressTracking,
      storage: input.storage,
      submissionId: input.submissionId,
      toolInput: input.toolInput,
      toolName: input.definition.name,
      source: input.source ?? "direct",
    });
    let result: unknown;
    try {
      input.signal?.throwIfAborted();
      await input.onStarted?.();
      result = input.signal
        ? await input.definition.execute(input.toolInput, {
            signal: input.signal,
          })
        : await input.definition.execute(input.toolInput);
    } catch (error) {
      if (
        error instanceof ConnectorActionOutcomeUnknownError ||
        error instanceof ConnectorActionTerminalReceipt
      ) {
        // Preserve the owner's evidence in both direct tools and Code Mode.
        result = error.result;
      } else {
        console.warn("[remote_agent.tool_execution_failed]", {
          submissionId: input.submissionId,
          toolName: input.definition.name,
          source: input.source ?? "direct",
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorSummary: sanitizeDispatchErrorSummary(
            error instanceof Error ? error.message : String(error)
          ),
        });
        throw error;
      }
    }
    await recordRemoteAgentToolResultProgress({
      attempt,
      result,
      storage: input.storage,
      submissionId: input.submissionId,
    });
    if (input.definition.endsTurnAfter?.(result, input.toolInput) === true) {
      await markRemoteAgentTurnEnded({
        storage: input.storage,
        submissionId: input.submissionId,
        toolName: input.definition.name,
      });
    }
    return result;
  });
}

export async function beginRemoteAgentToolExecutionAttempt(input: {
  callLimit?: number;
  progressTracking?: RemoteAgentToolDefinition["progressTracking"];
  storage: RemoteAgentStorage;
  submissionId: string;
  source: "code_mode" | "direct";
  toolInput: Record<string, unknown>;
  toolName: string;
}): Promise<RemoteAgentToolAttempt> {
  await assertRemoteAgentTurnAllowsToolExecution(input);
  try {
    const attempt = await beginRemoteAgentToolAttempt(input);
    await recordRemoteAgentTurnObservabilityBestEffort({
      event: {
        observedAtMs: Date.now(),
        source: input.source,
        toolName: input.toolName,
        type: "tool_call",
        callNumber: attempt.callNumber,
        callLimit: attempt.callLimit,
      },
      storage: input.storage,
      submissionId: input.submissionId,
    });
    return attempt;
  } catch (error) {
    if (error instanceof RemoteAgentNoProgressError && error.attempt) {
      await recordRemoteAgentTurnObservabilityBestEffort({
        event: {
          observedAtMs: Date.now(),
          source: input.source,
          toolName: input.toolName,
          type: "tool_call",
          callNumber: error.attempt.callNumber,
          callLimit: error.attempt.callLimit,
        },
        storage: input.storage,
        submissionId: input.submissionId,
      });
    }
    if (error instanceof RemoteAgentToolCallBudgetExceededError) {
      await recordRemoteAgentTurnObservabilityBestEffort({
        event: { observedAtMs: Date.now(), type: "tool_budget_exhausted" },
        storage: input.storage,
        submissionId: input.submissionId,
      });
    }
    if (
      error instanceof RemoteAgentToolCallBudgetExceededError ||
      error instanceof RemoteAgentToolProgressStateInvalidError
    ) {
      const context = await requireRemoteAgentToolExecutionContext(input);
      await requestRemoteAgentExecutionFailure({
        identity: buildRemoteAgentExecutionIdentity(context),
        failure: {
          code: error.reasonCode,
          detail: error.message,
          reasonCode: "remote_agent.turn_not_completed",
        },
        storage: input.storage,
      });
    }
    throw error;
  }
}

async function runRemoteAgentToolSerially<Result>(
  input: {
    storage: RemoteAgentStorage;
    submissionId: string;
  },
  execute: () => Promise<Result>
): Promise<Result> {
  let submissionQueues = toolExecutionQueues.get(input.storage);
  if (!submissionQueues) {
    submissionQueues = new Map();
    toolExecutionQueues.set(input.storage, submissionQueues);
  }
  const previous =
    submissionQueues.get(input.submissionId) ?? Promise.resolve();
  const releaseControl: { run?: () => void } = {};
  const current = new Promise<void>((resolve) => {
    releaseControl.run = resolve;
  });
  const tail = previous.then(() => current);
  submissionQueues.set(input.submissionId, tail);
  await previous;
  try {
    return await execute();
  } finally {
    releaseControl.run?.();
    if (submissionQueues.get(input.submissionId) === tail) {
      submissionQueues.delete(input.submissionId);
    }
  }
}

export function toFlueJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const jsonValue = toFlueJsonValue(item);
      if (jsonValue === undefined) {
        throw new TypeError(
          "Flue tool outputs cannot contain undefined array items."
        );
      }
      return jsonValue;
    });
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const jsonValue = toFlueJsonValue(item);
        return jsonValue === undefined ? [] : [[key, jsonValue]];
      })
    );
  }
  throw new TypeError(
    `Flue tool outputs must be JSON-serializable, received ${typeof value}.`
  );
}

export function toBoundedRemoteAgentToolResult(input: {
  toolName: string;
  value: unknown;
  maxBytes?: number;
}): JsonValue | undefined {
  const jsonValue = toFlueJsonValue(input.value);
  if (
    jsonValue === undefined ||
    isRemoteAgentToolResultWithinBudget(jsonValue, input.maxBytes)
  ) {
    return jsonValue;
  }
  const serialized = JSON.stringify(jsonValue);
  const prefixEnd = beforeSplitSurrogatePair(serialized, 4000);
  const suffixStart = beforeSplitSurrogatePair(
    serialized,
    serialized.length - 8000
  );
  return {
    toolName: input.toolName,
    toolExecution: "returned",
    resultMetadata: boundedCompleteResultFields(jsonValue),
    presentation: {
      kind: "partial",
      reasonCode: REMOTE_AGENT_TOOL_RESULT_TOO_LARGE_REASON_CODE,
      originalJsonBytes: new TextEncoder().encode(serialized).byteLength,
      limitBytes: input.maxBytes ?? REMOTE_AGENT_TOOL_RESULT_MAX_BYTES,
      continuation: null,
      message:
        "The tool returned; this is not an execution failure or proof of business success. Only complete small top-level fields and excerpts of the returned JSON are shown. OpenMeld did not retain the omitted content for continuation. The provider may itself have returned partial data; its completeness fields still apply. Use existing bounded read tools for additional evidence when available. Do not repeat a write to recover its display.",
    },
    resultPreview: {
      format: "json_excerpts",
      prefix: serialized.slice(0, prefixEnd),
      prefixEndUtf16Exclusive: prefixEnd,
      suffix: serialized.slice(suffixStart),
      suffixStartUtf16: suffixStart,
    },
  };
}

// Copy facts, not a derived success status. A large data field must not hide
// a completed operation's receipt (or a failure) elsewhere in the envelope.
function boundedCompleteResultFields(value: JsonValue): JsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const fields: [string, JsonValue][] = [];
  // Preserve the standard receipt/outcome fields before optional metadata can
  // consume their budget. Copy only present, complete values; infer no outcome.
  const keys = new Set([
    "status",
    "outcome",
    "success",
    "replayed",
    "operationId",
    "providerExecutionId",
    "requestId",
    "reasonCode",
    "errorCode",
    ...Object.keys(value),
  ]);
  let remainingBytes = 8000;
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    const item = value[key];
    if (item === undefined) {
      continue;
    }
    const bytes = new TextEncoder().encode(
      JSON.stringify({ [key]: item })
    ).byteLength;
    if (bytes <= remainingBytes) {
      fields.push([key, item]);
      remainingBytes -= bytes;
    }
  }
  return Object.fromEntries(fields);
}

// Excerpts stay well below the byte limit even after JSON escaping by Flue or
// Code Mode. Keep actual Unicode characters intact at both excerpt boundaries.
function beforeSplitSurrogatePair(text: string, offset: number): number {
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return previous >= 0xd8_00 &&
    previous <= 0xdb_ff &&
    current >= 0xdc_00 &&
    current <= 0xdf_ff
    ? offset - 1
    : offset;
}
