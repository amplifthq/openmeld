import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  REMOTE_AGENT_FAILURE_PURPOSE,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  resolveFinalVisibleMessageTraceReadResult,
  toFinalVisibleMessageTraceRecordFromRawSignal,
} from "../space/transport/do/space";

const BASE_SIGNAL = {
  v: 1,
  id: "sig-final-1",
  spaceId: "space-1",
  ts: 1_700_000_000_000,
  profile: {
    kind: "system",
    profileId: "openmeld-system",
    profileName: "OpenMeld",
  },
} as const;
const TARGET_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("dispatch final visible message trace", () => {
  it("projects a terminal failure system notice from the stored Space signal", () => {
    const signal = {
      ...BASE_SIGNAL,
      type: "signal.system_notice",
      data: {
        actorName: "Claude Code",
        actorProfileId: TARGET_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "auth.required",
        text: "Claude Code subscription access is unavailable for this account.",
      },
    } satisfies SignalEnvelope;

    expect(
      toFinalVisibleMessageTraceRecordFromRawSignal({
        dispatchId: "dispatch-1",
        factSource: "space_signal_by_published_signal_id",
        rawSignal: JSON.stringify(signal),
        targetProfileId: TARGET_PROFILE_ID,
      })
    ).toEqual({
      factSource: "space_signal_by_published_signal_id",
      signalId: "sig-final-1",
      signalType: "signal.system_notice",
      dispatchId: "dispatch-1",
      targetProfileId: TARGET_PROFILE_ID,
      profileId: "openmeld-system",
      profileKind: "system",
      profileName: "OpenMeld",
      text: "Claude Code subscription access is unavailable for this account.",
      reasonCode: "auth.required",
      noticeType: "terminal_failure",
      statusType: null,
      createdAt: "2023-11-14T22:13:20.000Z",
    });
  });

  it("projects a published Remote Agent failure text as the final visible failure", () => {
    const signal = {
      ...BASE_SIGNAL,
      id: "sig-remote-agent-failure-1",
      type: "signal.text",
      profile: {
        kind: "agent",
        profileId: TARGET_PROFILE_ID,
        profileName: "Center Agent",
      },
      data: {
        text: "Center Agent could not complete this request.",
        meta: {
          dispatchId: "dispatch-1",
          errorCode: "remote_agent.turn_not_completed",
          purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          targetProfileId: TARGET_PROFILE_ID,
        },
      },
    } satisfies SignalEnvelope;

    const result = resolveFinalVisibleMessageTraceReadResult({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: [signal.id],
      readFinalReplyClaimSignalId: () => null,
      readRawSignalById: (signalId) =>
        signalId === signal.id ? JSON.stringify(signal) : null,
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(result.finalVisibleMessage).toMatchObject({
      factSource: "space_signal_by_published_signal_id",
      signalId: signal.id,
      signalType: "signal.text",
      dispatchId: "dispatch-1",
      targetProfileId: TARGET_PROFILE_ID,
      reasonCode: "remote_agent.turn_not_completed",
    });
    expect(result.finalVisibleMessageLinkage).toMatchObject({
      status: "matched_published_signal",
      selectedSignalId: signal.id,
    });
  });

  it("projects a Wake stopped system notice from the stored Space signal", () => {
    const signal = {
      ...BASE_SIGNAL,
      id: "sig-wake-stopped-1",
      type: "signal.system_notice",
      data: {
        actorName: "Codex",
        actorProfileId: TARGET_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "wake_stopped",
        reason: "runtime_coordinator.wake_stop_local_control_accepted",
        text: "Wake was stopped for @Codex.",
      },
    } as unknown as SignalEnvelope;

    expect(
      toFinalVisibleMessageTraceRecordFromRawSignal({
        dispatchId: "dispatch-1",
        factSource: "space_signal_by_published_signal_id",
        rawSignal: JSON.stringify(signal),
        targetProfileId: TARGET_PROFILE_ID,
      })
    ).toMatchObject({
      signalId: "sig-wake-stopped-1",
      signalType: "signal.system_notice",
      dispatchId: "dispatch-1",
      targetProfileId: TARGET_PROFILE_ID,
      text: "Wake was stopped for @Codex.",
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      noticeType: "wake_stopped",
    });
  });

  it("projects a stay-silent system notice from the stored Space signal", () => {
    const signal = {
      ...BASE_SIGNAL,
      id: "sig-stay-silent-1",
      type: "signal.system_notice",
      data: {
        actorName: "Codex",
        actorProfileId: TARGET_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "stay_silent",
        reason: "No public update is needed.",
        text: "Codex chose to stay silent.",
      },
    } satisfies SignalEnvelope;

    expect(
      toFinalVisibleMessageTraceRecordFromRawSignal({
        dispatchId: "dispatch-1",
        factSource: "space_signal_by_published_signal_id",
        rawSignal: JSON.stringify(signal),
        targetProfileId: TARGET_PROFILE_ID,
      })
    ).toMatchObject({
      signalId: "sig-stay-silent-1",
      signalType: "signal.system_notice",
      dispatchId: "dispatch-1",
      targetProfileId: TARGET_PROFILE_ID,
      text: "Codex chose to stay silent.",
      reasonCode: "No public update is needed.",
      noticeType: "stay_silent",
    });
  });

  it("projects a policy-blocked system notice from the stored Space signal", () => {
    const signal = {
      ...BASE_SIGNAL,
      id: "sig-policy-blocked-1",
      type: "signal.system_notice",
      data: {
        actorName: "Codex",
        actorProfileId: TARGET_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "policy_blocked",
        reason: "This Space does not allow post_message.",
        text: "OpenMeld blocked a public reply from Codex: This Space does not allow post_message.",
      },
    } satisfies SignalEnvelope;

    expect(
      toFinalVisibleMessageTraceRecordFromRawSignal({
        dispatchId: "dispatch-1",
        factSource: "space_signal_by_published_signal_id",
        rawSignal: JSON.stringify(signal),
        targetProfileId: TARGET_PROFILE_ID,
      })
    ).toMatchObject({
      signalId: "sig-policy-blocked-1",
      signalType: "signal.system_notice",
      dispatchId: "dispatch-1",
      targetProfileId: TARGET_PROFILE_ID,
      text: "OpenMeld blocked a public reply from Codex: This Space does not allow post_message.",
      reasonCode: "This Space does not allow post_message.",
      noticeType: "policy_blocked",
    });
  });

  it("rejects a stored final signal that belongs to a different target", () => {
    const signal = {
      ...BASE_SIGNAL,
      type: "signal.system_notice",
      data: {
        actorProfileId: "agt_44444444-4444-4444-8444-444444444444",
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "auth.required",
        text: "Claude Code subscription access is unavailable for this account.",
      },
    } satisfies SignalEnvelope;

    expect(
      toFinalVisibleMessageTraceRecordFromRawSignal({
        dispatchId: "dispatch-1",
        factSource: "space_signal_by_published_signal_id",
        rawSignal: JSON.stringify(signal),
        targetProfileId: TARGET_PROFILE_ID,
      })
    ).toBeNull();
  });

  it("falls back to the Space final reply claim when publication candidates are not linked yet", () => {
    const signal = {
      ...BASE_SIGNAL,
      id: "sig-claim-final-1",
      type: "signal.text",
      profile: {
        kind: "agent",
        profileId: TARGET_PROFILE_ID,
        profileName: "Codex",
      },
      data: {
        text: "Done from the claimed final reply.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          targetProfileId: TARGET_PROFILE_ID,
        },
      },
    } satisfies SignalEnvelope;

    const result = resolveFinalVisibleMessageTraceReadResult({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: [],
      readFinalReplyClaimSignalId: () => "sig-claim-final-1",
      readRawSignalById: (signalId) =>
        signalId === "sig-claim-final-1" ? JSON.stringify(signal) : null,
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(result.finalVisibleMessage).toMatchObject({
      factSource: "space_final_reply_claim",
      signalId: "sig-claim-final-1",
      signalType: "signal.text",
      dispatchId: "dispatch-1",
      targetProfileId: TARGET_PROFILE_ID,
    });
    expect(result.finalVisibleMessageLinkage).toEqual({
      status: "matched_final_reply_claim",
      reasonCode: "final_visible_message.matched_final_reply_claim",
      sourceFact: "space_final_reply_claim",
      candidateSignalIds: [],
      claimSignalId: "sig-claim-final-1",
      selectedSignalId: "sig-claim-final-1",
    });
  });

  it("rejects a final reply claim whose text signal is not marked as the final reply", () => {
    const signal = {
      ...BASE_SIGNAL,
      id: "sig-claim-non-final-1",
      type: "signal.text",
      profile: {
        kind: "agent",
        profileId: TARGET_PROFILE_ID,
        profileName: "Codex",
      },
      data: {
        text: "This is not the final public reply.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: "agent_reply_preview",
          targetProfileId: TARGET_PROFILE_ID,
        },
      },
    } satisfies SignalEnvelope;

    const result = resolveFinalVisibleMessageTraceReadResult({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: [],
      readFinalReplyClaimSignalId: () => "sig-claim-non-final-1",
      readRawSignalById: () => JSON.stringify(signal),
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(result.finalVisibleMessage).toBeNull();
    expect(result.finalVisibleMessageLinkage).toMatchObject({
      status: "storage_inconsistent",
      reasonCode: "final_visible_message.claim_signal_mismatch",
      sourceFact: "space_final_reply_claim",
      claimSignalId: "sig-claim-non-final-1",
    });
  });

  it("diagnoses a final reply claim whose Space signal is missing", () => {
    const result = resolveFinalVisibleMessageTraceReadResult({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: [],
      readFinalReplyClaimSignalId: () => "sig-missing-final-1",
      readRawSignalById: () => null,
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(result.finalVisibleMessage).toBeNull();
    expect(result.finalVisibleMessageLinkage).toMatchObject({
      status: "storage_inconsistent",
      reasonCode: "final_visible_message.claim_signal_missing",
      sourceFact: "space_final_reply_claim",
      claimSignalId: "sig-missing-final-1",
    });
  });

  it("diagnoses a published signal candidate that cannot be verified", () => {
    const result = resolveFinalVisibleMessageTraceReadResult({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: ["sig-published-missing-1"],
      readFinalReplyClaimSignalId: () => null,
      readRawSignalById: () => null,
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(result.finalVisibleMessage).toBeNull();
    expect(result.finalVisibleMessageLinkage).toEqual({
      status: "linkage_missing",
      reasonCode: "final_visible_message.published_signal_missing",
      sourceFact: "published_signal_candidate",
      candidateSignalIds: ["sig-published-missing-1"],
      claimSignalId: null,
      selectedSignalId: null,
    });
  });

  it("marks final visible projection as pending when there is no candidate or claim", () => {
    const result = resolveFinalVisibleMessageTraceReadResult({
      dispatchId: "dispatch-1",
      publishedSignalIdCandidates: [],
      readFinalReplyClaimSignalId: () => null,
      readRawSignalById: () => null,
      targetProfileId: TARGET_PROFILE_ID,
    });

    expect(result.finalVisibleMessage).toBeNull();
    expect(result.finalVisibleMessageLinkage).toEqual({
      status: "projection_pending",
      reasonCode: "final_visible_message.projection_pending",
      sourceFact: "none",
      candidateSignalIds: [],
      claimSignalId: null,
      selectedSignalId: null,
    });
  });
});
