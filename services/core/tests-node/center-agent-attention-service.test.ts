import { describe, expect, it } from "vitest";
import {
  createCenterAgentAttentionRequest,
  resolveCenterAgentAttentionRequestsForReply,
} from "../src/center-agent/application/center-agent-attention-service";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Center Agent attention service", () => {
  it.each([
    ["response_needed", "normal", 0],
    ["work_blocked", "urgent", 1],
    ["material_failure_risk", "urgent", 1],
  ] as const)("projects %s as a %s Inbox request and resolves it on the member's next reply", async (impact, importance, expectedEmailCount) => {
    const harness = await createHarness();
    try {
      await createCenterAgentAttentionRequest({
        db: harness.db,
        impact,
        nativeDeliveryId: `delivery-${impact}`,
        nowMs: 2000,
        organizationId: "org-one",
        prompt: "Choose whether I should ship the draft.",
        recipientUserId: "user-one",
        sourceTarget: {
          kind: "center_agent",
          signalId: "signal-trigger",
          spaceId: "space-center-agent",
        },
        spaceId: "space-center-agent",
        submissionId: `submission-${impact}`,
        title: "Your decision is needed",
        triggerSignalId: "signal-trigger",
      });

      const inbox = createInboxService({ db: harness.db, nowMs: () => 3000 });
      await expect(
        inbox.list({
          organizationId: "org-one",
          recipientUserId: "user-one",
          view: "needs_action",
        })
      ).resolves.toMatchObject({
        items: [
          {
            attention: "action_required",
            importance,
            resolutionStatus: "open",
            sourceTarget: {
              kind: "center_agent",
              signalId: "signal-trigger",
              spaceId: "space-center-agent",
            },
            title: "Your decision is needed",
          },
        ],
      });
      expect(
        (
          await harness.queryFirst<{ count: number }>({
            text: 'SELECT count(*) AS count FROM "openmeld"."inbox_email_deliveries"',
          })
        )?.count
      ).toBe(expectedEmailCount);

      await expect(
        resolveCenterAgentAttentionRequestsForReply({
          db: harness.db,
          nowMs: 4000,
          organizationId: "org-one",
          recipientUserId: "user-one",
          spaceId: "space-center-agent",
        })
      ).resolves.toBe(1);
      await expect(
        inbox.list({
          organizationId: "org-one",
          recipientUserId: "user-one",
          view: "needs_action",
        })
      ).resolves.toMatchObject({ items: [] });
    } finally {
      await harness.close();
    }
  });
});

async function createHarness() {
  const harness = await createPostgresHarness();

  await harness.query({
    values: ["org-one", "One", "one", 1000],
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
  });
  await harness.query({
    values: ["user-one", "One", "one@example.com"],
    text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
  });
  await harness.query({
    values: [
      "space-center-agent",
      "org-one",
      "private",
      "active",
      1000,
      1000,
      "space-projection",
    ],
    text: `INSERT INTO "openmeld"."space_index_spaces" (
      space_id, organization_id, organization_visibility, status,
      source_updated_at_ms, projected_at_ms, projection_event_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  });
  await harness.query({
    values: [
      "space-center-agent",
      "human-profile",
      "Human",
      "user-one",
      1000,
      1000,
      1000,
      "member-projection",
    ],
    text: `INSERT INTO "openmeld"."space_index_memberships" (
      space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
      owner_user_id_snapshot, status, member_source, added_at_ms,
      source_updated_at_ms, projected_at_ms, projection_event_id
    ) VALUES ($1, $2, 'human', $3, $4, 'active', 'joined_directly', $5, $6, $7, $8)`,
  });
  return harness;
}
