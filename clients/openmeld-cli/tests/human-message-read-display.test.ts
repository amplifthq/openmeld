import type {
  SpaceMessageReadProjection,
  SpaceMessageReadTargetRef,
  SpaceMessageReplyContext,
} from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  buildHumanMessageRelationLines,
  buildHumanReplyContextLine,
  buildHumanReplyContextSummary,
  formatHumanReadTargetList,
} from "../src/space/read-projection/human-message-read-display";

function createTargetRef(
  profileId: string,
  displayName: string
): SpaceMessageReadTargetRef {
  return {
    profileId,
    profileKind: "agent",
    displayName,
    displaySource: "member_snapshot",
  };
}

function createProjection(
  input?: Partial<
    Pick<SpaceMessageReadProjection, "wakeTargets" | "referenceTargets">
  >
): Pick<SpaceMessageReadProjection, "wakeTargets" | "referenceTargets"> {
  return {
    wakeTargets: input?.wakeTargets ?? [],
    referenceTargets: input?.referenceTargets ?? [],
  };
}

function createReplyContext(
  input?: Partial<SpaceMessageReplyContext>
): SpaceMessageReplyContext {
  return {
    signalId: input?.signalId ?? "sig-1",
    actorProfileId: input?.actorProfileId ?? "hum_felix",
    actorProfileKind: input?.actorProfileKind ?? "human",
    actorDisplayName: input?.actorDisplayName ?? "Felix",
    previewText: input?.previewText ?? "Earlier preview",
    relationSummary: input?.relationSummary ?? null,
    resolved: input?.resolved ?? true,
  };
}

describe("human message read display", () => {
  it("formats relation lines in wake-reference order", () => {
    const lines = buildHumanMessageRelationLines(
      createProjection({
        wakeTargets: [createTargetRef("agt-1", "Phase 2a Agent")],
        referenceTargets: [
          createTargetRef("agt-2", "Budget Analyst"),
          createTargetRef("agt-3", "Legal"),
        ],
      })
    );

    expect(lines).toEqual([
      "wake: Phase 2a Agent",
      "reference: Budget Analyst, Legal",
    ]);
  });

  it("returns empty relation lines when projection has no targets", () => {
    expect(buildHumanMessageRelationLines(createProjection())).toEqual([]);
    expect(buildHumanMessageRelationLines(null)).toEqual([]);
  });

  it("prefers semantic reply summaries over raw preview text", () => {
    const replyContext = createReplyContext({
      relationSummary: [
        {
          relation: "wake",
          targets: [createTargetRef("agt-1", "Phase 2a Agent")],
        },
        {
          relation: "reference",
          targets: [createTargetRef("agt-2", "Budget Analyst")],
        },
      ],
      previewText: "@Phase 2a Agent(wake) Can you help?",
    });

    expect(buildHumanReplyContextSummary(replyContext)).toBe(
      "Felix · wake: Phase 2a Agent · reference: Budget Analyst"
    );
    expect(buildHumanReplyContextLine(replyContext)).toBe(
      "reply to Felix · wake: Phase 2a Agent · reference: Budget Analyst"
    );
  });

  it("falls back from raw preview to actor-only reply summaries", () => {
    expect(
      buildHumanReplyContextSummary(
        createReplyContext({
          relationSummary: null,
          previewText: "  what is your current working directory  ",
        })
      )
    ).toBe("Felix · what is your current working directory");

    expect(
      buildHumanReplyContextSummary(
        createReplyContext({
          relationSummary: null,
          previewText: "   ",
        })
      )
    ).toBe("Felix");
  });

  it("formats target lists with normalized display names", () => {
    expect(
      formatHumanReadTargetList([
        createTargetRef("agt-1", "  Budget   Analyst "),
        createTargetRef("agt-2", "Legal"),
      ])
    ).toBe("Budget Analyst, Legal");
  });
});
