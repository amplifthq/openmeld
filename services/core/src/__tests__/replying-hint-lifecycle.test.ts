import { describe, expect, it } from "vitest";
import {
  resolveReplyingHintActivationState,
  resolveReplyingHintFinalizeDecision,
} from "../dispatch/rules/replying-hint-lifecycle";

describe("replying hint lifecycle", () => {
  it("treats an already-active hint as active without claiming local ownership", () => {
    expect(
      resolveReplyingHintActivationState({
        replyingHintActive: false,
        replyingHintEmissionState: "already_active",
      })
    ).toBe(true);
  });

  it("keeps active replying hints during preserve transitions", () => {
    expect(
      resolveReplyingHintFinalizeDecision({
        replyingHintActive: true,
        transition: "preserve",
      })
    ).toEqual({
      nextReplyingHintActive: true,
      shouldEmitReplyingHintEnd: false,
    });
  });

  it("emits replying end only for terminal reply clears", () => {
    expect(
      resolveReplyingHintFinalizeDecision({
        replyingHintActive: true,
        transition: "clear_for_terminal_reply",
      })
    ).toEqual({
      nextReplyingHintActive: false,
      shouldEmitReplyingHintEnd: true,
    });
  });

  it("lets replacement activity take over without emitting replying end", () => {
    expect(
      resolveReplyingHintFinalizeDecision({
        replyingHintActive: true,
        transition: "replace_with_activity",
      })
    ).toEqual({
      nextReplyingHintActive: false,
      shouldEmitReplyingHintEnd: false,
    });
  });
});
