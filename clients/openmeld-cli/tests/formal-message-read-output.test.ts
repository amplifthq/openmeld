import type { SignalEnvelope } from "@openmeld/protocol";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  DispatchResult,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { buildSignalIndex } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  buildFormalDispatchResultReadPayload,
  buildFormalSignalReadPayload,
} from "../src/space/read-projection/formal-message-read-output";

const HUMAN_FELIX_PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_PHASE_PROFILE_ID = "agt_22222222-2222-2222-2222-222222222222";

const MEMBERS_SNAPSHOT: SpaceMembersSnapshot = createSpaceMembersSnapshot({
  agents: [
    createSpaceMemberAgentSnapshot({
      addedAt: "2026-04-02T00:00:00.000Z",
      addedByDisplayName: "Felix",
      addedByOwnerUserId: "user-felix",
      addedByProfileId: HUMAN_FELIX_PROFILE_ID,
      createdAt: "2026-04-02T00:00:00.000Z",
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      memberSourceLabel: "Added by member",
      ownerName: "Felix",
      ownerUserId: "user-felix",
      profileId: AGENT_PHASE_PROFILE_ID,
      profileName: "Phase 2a Agent",
      updatedAt: "2026-04-02T00:00:00.000Z",
      wakeabilityReasonText: "Ready",
      workingDirectory: null,
    }),
  ],
  generatedAt: "2026-04-02T00:00:00.000Z",
  humans: [
    createSpaceMemberHumanSnapshot({
      addedAt: "2026-04-02T00:00:00.000Z",
      createdAt: "2026-04-02T00:00:00.000Z",
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      liveNow: true,
      memberSource: "joined_directly",
      memberSourceLabel: "Joined directly",
      ownerName: "Felix",
      ownerUserId: "user-felix",
      profileId: HUMAN_FELIX_PROFILE_ID,
      profileName: "Felix",
      updatedAt: "2026-04-02T00:00:00.000Z",
    }),
  ],
  spaceId: "space-1",
});

describe("formal message read output", () => {
  it("adds messageReadProjection to message-like signals", () => {
    const sourceSignal: SignalEnvelope = {
      v: 1,
      id: "sig-source",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 0, 0),
      profile: {
        kind: "human",
        profileId: HUMAN_FELIX_PROFILE_ID,
        profileName: "Felix",
      },
      type: "signal.text",
      data: {
        text: "@Phase 2a Agent(wake) Please help.",
        messageEnvelope: {
          text: "@Phase 2a Agent(wake) Please help.",
          activationTargets: [AGENT_PHASE_PROFILE_ID],
          referenceTargets: [],
        },
      },
    };
    const replySignal: SignalEnvelope = {
      v: 1,
      id: "sig-status",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 1, 0),
      profile: {
        kind: "agent",
        profileId: AGENT_PHASE_PROFILE_ID,
        profileName: "Phase 2a Agent",
      },
      type: "signal.status",
      data: {
        actorProfileId: AGENT_PHASE_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        status: "done",
        text: "Done.",
        replyTo: {
          signalId: "sig-source",
          profileId: HUMAN_FELIX_PROFILE_ID,
          profileKind: "human",
          profileName: "Felix",
          previewText: "@Phase 2a Agent(wake) Please help.",
        },
      },
    };

    const payload = buildFormalSignalReadPayload({
      signal: replySignal,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([sourceSignal, replySignal]),
    });

    expect(payload.messageReadProjection?.replyToSignalId).toBe("sig-source");
    expect(payload.messageReadProjection?.replyToContext).toMatchObject({
      actorDisplayName: "Felix",
      resolved: true,
      relationSummary: [
        {
          relation: "wake",
          targets: [
            {
              displayName: "Phase 2a Agent",
            },
          ],
        },
      ],
    });
  });

  it("adds messageReadProjection to system notices", () => {
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-notice",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 2, 0),
      profile: {
        kind: "system",
        profileId: "system",
        profileName: "system",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "stay_silent",
        actorProfileId: AGENT_PHASE_PROFILE_ID,
        actorName: "Phase 2a Agent",
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        reason: "Handled privately.",
        text: "Phase 2a Agent chose to stay silent.",
      },
    };

    expect(buildFormalSignalReadPayload({ signal })).toMatchObject({
      type: "signal.system_notice",
      messageReadProjection: {
        text: "Phase 2a Agent chose to stay silent.",
        wakeTargets: [],
        referenceTargets: [],
        replyToSignalId: null,
        replyToContext: null,
      },
    });
  });

  it("adds messageReadProjection to dispatch results", () => {
    const sourceSignal: SignalEnvelope = {
      v: 1,
      id: "sig-origin",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 0, 0),
      profile: {
        kind: "human",
        profileId: HUMAN_FELIX_PROFILE_ID,
        profileName: "Felix",
      },
      type: "signal.text",
      data: {
        text: "@Phase 2a Agent(reference) Background context.",
        messageEnvelope: {
          text: "@Phase 2a Agent(reference) Background context.",
          activationTargets: [],
          referenceTargets: [AGENT_PHASE_PROFILE_ID],
        },
      },
    };
    const result: DispatchResult = {
      resultRef: "result-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      actorProfileId: AGENT_PHASE_PROFILE_ID,
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Thanks.",
      messageEnvelope: {
        text: "Thanks.",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-origin",
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };

    const payload = buildFormalDispatchResultReadPayload({
      result,
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([sourceSignal]),
    });

    expect(payload.messageReadProjection.replyToContext).toMatchObject({
      signalId: "sig-origin",
      actorDisplayName: "Felix",
      resolved: true,
      relationSummary: [
        {
          relation: "reference",
          targets: [
            {
              displayName: "Phase 2a Agent",
            },
          ],
        },
      ],
    });
  });

  it("keeps dispatch execution evidence in formal payloads", () => {
    const dispatchExecution = {
      sourceSignalId: "sig-origin",
      targetDispatches: [
        {
          dispatchId: "dispatch-1",
          dispatchStatus: "blocked",
          latestAttemptStatus: "blocked",
          reasonCode: "route.not_registered",
          reasonText: "Route is not registered.",
          status: "blocked" as const,
          targetDisplayName: "Phase 2a Agent",
          targetProfileId: AGENT_PHASE_PROFILE_ID,
        },
      ],
    };
    const signal: SignalEnvelope = {
      v: 1,
      id: "sig-status",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 1, 0),
      profile: {
        kind: "agent",
        profileId: AGENT_PHASE_PROFILE_ID,
        profileName: "Phase 2a Agent",
      },
      type: "signal.status",
      data: {
        actorProfileId: AGENT_PHASE_PROFILE_ID,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        status: "done",
        text: "Done.",
      },
    };
    const result: DispatchResult = {
      resultRef: "result-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      actorProfileId: AGENT_PHASE_PROFILE_ID,
      actorName: "Phase 2a Agent",
      resultKind: "text",
      finalText: "Thanks.",
      messageEnvelope: {
        text: "Thanks.",
        activationTargets: [],
        referenceTargets: [],
      },
      publicOutcome: "post_message",
      createdAt: "2026-04-02T00:00:00.000Z",
    };

    expect(
      buildFormalSignalReadPayload({
        signal,
        dispatchExecution,
      }).dispatchExecution
    ).toEqual(dispatchExecution);
    expect(
      buildFormalDispatchResultReadPayload({
        result,
      })
    ).not.toHaveProperty("dispatchExecution");
  });

  it("adds copyable trace commands for wake source signals and agent replies", () => {
    const wakeSignal: SignalEnvelope = {
      v: 1,
      id: "sig-wake",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 0, 0),
      profile: {
        kind: "human",
        profileId: HUMAN_FELIX_PROFILE_ID,
        profileName: "Felix",
      },
      type: "signal.text",
      data: {
        text: "@Phase 2a Agent(wake) Please help.",
        messageEnvelope: {
          text: "@Phase 2a Agent(wake) Please help.",
          activationTargets: [AGENT_PHASE_PROFILE_ID],
          referenceTargets: [],
        },
        meta: {
          clientMessageId: "client-message-1",
        },
      },
    };
    const replySignal: SignalEnvelope = {
      v: 1,
      id: "sig-reply",
      spaceId: "space-1",
      ts: Date.UTC(2026, 3, 2, 0, 1, 0),
      profile: {
        kind: "agent",
        profileId: AGENT_PHASE_PROFILE_ID,
        profileName: "Phase 2a Agent",
      },
      type: "signal.text",
      data: {
        text: "Done.",
        meta: {
          dispatchId: "dispatch-1",
          purpose: "agent_reply_final",
          targetProfileId: AGENT_PHASE_PROFILE_ID,
        },
      },
    };

    expect(
      buildFormalSignalReadPayload({
        signal: wakeSignal,
        membersSnapshot: MEMBERS_SNAPSHOT,
      }).diagnostics?.traceCommands
    ).toEqual([
      "openmeld service trace --space space-1 --client-message client-message-1 --target-profile agt_22222222-2222-2222-2222-222222222222 --view agent",
    ]);
    expect(
      buildFormalSignalReadPayload({ signal: replySignal }).diagnostics
    ).toMatchObject({
      traceCommands: [
        "openmeld service trace --space space-1 --dispatch dispatch-1 --view agent",
      ],
    });
    expect(
      buildFormalSignalReadPayload({ signal: wakeSignal }).diagnostics
    ).toMatchObject({
      traceCommands: [
        "openmeld service trace --space space-1 --client-message client-message-1 --target-profile agt_22222222-2222-2222-2222-222222222222 --view agent",
      ],
    });
  });
});
