import type {
  AdapterReasoningEvent,
  AdapterRuntimeEvent,
  AdapterRuntimeEventCallback,
} from "@openmeld/adapter-core";
import { LOCAL_AGENT_REASONING_MAX_CHARS } from "@openmeld/schemas";

/** Keep private live content outside all lifecycle and journaling observers. */
export function routeReasoningEvents(
  reasoning: (event: AdapterReasoningEvent) => void,
  lifecycle: (
    event: Exclude<AdapterRuntimeEvent, AdapterReasoningEvent>
  ) => void
): AdapterRuntimeEventCallback {
  return (event) => {
    if (event.phase === "reasoning") {
      reasoning(event);
    } else {
      lifecycle(event);
    }
  };
}

/** A disposable live tail, deliberately independent of the result journal. */
export function createReasoningStream(input: {
  enabled: () => boolean;
  send: (snapshot: string, observedAtMs: number) => void;
}) {
  const blocks = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let observedAtMs = 0;
  let dirty = false;
  let disposed = false;
  const clear = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = undefined;
    blocks.clear();
    dirty = false;
  };
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = undefined;
    if (disposed || !input.enabled()) {
      clear();
      return;
    }
    if (!dirty) {
      return;
    }
    dirty = false;
    lastSentAt = Date.now();
    input.send(
      [...blocks.values()].join("\n\n").slice(-LOCAL_AGENT_REASONING_MAX_CHARS),
      observedAtMs
    );
  };
  return {
    clear,
    observe(event: AdapterReasoningEvent) {
      if (disposed || !input.enabled()) {
        clear();
        return;
      }
      if (!event.text) {
        return;
      }
      const previous = blocks.get(event.blockId) ?? "";
      const next = (
        event.mode === "snapshot" ? event.text : previous + event.text
      ).slice(-LOCAL_AGENT_REASONING_MAX_CHARS);
      if (next === previous) {
        return;
      }
      blocks.set(event.blockId, next);
      while (blocks.size > 8) {
        const oldest = blocks.keys().next().value;
        if (oldest !== undefined) {
          blocks.delete(oldest);
        }
      }
      dirty = true;
      observedAtMs = event.tsMs;
      const delay = Math.max(0, 100 - (Date.now() - lastSentAt));
      if (delay === 0) {
        flush();
      } else {
        timer ??= setTimeout(flush, delay);
      }
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
