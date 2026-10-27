import type { CoreBindings } from "../../../lib/bindings";
import type { RuntimeTransportHub } from "../../../runtime-transport/transport/do/runtime-transport-hub";
import { CORE_LOG_EVENTS } from "../../../shared/observability/log-events";
import {
  RUNTIME_TRANSPORT_READ_MAX_ATTEMPTS,
  RUNTIME_TRANSPORT_READ_RETRY_BASE_DELAY_MS,
} from "../../../strategy-constants";
import { resolveRuntimeTransportOwnerShard } from "./runtime-transport-shard";

export type RuntimeTransportReadOperation =
  | "rpcReadAgentProfileWorkRecovery"
  | "rpcReadAgentProfileExecutionState"
  | "rpcReadAgentProfileOperationalContexts"
  | "/lookup-route"
  | "/lookup-routes-batch"
  | "/lookup-owner-service";

// Cloudflare support confirmed this exact infrastructure error is transient
// even when the propagated exception does not retain its retryable property.
const INACTIVE_INSTANCE_MESSAGE =
  "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.";

export class RuntimeTransportReadTimeoutError extends Error {
  readonly retryable = false;

  constructor(operation: RuntimeTransportReadOperation, timeoutMs: number) {
    super(
      `Runtime Transport read ${operation} exceeded its ${timeoutMs}ms budget.`
    );
    this.name = "RuntimeTransportReadTimeoutError";
  }
}

class RuntimeTransportReadAttemptTimeoutError extends Error {
  constructor(operation: RuntimeTransportReadOperation, timeoutMs: number) {
    super(
      `Runtime Transport read ${operation} attempt exceeded ${timeoutMs}ms.`
    );
    this.name = "RuntimeTransportReadAttemptTimeoutError";
  }
}

function readExceptionProperties(error: unknown) {
  const source = typeof error === "object" && error !== null ? error : {};
  return {
    retryable:
      "retryable" in source && typeof source.retryable === "boolean"
        ? source.retryable
        : null,
    overloaded:
      "overloaded" in source && typeof source.overloaded === "boolean"
        ? source.overloaded
        : null,
    remote:
      "remote" in source && typeof source.remote === "boolean"
        ? source.remote
        : null,
    inactiveInstance:
      "message" in source && source.message === INACTIVE_INSTANCE_MESSAGE,
  };
}

type RetryDecision =
  | "retry"
  | "overloaded"
  | "non_retryable"
  | "attempts_exhausted"
  | "budget_exhausted";

function decideRetry(
  error: unknown,
  attempt: number,
  remainingMs: number
): {
  decision: RetryDecision;
  delayMs: number;
} {
  const properties = readExceptionProperties(error);
  if (properties.overloaded === true) {
    return { decision: "overloaded", delayMs: 0 };
  }
  if (
    !(
      error instanceof RuntimeTransportReadAttemptTimeoutError ||
      properties.retryable === true ||
      (properties.retryable === null && properties.inactiveInstance)
    )
  ) {
    return { decision: "non_retryable", delayMs: 0 };
  }
  if (attempt === RUNTIME_TRANSPORT_READ_MAX_ATTEMPTS) {
    return { decision: "attempts_exhausted", delayMs: 0 };
  }
  const delayMs = Math.floor(
    RUNTIME_TRANSPORT_READ_RETRY_BASE_DELAY_MS *
      2 ** (attempt - 1) *
      Math.random()
  );
  return delayMs >= remainingMs
    ? { decision: "budget_exhausted", delayMs: 0 }
    : { decision: "retry", delayMs };
}

export async function callRuntimeTransportRead<T>(input: {
  env: CoreBindings;
  ownerUserId: string;
  operation: RuntimeTransportReadOperation;
  requestId?: string | null;
  timeoutMs: number;
  // Only HTTP reads opt in: direct RPC cannot cancel an attempt's transport.
  attemptTimeoutMs?: number;
  execute: (
    stub: DurableObjectStub<RuntimeTransportHub>,
    signal: AbortSignal
  ) => Promise<T>;
}): Promise<T> {
  const readId = crypto.randomUUID();
  const startedAt = Date.now();
  const deadlineAt = startedAt + input.timeoutMs;
  let activeController: AbortController | undefined;
  const timeoutError = new RuntimeTransportReadTimeoutError(
    input.operation,
    input.timeoutMs
  );
  let attempt = 0;
  let durableObjectId: string | null = null;
  let backoffTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      reject(timeoutError);
      activeController?.abort();
    }, input.timeoutMs);
  });

  const logFailure = (
    error: unknown,
    decision: RetryDecision,
    delayMs: number
  ) => {
    console.warn("[core.runtime_transport.read_attempt_failed]", {
      event: CORE_LOG_EVENTS.runtimeTransportReadAttemptFailed,
      readId,
      requestId: input.requestId ?? null,
      durableObjectId,
      operation: input.operation,
      attempt,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      timeoutMs: input.timeoutMs,
      ...readExceptionProperties(error),
      ...(input.attemptTimeoutMs === undefined
        ? {}
        : {
            attemptTimedOut:
              error instanceof RuntimeTransportReadAttemptTimeoutError,
            attemptTimeoutMs: input.attemptTimeoutMs,
          }),
      decision,
      delayMs,
    });
  };

  const executeAttempt = async (
    stub: DurableObjectStub<RuntimeTransportHub>
  ): Promise<T> => {
    const controller = new AbortController();
    activeController = controller;
    let attemptTimer: ReturnType<typeof setTimeout> | undefined;
    const pending = [deadline];
    const attemptTimeoutMs = input.attemptTimeoutMs;
    const attemptDeadlineAt = Math.min(
      deadlineAt,
      Date.now() + (attemptTimeoutMs ?? input.timeoutMs)
    );
    // The total deadline owns the final boundary, including when a shorter
    // remaining budget cannot fit the full per-attempt allowance.
    if (
      attemptTimeoutMs !== undefined &&
      attemptTimeoutMs < deadlineAt - Date.now()
    ) {
      pending.push(
        new Promise<never>((_resolve, reject) => {
          attemptTimer = setTimeout(() => {
            reject(
              new RuntimeTransportReadAttemptTimeoutError(
                input.operation,
                attemptTimeoutMs
              )
            );
            controller.abort();
          }, attemptTimeoutMs);
        })
      );
    }
    try {
      const result = await Promise.race([
        input.execute(stub, controller.signal),
        ...pending,
      ]);
      if (Date.now() >= deadlineAt) {
        throw timeoutError;
      }
      if (attemptTimeoutMs !== undefined && Date.now() >= attemptDeadlineAt) {
        throw new RuntimeTransportReadAttemptTimeoutError(
          input.operation,
          attemptTimeoutMs
        );
      }
      return result;
    } finally {
      clearTimeout(attemptTimer);
      controller.abort();
      activeController = undefined;
    }
  };

  try {
    while (attempt < RUNTIME_TRANSPORT_READ_MAX_ATTEMPTS) {
      if (Date.now() >= deadlineAt) {
        throw timeoutError;
      }
      attempt += 1;
      try {
        const stub = resolveRuntimeTransportOwnerShard(
          input.env,
          input.ownerUserId
        );
        durableObjectId = stub.id?.toString() ?? null;
        // A broken stub must never be reused. HTTP reads can consume the abort
        // signal; these direct RPC methods do not accept it. The race bounds
        // caller waiting and ignores late completion without replaying after expiry.
        return await executeAttempt(stub);
      } catch (error) {
        if (error === timeoutError) {
          throw error;
        }
        const { decision, delayMs } = decideRetry(
          error,
          attempt,
          deadlineAt - Date.now()
        );
        logFailure(error, decision, delayMs);
        if (decision !== "retry") {
          throw error;
        }
        await Promise.race([
          new Promise<void>((resolve) => {
            backoffTimer = setTimeout(resolve, delayMs);
          }),
          deadline,
        ]);
      }
    }
    throw timeoutError;
  } catch (error) {
    if (error === timeoutError) {
      logFailure(error, "budget_exhausted", 0);
    }
    throw error;
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(backoffTimer);
    activeController?.abort();
  }
}
