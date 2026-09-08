import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it, vi } from "vitest";
import { prepareCliSpaceComposerSubmission } from "../src/space/composer-submission-adapter";

const agentId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const humanId = "11111111-1111-4111-8111-111111111111";
const snapshot = createSpaceMembersSnapshot({
  agents: [
    createSpaceMemberAgentSnapshot({
      profileId: agentId,
      profileName: "Review (wake) @ East",
      status: "active",
    }),
  ],
  humans: [
    createSpaceMemberHumanSnapshot({
      profileId: humanId,
      profileName: "Alex (Design)",
      status: "active",
    }),
  ],
});
const prepare = (
  input: Partial<Parameters<typeof prepareCliSpaceComposerSubmission>[0]> = {}
) =>
  prepareCliSpaceComposerSubmission({
    text: "Please review.",
    missingSnapshotMessage: "Members unavailable",
    loadMembersSnapshot: async () => snapshot,
    ...input,
  });

describe("explicit CLI Space addressing", () => {
  it("never turns body syntax into recipients or loads members for ordinary text", async () => {
    const loadMembersSnapshot = vi.fn();
    const text =
      "Example: @Review(wake), @Alex(mention), @Review(reference), @Review(cc).";
    const result = await prepare({ text, loadMembersSnapshot });
    expect(result.outboundText).toBe(text);
    expect(result.outboundMessageEnvelope).toBeUndefined();
    expect(loadMembersSnapshot).not.toHaveBeenCalled();
  });
  it("resolves exact IDs and keeps punctuation in display names", async () => {
    const result = await prepare({
      wakeTargets: [agentId],
      mentionTargets: [humanId],
    });
    expect(result.outboundMessageEnvelope).toMatchObject({
      activationTargets: [agentId],
      mentionTargets: [humanId],
      referenceTargets: [],
    });
    expect(result.outboundText).toBe(
      "@Review (wake) @ East @Alex (Design) Please review."
    );
  });
  it("deduplicates the same explicit target without dispatching twice", async () => {
    expect(
      (await prepare({ wakeTargets: [agentId, agentId] }))
        .outboundMessageEnvelope?.activationTargets
    ).toEqual([agentId]);
  });
  it("rejects conflicting relations rather than choosing an action", async () => {
    await expect(
      prepare({ wakeTargets: [agentId], referenceTargets: [agentId] })
    ).rejects.toMatchObject({
      code: "addressing.target_reused_across_relations",
    });
  });
  it("rejects names, shortened IDs, and absent profiles", async () => {
    for (const target of [
      "Review (wake) @ East",
      agentId.slice(0, 12),
      "agt_missing",
    ]) {
      await expect(prepare({ wakeTargets: [target] })).rejects.toMatchObject({
        code: "addressing.target_not_in_current_space",
      });
    }
  });
  it("rejects relation and profile-kind mismatches", async () => {
    await expect(prepare({ wakeTargets: [humanId] })).rejects.toMatchObject({
      code: "addressing.relation_incompatible",
    });
    await expect(prepare({ mentionTargets: [agentId] })).rejects.toMatchObject({
      code: "addressing.relation_incompatible",
    });
  });
  it("fails closed when explicit recipients cannot be checked", async () => {
    await expect(
      prepare({ wakeTargets: [agentId], loadMembersSnapshot: async () => null })
    ).rejects.toMatchObject({ code: "addressing.members_snapshot_missing" });
  });
});
