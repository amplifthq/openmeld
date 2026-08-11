import { MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH } from "@openmeld/schemas";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { buildDefaultSpaceContract } from "@openmeld/space-mesh";
import { describe, expect, it } from "vitest";
import {
  buildDispatchResultRecord,
  resolveDispatchPublicationPlan,
} from "../dispatch/application/dispatch-publication-policy";

function createDispatchMessage(input?: {
  publicationMode?: "collaboration" | "raw_context_sharing";
  allowedActions?: Array<"post_message" | "post_status" | "stay_silent">;
  replyToSnapshot?: OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"];
  threadContext?: OpenMeldDaemonDispatchQueueMessage["threadContext"];
}): OpenMeldDaemonDispatchQueueMessage {
  const contract = buildDefaultSpaceContract();
  return {
    spaceContractSnapshot: {
      ...contract,
      ...(input?.publicationMode
        ? { publicationMode: input.publicationMode }
        : {}),
      ...(input?.allowedActions
        ? { allowedActions: input.allowedActions }
        : {}),
    },
    ...(input?.replyToSnapshot
      ? { replyToSnapshot: input.replyToSnapshot }
      : {}),
    ...(input?.threadContext ? { threadContext: input.threadContext } : {}),
  } as OpenMeldDaemonDispatchQueueMessage;
}

const THREAD_CONTEXT = {
  threadId: "thr_11111111-1111-4111-8111-111111111111",
  rootSignalId: "sig-root-1",
} as const;
const PROVIDER_CREDITS_COPY =
  "The model provider rejected this request because the provider account does not have enough credits. Add credits or update billing directly with the provider, then wake the agent again.";
const PROVIDER_RATE_LIMIT_COPY =
  "The model provider rate-limited this request. Wait a moment, then wake the agent again.";
const CURSOR_MODEL_INVENTORY_UNAVAILABLE_COPY =
  "Cursor couldn't confirm which models are available right now. Try waking the agent again.";
const malformedReplyCopy = (targetName: string) =>
  `${targetName} answered in its local conversation, but it did not tell OpenMeld whether to post a message or stay silent, so nothing was posted.`;

describe("dispatch publication policy", () => {
  it.each([
    [
      "project.local_connection.missing",
      "Research Agent couldn’t start because its Project isn’t connected on the computer that runs it. Connect that Project on the Agent’s computer, then try again.",
    ],
    [
      "project.local_connection.folder_missing",
      "Research Agent couldn’t start because its Project folder is no longer available on the computer that runs it. Reconnect the folder in Projects, then try again.",
    ],
  ] as const)("publishes server-owned Project failure text for %s", (reasonCode, text) => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "Research Agent",
      dispatchMessage: createDispatchMessage(),
      payload: {
        errorCode: reasonCode,
        errorMessage: "/private/local/path must never be published",
        status: "failed",
      },
      replyText: null,
      targetProfileName: "Research Agent",
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      reason: text,
      reasonCode,
      text,
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).not.toContain("/private/local/path");
  });

  it("requires an explicit public action in collaboration mode", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
      },
      replyText: "hello world",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
      reason: "OpenMeld did not receive a message it could post in this space.",
      // A success payload with no publishable action carries no errorCode,
      // so the structured reasonCode stays empty instead of being invented.
      reasonCode: null,
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe(
      "oh-my-claude couldn't reply: OpenMeld did not receive a message it could post in this space."
    );
  });

  it("publishes raw replies in raw_context_sharing mode when no action is present", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage({
        publicationMode: "raw_context_sharing",
      }),
      payload: {
        status: "success",
      },
      replyText: "hello world",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "message",
      publicOutcome: "raw_context_sharing",
      text: "hello world",
    });
    if (plan.kind !== "message") {
      throw new Error("expected a message publication plan");
    }
    expect(plan.messageEnvelope).toEqual({
      activationTargets: [],
      referenceTargets: [],
      text: "hello world",
    });
  });

  it("does not publish raw replies in raw_context_sharing mode after terminal failure", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage({
        publicationMode: "raw_context_sharing",
      }),
      payload: {
        status: "failed",
        errorCode: "provider.timeout",
      },
      replyText: "leftover draft should stay private",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
    });
  });

  it("surfaces actionable upstream model errors instead of the generic invalid-action message", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "openclaw-phase-one",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          '{"detail":"The \'gpt-5.3-codex-spark\' model is not supported when using Codex with a ChatGPT account."}',
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
      reason:
        "The current Codex model is not available for this ChatGPT-backed account.",
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe(
      "openclaw-phase-one couldn't reply: The current Codex model is not available for this ChatGPT-backed account."
    );
  });

  it("keeps internal failure codes structured instead of appending them to user-facing copy", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "Cursor",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "model.inventory_unavailable",
        errorMessage:
          "model.inventory_unavailable: Cursor ACP did not provide one complete, consistent model inventory after a bounded recheck",
      },
      replyText: null,
      targetProfileName: "Cursor",
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      reason: CURSOR_MODEL_INVENTORY_UNAVAILABLE_COPY,
      reasonCode: "model.inventory_unavailable",
      text: `Cursor couldn't reply: ${CURSOR_MODEL_INVENTORY_UNAVAILABLE_COPY}`,
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).not.toContain("model.inventory_unavailable");
  });

  it("surfaces actionable provider balance failures without leaking raw provider text", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "wake-speed-test-opencode",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "upstream_unreachable",
        errorMessage: "upstream_unreachable: Insufficient Balance",
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
      reason: PROVIDER_CREDITS_COPY,
      reasonCode: "upstream_unreachable",
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe(
      `wake-speed-test-opencode couldn't reply: ${PROVIDER_CREDITS_COPY}`
    );
    expect(plan.text).not.toContain("Insufficient Balance");
  });

  it("uses classified provider balance codes without requiring raw provider text", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "wake-speed-test-opencode",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "provider.insufficient_balance",
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
      reason: PROVIDER_CREDITS_COPY,
    });
  });

  it("ignores daemon-provided structured-action public failure copy for Space-visible notices", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "openclaw-phase-one",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "A valid OpenMeld Space action is required in collaboration mode.",
        spaceActionFailureDiagnostics: {
          carrierKind: "none",
          invalidOutputPreview: null,
          publicFailureReason:
            "RAW INTERNAL PROVIDER ERROR: do not publish this daemon text.",
          repairMode: "controller_roundtrip",
          spaceActionCandidatePresent: false,
          spaceActionParseError: null,
        },
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
      reason: malformedReplyCopy("This agent"),
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe(
      `openclaw-phase-one couldn't reply: ${malformedReplyCopy("This agent")}`
    );
    expect(plan.text).not.toContain("RAW INTERNAL PROVIDER ERROR");
  });

  it("publishes explicit post_message without OpenMeld rewriting", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
        spaceAction: {
          type: "post_message",
          observedThroughSignalId: "sig-observed-through",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            replyToSignalId: "sig-current",
            text: "Ship this version.",
          },
        },
      },
      replyText: "ignored runtime output",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "message",
      observedThroughSignalId: "sig-observed-through",
      publicOutcome: "post_message",
      text: "Ship this version.",
    });
    if (plan.kind !== "message") {
      throw new Error("expected a message publication plan");
    }
    expect(plan.messageEnvelope).toEqual({
      activationTargets: [],
      referenceTargets: [],
      replyToSignalId: "sig-current",
      text: "Ship this version.",
    });
  });

  it("publishes explicit CLI post_message even when the runtime status is failed", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "handoff-agent",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "provider.exit_failed",
        errorMessage: "provider exited after recording a final action",
        spaceAction: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: ["agt_qa"],
            referenceTargets: [],
            replyToSignalId: "sig-current",
            text: "Please validate this handoff.",
          },
        },
        spaceActionProvenance: "cli_action",
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "message",
      publicOutcome: "post_message",
      text: "Please validate this handoff.",
    });
    if (plan.kind !== "message") {
      throw new Error("expected a message publication plan");
    }
    expect(plan.messageEnvelope).toEqual({
      activationTargets: ["agt_qa"],
      referenceTargets: [],
      replyToSignalId: "sig-current",
      text: "Please validate this handoff.",
    });
  });

  it("publishes explicit post_status with agent-authored text", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
        spaceAction: {
          type: "post_status",
          status: "needs_input",
          text: "Need the customer intro sentence.",
          targetProfileId: "profile-2",
          replyTo: "current",
        },
      },
      replyText: "ignored runtime output",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "status",
      publicOutcome: "post_status",
      status: "needs_input",
      targetProfileId: "profile-2",
      text: "Need the customer intro sentence.",
    });
  });

  it("bounds explicit post_status text to the signal.status display contract", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
        spaceAction: {
          type: "post_status",
          status: "done",
          text: "x".repeat(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH + 20),
        },
      },
      replyText: "ignored runtime output",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "status",
      publicOutcome: "post_status",
      status: "done",
    });
    if (plan.kind !== "status") {
      throw new Error("expected a status publication plan");
    }
    expect(plan.text).toHaveLength(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH);
    expect(plan.text.endsWith("…")).toBe(true);
  });

  it("publishes explicit stay_silent with a public agent reason separate from the system text", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
        spaceAction: {
          type: "stay_silent",
          reason: "Handled privately.",
          saveResult: true,
        },
      },
      replyText: "private reply",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "stay_silent",
      publicOutcome: "stay_silent",
      reason: "Handled privately.",
      // stay_silent is not a failure, so no machine-readable failure code.
      reasonCode: null,
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe("oh-my-claude chose to stay silent.");
  });

  it("suppresses stay_silent reason when the action came from controller repair", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
        spaceAction: {
          type: "stay_silent",
          reason: "Keeping this private.",
          saveResult: true,
        },
        spaceActionProvenance: "controller_repair",
      },
      replyText: "private reply",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "stay_silent",
      publicOutcome: "stay_silent",
      reason: null,
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe("oh-my-claude chose to stay silent.");
  });

  it("suppresses stay_silent reason when the action came from local repair", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
        spaceAction: {
          type: "stay_silent",
          reason: "Keeping this private.",
          saveResult: true,
        },
        spaceActionProvenance: "local_repair",
      },
      replyText: "private reply",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "stay_silent",
      publicOutcome: "stay_silent",
      reason: null,
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe("oh-my-claude chose to stay silent.");
  });

  it("turns blocked explicit actions into policy_blocked system notices", () => {
    const dispatchMessage = createDispatchMessage({
      allowedActions: ["post_status", "stay_silent"],
      replyToSnapshot: {
        signalId: "sig-live-thread-1",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        profileName: "Felix",
        previewText: "Earlier message",
      },
    });
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage,
      payload: {
        status: "success",
        spaceAction: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            replyToSignalId: "sig-current",
            text: "should not publish",
          },
        },
      },
      replyText: "runtime output",
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "policy_blocked",
      publicOutcome: "system_notice",
      blockedExplicitAction: true,
      reason: "This room does not allow post_message.",
      // policy_blocked comes from Space policy, not a failure code family.
      reasonCode: null,
    });

    const record = buildDispatchResultRecord({
      dispatchId: "dispatch-policy-blocked-1",
      dispatchReplyToSignalId: "sig-live-thread-1",
      emittedSignal: {
        v: 1,
        id: "sig-system-notice-1",
        spaceId: "space-1",
        ts: Date.now(),
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        type: "signal.system_notice",
        data: {
          dispatchId: "dispatch-policy-blocked-1",
          noticeType: "policy_blocked",
          actorProfileId: "agt-blocked-1",
          replyTo: {
            signalId: "sig-live-thread-1",
            profileId: "11111111-1111-4111-8111-111111111111",
            profileKind: "human",
            profileName: "Felix",
            previewText: "Earlier message",
          },
          text: "This room does not allow post_message.",
          generatedBy: "openmeld",
        },
      },
      publishedSignalId: "sig-system-notice-1",
      runtimeOutput: "runtime output",
      targetProfileId: "agt-blocked-1",
      targetProfileName: "oh-my-claude",
      plan,
      spaceId: "space-1",
    });

    expect(record).toMatchObject({
      publicOutcome: "system_notice",
      replyToSignalId: "sig-live-thread-1",
    });
  });

  it("keeps failure reasons structured and non-technical in public system notices", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "provider.rate_limit",
        errorMessage: "raw vendor error should not leak",
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
      reason: PROVIDER_RATE_LIMIT_COPY,
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).not.toContain("raw vendor error");
  });

  it("names the agent and keeps an unmapped runtime errorCode structured without leaking diagnostics", () => {
    // Real 2026-07-10 dogfooding incident shape: the daemon reported
    // errorCode "runtime.turn.failed" with an OpenAI 400 JSON errorMessage.
    // No specific public mapping exists for this code. The visible notice stays
    // plain-language while the structured reasonCode preserves diagnostics.
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "runtime.turn.failed",
        errorMessage:
          '{"type":"error","error":{"type":"invalid_request_error","code":"invalid_value","message":"Invalid value: \'max\'. Supported values are: ...","param":"reasoning.effort"},"status":400}',
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      publicOutcome: "system_notice",
      reason: "OpenMeld did not receive a message it could post in this space.",
      reasonCode: "runtime.turn.failed",
    });
    if (plan.kind !== "system_notice") {
      throw new Error("expected a system notice publication plan");
    }
    expect(plan.text).toBe(
      "oh-my-claude couldn't reply: OpenMeld did not receive a message it could post in this space."
    );
    expect(plan.text).toContain("oh-my-claude");
    expect(plan.text).not.toContain("runtime.turn.failed");
    expect(plan.text).not.toContain("reasoning.effort");
    expect(plan.text).not.toContain("Invalid value");
    expect(plan.text).not.toContain("invalid_request_error");
  });

  it("uses target profile snapshots before falling back to a generic actor name", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: null,
      dispatchMessage: {
        ...createDispatchMessage(),
        targetProfileNameSnapshot: "hi-agent",
      } as OpenMeldDaemonDispatchQueueMessage,
      payload: {
        status: "failed",
        errorCode: "openmeld.space_action.repair_failed",
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "system_notice",
      noticeType: "terminal_failure",
      text: `hi-agent couldn't reply: ${malformedReplyCopy("This agent")}`,
    });
  });

  it("suppresses internal-only failures from the public room", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "failed",
        errorCode: "dispatch.execution_failed",
        suppressPublicOutcome: true,
      },
      replyText: null,
      targetProfileName: null,
    });

    expect(plan).toMatchObject({
      kind: "none",
      publicOutcome: "internal_only",
    });
  });

  it("preserves structured status metadata when archiving all final results", () => {
    const dispatchMessage = createDispatchMessage();
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: {
        ...dispatchMessage,
        spaceContractSnapshot: {
          ...dispatchMessage.spaceContractSnapshot,
          resultArchivePolicy: { mode: "all_final_results" },
        },
      } as OpenMeldDaemonDispatchQueueMessage,
      payload: {
        status: "success",
        spaceAction: {
          type: "post_status",
          status: "done",
          text: "Ready for review.",
          replyTo: "current",
        },
      },
      replyText: "Final runtime output",
      targetProfileName: "oh-my-claude",
    });

    const record = buildDispatchResultRecord({
      dispatchId: "dispatch-1",
      runtimeOutput: "Final runtime output",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      targetProfileName: "oh-my-claude",
      plan,
      spaceId: "space-1",
      threadContext: THREAD_CONTEXT,
    });

    expect(record).toMatchObject({
      resultKind: "status",
      statusType: "done",
      publicOutcome: "post_status",
      finalText: "Final runtime output",
      previewText: "Ready for review.",
      threadContext: THREAD_CONTEXT,
    });
  });

  it("archives canonical messageEnvelope for public text results", () => {
    const baseMessage = createDispatchMessage({
      publicationMode: "raw_context_sharing",
    });
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: {
        ...baseMessage,
        replyToSnapshot: {
          signalId: "sig-thread-1",
          profileId: "hum_1",
          profileKind: "human",
          profileName: "Felix",
          previewText: "Earlier message",
        },
        spaceContractSnapshot: {
          ...baseMessage.spaceContractSnapshot,
          resultArchivePolicy: { mode: "all_final_results" },
        },
      } as OpenMeldDaemonDispatchQueueMessage,
      payload: {
        status: "success",
      },
      replyText: "hello world",
      targetProfileName: null,
    });

    const record = buildDispatchResultRecord({
      dispatchId: "dispatch-raw-1",
      runtimeOutput:
        "internal runtime output that should not override public text",
      targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
      targetProfileName: "oh-my-claude",
      plan,
      spaceId: "space-1",
    });

    expect(record).toMatchObject({
      resultKind: "text",
      finalText: "hello world",
      replyToSignalId: "sig-thread-1",
      publicOutcome: "raw_context_sharing",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-thread-1",
        text: "hello world",
      },
    });
  });

  it("archives successful explicit post_message using the emitted signal thread", () => {
    const plan = resolveDispatchPublicationPlan({
      actorName: "oh-my-claude",
      dispatchMessage: createDispatchMessage(),
      payload: {
        status: "success",
        spaceAction: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            replyToSignalId: "sig-live-thread-1",
            text: "Ship this version.",
          },
        },
      },
      replyText: "ignored runtime output",
      targetProfileName: null,
    });

    const record = buildDispatchResultRecord({
      dispatchId: "dispatch-explicit-message-1",
      dispatchReplyToSignalId: "sig-fallback-thread-1",
      emittedSignal: {
        v: 1,
        id: "sig-message-1",
        spaceId: "space-1",
        ts: Date.now(),
        profile: {
          kind: "agent",
          profileId: "agt-explicit-1",
          profileName: "oh-my-claude",
        },
        type: "signal.text",
        data: {
          text: "Ship this version.",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            replyToSignalId: "sig-live-thread-1",
            text: "Ship this version.",
          },
        },
      },
      publishedSignalId: "sig-message-1",
      runtimeOutput: "runtime output",
      targetProfileId: "agt-explicit-1",
      targetProfileName: "oh-my-claude",
      plan,
      spaceId: "space-1",
    });

    expect(record).toMatchObject({
      publicOutcome: "post_message",
      replyToSignalId: "sig-live-thread-1",
      messageEnvelope: {
        replyToSignalId: "sig-live-thread-1",
      },
    });
  });
});
