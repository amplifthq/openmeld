import type { SignalEnvelope } from "@openmeld/protocol";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
  MessageEnvelope,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { buildSignalIndex } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  buildHumanReadSignalsTranscriptItems,
  emitHumanReadSignalsTextProjection,
} from "../src/space/read-signals-output";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const OPENMELD_PROFILE = createTestOpenMeldProfile({
  openMeldProfileId: "11111111-1111-1111-1111-111111111111",
  profileName: "Felix",
  profileKind: "human",
});

const MEMBERS_SNAPSHOT: SpaceMembersSnapshot = createSpaceMembersSnapshot({
  agents: [
    createSpaceMemberAgentSnapshot({
      addedAt: "2026-04-02T00:00:00.000Z",
      addedByDisplayName: "Felix",
      addedByOwnerUserId: "user-felix",
      addedByProfileId: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-04-02T00:00:00.000Z",
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      memberSourceLabel: "Added by member",
      ownerName: "Felix",
      ownerUserId: "user-felix",
      profileId: "agt_22222222-2222-2222-2222-222222222222",
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
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      updatedAt: "2026-04-02T00:00:00.000Z",
    }),
  ],
  spaceId: "space-1",
});

function createTextSignal(input: {
  id: string;
  profileId: string;
  profileName: string;
  text: string;
  messageEnvelope?: MessageEnvelope;
  meta?: Record<string, unknown>;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 3, 2, 12, 0, 0),
    profile: {
      kind: input.profileId.startsWith("agt_") ? "agent" : "human",
      profileId: input.profileId,
      profileName: input.profileName,
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.meta ? { meta: input.meta } : {}),
      ...(input.messageEnvelope
        ? { messageEnvelope: input.messageEnvelope }
        : {}),
    },
  };
}

describe("read signals output", () => {
  it("threads shared read projection into transcript items and resolves replyRef from signal history", () => {
    const source = createTextSignal({
      id: "sig-origin",
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileName: "Phase 2a Agent",
      text: "Earlier reply preview",
    });
    const reply = createTextSignal({
      id: "sig-reply",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "Reply body",
      messageEnvelope: {
        text: "Reply body",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-origin",
      },
    });

    const items = buildHumanReadSignalsTranscriptItems({
      openMeldProfile: OPENMELD_PROFILE,
      events: [source, reply],
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    expect(items).toHaveLength(2);
    expect(items[1]?.replyRef).toEqual({
      signalId: "sig-origin",
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileKind: "agent",
      profileName: "Phase 2a Agent",
      previewText: "Earlier reply preview",
    });
    expect(items[1]?.messageReadProjection?.replyToSignalId).toBe("sig-origin");
  });

  it("threads Wake and Reference relation lines into formatted transcript messages", () => {
    const items = buildHumanReadSignalsTranscriptItems({
      openMeldProfile: OPENMELD_PROFILE,
      events: [
        createTextSignal({
          id: "sig-semantic",
          profileId: "11111111-1111-1111-1111-111111111111",
          profileName: "Felix",
          text: "@Phase 2a Agent(wake) @Felix(reference)",
          messageEnvelope: {
            text: "@Phase 2a Agent(wake) @Felix(reference)",
            activationTargets: ["agt_22222222-2222-2222-2222-222222222222"],
            referenceTargets: ["11111111-1111-1111-1111-111111111111"],
          },
        }),
      ],
      membersSnapshot: MEMBERS_SNAPSHOT,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.formattedMessage?.relationLines).toEqual([
      "wake: Phase 2a Agent",
      "reference: Felix",
    ]);
  });

  it("uses an explicit signal index to resolve semantic reply context when the source signal is not in the event batch", () => {
    const source = createTextSignal({
      id: "sig-anchor",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "@Phase 2a Agent(wake) anchor text",
      messageEnvelope: {
        text: "@Phase 2a Agent(wake) anchor text",
        activationTargets: ["agt_22222222-2222-2222-2222-222222222222"],
        referenceTargets: [],
      },
    });
    const reply = createTextSignal({
      id: "sig-reply-only",
      profileId: "agt_22222222-2222-2222-2222-222222222222",
      profileName: "Phase 2a Agent",
      text: "Ack",
      messageEnvelope: {
        text: "Ack",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-anchor",
      },
    });

    const items = buildHumanReadSignalsTranscriptItems({
      openMeldProfile: OPENMELD_PROFILE,
      events: [reply],
      membersSnapshot: MEMBERS_SNAPSHOT,
      signalIndex: buildSignalIndex([source, reply]),
    });

    expect(items).toHaveLength(1);
    expect(
      items[0]?.messageReadProjection?.replyToContext?.relationSummary
    ).toEqual([
      {
        relation: "wake",
        targets: [
          {
            profileId: "agt_22222222-2222-2222-2222-222222222222",
            profileKind: "agent",
            displayName: "Phase 2a Agent",
            displaySource: "member_snapshot",
          },
        ],
      },
    ]);
  });

  it("keeps removed member names readable in transcript relation lines", () => {
    const removedSnapshot: SpaceMembersSnapshot = {
      ...MEMBERS_SNAPSHOT,
      summary: {
        ...MEMBERS_SNAPSHOT.summary,
        totalCount: 3,
        agentCount: 2,
      },
      agents: [
        ...MEMBERS_SNAPSHOT.agents,
        createSpaceMemberAgentSnapshot({
          addedAt: "2026-04-02T00:00:00.000Z",
          addedByDisplayName: "Felix",
          addedByOwnerUserId: "user-felix",
          addedByProfileId: "11111111-1111-1111-1111-111111111111",
          createdAt: "2026-04-02T00:00:00.000Z",
          firstEnteredAt: null,
          lastEnteredAt: null,
          lastSeenAt: null,
          lastSeenLabel: null,
          memberSourceLabel: "Added by member",
          ownerName: "Removed Agent",
          ownerUserId: "user-removed-agent",
          profileId: "agt_33333333-3333-3333-3333-333333333333",
          profileName: "Removed Agent",
          removalReason: "Removed",
          removedAt: "2026-04-03T00:00:00.000Z",
          status: "removed",
          updatedAt: "2026-04-03T00:00:00.000Z",
          wakeabilityReasonCodes: ["profile.unbound"],
          wakeabilityReasonText: "Blocked",
          wakeabilityStatus: "blocked",
          workingDirectory: null,
        }),
      ],
    };

    const items = buildHumanReadSignalsTranscriptItems({
      openMeldProfile: OPENMELD_PROFILE,
      events: [
        createTextSignal({
          id: "sig-removed-readable",
          profileId: "11111111-1111-1111-1111-111111111111",
          profileName: "Felix",
          text: "@Removed Agent(reference)",
          messageEnvelope: {
            text: "@Removed Agent(reference)",
            activationTargets: [],
            referenceTargets: ["agt_33333333-3333-3333-3333-333333333333"],
          },
        }),
      ],
      membersSnapshot: removedSnapshot,
    });

    expect(items[0]?.formattedMessage?.relationLines).toEqual([
      "reference: Removed Agent",
    ]);
  });

  it("keeps removed member names readable from signal history when the current snapshot is active-only", () => {
    const currentSnapshot: SpaceMembersSnapshot = {
      ...MEMBERS_SNAPSHOT,
      summary: {
        ...MEMBERS_SNAPSHOT.summary,
        totalCount: 2,
        humanCount: 1,
        agentCount: 1,
      },
    };

    const joinNotice = createTextSignal({
      id: "sig-join-notice",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "Felix added Removed Agent to this space.",
      meta: {
        purpose: "space_membership_join_notice",
        targetProfileId: "agt_33333333-3333-3333-3333-333333333333",
        targetProfileName: "Removed Agent",
        targetProfileKind: "agent",
      },
    });
    const removedRelationSignal = createTextSignal({
      id: "sig-removed-readable-active-only",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "@Removed Agent(reference)",
      messageEnvelope: {
        text: "@Removed Agent(reference)",
        activationTargets: [],
        referenceTargets: ["agt_33333333-3333-3333-3333-333333333333"],
      },
    });
    const removeNotice = createTextSignal({
      id: "sig-remove-notice",
      profileId: "11111111-1111-1111-1111-111111111111",
      profileName: "Felix",
      text: "Felix removed Removed Agent from this space.",
      meta: {
        purpose: "space_membership_remove_notice",
        targetProfileId: "agt_33333333-3333-3333-3333-333333333333",
        targetProfileName: "Removed Agent",
        targetProfileKind: "agent",
      },
    });

    const items = buildHumanReadSignalsTranscriptItems({
      openMeldProfile: OPENMELD_PROFILE,
      events: [removedRelationSignal],
      membersSnapshot: currentSnapshot,
      signalIndex: buildSignalIndex([
        joinNotice,
        removedRelationSignal,
        removeNotice,
      ]),
    });

    expect(items[0]?.formattedMessage?.relationLines).toEqual([
      "reference: Removed Agent",
    ]);
  });

  it("emits focused summary from the shared read-signals transcript adapter", () => {
    const lines: Array<{ code: string; text: string }> = [];
    const presenter = {
      line(input: { code: string; text: string }) {
        lines.push(input);
      },
    };

    emitHumanReadSignalsTextProjection({
      openMeldProfile: OPENMELD_PROFILE,
      presenter: presenter as never,
      transcriptItems: [],
      membersSnapshot: MEMBERS_SNAPSHOT,
      focusedSummary: "History is showing chat first. Hidden 2 system notices.",
    });

    expect(lines).toEqual([
      {
        code: "tail.history.focused_summary",
        text: "History is showing chat first. Hidden 2 system notices.",
      },
    ]);
  });
});
