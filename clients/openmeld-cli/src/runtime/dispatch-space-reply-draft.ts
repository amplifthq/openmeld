import { setTimeout as delay } from "node:timers/promises";
import {
  type DispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
} from "./dispatch-space-action-context";

/** Observe only explicitly public, durably recorded action text. Native output
 * is deliberately not an input: collaboration-mode output can be private. */
export function startDispatchSpaceReplyDraft(input: {
  context: DispatchSpaceActionContext;
  publish: (
    textSnapshot: string,
    placement?: "conversation" | "thread"
  ) => boolean;
  onError: (error: unknown) => void;
  pollIntervalMs?: number;
}): { close: () => Promise<void> } {
  const abort = new AbortController();
  let lastText: string | null = null;
  let lastSentAtMs = 0;
  let lastPlacement: "conversation" | "thread" | undefined;
  let reportedError = false;
  const drain = () => {
    const result = readDispatchSpaceActionRecord({ context: input.context });
    if (
      result.status !== "loaded" ||
      result.record.action.type !== "post_message"
    ) {
      return;
    }
    // The existing stream snapshot is bounded. The final action still carries
    // the complete message, including files and recipient semantics.
    const text = result.record.action.messageEnvelope.text.slice(0, 32 * 1024);
    if (
      text === lastText &&
      result.record.action.placement === lastPlacement &&
      Date.now() - lastSentAtMs < 5000
    ) {
      return;
    }
    if (input.publish(text, result.record.action.placement)) {
      lastText = text;
      lastPlacement = result.record.action.placement;
      lastSentAtMs = Date.now();
    }
  };
  const loop = (async () => {
    while (!abort.signal.aborted) {
      try {
        drain();
        reportedError = false;
      } catch (error) {
        if (!reportedError) {
          input.onError(error);
          reportedError = true;
        }
      }
      try {
        await delay(input.pollIntervalMs ?? 100, undefined, {
          signal: abort.signal,
        });
      } catch (error) {
        if (!abort.signal.aborted) {
          throw error;
        }
      }
    }
  })();
  return {
    close: async () => {
      abort.abort();
      await loop;
    },
  };
}
