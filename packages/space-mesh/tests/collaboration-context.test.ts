import { describe, expect, it } from "vitest";
import { buildSpaceWakeParticipantLines } from "../src/collaboration-context";

describe("Space Wake participants", () => {
  it("does not make a listener an activated participant or assign work", () => {
    const lines = buildSpaceWakeParticipantLines({
      targetProfileId: "listener",
      activationTargets: ["alice", "bob"],
      sourceSignalId: "source",
      readOutcomesInstruction: "use the current-results tool",
    }).join("\n");
    expect(lines).toContain('["alice","bob"]');
    expect(lines).not.toContain("including you");
    expect(lines).toContain(
      "Activation is not evidence that any Agent has contributed."
    );
    expect(lines).toContain("use the current-results tool only if");
    expect(lines).not.toContain("openmeld space");
  });

  it("does not offer source-scoped results without a source", () => {
    expect(
      buildSpaceWakeParticipantLines({
        targetProfileId: "alice",
        activationTargets: ["alice", "bob"],
        sourceSignalId: null,
        readOutcomesInstruction: "use the current-results tool",
      })
    ).toEqual([]);
  });
});
