import type { FeishuGroupHistoryResult } from "@openmeld/schemas";

function utc(value: number | null) {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Model-visible timestamps are rendered from provider milliseconds, not inferred. */
export function presentFeishuHistory(result: FeishuGroupHistoryResult) {
  if (result.status !== "read") {
    return result;
  }
  return {
    ...result,
    startUtc: utc(result.startMs),
    endUtc: utc(result.endMs),
    ...(result.coverage
      ? {
          coverage: {
            ...result.coverage,
            examinedFromUtc: utc(result.coverage.examinedFromMs),
          },
        }
      : {}),
    context: {
      ...result.context,
      messages: result.context.messages.map((message) => ({
        ...message,
        sentAtUtc: utc(message.sentAtMs),
      })),
    },
  };
}
