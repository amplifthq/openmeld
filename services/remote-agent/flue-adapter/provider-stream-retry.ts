import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";

type CompletedEmptyAttempt = {
  events: AssistantMessageEvent[];
  message: AssistantMessage;
};

type ForwardedAttempt =
  | { kind: "completed_empty"; attempt: CompletedEmptyAttempt }
  | { kind: "forwarded" };

export type ProviderAttemptCompletion = {
  attemptNo: 1 | 2;
  durationMs: number;
  event: Extract<AssistantMessageEvent, { type: "done" | "error" }>;
};

type CompletionObserver = (completion: ProviderAttemptCompletion) => void;

/**
 * Retries once only when a complete provider event stream proves that the model
 * produced no visible text or tool action. Invisible events are buffered within
 * a fixed bound; visible output, tools, cancellation, and exhausted budgets are
 * never replayed. The caller retains the same inference context and tool results.
 */
export function retryCompletedEmptyAssistantStreamOnce(input: {
  createAttempt: () => AssistantMessageEventStream;
  onRetry?: () => void;
  onCompletion?: CompletionObserver;
  signal?: AbortSignal;
}): AssistantMessageEventStream {
  const startedAtMs = Date.now();
  const firstAttempt = input.createAttempt();
  const output = createAssistantMessageEventStream();
  // biome-ignore lint/complexity/noVoid: Provider failures arrive as terminal events on the returned stream; this task only pumps events into it.
  void forwardCompletedEmptyAssistantRetry({
    ...input,
    firstAttempt,
    output,
    startedAtMs,
  });
  return output;
}

async function forwardCompletedEmptyAssistantRetry(input: {
  createAttempt: () => AssistantMessageEventStream;
  firstAttempt: AssistantMessageEventStream;
  onRetry?: () => void;
  onCompletion?: CompletionObserver;
  output: AssistantMessageEventStream;
  signal?: AbortSignal;
  startedAtMs: number;
}): Promise<void> {
  const first = await forwardProviderAttempt({
    allowCompletedEmptyRetry: true,
    attemptNo: 1,
    onCompletion: input.onCompletion,
    startedAtMs: input.startedAtMs,
    output: input.output,
    stream: input.firstAttempt,
  });
  if (first.kind === "forwarded") {
    return;
  }
  if (input.signal?.aborted || Date.now() - input.startedAtMs >= 120_000) {
    for (const event of first.attempt.events) {
      input.output.push(event);
    }
    return;
  }
  input.onRetry?.();
  const startedAtMs = Date.now();
  await forwardProviderAttempt({
    allowCompletedEmptyRetry: false,
    attemptNo: 2,
    onCompletion: input.onCompletion,
    startedAtMs,
    discardedUsage: first.attempt.message.usage,
    output: input.output,
    stream: input.createAttempt(),
  });
}

async function forwardProviderAttempt(input: {
  allowCompletedEmptyRetry: boolean;
  attemptNo: 1 | 2;
  onCompletion?: CompletionObserver;
  startedAtMs: number;
  discardedUsage?: AssistantMessage["usage"];
  output: AssistantMessageEventStream;
  stream: AssistantMessageEventStream;
}): Promise<ForwardedAttempt> {
  const bufferedEvents: AssistantMessageEvent[] = [];
  let bufferedChars = 0;
  let retryEligible = input.allowCompletedEmptyRetry;
  for await (const sourceEvent of input.stream) {
    const deltaChars = eventDeltaLength(sourceEvent);
    // Observe the source terminal event before retry suppression or usage merging.
    // Reporting cannot prevent a reply or turn a success into a Wake failure.
    if (sourceEvent.type === "done" || sourceEvent.type === "error") {
      observeCompletion(input.onCompletion, {
        attemptNo: input.attemptNo,
        durationMs: Math.max(0, Date.now() - input.startedAtMs),
        event: sourceEvent,
      });
    }
    if (
      retryEligible &&
      isInvisibleAssistantEvent(sourceEvent) &&
      bufferedEvents.length < 256 &&
      bufferedChars + deltaChars <= 65_536
    ) {
      bufferedEvents.push(sourceEvent);
      bufferedChars += deltaChars;
      continue;
    }
    if (retryEligible && isProvablyCompletedEmptyAssistantEvent(sourceEvent)) {
      return {
        attempt: {
          events: [...bufferedEvents, sourceEvent],
          message: sourceEvent.message,
        },
        kind: "completed_empty",
      };
    }
    retryEligible = false;
    for (const event of bufferedEvents) {
      input.output.push(event);
    }
    bufferedEvents.length = 0;
    input.output.push(
      input.discardedUsage
        ? mergeTerminalEventUsage(sourceEvent, input.discardedUsage)
        : sourceEvent
    );
  }
  for (const event of bufferedEvents) {
    input.output.push(event);
  }
  return { kind: "forwarded" };
}

function eventDeltaLength(event: AssistantMessageEvent): number {
  return "delta" in event ? event.delta.length : 0;
}

function observeCompletion(
  observer: CompletionObserver | undefined,
  completion: ProviderAttemptCompletion
): void {
  try {
    observer?.(completion);
  } catch {
    console.error("[remote_agent.provider.completion_observation_failed]");
  }
}

function isProvablyCompletedEmptyAssistantEvent(
  event: AssistantMessageEvent
): event is Extract<AssistantMessageEvent, { type: "done" }> {
  if (
    event.type !== "done" ||
    event.reason !== "stop" ||
    (event.message.rawStopReason !== undefined &&
      event.message.rawStopReason !== "stop") ||
    hasDeliverableAssistantContent(event.message)
  ) {
    return false;
  }
  return true;
}

function isInvisibleAssistantEvent(event: AssistantMessageEvent): boolean {
  if (!("partial" in event) || hasDeliverableAssistantContent(event.partial)) {
    return false;
  }
  return (
    event.type === "start" ||
    event.type.startsWith("thinking_") ||
    (event.type.startsWith("text_") &&
      !("delta" in event && event.delta.trim()))
  );
}

function hasDeliverableAssistantContent(message: AssistantMessage): boolean {
  return message.content.some(
    (part) =>
      part.type === "toolCall" ||
      (part.type === "text" && part.text.trim().length > 0)
  );
}

function mergeTerminalEventUsage(
  event: AssistantMessageEvent,
  discardedUsage: AssistantMessage["usage"]
): AssistantMessageEvent {
  if (event.type === "done") {
    return {
      ...event,
      message: {
        ...event.message,
        usage: mergeUsage(discardedUsage, event.message.usage),
      },
    };
  }
  if (event.type === "error") {
    return {
      ...event,
      error: {
        ...event.error,
        usage: mergeUsage(discardedUsage, event.error.usage),
      },
    };
  }
  return event;
}

function mergeUsage(
  discarded: AssistantMessage["usage"],
  delivered: AssistantMessage["usage"]
): AssistantMessage["usage"] {
  return {
    cacheRead: discarded.cacheRead + delivered.cacheRead,
    cacheWrite: discarded.cacheWrite + delivered.cacheWrite,
    ...(discarded.cacheWrite1h !== undefined ||
    delivered.cacheWrite1h !== undefined
      ? {
          cacheWrite1h:
            (discarded.cacheWrite1h ?? 0) + (delivered.cacheWrite1h ?? 0),
        }
      : {}),
    cost: {
      cacheRead: discarded.cost.cacheRead + delivered.cost.cacheRead,
      cacheWrite: discarded.cost.cacheWrite + delivered.cost.cacheWrite,
      input: discarded.cost.input + delivered.cost.input,
      output: discarded.cost.output + delivered.cost.output,
      total: discarded.cost.total + delivered.cost.total,
    },
    input: discarded.input + delivered.input,
    output: discarded.output + delivered.output,
    ...(discarded.reasoning !== undefined || delivered.reasoning !== undefined
      ? { reasoning: (discarded.reasoning ?? 0) + (delivered.reasoning ?? 0) }
      : {}),
    totalTokens: discarded.totalTokens + delivered.totalTokens,
  };
}
