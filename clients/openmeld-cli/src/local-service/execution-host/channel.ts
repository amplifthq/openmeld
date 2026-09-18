import { randomUUID } from "node:crypto";
import {
  SERVICE_EXECUTION_HOST_MAX_FRAME_BYTES,
  SERVICE_EXECUTION_HOST_MAX_PENDING_REQUESTS,
  SERVICE_EXECUTION_HOST_PROTOCOL,
  type ServiceExecutionHostInput,
  type ServiceExecutionHostMessage,
  type ServiceExecutionHostMethod,
  type ServiceExecutionHostOutput,
  serviceExecutionHostMessageSchema,
  serviceExecutionHostMethods,
  serviceExecutionHostRequestSchema,
} from "@openmeld/schemas";

export type ExecutionHostChannel = {
  connected(): boolean;
  send(message: object, completed: (error: Error | null) => void): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onDisconnect(listener: (error?: Error) => void): () => void;
};

export class ExecutionHostError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExecutionHostError";
    this.code = code;
  }
}

const RESERVED_CONTROL_REQUESTS = 4;
const controlMethods = new Set<ServiceExecutionHostMethod>([
  "health",
  "beginDrain",
  "detachConnection",
  "stop",
]);

function assertFrameSize(message: unknown): number {
  const serialized = JSON.stringify(message);
  if (serialized === undefined) {
    throw new ExecutionHostError(
      "host.invalid_frame",
      "Host IPC requires JSON."
    );
  }
  const size = Buffer.byteLength(serialized);
  if (size > SERVICE_EXECUTION_HOST_MAX_FRAME_BYTES) {
    throw new ExecutionHostError(
      "host.frame_too_large",
      "The local execution message exceeds the IPC limit."
    );
  }
  return size;
}

function createSender(channel: ExecutionHostChannel) {
  let queuedBytes = 0;
  return (message: object, completed: (error: Error | null) => void): void => {
    const size = assertFrameSize(message);
    if (!channel.connected()) {
      throw new ExecutionHostError(
        "host.disconnected",
        "The Host IPC channel is closed."
      );
    }
    if (queuedBytes + size > SERVICE_EXECUTION_HOST_MAX_FRAME_BYTES * 2) {
      throw new ExecutionHostError(
        "host.backpressure",
        "Host IPC is full; no new message was queued."
      );
    }
    queuedBytes += size;
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) {
        return;
      }
      settled = true;
      queuedBytes -= size;
      completed(error);
    };
    try {
      channel.send(message, settle);
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

type PendingRequest = {
  method: ServiceExecutionHostMethod;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
};

function resolveReply(
  request: PendingRequest,
  message: Extract<ServiceExecutionHostMessage, { type: "reply" }>
): void {
  if (!message.result.ok) {
    request.reject(
      new ExecutionHostError(
        message.result.error.code,
        message.result.error.message
      )
    );
    return;
  }
  const result = serviceExecutionHostMethods[request.method].output.safeParse(
    message.result.payload
  );
  if (!result.success) {
    const error = new ExecutionHostError(
      "host.invalid_response",
      `Invalid ${request.method} response from the execution host.`
    );
    request.reject(error);
    throw error;
  }
  request.resolve(result.data);
}

export function createExecutionHostClient(input: {
  channel: ExecutionHostChannel;
  hostInstanceId: string;
  onEvent?(
    event: Exclude<ServiceExecutionHostMessage, { type: "reply" }>
  ): void;
  onFailure?(error: Error): void;
}) {
  const pending = new Map<string, PendingRequest>();
  const send = createSender(input.channel);
  let failure: Error | null = null;

  const fail = (error: Error) => {
    if (failure) {
      return;
    }
    failure = error;
    for (const request of pending.values()) {
      if (request.timer) {
        clearTimeout(request.timer);
      }
      request.reject(error);
    }
    pending.clear();
    input.onFailure?.(error);
  };

  const stopMessages = input.channel.onMessage((raw) => {
    if (failure) {
      return;
    }
    try {
      assertFrameSize(raw);
      const parsed = serviceExecutionHostMessageSchema.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.hostInstanceId !== input.hostInstanceId
      ) {
        throw new ExecutionHostError(
          "host.invalid_response",
          "Host response does not match this process incarnation."
        );
      }
      const message = parsed.data;
      if (message.type !== "reply") {
        input.onEvent?.(message);
        return;
      }
      const request = pending.get(message.requestId);
      // A timed-out observer is gone, not the accepted operation. Do not retry it
      // or turn its late result into the outcome of a newer request.
      if (!request) {
        return;
      }
      if (request.method !== message.method) {
        throw new ExecutionHostError(
          "host.invalid_response",
          "Host response method does not match its request."
        );
      }
      pending.delete(message.requestId);
      if (request.timer) {
        clearTimeout(request.timer);
      }
      resolveReply(request, message);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const stopDisconnect = input.channel.onDisconnect((cause) => {
    fail(
      new ExecutionHostError(
        "host.disconnected",
        cause
          ? `The execution host disconnected: ${cause.message}. In-flight outcomes are unconfirmed.`
          : "The execution host disconnected; in-flight outcomes are unconfirmed."
      )
    );
  });

  return {
    call<M extends ServiceExecutionHostMethod>(
      method: M,
      value: ServiceExecutionHostInput<M>,
      options: { timeoutMs?: number | null } = {}
    ): Promise<ServiceExecutionHostOutput<M>> {
      if (failure) {
        return Promise.reject(failure);
      }
      const limit =
        SERVICE_EXECUTION_HOST_MAX_PENDING_REQUESTS -
        (controlMethods.has(method) ? 0 : RESERVED_CONTROL_REQUESTS);
      if (pending.size >= limit) {
        return Promise.reject(
          new ExecutionHostError(
            "host.busy",
            "Too many outstanding Host requests; no new request was sent."
          )
        );
      }
      const payload =
        serviceExecutionHostMethods[method].input.safeParse(value);
      if (!payload.success) {
        return Promise.reject(
          new ExecutionHostError(
            "host.invalid_request",
            `Invalid ${method} request.`
          )
        );
      }
      const requestId = randomUUID();
      const timeoutMs =
        options.timeoutMs === undefined ? 30_000 : options.timeoutMs;
      if (
        timeoutMs !== null &&
        (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      ) {
        return Promise.reject(
          new ExecutionHostError(
            "host.invalid_timeout",
            "The observer deadline must be positive or absent."
          )
        );
      }
      return new Promise<ServiceExecutionHostOutput<M>>((resolve, reject) => {
        const request: PendingRequest = {
          method,
          resolve: (result) => resolve(result as ServiceExecutionHostOutput<M>),
          reject,
          timer: null,
        };
        if (timeoutMs !== null) {
          request.timer = setTimeout(() => {
            pending.delete(requestId);
            reject(
              new ExecutionHostError(
                "host.observation_timeout",
                `The ${method} response is unconfirmed. No operation was cancelled or retried.`
              )
            );
          }, timeoutMs);
          request.timer.unref?.();
        }
        pending.set(requestId, request);
        try {
          send(
            {
              protocol: SERVICE_EXECUTION_HOST_PROTOCOL,
              hostInstanceId: input.hostInstanceId,
              requestId,
              method,
              payload: payload.data,
            },
            (error) => {
              if (error) {
                fail(error);
              }
            }
          );
        } catch (error) {
          pending.delete(requestId);
          if (request.timer) {
            clearTimeout(request.timer);
          }
          reject(error);
        }
      });
    },
    pendingCount: () => pending.size,
    dispose(): void {
      stopMessages();
      stopDisconnect();
      fail(
        new ExecutionHostError(
          "host.observer_closed",
          "The Host observer closed; accepted work was not cancelled."
        )
      );
    },
  };
}

export type ExecutionHostHandlers = {
  [M in ServiceExecutionHostMethod]: (
    input: ServiceExecutionHostInput<M>
  ) => Promise<ServiceExecutionHostOutput<M>> | ServiceExecutionHostOutput<M>;
};

export function serveExecutionHost(input: {
  channel: ExecutionHostChannel;
  hostInstanceId: string;
  handlers: ExecutionHostHandlers;
  onFailure(error: Error): void;
  onDisconnect(): void;
}) {
  const activeIds = new Set<string>();
  const send = createSender(input.channel);
  let closed = false;

  const sendMessage = (message: ServiceExecutionHostMessage) => {
    if (closed) {
      throw new ExecutionHostError(
        "host.disconnected",
        "The connector is no longer observing this Host."
      );
    }
    send(message, (error) => {
      if (error) {
        input.onFailure(error);
      }
    });
  };

  const stopMessages = input.channel.onMessage((raw) => {
    if (closed) {
      return;
    }
    let request: ReturnType<typeof serviceExecutionHostRequestSchema.parse>;
    try {
      assertFrameSize(raw);
      const parsed = serviceExecutionHostRequestSchema.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.hostInstanceId !== input.hostInstanceId
      ) {
        throw new ExecutionHostError(
          "host.invalid_request",
          "Host request does not match this process incarnation."
        );
      }
      request = parsed.data;
    } catch (error) {
      input.onFailure(
        error instanceof Error ? error : new Error(String(error))
      );
      return;
    }

    const respond = (
      result: Extract<ServiceExecutionHostMessage, { type: "reply" }>["result"]
    ) => {
      if (!closed) {
        sendMessage({
          protocol: SERVICE_EXECUTION_HOST_PROTOCOL,
          hostInstanceId: input.hostInstanceId,
          type: "reply",
          requestId: request.requestId,
          method: request.method,
          result,
        });
      }
    };
    const reject = (error: unknown) => {
      try {
        respond({
          ok: false,
          error: {
            code:
              error instanceof ExecutionHostError
                ? error.code
                : "host.operation_failed",
            message:
              (error instanceof Error ? error.message : String(error)).slice(
                0,
                4096
              ) || "Host operation failed.",
          },
        });
      } catch (sendError) {
        input.onFailure(
          sendError instanceof Error ? sendError : new Error(String(sendError))
        );
      }
    };

    const limit =
      SERVICE_EXECUTION_HOST_MAX_PENDING_REQUESTS -
      (controlMethods.has(request.method) ? 0 : RESERVED_CONTROL_REQUESTS);
    if (activeIds.has(request.requestId) || activeIds.size >= limit) {
      reject(
        new ExecutionHostError(
          "host.busy",
          "Host request is duplicate or capacity is exhausted; it was not admitted again."
        )
      );
      return;
    }
    const method = serviceExecutionHostMethods[request.method];
    const payload = method.input.safeParse(request.payload);
    if (!payload.success) {
      reject(
        new ExecutionHostError(
          "host.invalid_request",
          `Invalid ${request.method} payload.`
        )
      );
      return;
    }
    activeIds.add(request.requestId);
    // This cast connects the fixed schema table to its corresponding handler.
    // Both request and response are runtime-validated, including local callers.
    const handler = input.handlers[request.method] as (
      value: unknown
    ) => unknown;
    Promise.resolve()
      .then(() => handler(payload.data))
      .then((result) => {
        const parsed = method.output.safeParse(result);
        if (!parsed.success) {
          throw new ExecutionHostError(
            "host.invalid_response",
            `The ${request.method} owner returned an invalid response.`
          );
        }
        respond({ ok: true, payload: parsed.data });
      })
      .catch(reject)
      .finally(() => activeIds.delete(request.requestId));
  });
  const stopDisconnect = input.channel.onDisconnect(() => {
    if (closed) {
      return;
    }
    closed = true;
    input.onDisconnect();
  });
  return {
    emit(event: Exclude<ServiceExecutionHostMessage, { type: "reply" }>): void {
      const parsed = serviceExecutionHostMessageSchema.safeParse(event);
      if (!parsed.success || event.hostInstanceId !== input.hostInstanceId) {
        throw new ExecutionHostError(
          "host.invalid_event",
          "Invalid execution-host event."
        );
      }
      sendMessage(parsed.data);
    },
    dispose(): void {
      closed = true;
      stopMessages();
      stopDisconnect();
    },
  };
}
