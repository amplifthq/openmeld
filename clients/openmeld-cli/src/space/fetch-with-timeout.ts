import {
  resolveSpaceRequestTimeoutMs,
  resolveSpaceRequestTimeoutMsForDiagnostics as resolveSpaceRequestTimeoutMsForCliDiagnostics,
} from "./request-timeout";

export async function fetchSpaceRequestWithTimeout(input: {
  url: string;
  operation: string;
  init?: RequestInit;
  timeoutMs?: number;
}): Promise<Response> {
  const timeoutMs = resolveSpaceRequestTimeoutMs(input.timeoutMs);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const composed = composeAbortSignals(input.init?.signal, timeoutSignal);

  try {
    try {
      return await fetch(input.url, {
        ...input.init,
        signal: composed.signal,
      });
    } catch (error) {
      // A keep-alive connection that a proxy silently dropped fails exactly
      // once and undici evicts it; the retry rides a fresh connection. This
      // is what keeps a long-lived service working behind flaky proxies
      // without asking users to touch their network config.
      if (
        timeoutSignal.aborted ||
        composed.signal.aborted ||
        !shouldWrapNetworkRequestError(error)
      ) {
        throw error;
      }
      return await fetch(input.url, {
        ...input.init,
        signal: composed.signal,
      });
    }
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw createSpaceRequestTimeoutError({
        operation: input.operation,
        timeoutMs,
        cause: error,
      });
    }
    if (shouldWrapNetworkRequestError(error)) {
      throw createSpaceRequestNetworkError({
        operation: input.operation,
        url: input.url,
        cause: error,
      });
    }
    throw error;
  } finally {
    composed.cleanup();
  }
}

export function resolveSpaceRequestTimeoutMsForDiagnostics(): number {
  return resolveSpaceRequestTimeoutMsForCliDiagnostics();
}

function createSpaceRequestTimeoutError(input: {
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

function createSpaceRequestNetworkError(input: {
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

function composeAbortSignals(
  parent: AbortSignal | null | undefined,
  timeout: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  if (!parent) {
    return {
      signal: timeout,
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
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("ERR_SSL_")
  ) {
    return true;
  }
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("ssl_decryption_failed_or_bad_record_mac")
  );
}
