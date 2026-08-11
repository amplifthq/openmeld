import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { prepareSpaceInboxCandidateForCenterAgent } from "../src/space/application/space-inbox-center-agent-candidate";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Center Agent Space Inbox candidate", () => {
  it("uses the canonical Center Agent target for a reply in the member DM", async () => {
    const harness = createHarness();
    try {
      seedCenterAgentDirectMessage(harness);

      await expect(
        prepareSpaceInboxCandidateForCenterAgent({
          candidate: candidate(),
          db: harness.db,
        })
      ).resolves.toMatchObject({
        contextLabel: "Center Agent",
        sourceTarget: {
          kind: "center_agent",
          signalId: "signal-1",
          spaceId: "space-1",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("uses the canonical Center Agent target for an attention request in the member DM", async () => {
    const harness = createHarness();
    try {
      seedCenterAgentDirectMessage(harness);

      await expect(
        prepareSpaceInboxCandidateForCenterAgent({
          candidate: {
            ...candidate(),
            attention: "action_required",
            kind: "agent_interaction",
            title: "Approval needed",
          },
          db: harness.db,
        })
      ).resolves.toMatchObject({
        contextLabel: "Center Agent",
        sourceTarget: {
          kind: "center_agent",
          signalId: "signal-1",
          spaceId: "space-1",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("keeps an ordinary agent reply on its Space target", async () => {
    const harness = createHarness();
    try {
      seedSpace(harness, {
        directMessagePairKey: "profile-human:profile-other-agent",
        purpose: "openmeld_dm_space",
      });

      await expect(
        prepareSpaceInboxCandidateForCenterAgent({
          candidate: candidate(),
          db: harness.db,
        })
      ).resolves.toEqual(candidate());
    } finally {
      harness.close();
    }
  });
});

function candidate(): InboxSourceCandidate {
  return {
    attention: "update",
    contextLabel: "Direct message",
    importance: "normal",
    kind: "agent_reply",
    occurredAtMs: 1000,
    organizationId: "org-1",
    preview: "The rollout summary is ready.",
    recipientUserId: "user-1",
    sourceKey: "signal-1",
    sourceKind: "space_signal",
    sourceTarget: {
      kind: "space",
      signalId: "signal-1",
      spaceId: "space-1",
    },
    title: "Center Agent replied in Direct message",
  };
}

function createHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: `
      CREATE TABLE center_agent_designations (
        organization_id TEXT PRIMARY KEY NOT NULL,
        agent_profile_id TEXT NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE space_index_spaces (
        space_id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        space_purpose TEXT,
        direct_message_pair_key TEXT,
        status TEXT NOT NULL
      )
    `,
  });
  harness.run({
    params: ["org-1", "profile-center-agent"],
    sql: `
      INSERT INTO center_agent_designations (organization_id, agent_profile_id)
      VALUES (?, ?)
    `,
  });
  return harness;
}

function seedCenterAgentDirectMessage(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  seedSpace(harness, {
    directMessagePairKey: "profile-center-agent:profile-human",
    purpose: "openmeld_dm_space",
  });
}

function seedSpace(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: { directMessagePairKey: string; purpose: string }
): void {
  harness.run({
    params: [
      "space-1",
      "org-1",
      input.purpose,
      input.directMessagePairKey,
      "active",
    ],
    sql: `
      INSERT INTO space_index_spaces (
        space_id,
        organization_id,
        space_purpose,
        direct_message_pair_key,
        status
      ) VALUES (?, ?, ?, ?, ?)
    `,
  });
}
