export type OpenMeldApiClientTransport = (input: {
  url: string;
  operation: string;
  init?: RequestInit;
  timeoutMs?: number;
}) => Promise<Response>;

export type OpenMeldApiClientStreamTransport = (input: {
  url: string;
  headers?: Record<string, string>;
  protocols?: string | string[];
  signal?: AbortSignal;
}) => Promise<unknown>;

export function createFetchTransport(input: {
  fetch: typeof globalThis.fetch;
  defaultTimeoutMs?: number;
}): OpenMeldApiClientTransport {
  const defaultTimeoutMs = normalizeOptionalTimeoutMs(input.defaultTimeoutMs);

  return async function fetchTransport(request): Promise<Response> {
    const timeoutMs =
      normalizeOptionalTimeoutMs(request.timeoutMs) ?? defaultTimeoutMs;
    const timeoutSignal =
      timeoutMs === undefined ? null : AbortSignal.timeout(timeoutMs);
    const composed = composeAbortSignals(request.init?.signal, timeoutSignal);

    try {
      return await input.fetch(request.url, {
        ...request.init,
        signal: composed.signal,
      });
    } catch (error) {
      if (timeoutSignal?.aborted && timeoutMs !== undefined) {
        throw createTimeoutError({
          operation: request.operation,
          timeoutMs,
          cause: error,
        });
      }
      if (shouldWrapNetworkRequestError(error)) {
        throw createNetworkRequestError({
          operation: request.operation,
          url: request.url,
          cause: error,
        });
      }
      throw error;
    } finally {
      composed.cleanup();
    }
  };
}

function createTimeoutError(input: {
  operation: string;
  timeoutMs: number;
  cause: unknown;
}): Error {
  const error = new Error(
    `${input.operation} request timed out after ${input.timeoutMs}ms`,
    { cause: input.cause }
  ) as Error & { code?: string };
  error.code = "network.timeout";
  return error;
}

function createNetworkRequestError(input: {
  operation: string;
  url: string;
  cause: unknown;
}): Error {
  const error = new Error(
    `${input.operation} request could not reach ${describeRequestTarget(input.url)} (${toErrorMessage(input.cause)})`,
    { cause: input.cause }
  ) as Error & { code?: string };
  error.code = "network.request_failed";
  return error;
}

function normalizeOptionalTimeoutMs(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("timeoutMs must be a finite positive number");
  }
  return Math.trunc(value);
}

function describeRequestTarget(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "request failed";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "request failed";
}

function shouldWrapNetworkRequestError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("network request failed")
  );
}

function composeAbortSignals(
  parent: AbortSignal | null | undefined,
  timeout: AbortSignal | null
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (!(parent || timeout)) {
    return {
      signal: undefined,
      cleanup: () => undefined,
    };
  }

  if (!parent) {
    return {
      signal: timeout ?? undefined,
      cleanup: () => undefined,
    };
  }

  if (!timeout) {
    return {
      signal: parent,
      cleanup: () => undefined,
    };
  }

  if (parent.aborted || timeout.aborted) {
    const controller = new AbortController();
    controller.abort();
    return {
      signal: controller.signal,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };

  parent.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      parent.removeEventListener("abort", abort);
      timeout.removeEventListener("abort", abort);
    },
  };
}
