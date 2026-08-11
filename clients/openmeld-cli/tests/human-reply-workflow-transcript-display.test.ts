import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type { SpaceReplyWorkflowProjection } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { buildHumanReplyWorkflowTranscriptCueLine } from "../src/space/read-projection/human-reply-workflow-transcript-display";

const MEMBERS_SNAPSHOT: SpaceMembersSnapshot = {
  spaceId: "space-1",
  generatedAt: "2026-04-09T00:00:00.000Z",
  summary: {
    totalCount: 1,
    humanCount: 1,
    agentCount: 0,
    liveNowCount: 0,
  },
  humans: [
    {
      profileId: "hum_felix",
      profileName: "Felix",
      profileKind: "human",
      mentionAlias: null,
      status: "active",
      memberSource: "space_creator",
      memberSourceLabel: "Creator",
      addedAt: "2026-04-09T00:00:00.000Z",
      removedAt: null,
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayName: null,
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: null,
      lastEnteredAt: null,
      lastSeenAt: null,
      lastSeenLabel: null,
      liveNow: false,
      ownerUserId: "user-1",
      ownerName: "Felix",
    },
  ],
  agents: [],
};

function createProjection(
  overrides: Partial<SpaceReplyWorkflowProjection> = {}
): SpaceReplyWorkflowProjection {
  const hasOwn = <K extends keyof SpaceReplyWorkflowProjection>(key: K) =>
    Object.hasOwn(overrides, key);

  return {
    sourceSignalId: overrides.sourceSignalId ?? "sig-source",
    replyToSignalId: overrides.replyToSignalId ?? "sig-source",
    publicOutcome: overrides.publicOutcome ?? "post_message",
    publishedSignalId: overrides.publishedSignalId ?? "sig-published",
    publishedSignalType: overrides.publishedSignalType ?? "signal.text",
    hasPublicSignal: overrides.hasPublicSignal ?? true,
    hasPublicAgentReplyText: overrides.hasPublicAgentReplyText ?? true,
    dispatchExecution: hasOwn("dispatchExecution")
      ? (overrides.dispatchExecution ?? null)
      : null,
    replyToContext: hasOwn("replyToContext")
      ? (overrides.replyToContext ?? null)
      : {
          signalId: "sig-source",
          actorProfileId: "hum_felix",
          actorProfileKind: "human",
          actorDisplayName: "Felix",
          previewText: "@Ops Bot(wake) Please help",
          relationSummary: [
            {
              relation: "wake",
              targets: [
                {
                  profileId: "agt_ops",
                  profileKind: "agent",
                  displayName: "Ops Bot",
                  displaySource: "member_snapshot",
                },
              ],
            },
          ],
          resolved: true,
        },
  };
}

describe("human reply workflow transcript display", () => {
  it("prefers shared semantic reply context when workflow projection is available", () => {
    expect(
      buildHumanReplyWorkflowTranscriptCueLine({
        membersSnapshot: MEMBERS_SNAPSHOT,
        replyWorkflowProjection: createProjection(),
      })
    ).toBe("reply to Felix · wake: Ops Bot");
  });

  it("falls back to the legacy replyRef when workflow projection has no semantic reply context", () => {
    expect(
      buildHumanReplyWorkflowTranscriptCueLine({
        membersSnapshot: MEMBERS_SNAPSHOT,
        replyWorkflowProjection: createProjection({
          replyToContext: null,
        }),
        replyRef: {
          signalId: "sig-source",
          profileId: "hum_felix",
          profileKind: "human",
          profileName: "Felix",
          previewText: "Legacy preview text that should remain visible",
        },
      })
    ).toBe("reply to Felix · Legacy preview text that should…");
  });

  it("keeps unresolved structured reply context on an actor-only summary instead of preview drift", () => {
    expect(
      buildHumanReplyWorkflowTranscriptCueLine({
        membersSnapshot: MEMBERS_SNAPSHOT,
        replyWorkflowProjection: createProjection({
          replyToContext: {
            signalId: "sig-source",
            actorProfileId: "hum_felix",
            actorProfileKind: "human",
            actorDisplayName: "Felix",
            previewText:
              "Legacy preview text that should not replace semantics",
            relationSummary: null,
            resolved: false,
          },
        }),
      })
    ).toBe("reply to Felix");
  });

  it("returns null when neither shared workflow reply context nor replyRef exists", () => {
    expect(
      buildHumanReplyWorkflowTranscriptCueLine({
        membersSnapshot: MEMBERS_SNAPSHOT,
        replyWorkflowProjection: createProjection({
          replyToContext: null,
        }),
      })
    ).toBeNull();
  });
});
