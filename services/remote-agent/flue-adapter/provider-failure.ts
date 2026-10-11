import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  isContextOverflow,
  type Model,
} from "@earendil-works/pi-ai";
import { isRetryableAssistantError } from "@earendil-works/pi-ai/utils/retry";

// Flue 2.2.2 reads these tokens from errorMessage for agent-turn recovery.
// Keep only fixed vocabulary, never the matching free-text substring. Flue
// still owns the retry decision and budget; summary retry uses pi-ai below.
const RECOVERY_HINTS: readonly [RegExp, string][] = [
  [/overloaded/iu, "overloaded"],
  [/rate.?limit|too many requests/iu, "rate limit"],
  [/429/u, "429"],
  [/500/u, "500"],
  [/502/u, "502"],
  [/503/u, "503"],
  [/504/u, "504"],
  [/service.?unavailable/iu, "service unavailable"],
  [/server.?error/iu, "server error"],
  [/network.?error/iu, "network error"],
  [/connection.?reset/iu, "connection reset"],
  [/connection.?refused/iu, "connection refused"],
  [/connection.?lost/iu, "connection lost"],
  [/connection.?error/iu, "connection error"],
  [/socket hang up/iu, "socket hang up"],
  [/fetch failed/iu, "fetch failed"],
  [/timed? out|timeout/iu, "timeout"],
  [/terminated/iu, "terminated"],
  [
    /provider finish_reason:\s*error(?![-\w])/iu,
    "provider finish_reason: error",
  ],
  [/\(retryable_interruption\)/u, "(retryable_interruption)"],
];

// pi-ai excludes account limits from summary retries. Preserve only its fixed
// exclusion vocabulary when the original error actually contains it.
const LIMIT_HINTS: readonly [RegExp, string][] = [
  [/GoUsageLimitError/iu, "GoUsageLimitError"],
  [/FreeUsageLimitError/iu, "FreeUsageLimitError"],
  [/Monthly usage limit reached/iu, "Monthly usage limit reached"],
  [/available balance/iu, "available balance"],
  [/insufficient_quota/iu, "insufficient_quota"],
  [/out of budget/iu, "out of budget"],
  [/quota exceeded/iu, "quota exceeded"],
  [/billing/iu, "billing"],
];

/** Flue logs provider errorMessage before application observers run. Keep the
 * provider's failure/recovery contract, but do not give those SDK exits a body.
 */
export function projectRemoteAgentProviderFailure(
  message: AssistantMessage,
  input: { contextWindow: number; status?: number }
): AssistantMessage {
  if (message.stopReason !== "error" && message.stopReason !== "aborted") {
    return message;
  }
  let explanation = "Provider request failed.";
  const hints = RECOVERY_HINTS.filter(([pattern]) =>
    pattern.test(message.errorMessage ?? "")
  ).map(([, hint]) => hint);
  hints.push(
    ...LIMIT_HINTS.filter(([pattern]) =>
      pattern.test(message.errorMessage ?? "")
    ).map(([, hint]) => hint)
  );
  if (
    isRetryableAssistantError(message) &&
    !isRetryableAssistantError({ ...message, errorMessage: hints.join(", ") })
  ) {
    // This pi-ai marker preserves summary retries without adding a main-turn
    // retry trigger for failures that only pi-ai recognizes.
    hints.push("provider returned error");
  }
  if (message.stopReason === "aborted") {
    explanation = "Provider request was aborted.";
  } else if (
    message.errorMessage?.includes("(request_too_large)") ||
    isContextOverflow(message, input.contextWindow)
  ) {
    explanation =
      "Provider input exceeds the context window (request_too_large).";
  }
  const status =
    input.status &&
    input.status >= 400 &&
    input.status <= 599 &&
    message.errorMessage?.includes(String(input.status))
      ? `HTTP ${input.status}: `
      : "";
  return {
    ...message,
    // Keep call/submission IDs in the existing completion observation. Their
    // random digits must not become retry hints in SDK text classifiers.
    errorMessage: `${status}${explanation}${hints.length ? ` Classification: ${hints.join(", ")}.` : ""}`,
  };
}

/** Bound to one model request. Initial throws and iterator throws become the
 * same terminal provider failure as an error event; causes never escape to SDK logs.
 */
export function guardRemoteAgentProviderStream(input: {
  createAttempt: (
    fetch: typeof globalThis.fetch
  ) => AssistantMessageEventStream;
  fetch: typeof globalThis.fetch;
  model: Model<Api>;
}): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  let status: number | undefined;
  let partial: AssistantMessage | undefined;
  const requestFetch: typeof globalThis.fetch = async (...args) => {
    const response = await input.fetch(...args);
    status = response.status;
    return response;
  };
  const project = (message: AssistantMessage) =>
    projectRemoteAgentProviderFailure(message, {
      contextWindow: input.model.contextWindow,
      status,
    });
  // biome-ignore lint/complexity/noVoid: The task emits one terminal error event on failure, including synchronous initialization and asynchronous iteration.
  void (async () => {
    try {
      let terminal = false;
      for await (const event of input.createAttempt(requestFetch)) {
        if ("partial" in event) {
          partial = event.partial;
        }
        if (event.type === "error") {
          terminal = true;
          output.push({ ...event, error: project(event.error) });
        } else if (event.type === "done") {
          terminal = true;
          output.push({ ...event, message: project(event.message) });
        } else if ("partial" in event) {
          // Providers mutate their partial message later. Snapshot its fields
          // so a later raw errorMessage cannot reach an earlier SDK event.
          output.push({ ...event, partial: project({ ...event.partial }) });
        } else {
          output.push(event);
        }
      }
      if (!terminal) {
        throw new Error(
          "Provider stream ended before a terminal response event."
        );
      }
    } catch (error) {
      const message: AssistantMessage = {
        ...(partial ?? {
          role: "assistant",
          api: input.model.api,
          provider: input.model.provider,
          model: input.model.id,
          content: [],
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
        }),
        stopReason: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      output.push({ type: "error", reason: "error", error: project(message) });
    }
  })();
  return output;
}
