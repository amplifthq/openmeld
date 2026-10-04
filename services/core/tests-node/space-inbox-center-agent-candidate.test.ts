import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { prepareSpaceInboxCandidateForCenterAgent } from "../src/space/application/space-inbox-center-agent-candidate";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Center Agent Space Inbox candidate", () => {
  it("uses the canonical Center Agent target for a reply in the member DM", async () => {
    const harness = await createHarness();
    try {
      await seedCenterAgentDirectMessage(harness);

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
      await harness.close();
    }
  });

  it("uses the canonical Center Agent target for an attention request in the member DM", async () => {
    const harness = await createHarness();
    try {
      await seedCenterAgentDirectMessage(harness);

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
      await harness.close();
    }
  });

  it("keeps an ordinary agent reply on its Space target", async () => {
    const harness = await createHarness();
    try {
      await seedSpace(harness, {
        directMessagePairKey:
          "22222222-2222-4222-8222-222222222222:agt_33333333-3333-4333-8333-333333333333",
        purpose: "openmeld_dm_space",
      });

      await expect(
        prepareSpaceInboxCandidateForCenterAgent({
          candidate: candidate(),
          db: harness.db,
        })
      ).resolves.toEqual(candidate());
    } finally {
      await harness.close();
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

async function createHarness() {
  const harness = await createPostgresHarness();
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('owner','Owner','owner@example.test')`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org-1','Organization','org-1',1000)`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id,profile_name,profile_handle,profile_kind,organization_id,created_by_user_id,managed_role,source,status) VALUES ('agt_11111111-1111-4111-8111-111111111111','Center Agent','center-agent','agent','org-1','owner','center_agent','auth_bootstrap','active')`,
  });

  await harness.query({
    values: ["org-1", "agt_11111111-1111-4111-8111-111111111111"],
    text: `
      INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id)
      VALUES ($1, $2)
    `,
  });
  return harness;
}

async function seedCenterAgentDirectMessage(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await seedSpace(harness, {
    directMessagePairKey:
      "agt_11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222",
    purpose: "openmeld_dm_space",
  });
}

async function seedSpace(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: { directMessagePairKey: string; purpose: string }
): Promise<void> {
  await harness.query({
    values: [
      "space-1",
      "org-1",
      input.purpose,
      input.directMessagePairKey,
      "active",
    ],
    text: `
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        space_purpose,
        direct_message_pair_key,
        status, organization_visibility, source_updated_at_ms, projected_at_ms, projection_event_id
      ) VALUES ($1, $2, $3, $4, $5, 'private', 1000, 1000, 'fixture-projection')
    `,
  });
}
