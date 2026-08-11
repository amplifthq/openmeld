import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  buildDispatchContinuitySnapshot,
  resolveDispatchContinuitySnapshotForDecision,
} from "../space/rules/dispatch/dispatch-continuity";

const OWNER_LINEAGE = {
  "human-root": null,
  "human-sibling": null,
  "agent-parent": "human-root",
  "agent-child": "agent-parent",
} as const;

function createTextSignal(input: {
  id: string;
  profileId: string;
  profileKind: "human" | "agent" | "system";
  text: string;
  transient?: boolean;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 2, 20, 0, 0, 0),
    profile: {
      kind: input.profileKind,
      profileId: input.profileId,
      profileName: input.profileId,
    },
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.transient ? { meta: { transient: true } } : {}),
    },
  };
}

function createStatusSignal(input: {
  id: string;
  profileId: string;
  profileKind: "human" | "agent" | "system";
  text: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 2, 20, 0, 0, 1),
    profile: {
      kind: input.profileKind,
      profileId: input.profileId,
      profileName: input.profileId,
    },
    type: "signal.status",
    data: {
      actorProfileId: input.profileId,
      status: "done",
      dispatchId: "dispatch-1",
      text: input.text,
      generatedBy: "openmeld",
    },
  };
}

function createSystemNoticeSignal(input: {
  id: string;
  profileId: string;
  text: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-1",
    ts: Date.UTC(2026, 2, 20, 0, 0, 2),
    profile: {
      kind: "system",
      profileId: "openmeld.system.dispatch",
      profileName: "system",
    },
    type: "signal.system_notice",
    data: {
      noticeType: "stay_silent",
      actorProfileId: input.profileId,
      dispatchId: "dispatch-2",
      reason: "Handled privately.",
      text: input.text,
      generatedBy: "openmeld",
    },
  };
}

describe("dispatch continuity", () => {
  it("counts only public text/status updates and flags ancestor human updates", () => {
    const continuity = buildDispatchContinuitySnapshot({
      signals: [
        createTextSignal({
          id: "evt-1",
          profileId: "agent-child",
          profileKind: "agent",
          text: "previous public reply",
        }),
        createSystemNoticeSignal({
          id: "evt-2",
          profileId: "agent-child",
          text: "kept private",
        }),
        createTextSignal({
          id: "evt-3",
          profileId: "human-root",
          profileKind: "human",
          text: "founder updated the room",
        }),
        createTextSignal({
          id: "evt-4",
          profileId: "human-sibling",
          profileKind: "human",
          text: "side chatter",
        }),
        createStatusSignal({
          id: "evt-5",
          profileId: "agent-parent",
          profileKind: "agent",
          text: "agent is ready",
        }),
        createTextSignal({
          id: "evt-6",
          profileId: "system-1",
          profileKind: "system",
          text: "internal hint",
        }),
        createTextSignal({
          id: "evt-7",
          profileId: "human-root",
          profileKind: "human",
          text: "transient ping",
          transient: true,
        }),
      ],
      targetProfileId: "agent-child",
      creatorProfileIdByProfileId: OWNER_LINEAGE,
    });

    expect(continuity).toEqual({
      messagesSinceThen: 3,
      higherAuthorityUpdates: true,
    });
  });

  it("does not mark sibling or unrelated human updates as higher authority", () => {
    const continuity = buildDispatchContinuitySnapshot({
      signals: [
        createTextSignal({
          id: "evt-1",
          profileId: "agent-child",
          profileKind: "agent",
          text: "previous public reply",
        }),
        createTextSignal({
          id: "evt-2",
          profileId: "human-sibling",
          profileKind: "human",
          text: "sibling follow-up",
        }),
      ],
      targetProfileId: "agent-child",
      creatorProfileIdByProfileId: OWNER_LINEAGE,
    });

    expect(continuity).toEqual({
      messagesSinceThen: 1,
      higherAuthorityUpdates: false,
    });
  });

  it("resolves continuity lineage from the target member owner map", () => {
    const continuity = resolveDispatchContinuitySnapshotForDecision({
      activeMemberByProfileId: new Map([
        [
          "agent-child",
          {
            ownerUserIdSnapshot: "owner-1",
          },
        ],
      ]),
      ownerCreatorProfileIdsByOwnerUserId: new Map([
        [
          "owner-1",
          {
            "human-root": null,
            "agent-child": "human-root",
          },
        ],
      ]),
      recentSignals: [
        createTextSignal({
          id: "evt-1",
          profileId: "agent-child",
          profileKind: "agent",
          text: "previous public reply",
        }),
        createTextSignal({
          id: "evt-2",
          profileId: "human-root",
          profileKind: "human",
          text: "owner follow-up",
        }),
      ],
      targetProfileId: "agent-child",
    });

    expect(continuity).toEqual({
      messagesSinceThen: 1,
      higherAuthorityUpdates: true,
    });
  });
});
