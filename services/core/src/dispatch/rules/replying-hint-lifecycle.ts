export type ReplyingHintEmissionState =
  | "emitted"
  | "already_active"
  | "claim_failed"
  | "emit_failed";

export type ReplyingHintTransition =
  | "preserve"
  | "clear_for_terminal_reply"
  | "replace_with_activity";

export type ReplyingHintTransitionHint = Extract<
  ReplyingHintTransition,
  "clear_for_terminal_reply"
>;

export const resolveReplyingHintActivationState = (input: {
  replyingHintActive: boolean;
  replyingHintEmissionState: ReplyingHintEmissionState;
}): boolean => {
  return (
    input.replyingHintActive ||
    input.replyingHintEmissionState === "emitted" ||
    input.replyingHintEmissionState === "already_active"
  );
};

export const resolveReplyingHintFinalizeDecision = (input: {
  replyingHintActive: boolean;
  transition: ReplyingHintTransition;
}): {
  nextReplyingHintActive: boolean;
  shouldEmitReplyingHintEnd: boolean;
} => {
  switch (input.transition) {
    case "preserve":
      return {
        nextReplyingHintActive: input.replyingHintActive,
        shouldEmitReplyingHintEnd: false,
      };
    case "clear_for_terminal_reply":
      return {
        nextReplyingHintActive: false,
        shouldEmitReplyingHintEnd: input.replyingHintActive,
      };
    case "replace_with_activity":
      return {
        nextReplyingHintActive: false,
        shouldEmitReplyingHintEnd: false,
      };
    default: {
      const unexpectedTransition: never = input.transition;
      throw new Error(
        `unsupported replying hint transition: ${String(unexpectedTransition)}`
      );
    }
  }
};
