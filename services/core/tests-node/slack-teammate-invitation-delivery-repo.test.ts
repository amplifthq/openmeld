import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimSlackTeammateInvitationDelivery,
  completeSlackTeammateInvitationDelivery,
} from "../src/remote-agent/infrastructure/d1/slack-teammate-invitation-delivery-repo";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Slack teammate invitation delivery ledger", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE slack_teammate_invitation_deliveries (
          interaction_id TEXT NOT NULL,
          slack_team_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          actor_slack_user_id TEXT NOT NULL,
          actor_user_id TEXT NOT NULL,
          target_slack_user_id TEXT NOT NULL,
          target_email TEXT,
          target_display_name TEXT NOT NULL,
          status TEXT NOT NULL,
          message_ts TEXT,
          failure_code TEXT,
          onboarding_status TEXT,
          joined_user_id TEXT,
          joined_profile_id TEXT,
          research_task_id TEXT,
          welcome_message_ts TEXT,
          onboarding_failure_code TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          PRIMARY KEY (interaction_id, target_slack_user_id)
        )
      `,
    });
  });

  afterEach(() => harness.close());

  it("claims and completes one target exactly once across Slack retries", async () => {
    const input = {
      actorSlackUserId: "U_INSTALLER",
      actorUserId: "user-installer",
      db: harness.db,
      interactionId: "V123",
      nowMs: 1000,
      organizationId: "org-1",
      slackTeamId: "T123",
      targetDisplayName: "Maya",
      targetEmail: "maya@example.com",
      targetSlackUserId: "U_MAYA",
    } as const;
    const claim = await claimSlackTeammateInvitationDelivery(input);

    expect(claim).not.toBeNull();
    await completeSlackTeammateInvitationDelivery({
      claim: expectClaim(claim),
      db: harness.db,
      failureCode: null,
      messageTs: "1723.0001",
      nowMs: 1001,
      status: "delivered",
    });
    await expect(
      claimSlackTeammateInvitationDelivery({ ...input, nowMs: 1002 })
    ).resolves.toBeNull();
    expect(
      harness.queryFirst({
        sql: "SELECT status, message_ts, failure_code, onboarding_status FROM slack_teammate_invitation_deliveries",
      })
    ).toEqual({
      failure_code: null,
      message_ts: "1723.0001",
      onboarding_status: "waiting_for_join",
      status: "delivered",
    });
  });
});

function expectClaim<T>(value: T | null): T {
  if (!value) {
    throw new Error("Expected an invitation delivery claim.");
  }
  return value;
}
