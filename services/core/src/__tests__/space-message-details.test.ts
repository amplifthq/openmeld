import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import type {
  MessageEnvelope,
  WakeTraceWaterfallItem,
  WakeTraceWaterfallStepName,
  WakeTraceWaterfallSummaryStatus,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { projectSpaceMessageDetails } from "../space/application/space-message-details";

const SPACE_ID = "space-1";
const SENT_AT_MS = Date.UTC(2026, 5, 4, 6, 8);

describe("space Message Details projection", () => {
  it("marks agent context as not applicable for human messages", () => {
    const signal = createTextSignal({
      id: "sig-human-1",
      profile: humanProfile(),
      text: "hello",
    });

    const details = projectSpaceMessageDetails({
      replySignal: null,
      signal,
      spaceId: SPACE_ID,
      visibleReplySignal: null,
      visibleSignal: signal,
      wakeSourceSignal: null,
    });

    expect(details.message.actor.displayName).toBe("Felix");
    expect(details.agentContext.state).toBe("not_applicable");
    expect(details.agentContext.agentControllerConversationId.state).toBe(
      "not_applicable"
    );
    expect(details.wakeContext.state).toBe("not_applicable");
    expect(details.replyContext.state).toBe("not_applicable");
    expect(details.workingDetails).toEqual({
      state: "not_applicable",
      tools: [],
      truncated: false,
    });
  });

  it("does not invent local runtime facts for manual agent-authored messages", () => {
    const signal = createTextSignal({
      id: "sig-agent-manual",
      profile: agentProfile({
        profileName: "OpenMeld CLI Bot",
      }),
      text: "sent from the CLI",
    });

    const details = projectSpaceMessageDetails({
      replySignal: null,
      signal,
      spaceId: SPACE_ID,
      visibleReplySignal: null,
      visibleSignal: signal,
      wakeSourceSignal: null,
    });

    expect(details.agentContext.state).toBe("recorded");
    expect(details.agentContext.profileName).toMatchObject({
      state: "recorded",
      value: "OpenMeld CLI Bot",
    });
    expect(details.agentContext.agentControllerConversationId.state).toBe(
      "not_recorded"
    );
    expect(details.agentContext.workspacePath.state).toBe("not_recorded");
    expect(details.wakeContext.state).toBe("not_applicable");
    expect(details.workingDetails?.state).toBe("not_applicable");
  });

  it("distinguishes unavailable and recorded working details for final Agent replies", () => {
    const signal = createTextSignal({
      id: "sig-agent-final",
      profile: agentProfile({ profileName: "Center Agent" }),
      text: "I found the answer.",
      meta: { purpose: "agent_reply_final" },
    });

    const withoutDetails = projectSpaceMessageDetails({
      replySignal: null,
      signal,
      spaceId: SPACE_ID,
      visibleReplySignal: null,
      visibleSignal: signal,
      wakeSourceSignal: null,
    });
    const withDetails = projectSpaceMessageDetails({
      replySignal: null,
      signal,
      spaceId: SPACE_ID,
      visibleReplySignal: null,
      visibleSignal: signal,
      wakeSourceSignal: null,
      workingDetails: {
        state: "recorded",
        tools: [
          {
            toolName: "openmeld_list_spaces",
            state: "output-available",
            startedAtMs: SENT_AT_MS - 200,
            updatedAtMs: SENT_AT_MS - 100,
          },
        ],
        truncated: false,
      },
    });

    expect(withoutDetails.workingDetails).toEqual({
      state: "not_recorded",
      tools: [],
      truncated: false,
    });
    expect(withDetails.workingDetails).toEqual({
      state: "recorded",
      tools: [
        {
          toolName: "openmeld_list_spaces",
          state: "output-available",
          startedAtMs: SENT_AT_MS - 200,
          updatedAtMs: SENT_AT_MS - 100,
        },
      ],
      truncated: false,
    });
  });

  it("preserves redacted local origin facts as redacted facts", () => {
    const rawSignal = createTextSignal({
      id: "sig-agent-reply",
      profile: agentProfile({
        agentControllerConversationId: "conv-1",
        agentControllerRef: "builtin:codex",
        profileName: "Codex Local Agent",
        workingDirectory: "/Users/felix/.openmeld/private",
      }),
      text: "done",
    });
    const visibleSignal = createTextSignal({
      id: rawSignal.id,
      profile: agentProfile({
        agentControllerRef: "builtin:codex",
        profileName: "Codex Local Agent",
      }),
      text: "done",
    });

    const details = projectSpaceMessageDetails({
      replySignal: null,
      signal: rawSignal,
      spaceId: SPACE_ID,
      visibleReplySignal: null,
      visibleSignal,
      wakeSourceSignal: null,
    });

    expect(details.agentContext.agentControllerRef).toMatchObject({
      state: "recorded",
      value: "builtin:codex",
    });
    expect(details.agentContext.agentControllerConversationId.state).toBe(
      "redacted"
    );
    expect(details.agentContext.workspacePath.state).toBe("redacted");
  });

  it("projects Wake source details without embedding diagnostic trace facts", () => {
    const wakeSourceSignal = createTextSignal({
      id: "sig-wake-1",
      profile: humanProfile(),
      text: "@codex(wake) please check",
      messageEnvelope: {
        activationTargets: ["agt-codex"],
        referenceTargets: [],
        text: "@codex(wake) please check",
      },
      meta: {
        clientMessageId: "client-message-1",
      },
    });
    const failureNotice = createSystemNoticeSignal({
      id: "sig-failure-1",
      profile: systemProfile(),
      replyTo: {
        signalId: wakeSourceSignal.id,
        profileId: "human-1",
        profileKind: "human",
        profileName: "Felix",
        previewText: "@codex(wake) please check",
      },
      text: "Codex could not complete this Wake.",
    });

    const details = projectSpaceMessageDetails({
      replySignal: wakeSourceSignal,
      signal: failureNotice,
      spaceId: SPACE_ID,
      visibleReplySignal: wakeSourceSignal,
      visibleSignal: failureNotice,
      wakeSourceSignal,
    });

    expect(details.agentContext.state).toBe("not_applicable");
    expect(details.wakeContext.state).toBe("recorded");
    expect(details.wakeContext.targets).toEqual([
      {
        targetProfileId: "agt-codex",
        targetLabel: null,
      },
    ]);
    expect(details.replyContext.previewText.value).toBe(
      "@codex(wake) please check"
    );
    expect(details.diagnostics.traceSelectors).toEqual([
      {
        kind: "signal",
        label: "Message ID",
        value: "sig-failure-1",
        targetProfileId: null,
      },
      {
        kind: "wake_source_signal",
        label: "Wake source signal ID",
        value: "sig-wake-1",
        targetProfileId: null,
      },
      {
        kind: "client_message",
        label: "Client message ID",
        value: "client-message-1",
        targetProfileId: null,
      },
      {
        kind: "client_message",
        label: "Client message ID (agt-codex)",
        value: "client-message-1",
        targetProfileId: "agt-codex",
      },
    ]);
  });

  it("projects per-target Wake statuses from the Wake trace waterfall", () => {
    const wakeSourceSignal = createTextSignal({
      id: "sig-wake-multi",
      profile: humanProfile(),
      text: "@codex(wake) @opencode(wake) compare",
      messageEnvelope: {
        activationTargets: ["agt-codex", "agt-opencode"],
        referenceTargets: [],
        text: "@codex(wake) @opencode(wake) compare",
      },
      meta: {
        clientMessageId: "client-message-multi",
      },
    });

    const details = projectSpaceMessageDetails({
      replySignal: null,
      signal: wakeSourceSignal,
      spaceId: SPACE_ID,
      visibleReplySignal: null,
      visibleSignal: wakeSourceSignal,
      wakeSourceSignal,
      wakeTraceItems: [
        createWakeTraceItem({
          reasonCode: null,
          status: "replied",
          targetLabel: "Codex",
          targetProfileId: "agt-codex",
          terminalStep: "reply_signal",
        }),
        createWakeTraceItem({
          reasonCode: null,
          status: "running",
          targetLabel: "OpenCode",
          targetProfileId: "agt-opencode",
          terminalStep: null,
        }),
      ],
    });

    expect(details.wakeContext.targets).toMatchObject([
      {
        targetProfileId: "agt-codex",
        targetLabel: "Codex",
        status: "replied",
        terminalStep: "reply_signal",
        reasonCode: null,
      },
      {
        targetProfileId: "agt-opencode",
        targetLabel: "OpenCode",
        status: "running",
        terminalStep: null,
        reasonCode: null,
      },
    ]);
    expect(details.diagnostics.traceSelectors).toEqual([
      {
        kind: "signal",
        label: "Message ID",
        value: "sig-wake-multi",
        targetProfileId: null,
      },
      {
        kind: "wake_source_signal",
        label: "Wake source signal ID",
        value: "sig-wake-multi",
        targetProfileId: null,
      },
      {
        kind: "client_message",
        label: "Client message ID",
        value: "client-message-multi",
        targetProfileId: null,
      },
      {
        kind: "client_message",
        label: "Client message ID (Codex)",
        value: "client-message-multi",
        targetProfileId: "agt-codex",
      },
      {
        kind: "client_message",
        label: "Client message ID (OpenCode)",
        value: "client-message-multi",
        targetProfileId: "agt-opencode",
      },
    ]);
  });

  it("keeps the message author separate from the Agent targeted by the same signal", () => {
    const wakeSourceSignal = createTextSignal({
      id: "sig-agent-handoff",
      profile: agentProfile({
        agentControllerRef: "builtin:codex",
        profileName: "Codex 5.6 Sol",
      }),
      text: "@Center Agent(wake) PR is ready",
      messageEnvelope: {
        activationTargets: ["agt-center"],
        referenceTargets: [],
        text: "@Center Agent(wake) PR is ready",
      },
      meta: {
        clientMessageId: "client-message-handoff",
      },
    });
    const wakeTraceItem = createWakeTraceItem({
      clientMessageId: "client-message-handoff",
      reasonCode: "remote_agent.turn.context_window_exceeded",
      status: "failed",
      targetLabel: "Center Agent",
      targetProfileId: "agt-center",
      terminalStep: "attempt",
    });
    wakeTraceItem.executionContext = {
      ...wakeTraceItem.executionContext,
      agentControllerRef: "hosted:center-agent",
      bindingId: "binding-center-agent",
      factSource: "dispatch_trace_origin",
      resolutionStatus: "not_resolved",
    };

    const details = projectSpaceMessageDetails({
      replySignal: null,
      signal: wakeSourceSignal,
      spaceId: SPACE_ID,
      visibleReplySignal: null,
      visibleSignal: wakeSourceSignal,
      wakeSourceSignal,
      wakeTraceItems: [wakeTraceItem],
    });

    expect(details.agentContext.profileName).toMatchObject({
      state: "recorded",
      value: "Codex 5.6 Sol",
    });
    expect(details.wakeContext.targets).toMatchObject([
      {
        targetProfileId: "agt-center",
        targetLabel: "Center Agent",
        status: "failed",
        reasonCode: "remote_agent.turn.context_window_exceeded",
        agentContext: {
          state: "recorded",
          profileId: {
            state: "recorded",
            value: "agt-center",
            source: "wake_trace",
          },
          profileName: {
            state: "recorded",
            value: "Center Agent",
            source: "wake_trace",
          },
          agentControllerRef: {
            state: "recorded",
            value: "hosted:center-agent",
            source: "wake_trace_execution_context",
          },
          bindingId: {
            state: "recorded",
            value: "binding-center-agent",
            source: "wake_trace_execution_context",
          },
        },
      },
    ]);
  });
});

function createTextSignal(input: {
  id: string;
  messageEnvelope?: MessageEnvelope;
  meta?: Record<string, string>;
  profile: Profile;
  replyTo?: Extract<SignalEnvelope, { type: "signal.text" }>["data"]["replyTo"];
  text: string;
}): Extract<SignalEnvelope, { type: "signal.text" }> {
  return {
    v: 1,
    id: input.id,
    spaceId: SPACE_ID,
    ts: SENT_AT_MS,
    profile: input.profile,
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.messageEnvelope
        ? { messageEnvelope: input.messageEnvelope }
        : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    },
  };
}

function createSystemNoticeSignal(input: {
  id: string;
  profile: Profile;
  replyTo: Extract<SignalEnvelope, { type: "signal.text" }>["data"]["replyTo"];
  text: string;
}): Extract<SignalEnvelope, { type: "signal.system_notice" }> {
  return {
    v: 1,
    id: input.id,
    spaceId: SPACE_ID,
    ts: SENT_AT_MS,
    profile: input.profile,
    type: "signal.system_notice",
    data: {
      text: input.text,
      noticeType: "terminal_failure",
      dispatchId: "dispatch-failure-1",
      generatedBy: "openmeld",
      actorProfileId: "agt-codex",
      actorName: "Codex",
      replyTo: input.replyTo,
    },
  };
}

function humanProfile(): Profile {
  return {
    kind: "human",
    profileId: "human-1",
    profileName: "Felix",
  };
}

function systemProfile(): Profile {
  return {
    kind: "system",
    profileId: "openmeld-system",
    profileName: "OpenMeld",
  };
}

function agentProfile(input: Partial<Profile>): Profile {
  return {
    kind: "agent",
    profileId: "agt-codex",
    ...input,
  };
}

function createWakeTraceItem(input: {
  clientMessageId?: string;
  reasonCode: string | null;
  status: WakeTraceWaterfallSummaryStatus;
  targetLabel: string;
  targetProfileId: string;
  terminalStep: WakeTraceWaterfallStepName | null;
}): WakeTraceWaterfallItem {
  const clientMessageId = input.clientMessageId ?? "client-message-multi";
  return {
    targetProfileId: input.targetProfileId,
    targetLabel: input.targetLabel,
    correlation: {
      modelVersion: "openmeld.observability.wake.v1",
      selector: {
        kind: "client_message",
        clientMessageId,
        spaceId: SPACE_ID,
        targetProfileId: input.targetProfileId,
      },
      spaceId: SPACE_ID,
      clientMessageId,
      sourceSignalId: null,
      targetProfileId: input.targetProfileId,
      dispatchId: null,
      runtimeCoordinatorExecutionId: null,
      latestAttemptId: null,
      claimLeaseId: null,
      bindingId: null,
      openMeldServiceRuntimeId: null,
      agentControllerRef: null,
      resultRef: null,
      publishedSignalId: null,
      replySignalId: null,
      cloudflare: {
        cfRayId: null,
        requestId: null,
        traceId: null,
      },
    },
    executionContext: {
      resolutionStatus: "not_started",
      factSource: "none",
      reasonCode: null,
      bindingId: null,
      openMeldServiceRuntimeId: null,
      agentControllerRef: null,
      agentControllerConversationId: null,
      agentControllerConversationKind: null,
      runtimeWorkspacePath: null,
      runtimeWorkspaceFingerprint: null,
    },
    summary: {
      status: input.status,
      terminalStep: input.terminalStep,
      reasonCode: input.reasonCode,
    },
    steps: [],
  };
}
