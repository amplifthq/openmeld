import type { SpaceThreadContext } from "@openmeld/schemas/types";

type SpaceDispatchContinuityRecord = {
  sourceEventId: string;
  spaceId: string;
  targetProfileId: string;
  threadContext?: SpaceThreadContext;
};

export type SpaceDispatchConversationContinuityScope =
  | { kind: "main" }
  | { kind: "thread"; threadContext: SpaceThreadContext };

export function resolveSpaceDispatchConversationContinuityScope(input: {
  dispatch: SpaceDispatchContinuityRecord | null;
  readSourceThreadId: (sourceSignalId: string) => string | null;
  readThreadRootSignalId: (threadId: string) => string | null;
  sourceSignalId: string;
  spaceId: string;
  targetProfileId: string;
}):
  | { ok: true; scope: SpaceDispatchConversationContinuityScope }
  | {
      code:
        | "space.continuity.dispatch_not_found"
        | "space.continuity.thread_mismatch";
      ok: false;
    } {
  const dispatch = input.dispatch;
  if (
    !dispatch ||
    dispatch.spaceId !== input.spaceId ||
    dispatch.sourceEventId !== input.sourceSignalId ||
    dispatch.targetProfileId !== input.targetProfileId
  ) {
    return { code: "space.continuity.dispatch_not_found", ok: false };
  }
  if (!dispatch.threadContext) {
    return { ok: true, scope: { kind: "main" } };
  }
  const { rootSignalId, threadId } = dispatch.threadContext;
  if (
    input.readThreadRootSignalId(threadId) !== rootSignalId ||
    input.readSourceThreadId(input.sourceSignalId) !== threadId
  ) {
    return { code: "space.continuity.thread_mismatch", ok: false };
  }
  return {
    ok: true,
    scope: {
      kind: "thread",
      threadContext: dispatch.threadContext,
    },
  };
}
