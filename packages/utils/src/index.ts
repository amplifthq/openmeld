export type RetryWithBackoffOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryWithBackoffOptions = {}
): Promise<T> {
  const maxAttempts = normalizePositiveInteger(options.maxAttempts, 3);
  const initialDelayMs = normalizeNonNegativeInteger(
    options.initialDelayMs,
    100
  );
  const backoffFactor = normalizePositiveNumber(options.backoffFactor, 2);
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= maxAttempts ||
        options.shouldRetry?.(error, attempt) === false
      ) {
        throw error;
      }
      await sleep(delayMs);
      delayMs = Math.trunc(delayMs * backoffFactor);
    }
  }

  throw new Error("retryWithBackoff exhausted without returning or throwing");
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizePositiveNumber(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

// biome-ignore lint/performance/noBarrelFile: Public shared utility package entrypoint.
export { digestCanonicalJson, stringifyCanonicalJson } from "./canonical-json";
