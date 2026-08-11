import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import { resolveMembershipNoticeFromSignalEnvelope } from "../src/space/transcript/membership-notice";

describe("resolveMembershipNoticeFromSignalEnvelope", () => {
  it("builds a structured member-added notice from signal meta", () => {
    const event: SignalEnvelope = {
      v: 1,
      id: "signal-added-agent",
      spaceId: "space-1",
      ts: new Date(2026, 2, 15, 23, 31).getTime(),
      type: "signal.text",
      profile: {
        kind: "human",
        profileId: "hum_felix",
        profileName: "Felix",
      },
      data: {
        text: "Felix added 🤖 Ops Bot to this space.",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: "agt_ops",
          targetProfileKind: "agent",
          targetProfileName: "Ops Bot",
          targetMentionLabel: "Ops Bot",
          addedByProfileId: "hum_felix",
          addedByDisplayName: "Felix",
        },
      },
    };

    expect(resolveMembershipNoticeFromSignalEnvelope(event)).toEqual({
      action: "member_added",
      actorProfileId: "hum_felix",
      actorKind: "human",
      actorLabel: "Felix",
      targetProfileId: "agt_ops",
      targetProfileKind: "agent",
      targetProfileLabel: "Ops Bot",
      mentionLabel: "Ops Bot",
      ts: new Date(2026, 2, 15, 23, 31).getTime(),
    });
  });

  it("ignores unrelated system notices", () => {
    const event: SignalEnvelope = {
      v: 1,
      id: "signal-random-system-notice",
      spaceId: "space-1",
      ts: new Date(2026, 2, 15, 23, 31).getTime(),
      type: "signal.text",
      profile: {
        kind: "human",
        profileId: "hum_felix",
        profileName: "Felix",
      },
      data: {
        text: "Felix said hello",
        meta: {
          purpose: "other_notice",
        },
      },
    };

    expect(resolveMembershipNoticeFromSignalEnvelope(event)).toBeNull();
  });

  it("builds a structured member-removed notice from signal meta", () => {
    const event: SignalEnvelope = {
      v: 1,
      id: "signal-removed-agent",
      spaceId: "space-1",
      ts: new Date(2026, 2, 16, 9, 44).getTime(),
      type: "signal.text",
      profile: {
        kind: "human",
        profileId: "hum_felix",
        profileName: "Felix",
      },
      data: {
        text: "Felix removed 🤖 Ops Bot from this space.",
        meta: {
          purpose: "space_membership_remove_notice",
          targetProfileId: "agt_ops",
          targetProfileKind: "agent",
          targetProfileName: "Ops Bot",
          targetMentionLabel: "Ops Bot",
          removedByProfileId: "hum_felix",
          removedByDisplayName: "Felix",
        },
      },
    };

    expect(resolveMembershipNoticeFromSignalEnvelope(event)).toEqual({
      action: "member_removed",
      actorProfileId: "hum_felix",
      actorKind: "human",
      actorLabel: "Felix",
      targetProfileId: "agt_ops",
      targetProfileKind: "agent",
      targetProfileLabel: "Ops Bot",
      mentionLabel: "Ops Bot",
      ts: new Date(2026, 2, 16, 9, 44).getTime(),
    });
  });

  it("falls back to the legacy target handle when an old remove notice has no mention label", () => {
    const event = {
      v: 1,
      id: "signal-removed-human-handle",
      spaceId: "space-1",
      ts: new Date(2026, 2, 16, 10, 12).getTime(),
      type: "signal.text",
      profile: {
        kind: "human",
        profileId: "hum_felix",
        profileName: "Felix",
      },
      data: {
        text: "Felix removed Alice Writer from this space.",
        meta: {
          purpose: "space_membership_remove_notice",
          targetProfileId: "hum_alice",
          targetProfileKind: "human",
          targetProfileName: "Alice Writer",
          targetProfileHandle: "@alice-writer",
          removedByProfileId: "hum_felix",
          removedByDisplayName: "Felix",
        },
      },
    } as unknown as SignalEnvelope;

    expect(resolveMembershipNoticeFromSignalEnvelope(event)).toEqual({
      action: "member_removed",
      actorProfileId: "hum_felix",
      actorKind: "human",
      actorLabel: "Felix",
      targetProfileId: "hum_alice",
      targetProfileKind: "human",
      targetProfileLabel: "Alice Writer",
      mentionLabel: "alice-writer",
      ts: new Date(2026, 2, 16, 10, 12).getTime(),
    });
  });
});
