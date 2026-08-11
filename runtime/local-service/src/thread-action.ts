import type {
  OpenMeldDaemonTaskResultPayload,
  SpaceThreadContext,
} from "@openmeld/schemas/types";

type ThreadAwareEgressAction = Extract<
  NonNullable<OpenMeldDaemonTaskResultPayload["spaceAction"]>,
  { type: "post_message" | "post_status" }
>;

export function normalizeDispatchThreadAction(input: {
  action: ThreadAwareEgressAction;
  threadContext?: SpaceThreadContext | null;
}): ThreadAwareEgressAction {
  const requestedThreadId = normalizeOptionalText(
    input.action.thread?.threadId
  );
  const currentThreadId = normalizeOptionalText(input.threadContext?.threadId);
  if (currentThreadId) {
    if (requestedThreadId && requestedThreadId !== currentThreadId) {
      throw new Error(
        `structured action thread.threadId must match the current dispatch thread: ${currentThreadId}`
      );
    }
    return {
      ...input.action,
      thread: { threadId: currentThreadId },
    };
  }
  if (requestedThreadId) {
    throw new Error(
      "structured action thread is only allowed when the dispatch belongs to a thread"
    );
  }
  return input.action;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
