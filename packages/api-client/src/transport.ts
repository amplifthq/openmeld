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
  // Fetch is an injected callable, not a method of this options object.
  // Worker globals reject that accidental receiver; explicitly bound callers
  // must also retain their own receiver.
  const fetchImpl = input.fetch;

  return async function fetchTransport(request): Promise<Response> {
    const timeoutMs =
      normalizeOptionalTimeoutMs(request.timeoutMs) ?? defaultTimeoutMs;
    const timeoutSignal =
      timeoutMs === undefined ? null : AbortSignal.timeout(timeoutMs);
    const signals = [request.init?.signal, timeoutSignal].filter(
      (signal): signal is AbortSignal => signal != null
    );
    // Keep cancellation alive through response-body consumption, which happens
    // after fetch resolves. Removing listeners at the headers boundary can
    // otherwise leave a partially received admission snapshot waiting forever.
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    try {
      return await fetchImpl(request.url, {
        ...request.init,
        signal,
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
