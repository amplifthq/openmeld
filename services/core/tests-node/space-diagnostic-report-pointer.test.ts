import type { SignalEnvelope } from "@openmeld/protocol";
import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { projectSpaceDiagnosticReportPointers } from "../src/diagnostics/application/space-diagnostic-report-pointer";

const SPACE_ID = "space-1";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const SECOND_AGENT_PROFILE_ID = "agt_44444444-4444-4444-8444-444444444444";
type SystemNoticeData = Extract<
  SignalEnvelope,
  { type: "signal.system_notice" }
>["data"];

describe("space diagnostic report pointer projection", () => {
  it("projects an exact wake pointer from a final agent reply", () => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: HUMAN_PROFILE_ID,
      text: "@agent please help",
      data: {
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@agent please help",
        },
        meta: {
          clientMessageId: "client-message-1",
        },
      },
    });
    const reply = buildTextSignal({
      id: "sig-reply-1",
      profileId: AGENT_PROFILE_ID,
      text: "Done",
      data: {
        replyTo: {
          signalId: source.id,
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: AGENT_PROFILE_ID,
        },
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: reply,
      spaceId: SPACE_ID,
      readSignalById: (signalId) => (signalId === source.id ? source : null),
      readThreadIdBySignalId: () => "thread-1",
    });

    expect(result).toEqual({
      replyToSignalId: source.id,
      threadId: "thread-1",
      wakePointers: [
        {
          spaceId: SPACE_ID,
          clientMessageId: "client-message-1",
          sourceSignalId: source.id,
          targetProfileId: AGENT_PROFILE_ID,
        },
      ],
      wakePointerDerivation: {
        status: "exact",
        reasonCodes: ["diagnostic_report.reply_target_exact"],
      },
    });
  });

  it("projects an exact wake pointer from an agent-authored final reply without a client message ID", () => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: AGENT_PROFILE_ID,
      text: "@runner please continue",
      data: {
        messageEnvelope: {
          activationTargets: [SECOND_AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@runner please continue",
        },
      },
    });
    const reply = buildTextSignal({
      id: "sig-reply-1",
      profileId: SECOND_AGENT_PROFILE_ID,
      text: "Done",
      data: {
        replyTo: {
          signalId: source.id,
          profileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Agent",
          previewText: "@runner please continue",
        },
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: SECOND_AGENT_PROFILE_ID,
        },
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: reply,
      spaceId: SPACE_ID,
      readSignalById: (signalId) => (signalId === source.id ? source : null),
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointers).toEqual([
      {
        spaceId: SPACE_ID,
        clientMessageId: null,
        sourceSignalId: source.id,
        targetProfileId: SECOND_AGENT_PROFILE_ID,
      },
    ]);
    expect(result.wakePointerDerivation).toEqual({
      status: "exact",
      reasonCodes: ["diagnostic_report.reply_target_exact"],
    });
  });

  it("projects source wake pointers for a reported source message", () => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: HUMAN_PROFILE_ID,
      text: "@agent please help",
      data: {
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@agent please help",
        },
        meta: {
          clientMessageId: "client-message-1",
        },
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: source,
      spaceId: SPACE_ID,
      readSignalById: () => null,
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointerDerivation).toEqual({
      status: "source_multi_target",
      reasonCodes: ["diagnostic_report.source_wake_targets"],
    });
    expect(result.wakePointers).toHaveLength(1);
  });

  it("projects source wake pointers without a client message ID", () => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: AGENT_PROFILE_ID,
      text: "@runner please continue",
      data: {
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@runner please continue",
        },
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: source,
      spaceId: SPACE_ID,
      readSignalById: () => null,
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointers).toEqual([
      {
        spaceId: SPACE_ID,
        clientMessageId: null,
        sourceSignalId: source.id,
        targetProfileId: AGENT_PROFILE_ID,
      },
    ]);
    expect(result.wakePointerDerivation).toEqual({
      status: "source_multi_target",
      reasonCodes: ["diagnostic_report.source_wake_targets"],
    });
  });

  it("projects an exact wake pointer from a terminal failure notice", () => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: HUMAN_PROFILE_ID,
      text: "@agent please help",
      data: {
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@agent please help",
        },
        meta: {
          clientMessageId: "client-message-1",
        },
      },
    });
    const failure = buildSystemNoticeSignal({
      id: "sig-terminal-failure-1",
      data: {
        actorProfileId: AGENT_PROFILE_ID,
        actorName: "Agent",
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "daemon.profile.offline",
        replyTo: {
          signalId: source.id,
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        text: "Agent couldn't reply.",
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: failure,
      spaceId: SPACE_ID,
      readSignalById: (signalId) => (signalId === source.id ? source : null),
      readThreadIdBySignalId: () => null,
    });

    expect(result).toEqual({
      replyToSignalId: source.id,
      threadId: null,
      wakePointers: [
        {
          spaceId: SPACE_ID,
          clientMessageId: "client-message-1",
          sourceSignalId: source.id,
          targetProfileId: AGENT_PROFILE_ID,
        },
      ],
      wakePointerDerivation: {
        status: "exact",
        reasonCodes: ["diagnostic_report.terminal_failure_target_exact"],
      },
    });
  });

  it("reports unavailable evidence when a terminal failure source signal is missing", () => {
    const failure = buildSystemNoticeSignal({
      id: "sig-terminal-failure-1",
      data: {
        actorProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        replyTo: {
          signalId: "sig-missing-source",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        text: "Agent couldn't reply.",
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: failure,
      spaceId: SPACE_ID,
      readSignalById: () => null,
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointers).toEqual([]);
    expect(result.wakePointerDerivation).toEqual({
      status: "unavailable",
      reasonCodes: [
        "diagnostic_report.terminal_failure_source_signal_not_found",
      ],
    });
  });

  it("projects an exact wake pointer when a terminal failure source has no client message ID", () => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: HUMAN_PROFILE_ID,
      text: "@agent please help",
      data: {
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@agent please help",
        },
      },
    });
    const failure = buildSystemNoticeSignal({
      id: "sig-terminal-failure-1",
      data: {
        actorProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        replyTo: {
          signalId: source.id,
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        text: "Agent couldn't reply.",
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: failure,
      spaceId: SPACE_ID,
      readSignalById: (signalId) => (signalId === source.id ? source : null),
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointers).toEqual([
      {
        spaceId: SPACE_ID,
        clientMessageId: null,
        sourceSignalId: source.id,
        targetProfileId: AGENT_PROFILE_ID,
      },
    ]);
    expect(result.wakePointerDerivation).toEqual({
      status: "exact",
      reasonCodes: ["diagnostic_report.terminal_failure_target_exact"],
    });
  });

  it.each<{ data: Partial<SystemNoticeData>; label: string }>([
    {
      label: "actorProfileId",
      data: {
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        replyTo: {
          signalId: "sig-source-1",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        text: "Agent couldn't reply.",
      },
    },
    {
      label: "dispatchId",
      data: {
        actorProfileId: AGENT_PROFILE_ID,
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        replyTo: {
          signalId: "sig-source-1",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        text: "Agent couldn't reply.",
      },
    },
    {
      label: "replyTo",
      data: {
        actorProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        text: "Agent couldn't reply.",
      },
    },
  ])("reports unavailable evidence when a terminal failure is missing $label", ({
    data,
  }) => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: HUMAN_PROFILE_ID,
      text: "@agent please help",
      data: {
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@agent please help",
        },
        meta: {
          clientMessageId: "client-message-1",
        },
      },
    });
    const failure = buildSystemNoticeSignal({
      id: "sig-terminal-failure-1",
      data,
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: failure,
      spaceId: SPACE_ID,
      readSignalById: (signalId) => (signalId === source.id ? source : null),
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointers).toEqual([]);
    expect(result.wakePointerDerivation).toEqual({
      status: "unavailable",
      reasonCodes: ["diagnostic_report.wake_pointer_unavailable"],
    });
  });

  it("does not treat non-terminal system notices as wake reports", () => {
    const source = buildTextSignal({
      id: "sig-source-1",
      profileId: HUMAN_PROFILE_ID,
      text: "@agent please help",
      data: {
        messageEnvelope: {
          activationTargets: [AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@agent please help",
        },
        meta: {
          clientMessageId: "client-message-1",
        },
      },
    });
    const notice = buildSystemNoticeSignal({
      id: "sig-stay-silent-1",
      data: {
        actorProfileId: AGENT_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "stay_silent",
        replyTo: {
          signalId: source.id,
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        text: "Agent stayed silent.",
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: notice,
      spaceId: SPACE_ID,
      readSignalById: (signalId) => (signalId === source.id ? source : null),
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointers).toEqual([]);
    expect(result.wakePointerDerivation).toEqual({
      status: "not_wake",
      reasonCodes: ["diagnostic_report.not_wake_related"],
    });
  });

  it("reports unavailable evidence when a reply source signal is missing", () => {
    const reply = buildTextSignal({
      id: "sig-reply-1",
      profileId: AGENT_PROFILE_ID,
      text: "Done",
      data: {
        replyTo: {
          signalId: "sig-missing",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Mira",
          previewText: "@agent please help",
        },
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: AGENT_PROFILE_ID,
        },
      },
    });

    const result = projectSpaceDiagnosticReportPointers({
      reportedSignal: reply,
      spaceId: SPACE_ID,
      readSignalById: () => null,
      readThreadIdBySignalId: () => null,
    });

    expect(result.wakePointers).toEqual([]);
    expect(result.wakePointerDerivation).toEqual({
      status: "unavailable",
      reasonCodes: ["diagnostic_report.reply_source_signal_not_found"],
    });
  });
});

function buildTextSignal(input: {
  data?: Partial<Extract<SignalEnvelope, { type: "signal.text" }>["data"]>;
  id: string;
  profileId: string;
  text: string;
}): Extract<SignalEnvelope, { type: "signal.text" }> {
  return {
    v: 1,
    id: input.id,
    spaceId: SPACE_ID,
    ts: 1_805_000_000_000,
    profile: {
      kind: input.profileId.startsWith("agt_") ? "agent" : "human",
      profileId: input.profileId,
      profileName: input.profileId.startsWith("agt_") ? "Agent" : "Mira",
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...input.data,
    },
  };
}

function buildSystemNoticeSignal(input: {
  data: Partial<SystemNoticeData>;
  id: string;
}): Extract<SignalEnvelope, { type: "signal.system_notice" }> {
  return {
    v: 1,
    id: input.id,
    spaceId: SPACE_ID,
    ts: 1_805_000_000_000,
    profile: {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld System",
    },
    type: "signal.system_notice",
    data: input.data,
  } as Extract<SignalEnvelope, { type: "signal.system_notice" }>;
}
