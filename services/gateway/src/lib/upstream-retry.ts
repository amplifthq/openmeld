import { sleep } from "@openmeld/utils";

const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 90;

const TRANSIENT_UPSTREAM_PATTERNS = [
  "couldn't find a local dev session",
  "failed to call service",
  "service unavailable",
  "connection reset",
  "network error",
] as const;

type RetryOptions = {
  retries?: number;
  delayMs?: number;
};

export async function withUpstreamRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = normalizeRetryCount(options.retries);
  const delayMs = normalizeDelay(options.delayMs);

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isTransientUpstreamError(error)) {
        throw error;
      }
      attempt += 1;
      await (delayMs <= 0 ? Promise.resolve() : sleep(delayMs));
    }
  }
}

export function isTransientUpstreamError(error: unknown): boolean {
  const messages = collectErrorMessages(error);
  for (const message of messages) {
    const normalized = message.toLowerCase();
    if (
      TRANSIENT_UPSTREAM_PATTERNS.some((pattern) =>
        normalized.includes(pattern)
      )
    ) {
      return true;
    }
  }
  return false;
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  traverseErrorValue(error, messages, seen);

  return messages;
}

function traverseErrorValue(
  value: unknown,
  messages: string[],
  seen: Set<unknown>
): void {
  if (!value || seen.has(value)) {
    return;
  }
  seen.add(value);

  if (typeof value === "string") {
    messages.push(value);
    return;
  }

  if (value instanceof Error) {
    if (value.message) {
      messages.push(value.message);
    }
    const withCause = value as Error & { cause?: unknown };
    if (withCause.cause) {
      traverseErrorValue(withCause.cause, messages, seen);
    }
    return;
  }

  const linkedValues = readLinkedErrorValues(value);
  for (const linked of linkedValues) {
    traverseErrorValue(linked, messages, seen);
  }
}

function readLinkedErrorValues(value: unknown): unknown[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const maybe = value as {
    message?: unknown;
    error?: unknown;
    reason?: unknown;
  };

  const linked: unknown[] = [];
  if (typeof maybe.message === "string") {
    linked.push(maybe.message);
  }
  if (maybe.error) {
    linked.push(maybe.error);
  }
  if (maybe.reason) {
    linked.push(maybe.reason);
  }
  return linked;
}

function normalizeRetryCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RETRY_COUNT;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeDelay(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  return Math.max(0, Math.trunc(value));
}
