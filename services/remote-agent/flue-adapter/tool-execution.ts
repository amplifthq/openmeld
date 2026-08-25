import type { JsonValue } from "@flue/runtime";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { readRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  assertRemoteAgentExecutionCanContinue,
  buildRemoteAgentExecutionIdentity,
} from "../agent-core/execution-state";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import {
  beginRemoteAgentToolAttempt,
  type RemoteAgentToolAttempt,
  RemoteAgentToolCallBudgetExceededError,
  RemoteAgentToolProgressStateInvalidError,
  recordRemoteAgentToolResultProgress,
} from "../agent-core/tool-progress";
import {
  isRemoteAgentToolResultWithinLimit,
  RemoteAgentToolResultTooLargeError as ToolResultTooLargeError,
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
  definition: RemoteAgentToolDefinition;
  signal?: AbortSignal;
  source?: "code_mode" | "direct";
  storage: RemoteAgentStorage;
  submissionId: string;
  toolInput: Record<string, unknown>;
}): Promise<unknown> {
  return await runRemoteAgentToolSerially(input, async () => {
    await requireRemoteAgentToolExecutionContext(input);
    const attempt = await beginRemoteAgentToolExecutionAttempt({
      progressTracking: input.definition.progressTracking,
      storage: input.storage,
      submissionId: input.submissionId,
      toolInput: input.toolInput,
      toolName: input.definition.name,
      source: input.source ?? "direct",
    });
    const result = input.signal
      ? await input.definition.execute(input.toolInput, {
          signal: input.signal,
        })
      : await input.definition.execute(input.toolInput);
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
      },
      storage: input.storage,
      submissionId: input.submissionId,
    });
    return attempt;
  } catch (error) {
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
      await markRemoteAgentTurnEnded({
        storage: input.storage,
        submissionId: input.submissionId,
        toolName:
          error instanceof RemoteAgentToolCallBudgetExceededError
            ? "the submission tool-call budget"
            : "invalid durable tool progress",
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
}): JsonValue | undefined {
  const jsonValue = toFlueJsonValue(input.value);
  if (
    jsonValue === undefined ||
    isRemoteAgentToolResultWithinLimit(jsonValue)
  ) {
    return jsonValue;
  }
  throw new ToolResultTooLargeError(input.toolName);
}
