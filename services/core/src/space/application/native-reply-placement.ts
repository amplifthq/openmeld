import type {
  NativeReplyPlacement,
  ResolveNativeReplyPlacementInput,
  SpaceThreadContext,
} from "@openmeld/schemas/types";

export function chooseNativeReplyPlacement(input: {
  request: ResolveNativeReplyPlacementInput;
  current: NativeReplyPlacement | null;
  directMessage: boolean;
  sourceThread: SpaceThreadContext | null;
}):
  | { current: NativeReplyPlacement }
  | { useThread: boolean; threadContext: SpaceThreadContext | null } {
  const { request, current, sourceThread } = input;
  if (
    current &&
    (current.sourceSignalId !== request.sourceSignalId ||
      current.profileId !== request.profileId)
  ) {
    throw new Error("space.reply_placement.identity_mismatch");
  }
  if (current?.locked) {
    const placement = current.threadContext ? "thread" : "conversation";
    if (request.placement && request.placement !== placement) {
      throw new Error("space.reply_placement.already_started");
    }
    return { current };
  }
  let useThread = Boolean(
    sourceThread || (request.defaultToThread && !input.directMessage)
  );
  if (current) {
    useThread = Boolean(current.threadContext);
  }
  if (request.placement) {
    useThread = request.placement === "thread";
  }
  return {
    useThread,
    threadContext: useThread
      ? (sourceThread ?? current?.threadContext ?? null)
      : null,
  };
}
