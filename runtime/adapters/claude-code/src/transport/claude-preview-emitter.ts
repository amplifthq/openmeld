import type {
  AdapterPreviewCallback,
  AdapterStreamingMode,
} from "@openmeld/adapter-core";

const PREVIEW_EMIT_MIN_VISIBLE_CHARS = 24;
const PREVIEW_EMIT_THROTTLE_MS = 500;

export type ClaudePreviewEmitter = {
  append: (deltaText: string) => string | null;
  readonly emitted: boolean;
  flush: () => Promise<void>;
};

export const createClaudePreviewEmitter = (input: {
  onPreview?: AdapterPreviewCallback;
  streamingMode?: AdapterStreamingMode;
}): ClaudePreviewEmitter => {
  if (!(input.onPreview && input.streamingMode === "stream")) {
    return {
      append: () => null,
      emitted: false,
      flush: async () => undefined,
    };
  }

  let currentPreviewText = "";
  let emitted = false;
  let lastEmittedAtMs = 0;
  let lastEmittedText = "";
  const pendingTasks = new Set<Promise<void>>();

  const queuePreview = (nextPreviewText: string): void => {
    emitted = true;
    lastEmittedAtMs = Date.now();
    lastEmittedText = nextPreviewText;
    const task = Promise.resolve(
      input.onPreview?.({
        text: nextPreviewText,
      })
    )
      .catch(() => undefined)
      .finally(() => {
        pendingTasks.delete(task);
      });
    pendingTasks.add(task);
  };

  return {
    append: (deltaText: string): string | null => {
      currentPreviewText += deltaText;
      const nextPreviewText = currentPreviewText.trim();
      if (!nextPreviewText || nextPreviewText === lastEmittedText) {
        return null;
      }

      const nowMs = Date.now();
      const grewEnough =
        nextPreviewText.length - lastEmittedText.length >=
        PREVIEW_EMIT_MIN_VISIBLE_CHARS;
      const addedNewLineBoundary =
        countVisibleLines(nextPreviewText) > countVisibleLines(lastEmittedText);
      if (
        lastEmittedText &&
        nowMs - lastEmittedAtMs < PREVIEW_EMIT_THROTTLE_MS
      ) {
        return nextPreviewText;
      }
      if (!(lastEmittedText === "" || grewEnough || addedNewLineBoundary)) {
        return nextPreviewText;
      }

      queuePreview(nextPreviewText);
      return nextPreviewText;
    },
    get emitted() {
      return emitted;
    },
    flush: async (): Promise<void> => {
      const finalPreviewText = currentPreviewText.trim();
      if (finalPreviewText && finalPreviewText !== lastEmittedText) {
        queuePreview(finalPreviewText);
      }
      await Promise.allSettled([...pendingTasks]);
    },
  };
};

const countVisibleLines = (value: string): number => {
  if (value.length === 0) {
    return 0;
  }
  return value.split("\n").length;
};
