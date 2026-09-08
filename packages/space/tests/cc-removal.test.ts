import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildSignalMessageReadProjection,
  buildSpaceRoundReadProjection,
  listSpaceMentionRelationChoices,
} from "../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";

const snapshot = {
  spaceId: "space-1",
  generatedAt: "2026-07-19T00:00:00.000Z",
  humans: [
    {
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Mira",
      mentionAlias: null,
      ownerUserId: HUMAN_PROFILE_ID,
      ownerName: "Mira",
      status: "active",
      liveNow: true,
    },
  ],
  agents: [
    {
      profileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileName: "Reviewer",
      mentionAlias: null,
      ownerUserId: HUMAN_PROFILE_ID,
      ownerName: "Mira",
      status: "active",
      liveNow: true,
      agentControllerRef: "codex",
      agentWakeAvailability: {
        status: "available_for_wake",
        reasonCode: null,
        summary: "Ready to Wake.",
        tooltip: "Ready",
      },
    },
  ],
} as unknown as SpaceMembersSnapshot;

describe("current Space addressing without CC", () => {
  it("offers Wake and Reference for agents and Mention for humans", () => {
    expect(
      listSpaceMentionRelationChoices({
        allowedRelations: { wake: true, reference: true, mention: false },
        primaryMentionLabel: "Reviewer",
        wakeAvailability: {
          status: "ready",
          reasonCodes: [],
          reasonText: null,
        },
      }).map((choice) => choice.label)
    ).toEqual(["Wake", "Reference"]);

    expect(
      listSpaceMentionRelationChoices({
        allowedRelations: { wake: false, reference: false, mention: true },
        primaryMentionLabel: "Mira",
        wakeAvailability: {
          status: "unsupported",
          reasonCodes: [],
          reasonText: null,
        },
      }).map((choice) => choice.label)
    ).toEqual(["Mention"]);
  });

  it("projects historical CC targets as Reference-only no-dispatch targets", () => {
    const historicalSignal = {
      v: 1,
      id: "signal-1",
      spaceId: "space-1",
      ts: 1,
      profile: {
        kind: "human",
        profileId: HUMAN_PROFILE_ID,
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        text: "Historical CC",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          ccTargets: [AGENT_PROFILE_ID],
          text: "Historical CC",
        },
      },
    } as unknown as SignalEnvelope;

    const message = buildSignalMessageReadProjection({
      signal: historicalSignal,
      membersSnapshot: snapshot,
    });
    expect(message.referenceTargets.map((target) => target.profileId)).toEqual([
      AGENT_PROFILE_ID,
    ]);
    expect(message).not.toHaveProperty("ccTargets");

    const round = buildSpaceRoundReadProjection({
      sourceSignal: historicalSignal,
      sourceSignalId: historicalSignal.id,
      membersSnapshot: snapshot,
    });
    expect(round.targets).toMatchObject([
      {
        dispatchState: "no_dispatch",
        profileId: AGENT_PROFILE_ID,
        relation: "reference",
      },
    ]);
  });
});
