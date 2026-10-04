import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimSlackTeammateInvitationDelivery,
  completeSlackTeammateInvitationDelivery,
} from "../src/remote-agent/infrastructure/postgresql/slack-teammate-invitation-delivery-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Slack teammate invitation delivery ledger", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;

  beforeEach(async () => {
    harness = await createPostgresHarness();
  });

  afterEach(async () => await harness.close());

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
      await harness.queryFirst({
        text: 'SELECT status, message_ts, failure_code, onboarding_status FROM "openmeld"."slack_teammate_invitation_deliveries"',
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
