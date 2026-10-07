import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTrustFirstSlackWelcomeBlocks,
  buildTrustFirstSlackWelcomeMessage,
  readFirstProfileObservation,
  readPreparedProfileReport,
  runSlackInstallationWelcomePreparationTick,
} from "../src/remote-agent/application/slack-installation-welcome-preparation-service";
import { buildJoinedMemberWelcomeMessage } from "../src/remote-agent/application/slack-invited-member-onboarding-service";
import { buildPrivateTeammateInvitationMessage } from "../src/remote-agent/application/slack-welcome-interaction-service";
import { enqueueSlackInstallationWelcomePreparation } from "../src/remote-agent/infrastructure/postgresql/slack-installation-welcome-preparation-repo";
import {
  createFaultInjectingPostgresDatabase,
  createPostgresHarness,
} from "./helpers/postgresql-harness.test-support";

const PRESSURE_OR_NARROW_PRODUCT_LANGUAGE_PATTERN =
  /review|approve|discard|GitHub|coding agent/iu;
const PRESSURE_OR_GITHUB_LANGUAGE_PATTERN = /review|approve|discard|GitHub/iu;
const PRESSURE_LANGUAGE_PATTERN = /review|approve|discard/iu;

describe("Slack trust-first welcome preparation", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;

  beforeEach(async () => {
    harness = await createPostgresHarness();
    await harness.query({
      text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org-1','Ampli Lift','ampli-lift',1000)`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('user-installer','Alex','alex@example.test')`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."center_agent_member_research_batches" (id,organization_id,scope,status,requested_by_user_id,requested_by_member_id,requested_by_profile_id,requested_by_display_name,direct_message_space_id,created_at_ms,updated_at_ms) VALUES ('research-batch-1','org-1','member','completed','user-installer','member-installer','11111111-1111-4111-8111-111111111111','Alex','research-dm',1000,1100)`,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

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

  it("uses the frozen trusted observation language for Simplified Chinese welcome copy and actions", () => {
    const message = buildTrustFirstSlackWelcomeMessage({
      firstObservation: "你正在改进客户反馈流程。",
      hasUsefulEvidence: true,
      installerDisplayName: "张三",
      languageTag: "zh-CN",
      messageKind: "connected",
      organizationName: "示例团队",
    });
    const blocks = buildTrustFirstSlackWelcomeBlocks({
      activeConnectedAppCount: 0,
      documentId: "document-1",
      languageTag: "zh-CN",
      message,
      organizationSlug: "example-team",
      webAppUrl: "https://openmeld.test",
    });

    expect(message).toContain("你好，张三");
    expect(message).toContain("我目前了解到的一点");
    expect(blocks?.[1]).toEqual(
      expect.objectContaining({
        elements: expect.arrayContaining([
          expect.objectContaining({
            action_id: "open_profile_report",
            text: { text: "看看我学到了什么", type: "plain_text" },
          }),
          expect.objectContaining({
            action_id: "connect_more_context",
            text: { text: "连接更多工作信息", type: "plain_text" },
          }),
        ]),
      })
    );
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

  it("fails before publication when the Web app URL cannot build the promised actions", () => {
    expect(() =>
      buildTrustFirstSlackWelcomeBlocks({
        activeConnectedAppCount: 0,
        documentId: "document-1",
        message: "Prepared welcome",
        organizationSlug: "ampli-lift",
        webAppUrl: " ",
      })
    ).toThrow("WEB_APP_URL");
    expect(() =>
      buildTrustFirstSlackWelcomeBlocks({
        activeConnectedAppCount: 0,
        documentId: "document-1",
        message: "Prepared welcome",
        organizationSlug: "ampli-lift",
        webAppUrl: "not a URL",
      })
    ).toThrow("WEB_APP_URL");
  });

  it("closes the loop with a plain next step when a prepared welcome has an invalid Web app URL", async () => {
    await harness.query({
      text: `INSERT INTO "openmeld"."center_agent_member_research_tasks" (
        id, status, failure_code, observed_language_tag, report_result, batch_id, subject_user_id, subject_display_name, position, created_at_ms, started_at_ms, finished_at_ms
      ) VALUES ('research-task-1', 'completed', NULL, NULL, 'evidence_backed', 'research-batch-1', 'user-installer', 'Alex', 1, 1000, 1000, 1100)`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."organization_documents" (id, organization_id, content, draft_content, last_member_research_task_id, kind, subject_user_id, title) VALUES (
        'document-1', 'org-1', '## Working profile', NULL, 'research-task-1', 'member_profile', 'user-installer', 'Profile Report'
      )`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."center_agent_member_research_computer_files" (task_id, document_id, subject_user_id, path, created_at_ms) VALUES (
        'research-task-1', 'document-1', 'user-installer',
        '/computer/home/documents/Profile Reports/Alex/2026-08-15 — Work Profile.md', 1000
      )`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."slack_installation_welcome_preparations" (slack_team_id, organization_id, recipient_slack_user_id, connection_created_at_ms, welcome_version, message_kind, installed_by_user_id, installed_by_profile_id, status, claim_id, research_task_id, failure_code, created_at_ms, updated_at_ms) VALUES (
        'T123', 'org-1', 'U_INSTALLER', 100, 2, 'connected',
        'user-installer', 'profile-installer', 'ready', 'claim-1',
        'research-task-1', NULL, 100, 100
      )`,
    });
    const slackFetch = vi.fn(async (_url: string, _request?: RequestInit) =>
      Response.json({ channel: "D_INSTALLER", ok: true, ts: "1723.1" })
    );
    vi.stubGlobal("fetch", slackFetch);

    await runSlackInstallationWelcomePreparationTick({
      db: harness.db,
      env: {
        SLACK_OPENMELD_BOT_TOKEN: "xoxb-test",
        WEB_APP_URL: "not a URL",
      } as never,
      nowMs: 200,
      startResearch: () => Promise.reject(new Error("should not run")),
    });

    expect(slackFetch).toHaveBeenCalledOnce();
    const request = slackFetch.mock.calls[0]?.[1];
    if (!request) {
      throw new Error("Slack request was not captured.");
    }
    const body = JSON.parse(String(request.body)) as { text: string };
    expect(body.text).toContain("couldn’t finish your first Profile Report");
    expect(body.text).toContain("Reply “try again”");
    expect(
      await harness.queryFirst({
        text: 'SELECT status, failure_code FROM "openmeld"."slack_installation_welcome_preparations"',
      })
    ).toEqual({
      failure_code: "welcome_preparation_failed",
      status: "failed",
    });
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
      await harness.queryFirst({
        text: 'SELECT status, claim_id, research_task_id, failure_code FROM "openmeld"."slack_installation_welcome_preparations"',
      })
    ).toEqual({
      claim_id: null,
      failure_code: null,
      research_task_id: null,
      status: "queued",
    });
  });

  it("keeps an accepted research task recoverable when attaching it fails", async () => {
    await harness.query({
      text: `INSERT INTO "openmeld"."center_agent_member_research_tasks" (
        id, status, failure_code, observed_language_tag, report_result, batch_id, subject_user_id, subject_display_name, position, created_at_ms, started_at_ms
      ) VALUES ('research-task-accepted', 'running', NULL, NULL, NULL, 'research-batch-1', 'user-installer', 'Alex', 1, 100, 100)`,
    });
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
    const startResearch = vi.fn(async () => ({
      taskId: "research-task-accepted",
    }));
    const checkpointDb = createFaultInjectingPostgresDatabase({
      db: harness.db,
      matches: (sql) =>
        sql.includes(
          'UPDATE "openmeld"."slack_installation_welcome_preparations"'
        ) && sql.includes("research_task_id = $6"),
    });

    await runSlackInstallationWelcomePreparationTick({
      db: checkpointDb,
      env: {} as never,
      nowMs: 200,
      startResearch,
    });

    expect(
      await harness.queryFirst({
        text: `SELECT status, research_task_id, failure_code
          FROM "openmeld"."slack_installation_welcome_preparations"`,
      })
    ).toEqual({
      failure_code: null,
      research_task_id: null,
      status: "researching",
    });

    await runSlackInstallationWelcomePreparationTick({
      db: harness.db,
      env: {} as never,
      nowMs: 5 * 60_000 + 201,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledTimes(2);
    expect(
      await harness.queryFirst({
        text: `SELECT status, research_task_id, failure_code
          FROM "openmeld"."slack_installation_welcome_preparations"`,
      })
    ).toEqual({
      failure_code: null,
      research_task_id: "research-task-accepted",
      status: "researching",
    });
  });

  it("sends a plain next step instead of silently disappearing when first research fails", async () => {
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
    const slackFetch = vi.fn(async (_url: string, _request?: RequestInit) =>
      Response.json({ channel: "D_INSTALLER", ok: true, ts: "1723.1" })
    );
    vi.stubGlobal("fetch", slackFetch);

    await runSlackInstallationWelcomePreparationTick({
      db: harness.db,
      env: { SLACK_OPENMELD_BOT_TOKEN: "xoxb-test" } as never,
      nowMs: 200,
      startResearch: () =>
        Promise.reject(new Error("Remote Agent unavailable")),
    });

    expect(slackFetch).toHaveBeenCalledOnce();
    const request = slackFetch.mock.calls[0]?.[1];
    if (!request) {
      throw new Error("Slack request was not captured.");
    }
    const body = JSON.parse(String(request.body)) as { text: string };
    expect(body.text).toContain("couldn’t finish your first Profile Report");
    expect(body.text).toContain("Reply “try again”");
    expect(
      await harness.queryFirst({
        text: 'SELECT status, failure_code FROM "openmeld"."slack_installation_welcome_preparations"',
      })
    ).toEqual({
      failure_code: "member_research_start_failed",
      status: "failed",
    });
  });

  it("uses the published Profile Report when the draft was saved before welcome delivery", async () => {
    await harness.query({
      text: `INSERT INTO "openmeld"."center_agent_member_research_tasks" (
        id, status, failure_code, observed_language_tag, report_result, batch_id, subject_user_id, subject_display_name, position, created_at_ms, started_at_ms, finished_at_ms
      ) VALUES ('research-task-1', 'completed', NULL, NULL, 'evidence_backed', 'research-batch-1', 'user-installer', 'Alex', 1, 1000, 1000, 1100)`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."organization_documents" (id, organization_id, content, draft_content, last_member_research_task_id, kind, subject_user_id, title) VALUES (
        'document-1', 'org-1',
        '### Current focus
- 2026-08-15 — Replaced a prior **Insufficient evidence** draft with clearer onboarding findings. Source: Slack #product',
        NULL, 'research-task-1', 'member_profile', 'user-installer', 'Profile Report'
      )`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."center_agent_member_research_computer_files" (task_id, document_id, subject_user_id, path, created_at_ms) VALUES (
        'research-task-1', 'document-1', 'user-installer',
        '/computer/home/documents/Profile Reports/Alex/2026-08-15 — Work Profile.md', 1000
      )`,
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."organization_working_language_preferences" (organization_id, language_tag, mode, created_at_ms, updated_at_ms) VALUES ('org-1', 'zh-CN', 'automatic', 1000, 1000)`,
    });

    const report = await readPreparedProfileReport({
      db: harness.db,
      preparation: {
        claimId: "claim-1",
        failureCode: null,
        installedByProfileId: "profile-installer",
        installedByUserId: "user-installer",
        key: {
          connectionCreatedAtMs: 100,
          organizationId: "org-1",
          recipientSlackUserId: "U_INSTALLER",
          slackTeamId: "T123",
          welcomeVersion: 2,
        },
        messageKind: "connected",
        researchTaskId: "research-task-1",
        status: "ready",
      },
    });

    expect(report).toMatchObject({
      documentId: "document-1",
      firstObservation:
        "Replaced a prior **Insufficient evidence** draft with clearer onboarding findings.",
      hasUsefulEvidence: true,
      languageTag: "zh-CN",
    });
  });
});
