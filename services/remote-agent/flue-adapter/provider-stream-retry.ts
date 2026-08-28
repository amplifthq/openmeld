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

/**
 * Retries once only when a complete provider event stream proves that the model
 * produced no observable content or tool action. Any intermediate event is
 * forwarded immediately and permanently disables retry for that attempt.
 */
export function retryCompletedEmptyAssistantStreamOnce(input: {
  createAttempt: () => AssistantMessageEventStream;
  onRetry?: () => void;
  signal?: AbortSignal;
}): AssistantMessageEventStream {
  const firstAttempt = input.createAttempt();
  const output = createAssistantMessageEventStream();
  // biome-ignore lint/complexity/noVoid: Provider failures arrive as terminal events on the returned stream; this task only pumps events into it.
  void forwardCompletedEmptyAssistantRetry({
    ...input,
    firstAttempt,
    output,
  });
  return output;
}

async function forwardCompletedEmptyAssistantRetry(input: {
  createAttempt: () => AssistantMessageEventStream;
  firstAttempt: AssistantMessageEventStream;
  onRetry?: () => void;
  output: AssistantMessageEventStream;
  signal?: AbortSignal;
}): Promise<void> {
  const first = await forwardProviderAttempt({
    allowCompletedEmptyRetry: true,
    output: input.output,
    stream: input.firstAttempt,
  });
  if (first.kind === "forwarded") {
    return;
  }
  if (input.signal?.aborted) {
    for (const event of first.attempt.events) {
      input.output.push(event);
    }
    return;
  }
  input.onRetry?.();
  await forwardProviderAttempt({
    allowCompletedEmptyRetry: false,
    discardedUsage: first.attempt.message.usage,
    output: input.output,
    stream: input.createAttempt(),
  });
}

async function forwardProviderAttempt(input: {
  allowCompletedEmptyRetry: boolean;
  discardedUsage?: AssistantMessage["usage"];
  output: AssistantMessageEventStream;
  stream: AssistantMessageEventStream;
}): Promise<ForwardedAttempt> {
  let bufferedStart: AssistantMessageEvent | null = null;
  let eventCount = 0;
  for await (const sourceEvent of input.stream) {
    eventCount += 1;
    if (
      input.allowCompletedEmptyRetry &&
      eventCount === 1 &&
      sourceEvent.type === "start"
    ) {
      bufferedStart = sourceEvent;
      continue;
    }
    if (
      input.allowCompletedEmptyRetry &&
      isProvablyCompletedEmptyAssistantEvent(
        sourceEvent,
        eventCount,
        bufferedStart !== null
      )
    ) {
      return {
        attempt: {
          events: bufferedStart ? [bufferedStart, sourceEvent] : [sourceEvent],
          message: sourceEvent.message,
        },
        kind: "completed_empty",
      };
    }
    if (bufferedStart) {
      input.output.push(bufferedStart);
      bufferedStart = null;
    }
    input.output.push(
      input.discardedUsage
        ? mergeTerminalEventUsage(sourceEvent, input.discardedUsage)
        : sourceEvent
    );
  }
  if (bufferedStart) {
    input.output.push(bufferedStart);
  }
  return { kind: "forwarded" };
}

function isProvablyCompletedEmptyAssistantEvent(
  event: AssistantMessageEvent,
  eventCount: number,
  hadBufferedStart: boolean
): event is Extract<AssistantMessageEvent, { type: "done" }> {
  if (
    event.type !== "done" ||
    event.reason !== "stop" ||
    hasDeliverableAssistantContent(event.message)
  ) {
    return false;
  }
  return eventCount === 1 || (eventCount === 2 && hadBufferedStart);
}

function hasDeliverableAssistantContent(message: AssistantMessage): boolean {
  return message.content.some(
    (part) =>
      part.type === "toolCall" ||
      (part.type === "text" && part.text.trim().length > 0) ||
      (part.type === "thinking" && part.thinking.trim().length > 0)
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
