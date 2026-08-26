import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  attachAgentReplyObservation,
  buildAgentReplyReconsiderationPrompt,
  coordinateDispatchAgentReply,
  resolveDispatchAgentReplyObservation,
} from "../src/local-service/dispatch/dispatch-agent-reply-observation";

describe("dispatch Agent reply observation", () => {
  it("advances through relevant public collaboration messages only", () => {
    const relevant = textSignal({ id: "signal-agent-reply", text: "1" });
    const failed = systemNotice({
      actorProfileId: FAILED_AGENT_PROFILE_ID,
      id: "signal-agent-failed",
      noticeType: "terminal_failure",
      text: "Cursor stopped because its usage limit was reached.",
    });
    const humanUpdate = textSignal({
      id: "signal-human-update",
      kind: "human",
      profileId: "prf_human_felix",
      text: "Please prioritize the failure-safe result.",
    });
    const sameAgentOtherWake = textSignal({
      id: "signal-same-agent-other-wake",
      replyToSignalId: "signal-other-source",
      text: "Output for another Wake",
    });
    const observation = resolveDispatchAgentReplyObservation({
      candidates: [
        systemNotice({ id: "signal-working" }),
        textSignal({ id: "signal-preview", text: "draft", transient: true }),
        textSignal({
          id: "signal-unrelated-agent",
          profileId: UNRELATED_AGENT_PROFILE_ID,
          text: "Unrelated task output",
        }),
        humanUpdate,
        failed,
        relevant,
        sameAgentOtherWake,
      ],
      currentWakeTargetProfileIds: [AGENT_PROFILE_ID, FAILED_AGENT_PROFILE_ID],
      sourceSignalId: "signal-source",
    });

    expect(observation).toEqual({
      observedThroughSignalId: sameAgentOtherWake.id,
      relevantSignals: [humanUpdate, failed, relevant],
      status: "changed",
    });
  });

  it("treats sibling final outcomes from the same multi-target Wake as collaboration context", () => {
    const siblingReply = textSignal({
      final: true,
      id: "signal-sibling-reply",
      profileId: FAILED_AGENT_PROFILE_ID,
      text: "Sibling reply",
    });
    const siblingStatus = statusSignal({
      actorProfileId: FAILED_AGENT_PROFILE_ID,
      id: "signal-sibling-status",
    });
    const siblingFailure = systemNotice({
      actorProfileId: FAILED_AGENT_PROFILE_ID,
      id: "signal-sibling-failed",
      noticeType: "terminal_failure",
    });

    expect(
      resolveDispatchAgentReplyObservation({
        candidates: [siblingReply, siblingStatus, siblingFailure],
        currentWakeTargetProfileIds: [
          AGENT_PROFILE_ID,
          FAILED_AGENT_PROFILE_ID,
        ],
        sourceSignalId: "signal-source",
      })
    ).toEqual({
      observedThroughSignalId: siblingFailure.id,
      relevantSignals: [siblingReply, siblingStatus, siblingFailure],
      status: "changed",
    });
  });

  it("advances the safety cursor without adding irrelevant model context", () => {
    expect(
      resolveDispatchAgentReplyObservation({
        candidates: [systemNotice({ id: "signal-working" })],
        sourceSignalId: "signal-source",
      })
    ).toEqual({
      observedThroughSignalId: "signal-working",
      relevantSignals: [],
      status: "current",
    });
  });

  it("attaches the observation only to public message actions", () => {
    expect(
      attachAgentReplyObservation({
        action: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            text: "2",
          },
        },
        observedThroughSignalId: "signal-agent-reply",
      })
    ).toMatchObject({
      observedThroughSignalId: "signal-agent-reply",
      type: "post_message",
    });
    expect(
      attachAgentReplyObservation({
        action: { type: "stay_silent", reason: "Already handled." },
        observedThroughSignalId: "signal-agent-reply",
      })
    ).toEqual({ type: "stay_silent", reason: "Already handled." });
  });

  it("builds a provider-neutral reconsideration prompt without rerunning work", () => {
    const prompt = buildAgentReplyReconsiderationPrompt({
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "1",
        },
      },
      relevantSignals: [textSignal({ id: "signal-agent-reply", text: "1" })],
      spaceId: "space-1",
    });

    expect(prompt).toContain("Do not redo completed work");
    expect(prompt).toContain("Avoid duplicating work");
    expect(prompt).toContain("is an unpublished proposal");
    expect(prompt).toContain("does not mean the Space published it");
    expect(prompt).toContain("You still have one public reply available");
    expect(prompt).toContain("Keep the user's full request as the goal");
    expect(prompt).toContain(
      "only when no distinct, useful, non-duplicative contribution remains"
    );
    expect(prompt).toContain(
      "Call exactly one dispatch-scoped OpenMeld Space Action tool for the final action. Use the CLI only if the tool is unavailable."
    );
    expect(prompt).toContain('"signalId":"signal-agent-reply"');
    expect(prompt).not.toContain("Codex");
    expect(prompt).not.toContain("Cursor");
  });

  it("states terminal outcomes as facts rather than peer contributions", () => {
    const prompt = buildAgentReplyReconsiderationPrompt({
      action: postMessageAction("My proposed contribution"),
      relevantSignals: [
        systemNotice({
          actorProfileId: FAILED_AGENT_PROFILE_ID,
          id: "signal-agent-failed",
          noticeType: "terminal_failure",
          text: "Cursor stopped because its usage limit was reached.",
        }),
      ],
      spaceId: "space-1",
    });

    expect(prompt).toContain('"outcome":"failed"');
    expect(prompt).toContain('"actorProfileId"');
    expect(prompt).toContain(
      "A failed, stopped, or silent outcome is not a public contribution"
    );
    expect(prompt).not.toContain('"outcome":"contribution"');
  });

  it("reconsiders exactly once in the same caller-owned session when context changed", async () => {
    const reconsider = vi.fn(async (_prompt: string) => ({
      action: {
        type: "post_message" as const,
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "2",
        },
      },
      value: { conversationId: "same-session-1" },
    }));
    const result = await coordinateDispatchAgentReply({
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "1",
        },
      },
      currentValue: { conversationId: "same-session-1" },
      observation: {
        observedThroughSignalId: "signal-agent-reply",
        relevantSignals: [textSignal({ id: "signal-agent-reply", text: "1" })],
        status: "changed",
      },
      reconsider,
      spaceId: "space-1",
    });

    expect(reconsider).toHaveBeenCalledOnce();
    expect(reconsider.mock.calls[0]?.[0]).toContain("Newer Space messages");
    expect(result).toMatchObject({
      action: {
        messageEnvelope: { text: "2" },
        observedThroughSignalId: "signal-agent-reply",
      },
      reconsidered: true,
      value: { conversationId: "same-session-1" },
    });
  });

  it("preserves a failed reconsideration instead of replacing it with a missing-action error", async () => {
    type ReconsiderationState = {
      errorCode?: string;
      status: "failed" | "success";
    };
    const reconsider = vi.fn(
      async (): Promise<{
        action: undefined;
        value: ReconsiderationState;
      }> => ({
        action: undefined,
        value: {
          errorCode: "provider.request_failed",
          status: "failed",
        },
      })
    );

    const result = await coordinateDispatchAgentReply({
      action: postMessageAction("Before peer reply"),
      currentValue: { status: "success" } as ReconsiderationState,
      observation: changedObservation("signal-peer-1"),
      reconsider,
      spaceId: "space-1",
    });

    expect(reconsider).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      action: undefined,
      reconsiderationCount: 1,
      reconsidered: true,
      value: {
        errorCode: "provider.request_failed",
        status: "failed",
      },
    });
  });

  it("rechecks the Space and reconsiders a second time when collaboration keeps changing", async () => {
    const firstPeerResult = textSignal({ id: "signal-peer-1", text: "A" });
    const secondPeerResult = textSignal({ id: "signal-peer-2", text: "B" });
    const reconsider = vi
      .fn()
      .mockResolvedValueOnce({
        action: postMessageAction("After A"),
        value: { conversationId: "same-session-1" },
      })
      .mockResolvedValueOnce({
        action: postMessageAction("After A and B"),
        value: { conversationId: "same-session-1" },
      });
    const refreshObservation = vi
      .fn()
      .mockResolvedValueOnce({
        observedThroughSignalId: secondPeerResult.id,
        relevantSignals: [secondPeerResult],
        status: "changed" as const,
      })
      .mockResolvedValueOnce({
        observedThroughSignalId: secondPeerResult.id,
        relevantSignals: [],
        status: "current" as const,
      });

    const result = await coordinateDispatchAgentReply({
      action: postMessageAction("Before peers"),
      currentValue: { conversationId: "same-session-1" },
      observation: {
        observedThroughSignalId: firstPeerResult.id,
        relevantSignals: [firstPeerResult],
        status: "changed",
      },
      reconsider,
      refreshObservation,
      spaceId: "space-1",
    });

    expect(reconsider).toHaveBeenCalledTimes(2);
    expect(refreshObservation).toHaveBeenNthCalledWith(1, firstPeerResult.id);
    expect(refreshObservation).toHaveBeenNthCalledWith(2, secondPeerResult.id);
    expect(result).toMatchObject({
      action: {
        messageEnvelope: { text: "After A and B" },
        observedThroughSignalId: secondPeerResult.id,
      },
      reconsiderationCount: 2,
      reconsidered: true,
    });
  });

  it("keeps reviewing bounded deltas beyond two changes until the Space is current", async () => {
    const reconsider = vi.fn(async () => ({
      action: postMessageAction("Reviewed latest collaboration context"),
      value: { conversationId: "same-session-1" },
    }));
    const refreshObservation = vi
      .fn()
      .mockResolvedValueOnce(changedObservation("signal-peer-2"))
      .mockResolvedValueOnce(changedObservation("signal-peer-3"))
      .mockResolvedValueOnce(changedObservation("signal-peer-4"))
      .mockResolvedValueOnce({
        observedThroughSignalId: "signal-peer-4",
        relevantSignals: [],
        status: "current" as const,
      });

    const result = await coordinateDispatchAgentReply({
      action: postMessageAction("Before peers"),
      currentValue: { conversationId: "same-session-1" },
      observation: changedObservation("signal-peer-1"),
      reconsider,
      refreshObservation,
      spaceId: "space-1",
    });

    expect(reconsider).toHaveBeenCalledTimes(4);
    expect(refreshObservation).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      action: {
        messageEnvelope: {
          text: "Reviewed latest collaboration context",
        },
        observedThroughSignalId: "signal-peer-4",
        type: "post_message",
      },
      reconsiderationCount: 4,
      reconsidered: true,
    });
  });
});

function changedObservation(signalId: string) {
  const signal = textSignal({ id: signalId, text: signalId });
  return {
    observedThroughSignalId: signalId,
    relevantSignals: [signal],
    status: "changed" as const,
  };
}

function postMessageAction(text: string) {
  return {
    type: "post_message" as const,
    messageEnvelope: {
      activationTargets: [],
      referenceTargets: [],
      text,
    },
  };
}

function textSignal(input: {
  final?: boolean;
  id: string;
  kind?: "agent" | "human";
  profileId?: string;
  replyToSignalId?: string;
  text: string;
  transient?: boolean;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    profile: {
      kind: input.kind ?? "agent",
      profileId: input.profileId ?? AGENT_PROFILE_ID,
      profileName: "Agent",
    },
    spaceId: "space-1",
    ts: 1,
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.kind === "human"
        ? {}
        : {
            replyTo: replyToSource(input.replyToSignalId ?? "signal-source"),
          }),
      ...(input.transient ? { meta: { transient: true } } : {}),
      ...(input.final
        ? {
            meta: {
              dispatchId: "dispatch-1",
              purpose: "agent_reply_final",
              targetProfileId: input.profileId ?? AGENT_PROFILE_ID,
            },
          }
        : {}),
    },
  };
}

function statusSignal(input: {
  actorProfileId: string;
  id: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    profile: {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld",
    },
    spaceId: "space-1",
    ts: 1,
    type: "signal.status",
    data: {
      actorProfileId: input.actorProfileId,
      dispatchId: "dispatch-1",
      generatedBy: "openmeld",
      replyTo: replyToSource("signal-source"),
      status: "done",
      text: "Done",
    },
  };
}

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const FAILED_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const UNRELATED_AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

function systemNotice(input: {
  actorProfileId?: string;
  id: string;
  noticeType?: "execution_recovery_available" | "terminal_failure";
  text?: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    profile: {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld",
    },
    spaceId: "space-1",
    ts: 1,
    type: "signal.system_notice",
    data: {
      ...(input.actorProfileId ? { actorProfileId: input.actorProfileId } : {}),
      dispatchId: "dispatch-1",
      generatedBy: "openmeld",
      noticeType: input.noticeType ?? "execution_recovery_available",
      replyTo: replyToSource("signal-source"),
      resultRef: "result-1",
      text: input.text ?? "Agent is working",
    },
  };
}

function replyToSource(signalId: string) {
  return {
    profileId: "prf_human_felix",
    profileKind: "human" as const,
    profileName: "Felix",
    previewText: "Original Wake",
    signalId,
  };
}
