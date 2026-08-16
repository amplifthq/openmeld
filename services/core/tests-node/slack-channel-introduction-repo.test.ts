import { describe, expect, it } from "vitest";
import {
  claimNextSlackChannelIntroductionItem,
  completeSlackChannelIntroductionAcknowledgement,
  completeSlackChannelIntroductionItemClaim,
  createSlackChannelIntroductionManifest,
} from "../src/remote-agent/infrastructure/d1/slack-channel-introduction-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Slack channel introduction manifest", () => {
  it("checkpoints each channel and reclaims only an interrupted item", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(harness, "slack_channel_introduction_runs");
    applyDrizzleMigrationForTable(harness, "slack_channel_introduction_items");

    try {
      const manifest = buildManifest(harness.db);
      await expect(
        createSlackChannelIntroductionManifest(manifest)
      ).resolves.toMatchObject({ created: true });
      await completeSlackChannelIntroductionAcknowledgement({
        acknowledgementTs: "1723.1",
        db: harness.db,
        interactionId: "V_CHANNELS",
        nowMs: 1100,
      });

      const first = await claimNextSlackChannelIntroductionItem({
        db: harness.db,
        interactionId: "V_CHANNELS",
        nowMs: 1200,
      });
      expect(first).toMatchObject({
        attemptCount: 1,
        slackChannelId: "C_PRODUCT",
      });
      if (!first) {
        throw new Error("expected the first channel claim");
      }
      await completeSlackChannelIntroductionItemClaim({
        claim: first,
        db: harness.db,
        failureCode: null,
        nowMs: 1300,
        status: "submitted",
      });

      const interrupted = await claimNextSlackChannelIntroductionItem({
        db: harness.db,
        interactionId: "V_CHANNELS",
        nowMs: 1400,
      });
      expect(interrupted).toMatchObject({
        attemptCount: 1,
        slackChannelId: "C_DESIGN",
      });

      const recovered = await claimNextSlackChannelIntroductionItem({
        db: harness.db,
        interactionId: "V_CHANNELS",
        nowMs: 1400 + 5 * 60_000 + 1,
      });
      expect(recovered).toMatchObject({
        attemptCount: 2,
        slackChannelId: "C_DESIGN",
      });
      if (!recovered) {
        throw new Error("expected the interrupted channel to be reclaimed");
      }
      await completeSlackChannelIntroductionItemClaim({
        claim: recovered,
        db: harness.db,
        failureCode: null,
        nowMs: 1400 + 5 * 60_000 + 2,
        status: "submitted",
      });

      await expect(
        claimNextSlackChannelIntroductionItem({
          db: harness.db,
          interactionId: "V_CHANNELS",
          nowMs: 1400 + 5 * 60_000 + 3,
        })
      ).resolves.toBeNull();
      expect(
        harness.queryAll({
          sql: `SELECT slack_channel_id, status, attempt_count
            FROM slack_channel_introduction_items
            ORDER BY position`,
        })
      ).toEqual([
        {
          attempt_count: 1,
          slack_channel_id: "C_PRODUCT",
          status: "submitted",
        },
        {
          attempt_count: 2,
          slack_channel_id: "C_DESIGN",
          status: "submitted",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("rejects reuse without mutating the original channel manifest", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(harness, "slack_channel_introduction_runs");
    applyDrizzleMigrationForTable(harness, "slack_channel_introduction_items");

    try {
      const manifest = buildManifest(harness.db);
      await createSlackChannelIntroductionManifest(manifest);
      await expect(
        createSlackChannelIntroductionManifest({
          ...manifest,
          channels: [
            ...manifest.channels,
            {
              botWasChannelMember: false,
              slackChannelId: "C_ENGINEERING",
              slackChannelName: "engineering",
            },
          ],
        })
      ).rejects.toThrow("reused with a different manifest");
      expect(
        harness.queryAll({
          sql: `SELECT slack_channel_id
            FROM slack_channel_introduction_items
            ORDER BY position`,
        })
      ).toEqual([
        { slack_channel_id: "C_PRODUCT" },
        { slack_channel_id: "C_DESIGN" },
      ]);
    } finally {
      harness.close();
    }
  });
});

function buildManifest(db: D1Database) {
  return {
    channels: [
      {
        botWasChannelMember: false,
        slackChannelId: "C_PRODUCT",
        slackChannelName: "product",
      },
      {
        botWasChannelMember: true,
        slackChannelId: "C_DESIGN",
        slackChannelName: "design",
      },
    ],
    db,
    dmChannelId: "D_OPENMELD",
    interactionId: "V_CHANNELS",
    nowMs: 1000,
    organizationId: "org_1",
    organizationInviteUrl: "https://openmeld.ai/join/openmeld-test",
    requesterSlackUserId: "U123",
    slackTeamId: "T123",
  } as const;
}
