import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildTrustFirstSlackWelcomeBlocks,
  buildTrustFirstSlackWelcomeMessage,
  readFirstProfileObservation,
  runSlackInstallationWelcomePreparationTick,
} from "../src/remote-agent/application/slack-installation-welcome-preparation-service";
import { buildJoinedMemberWelcomeMessage } from "../src/remote-agent/application/slack-invited-member-onboarding-service";
import { buildPrivateTeammateInvitationMessage } from "../src/remote-agent/application/slack-welcome-interaction-service";
import { enqueueSlackInstallationWelcomePreparation } from "../src/remote-agent/infrastructure/d1/slack-installation-welcome-preparation-repo";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const PRESSURE_OR_NARROW_PRODUCT_LANGUAGE_PATTERN =
  /review|approve|discard|GitHub|coding agent/iu;
const PRESSURE_OR_GITHUB_LANGUAGE_PATTERN = /review|approve|discard|GitHub/iu;
const PRESSURE_LANGUAGE_PATTERN = /review|approve|discard/iu;

describe("Slack trust-first welcome preparation", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE slack_installation_welcome_preparations (
          slack_team_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          recipient_slack_user_id TEXT NOT NULL,
          connection_created_at_ms INTEGER NOT NULL,
          welcome_version INTEGER NOT NULL,
          message_kind TEXT NOT NULL,
          installed_by_user_id TEXT NOT NULL,
          installed_by_profile_id TEXT NOT NULL,
          status TEXT NOT NULL,
          claim_id TEXT,
          research_task_id TEXT,
          failure_code TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          PRIMARY KEY (
            slack_team_id,
            organization_id,
            recipient_slack_user_id,
            connection_created_at_ms,
            welcome_version
          )
        )
      `,
    });
  });

  afterEach(() => harness.close());

  it("speaks plainly, proves that learning happened, and stays low pressure", () => {
    const message = buildTrustFirstSlackWelcomeMessage({
      firstObservation:
        "You have been improving how customer feedback reaches the product team.",
      hasUsefulEvidence: true,
      installerDisplayName: "Felix Lee",
      messageKind: "connected",
      organizationName: "Ampli Lift",
    });

    expect(message).toContain("Hi Felix");
    expect(message).toContain("people and agents work as one team");
    expect(message).toContain("saved it as a file on my computer");
    expect(message).toContain("One thing I picked up:");
    expect(message).toContain("You can talk to me right here");
    expect(message).not.toMatch(PRESSURE_OR_NARROW_PRODUCT_LANGUAGE_PATTERN);
  });

  it("is honest when connected evidence is not yet enough", () => {
    const message = buildTrustFirstSlackWelcomeMessage({
      firstObservation: null,
      hasUsefulEvidence: false,
      installerDisplayName: "New User",
      messageKind: "connected",
      organizationName: "New Team",
    });

    expect(message).toContain("I don’t have enough context to say much yet");
    expect(message).toContain("I won’t make things up");
  });

  it("offers the report and team expansion without a connector upsell when context already exists", () => {
    const message = "Prepared welcome";
    const blocks = buildTrustFirstSlackWelcomeBlocks({
      activeConnectedAppCount: 2,
      documentId: "document-1",
      message,
      organizationSlug: "ampli-lift",
      webAppUrl: "https://openmeld.test",
    });

    expect(blocks).toEqual([
      { type: "section", text: { type: "mrkdwn", text: message } },
      {
        type: "actions",
        elements: [
          expect.objectContaining({
            action_id: "open_profile_report",
            text: { text: "See what I learned", type: "plain_text" },
          }),
          expect.objectContaining({
            action_id: "invite_teammates",
            text: { text: "Invite teammates", type: "plain_text" },
          }),
          expect.objectContaining({
            action_id: "start_channel_introduction",
            text: {
              text: "Introduce me in channels",
              type: "plain_text",
            },
          }),
        ],
      },
    ]);
  });

  it("extracts one evidence-backed observation without leaking its source wrapper", () => {
    expect(
      readFirstProfileObservation(`## Working profile

### Current focus
- 2026-08-12 — Improving customer feedback routing. Source: [GitHub: issue-1](https://example.test/1)

### Recent contributions
- 2026-08-11 — Shipped a fix. Source: Agent Activity \`session-1\``)
    ).toBe("Improving customer feedback routing.");
  });

  it("gives an invited teammate a human explanation and a clear next experience", () => {
    const message = buildPrivateTeammateInvitationMessage({
      inviterName: "Felix",
      organizationName: "Ampli Lift",
      targetDisplayName: "Maya Chen",
    });

    expect(message).toContain("Hi Maya");
    expect(message).toContain("Felix asked me to invite you");
    expect(message).toContain("people and agents work as one team");
    expect(message).toContain("I’ll make a first Profile Report");
    expect(message).not.toMatch(PRESSURE_OR_GITHUB_LANGUAGE_PATTERN);
  });

  it("welcomes a joined member with learning proof and an open conversation", () => {
    const message = buildJoinedMemberWelcomeMessage({
      hasUsefulEvidence: true,
      observation: "You’ve been improving the team’s customer feedback loop.",
      organizationName: "Ampli Lift",
      targetDisplayName: "Maya Chen",
    });

    expect(message).toContain("You’re in, Maya");
    expect(message).toContain("saved it as a file on my computer");
    expect(message).toContain("One thing I picked up");
    expect(message).toContain("You can talk to me right here");
    expect(message).not.toMatch(PRESSURE_LANGUAGE_PATTERN);
  });

  it("waits instead of permanently failing when another member is being learned", async () => {
    await enqueueSlackInstallationWelcomePreparation({
      allowCreate: true,
      connectionCreatedAtMs: 100,
      db: harness.db,
      installedByProfileId: "profile-installer",
      installedByUserId: "user-installer",
      messageKind: "connected",
      nowMs: 100,
      organizationId: "org-1",
      recipientSlackUserId: "U_INSTALLER",
      slackTeamId: "T123",
    });
    const busyError = Object.assign(new Error("Another batch is active."), {
      code: "center_agent_member_research.already_running",
    });

    await runSlackInstallationWelcomePreparationTick({
      db: harness.db,
      env: {} as never,
      nowMs: 200,
      startResearch: () => Promise.reject(busyError),
    });

    expect(
      harness.queryFirst({
        sql: "SELECT status, claim_id, research_task_id, failure_code FROM slack_installation_welcome_preparations",
      })
    ).toEqual({
      claim_id: null,
      failure_code: null,
      research_task_id: null,
      status: "queued",
    });
  });
});
