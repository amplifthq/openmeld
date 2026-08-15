import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSlackInvitedMemberOnboardingTick } from "../src/remote-agent/application/slack-invited-member-onboarding-service";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Slack invited member onboarding", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;
  let slackFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    createTables(harness);
    seedWaitingInvitation(harness);
    slackFetch = vi.fn(async () =>
      Response.json({ channel: "D_MAYA", ok: true, ts: "1723.0002" })
    );
    vi.stubGlobal("fetch", slackFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    harness.close();
  });

  it("learns a joined Slack invitee, sends one trust-first DM, and completes exactly once", async () => {
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));
    const env = buildOnboardingEnv();

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: env as never,
      nowMs: 2000,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledOnce();
    expect(startResearch).toHaveBeenCalledWith(
      expect.objectContaining({
        joinedProfileId: "11111111-1111-4111-8111-111111111111",
        joinedUserId: "user-maya",
        targetSlackUserId: "U_MAYA",
      })
    );
    expect(
      harness.queryFirst({
        sql: `
          SELECT onboarding_status, joined_user_id, joined_profile_id, research_task_id
          FROM slack_teammate_invitation_deliveries
        `,
      })
    ).toEqual({
      joined_profile_id: "11111111-1111-4111-8111-111111111111",
      joined_user_id: "user-maya",
      onboarding_status: "researching",
      research_task_id: "research-task-1",
    });
    expect(
      harness.queryFirst({
        sql: `
          SELECT organization_id, slack_team_id, slack_user_id, openmeld_user_id, source
          FROM slack_user_identity_links
        `,
      })
    ).toEqual({
      openmeld_user_id: "user-maya",
      organization_id: "org-1",
      slack_team_id: "T123",
      slack_user_id: "U_MAYA",
      source: "email_auto",
    });
    expect(slackFetch).not.toHaveBeenCalled();

    seedCompletedResearch(harness);
    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: env as never,
      nowMs: 3000,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledOnce();
    expect(slackFetch).toHaveBeenCalledOnce();
    const [url, request] = slackFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      channel: "U_MAYA",
      text: expect.stringContaining("You’re in, Maya"),
    });
    expect(body).not.toHaveProperty("thread_ts");
    expect(String(body.text)).toContain("One thing I picked up:");
    expect(String(body.text)).toContain("You can talk to me right here");
    expect(body.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({
              action_id: "open_profile_report",
              url: "https://openmeld.test/o/ampli-lift/documents/document-maya",
            }),
          ]),
          type: "actions",
        }),
      ])
    );
    expect(
      harness.queryFirst({
        sql: `
          SELECT onboarding_status, welcome_message_ts, onboarding_failure_code
          FROM slack_teammate_invitation_deliveries
        `,
      })
    ).toEqual({
      onboarding_failure_code: null,
      onboarding_status: "completed",
      welcome_message_ts: "1723.0002",
    });
    expect(
      harness.queryFirst({
        sql: `SELECT status, message_ts, failure_code
          FROM slack_invited_member_welcome_deliveries`,
      })
    ).toEqual({
      failure_code: null,
      message_ts: "1723.0002",
      status: "delivered",
    });

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: env as never,
      nowMs: 4000,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledOnce();
    expect(slackFetch).toHaveBeenCalledOnce();
  });

  it("starts one onboarding when the same Slack member has duplicate invitations", async () => {
    seedDuplicateWaitingInvitation(harness);
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledOnce();
    expect(
      harness.queryAll({
        sql: `
          SELECT interaction_id, onboarding_status, onboarding_failure_code,
            joined_user_id, joined_profile_id
          FROM slack_teammate_invitation_deliveries
          ORDER BY interaction_id
        `,
      })
    ).toEqual([
      {
        interaction_id: "invite-1",
        joined_profile_id: "11111111-1111-4111-8111-111111111111",
        joined_user_id: "user-maya",
        onboarding_failure_code: null,
        onboarding_status: "researching",
      },
      {
        interaction_id: "invite-2",
        joined_profile_id: "11111111-1111-4111-8111-111111111111",
        joined_user_id: "user-maya",
        onboarding_failure_code: "duplicate_invitation",
        onboarding_status: "failed",
      },
    ]);
    expect(slackFetch).not.toHaveBeenCalled();
  });

  it("does not publish again while a durable welcome delivery is still pending", async () => {
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));
    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });
    seedCompletedResearch(harness);
    seedWelcomeDelivery(harness, {
      messageTs: null,
      status: "pending",
      updatedAtMs: 2500,
    });

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 3000,
      startResearch,
    });

    expect(slackFetch).not.toHaveBeenCalled();
    expect(
      harness.queryFirst({
        sql: "SELECT onboarding_status FROM slack_teammate_invitation_deliveries",
      })
    ).toEqual({ onboarding_status: "researching" });

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 303_000,
      startResearch,
    });

    expect(slackFetch).not.toHaveBeenCalled();
    expect(
      harness.queryFirst({
        sql: `SELECT onboarding_status, onboarding_failure_code
          FROM slack_teammate_invitation_deliveries`,
      })
    ).toEqual({
      onboarding_failure_code: "welcome_delivery_outcome_unknown",
      onboarding_status: "failed",
    });
  });

  it("retries a welcome only after Slack confirms that nothing was published", async () => {
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));
    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });
    seedCompletedResearch(harness);
    slackFetch.mockResolvedValueOnce(
      Response.json({ error: "channel_not_found", ok: false })
    );

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 3000,
      startResearch,
    });

    expect(slackFetch).toHaveBeenCalledOnce();
    expect(
      harness.queryFirst({
        sql: `SELECT status, failure_code
          FROM slack_invited_member_welcome_deliveries`,
      })
    ).toEqual({
      failure_code: "channel_not_found",
      status: "failed",
    });

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 4000,
      startResearch,
    });

    expect(slackFetch).toHaveBeenCalledTimes(2);
    expect(
      harness.queryFirst({
        sql: `SELECT onboarding_status, welcome_message_ts
          FROM slack_teammate_invitation_deliveries`,
      })
    ).toEqual({
      onboarding_status: "completed",
      welcome_message_ts: "1723.0002",
    });
  });

  it("finishes onboarding from a delivered welcome record without publishing twice", async () => {
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));
    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });
    seedCompletedResearch(harness);
    seedWelcomeDelivery(harness, {
      messageTs: "1723.0002",
      status: "delivered",
      updatedAtMs: 2500,
    });

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 3000,
      startResearch,
    });

    expect(slackFetch).not.toHaveBeenCalled();
    expect(
      harness.queryFirst({
        sql: `SELECT onboarding_status, welcome_message_ts
          FROM slack_teammate_invitation_deliveries`,
      })
    ).toEqual({
      onboarding_status: "completed",
      welcome_message_ts: "1723.0002",
    });
  });
});

function buildOnboardingEnv() {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveOrganizationDirectoryMembers: vi.fn(
        async (input: { organizationId: string }) => ({
          members: [
            {
              humanProfile: {
                lastUsedAt: null,
                profileHandle: "maya-chen",
                profileId: "11111111-1111-4111-8111-111111111111",
                profileName: "Maya Chen",
                status: "active" as const,
              },
              joinedAt: "2026-08-15T00:00:00.000Z",
              memberId: "member-maya",
              organizationId: input.organizationId,
              role: "member",
              user: {
                email: "maya@example.com",
                id: "user-maya",
                image: null,
                name: "Maya Chen",
              },
              userId: "user-maya",
            },
          ],
          ok: true as const,
          organizationId: input.organizationId,
        })
      ),
    },
    SLACK_OPENMELD_BOT_TOKEN: "xoxb-test",
    WEB_APP_URL: "https://openmeld.test",
  } as const;
}

function createTables(harness: ReturnType<typeof createSqliteD1Harness>): void {
  const statements = [
    `
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
    `
      CREATE TABLE slack_user_identity_links (
        organization_id TEXT NOT NULL,
        slack_team_id TEXT NOT NULL,
        slack_user_id TEXT NOT NULL,
        openmeld_user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (slack_team_id, slack_user_id)
      )
    `,
    `
      CREATE TABLE center_agent_member_research_tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        failure_code TEXT
      )
    `,
    `
      CREATE TABLE center_agent_member_research_computer_files (
        task_id TEXT NOT NULL,
        subject_user_id TEXT NOT NULL,
        document_id TEXT NOT NULL
      )
    `,
    `
      CREATE TABLE organization_documents (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        last_member_research_task_id TEXT,
        content TEXT NOT NULL DEFAULT '',
        draft_content TEXT NOT NULL
      )
    `,
    `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL
      )
    `,
    `
      CREATE TABLE slack_workspace_tokens (
        slack_team_id TEXT PRIMARY KEY,
        encrypted_bot_token TEXT NOT NULL,
        bot_user_id TEXT NOT NULL,
        installed_by_user_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      )
    `,
    `
      CREATE TABLE slack_invited_member_welcome_deliveries (
        interaction_id TEXT NOT NULL,
        target_slack_user_id TEXT NOT NULL,
        research_task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        claim_id TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        message_ts TEXT,
        failure_code TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (interaction_id, target_slack_user_id)
      )
    `,
  ];
  for (const sql of statements) {
    harness.run({ sql });
  }
}

function seedWaitingInvitation(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    params: [
      "invite-1",
      "T123",
      "org-1",
      "U_INSTALLER",
      "user-installer",
      "U_MAYA",
      " Maya@Example.com ",
      "Maya Chen",
      1000,
      1000,
    ],
    sql: `
      INSERT INTO slack_teammate_invitation_deliveries (
        interaction_id,
        slack_team_id,
        organization_id,
        actor_slack_user_id,
        actor_user_id,
        target_slack_user_id,
        target_email,
        target_display_name,
        status,
        message_ts,
        failure_code,
        onboarding_status,
        joined_user_id,
        joined_profile_id,
        research_task_id,
        welcome_message_ts,
        onboarding_failure_code,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'delivered', '1723.0001', NULL,
        'waiting_for_join', NULL, NULL, NULL, NULL, NULL, ?, ?)
    `,
  });
}

function seedDuplicateWaitingInvitation(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    params: [
      "invite-2",
      "T123",
      "org-1",
      "U_INSTALLER_2",
      "user-installer-2",
      "U_MAYA",
      "maya@example.com",
      "Maya Chen",
      1100,
      1100,
    ],
    sql: `
      INSERT INTO slack_teammate_invitation_deliveries (
        interaction_id, slack_team_id, organization_id,
        actor_slack_user_id, actor_user_id, target_slack_user_id,
        target_email, target_display_name, status, message_ts, failure_code,
        onboarding_status, joined_user_id, joined_profile_id, research_task_id,
        welcome_message_ts, onboarding_failure_code, created_at_ms, updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'delivered', '1723.0002', NULL,
        'waiting_for_join', NULL, NULL, NULL, NULL, NULL, ?, ?)
    `,
  });
}

function seedCompletedResearch(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    params: ["research-task-1"],
    sql: `
      INSERT INTO center_agent_member_research_tasks (id, status, failure_code)
      VALUES (?, 'completed', NULL)
    `,
  });
  harness.run({
    params: [
      "document-maya",
      "org-1",
      "research-task-1",
      `## Working profile

### Current focus
- 2026-08-15 — Improving the customer feedback loop. Source: Slack #product
`,
    ],
    sql: `
      INSERT INTO organization_documents (
        id, organization_id, last_member_research_task_id, draft_content
      )
      VALUES (?, ?, ?, ?)
    `,
  });
  harness.run({
    params: ["research-task-1", "user-maya", "document-maya"],
    sql: `
      INSERT INTO center_agent_member_research_computer_files (
        task_id, subject_user_id, document_id
      )
      VALUES (?, ?, ?)
    `,
  });
  harness.run({
    sql: `
      INSERT INTO organizations (id, name, slug)
      VALUES ('org-1', 'Ampli Lift', 'ampli-lift')
    `,
  });
}

function seedWelcomeDelivery(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    messageTs: string | null;
    status: "delivered" | "pending";
    updatedAtMs: number;
  }
): void {
  harness.run({
    params: [
      input.status,
      input.messageTs,
      input.status === "pending" ? null : null,
      input.updatedAtMs,
    ],
    sql: `
      INSERT INTO slack_invited_member_welcome_deliveries (
        interaction_id, target_slack_user_id, research_task_id,
        status, claim_id, attempt_count, message_ts, failure_code,
        created_at_ms, updated_at_ms
      ) VALUES (
        'invite-1', 'U_MAYA', 'research-task-1',
        ?, 'claim-1', 1, ?, ?, 2500, ?
      )
    `,
  });
}
