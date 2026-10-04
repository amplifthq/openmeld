import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildJoinedMemberWelcomeBlocks,
  buildJoinedMemberWelcomeMessage,
  runSlackInvitedMemberOnboardingTick,
} from "../src/remote-agent/application/slack-invited-member-onboarding-service";
import {
  createFaultInjectingPostgresDatabase,
  createPostgresHarness,
} from "./helpers/postgresql-harness.test-support";

describe("Slack invited member onboarding", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  let slackFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    harness = await createPostgresHarness();

    await seedWaitingInvitation(harness);
    await seedExplicitIdentityLink(harness);
    slackFetch = vi.fn(async () =>
      Response.json({ channel: "D_MAYA", ok: true, ts: "1723.0002" })
    );
    vi.stubGlobal("fetch", slackFetch);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  it("localizes a joined-member welcome from the frozen Traditional Chinese observation", () => {
    const message = buildJoinedMemberWelcomeMessage({
      hasUsefulEvidence: true,
      languageTag: "zh-TW",
      observation: "你正在改善團隊的交付流程。",
      organizationName: "範例團隊",
      targetDisplayName: "陳小美",
    });
    const blocks = buildJoinedMemberWelcomeBlocks({
      documentId: "document-maya",
      languageTag: "zh-TW",
      message,
      organizationSlug: "example-team",
      webAppUrl: "https://openmeld.test",
    });

    expect(message).toContain("你已加入，陳小美");
    expect(message).toContain("我目前瞭解到的一點");
    expect(blocks[1]).toEqual(
      expect.objectContaining({
        elements: expect.arrayContaining([
          expect.objectContaining({
            action_id: "invite_teammates",
            text: { text: "邀請團隊成員", type: "plain_text" },
          }),
        ]),
      })
    );
  });

  it("learns a joined Slack invitee, sends one trust-first DM, and completes exactly once", async () => {
    await harness.query({
      text: `UPDATE "openmeld"."slack_teammate_invitation_deliveries"
        SET target_email = 'different-from-member@example.com'`,
    });
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
      await harness.queryFirst({
        text: `
          SELECT onboarding_status, joined_user_id, joined_profile_id, research_task_id
          FROM "openmeld"."slack_teammate_invitation_deliveries"
        `,
      })
    ).toEqual({
      joined_profile_id: "11111111-1111-4111-8111-111111111111",
      joined_user_id: "user-maya",
      onboarding_status: "researching",
      research_task_id: "research-task-1",
    });
    expect(
      await harness.queryFirst({
        text: `
          SELECT organization_id, slack_team_id, slack_user_id, openmeld_user_id, source
          FROM "openmeld"."slack_user_identity_links"
        `,
      })
    ).toEqual({
      openmeld_user_id: "user-maya",
      organization_id: "org-1",
      slack_team_id: "T123",
      slack_user_id: "U_MAYA",
      source: "explicit",
    });
    expect(slackFetch).not.toHaveBeenCalled();

    await seedCompletedResearch(harness);
    await harness.query({
      text: `INSERT INTO "openmeld"."organization_working_language_preferences"
        (organization_id, language_tag, mode, created_at_ms, updated_at_ms) VALUES ('org-1', 'zh-CN', 'automatic', 1000, 1000)`,
    });
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
      text: expect.stringContaining("你已加入，Maya"),
    });
    expect(body).not.toHaveProperty("thread_ts");
    expect(String(body.text)).toContain("我目前了解到的一点");
    expect(String(body.text)).toContain("你可以直接在这里与我对话");
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
      await harness.queryFirst({
        text: `
          SELECT onboarding_status, welcome_message_ts, onboarding_failure_code
          FROM "openmeld"."slack_teammate_invitation_deliveries"
        `,
      })
    ).toEqual({
      onboarding_failure_code: null,
      onboarding_status: "completed",
      welcome_message_ts: "1723.0002",
    });
    expect(
      await harness.queryFirst({
        text: `SELECT status, message_ts, failure_code
          FROM "openmeld"."slack_invited_member_welcome_deliveries"`,
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

  it("does not turn a matching invitation email into identity authority", async () => {
    await harness.query({
      text: 'DELETE FROM "openmeld"."slack_user_identity_links"',
    });
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });

    expect(startResearch).not.toHaveBeenCalled();
    expect(
      await harness.queryFirst({
        text: `SELECT onboarding_status, joined_user_id, joined_profile_id
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
      })
    ).toEqual({
      joined_profile_id: null,
      joined_user_id: null,
      onboarding_status: "waiting_for_join",
    });
    expect(
      await harness.queryFirst({
        text: 'SELECT openmeld_user_id FROM "openmeld"."slack_user_identity_links"',
      })
    ).toBeNull();
  });

  it("reconciles a confirmed private invitation before starting joined-member onboarding", async () => {
    await harness.query({
      text: `UPDATE "openmeld"."slack_teammate_invitation_deliveries"
        SET status = 'pending', message_ts = NULL, failure_code = NULL,
          onboarding_status = NULL, updated_at_ms = 1000`,
    });
    slackFetch.mockImplementation((url: string) => {
      if (url === "https://slack.com/api/conversations.open") {
        return Response.json({ channel: { id: "D_MAYA" }, ok: true });
      }
      if (url.startsWith("https://slack.com/api/conversations.history")) {
        return Response.json({
          messages: [
            {
              metadata: {
                event_payload: { delivery_id: "invite-1:U_MAYA" },
                event_type: "openmeld_teammate_invited",
              },
              ts: "1723.0001",
            },
          ],
          ok: true,
          response_metadata: { next_cursor: "" },
        });
      }
      throw new Error(`Unexpected Slack request: ${url}`);
    });
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 5 * 60_000 + 1001,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledOnce();
    expect(
      await harness.queryFirst({
        text: `SELECT status, message_ts, failure_code, onboarding_status
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
      })
    ).toEqual({
      failure_code: null,
      message_ts: "1723.0001",
      onboarding_status: "researching",
      status: "delivered",
    });
    expect(
      slackFetch.mock.calls.filter(
        ([url]) => url === "https://slack.com/api/chat.postMessage"
      )
    ).toHaveLength(0);
  });

  it("waits when the Slack identity does not map to a current Organization member", async () => {
    await harness.query({
      text: 'DELETE FROM "openmeld"."slack_user_identity_links"',
    });
    await harness.query({
      text: `
        INSERT INTO "openmeld"."slack_user_identity_links" (
          organization_id, slack_team_id, slack_user_id,
          openmeld_user_id, source, created_at_ms
        )
        VALUES ('org-1', 'T123', 'U_MAYA', 'user-someone-else', 'explicit', 1500)
      `,
    });
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });

    expect(startResearch).not.toHaveBeenCalled();
    expect(
      await harness.queryFirst({
        text: `
          SELECT onboarding_status, onboarding_failure_code,
            joined_user_id, joined_profile_id
          FROM "openmeld"."slack_teammate_invitation_deliveries"
        `,
      })
    ).toEqual({
      joined_profile_id: null,
      joined_user_id: null,
      onboarding_failure_code: null,
      onboarding_status: "waiting_for_join",
    });
    expect(
      await harness.queryFirst({
        text: `
          SELECT openmeld_user_id
          FROM "openmeld"."slack_user_identity_links"
          WHERE slack_team_id = 'T123' AND slack_user_id = 'U_MAYA'
        `,
      })
    ).toEqual({ openmeld_user_id: "user-someone-else" });
  });

  it("fails before publication when the report action cannot get a valid Web app URL", () => {
    expect(() =>
      buildJoinedMemberWelcomeBlocks({
        documentId: "document-maya",
        message: "Prepared welcome",
        organizationSlug: "ampli-lift",
        webAppUrl: " ",
      })
    ).toThrow("WEB_APP_URL");
  });

  it("gives a joined member one plain next step when first research cannot start", async () => {
    const startResearch = vi.fn(() =>
      Promise.reject(new Error("Remote Agent unavailable"))
    );

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });

    expect(slackFetch).toHaveBeenCalledOnce();
    const [, request] = slackFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as { text: string };
    expect(body.text).toContain("couldn’t finish your first Profile Report");
    expect(body.text).toContain("Reply “try again”");
    expect(
      await harness.queryFirst({
        text: `SELECT onboarding_status, onboarding_failure_code
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
      })
    ).toEqual({
      onboarding_failure_code: "member_research_start_failed",
      onboarding_status: "failed",
    });
  });

  it("keeps an accepted research task recoverable when attaching it fails", async () => {
    const startResearch = vi.fn(async () => ({
      taskId: "research-task-accepted",
    }));
    const checkpointDb = createFaultInjectingPostgresDatabase({
      db: harness.db,
      matches: (sql) =>
        sql.includes(
          'UPDATE "openmeld"."slack_teammate_invitation_deliveries"'
        ) &&
        sql.includes("onboarding_status = 'researching'") &&
        sql.includes("research_task_id = $1"),
    });

    await runSlackInvitedMemberOnboardingTick({
      db: checkpointDb,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });

    expect(slackFetch).not.toHaveBeenCalled();
    expect(
      await harness.queryFirst({
        text: `SELECT onboarding_status, research_task_id, onboarding_failure_code
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
      })
    ).toEqual({
      onboarding_failure_code: null,
      onboarding_status: "starting",
      research_task_id: null,
    });

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 3000,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledTimes(2);
    expect(slackFetch).not.toHaveBeenCalled();
    expect(
      await harness.queryFirst({
        text: `SELECT onboarding_status, research_task_id, onboarding_failure_code
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
      })
    ).toEqual({
      onboarding_failure_code: null,
      onboarding_status: "researching",
      research_task_id: "research-task-accepted",
    });
  });

  it("starts one onboarding when the same Slack member has duplicate invitations", async () => {
    await seedDuplicateWaitingInvitation(harness);
    const startResearch = vi.fn(async () => ({ taskId: "research-task-1" }));

    await runSlackInvitedMemberOnboardingTick({
      db: harness.db,
      env: buildOnboardingEnv() as never,
      nowMs: 2000,
      startResearch,
    });

    expect(startResearch).toHaveBeenCalledOnce();
    expect(
      await harness.queryAll({
        text: `
          SELECT interaction_id, onboarding_status, onboarding_failure_code,
            joined_user_id, joined_profile_id
          FROM "openmeld"."slack_teammate_invitation_deliveries"
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
    await seedCompletedResearch(harness);
    await seedWelcomeDelivery(harness, {
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
      await harness.queryFirst({
        text: 'SELECT onboarding_status FROM "openmeld"."slack_teammate_invitation_deliveries"',
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
      await harness.queryFirst({
        text: `SELECT onboarding_status, onboarding_failure_code
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
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
    await seedCompletedResearch(harness);
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
      await harness.queryFirst({
        text: `SELECT status, failure_code
          FROM "openmeld"."slack_invited_member_welcome_deliveries"`,
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
      await harness.queryFirst({
        text: `SELECT onboarding_status, welcome_message_ts
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
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
    await seedCompletedResearch(harness);
    await seedWelcomeDelivery(harness, {
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
      await harness.queryFirst({
        text: `SELECT onboarding_status, welcome_message_ts
          FROM "openmeld"."slack_teammate_invitation_deliveries"`,
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

async function seedWaitingInvitation(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id, name, slug, "created_at")
      VALUES ('org-1', 'Ampli Lift', 'ampli-lift', 1700000000000)`,
  });
  await harness.query({
    values: [
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
    text: `
      INSERT INTO "openmeld"."slack_teammate_invitation_deliveries" (
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'delivered', '1723.0001', NULL,
        'waiting_for_join', NULL, NULL, NULL, NULL, NULL, $9, $10)
    `,
  });
}

async function seedExplicitIdentityLink(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await harness.query({
    text: `
      INSERT INTO "openmeld"."slack_user_identity_links" (
        organization_id,
        slack_team_id,
        slack_user_id,
        openmeld_user_id,
        source,
        created_at_ms
      )
      VALUES ('org-1', 'T123', 'U_MAYA', 'user-maya', 'explicit', 900)
    `,
  });
}

async function seedDuplicateWaitingInvitation(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await harness.query({
    values: [
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
    text: `
      INSERT INTO "openmeld"."slack_teammate_invitation_deliveries" (
        interaction_id, slack_team_id, organization_id,
        actor_slack_user_id, actor_user_id, target_slack_user_id,
        target_email, target_display_name, status, message_ts, failure_code,
        onboarding_status, joined_user_id, joined_profile_id, research_task_id,
        welcome_message_ts, onboarding_failure_code, created_at_ms, updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'delivered', '1723.0002', NULL,
        'waiting_for_join', NULL, NULL, NULL, NULL, NULL, $9, $10)
    `,
  });
}

async function seedCompletedResearch(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('user-maya','Maya Chen','maya@example.test')`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."center_agent_member_research_batches" (id,organization_id,scope,status,requested_by_user_id,requested_by_member_id,requested_by_profile_id,requested_by_display_name,direct_message_space_id,created_at_ms,updated_at_ms) VALUES ('research-batch-1','org-1','member','completed','user-installer','member-installer','11111111-1111-4111-8111-111111111111','Alex','research-dm',1000,1100)`,
  });
  await harness.query({
    values: ["research-task-1"],
    text: `
      INSERT INTO "openmeld"."center_agent_member_research_tasks" (
        id, status, failure_code, observed_language_tag, report_result, batch_id, subject_user_id, subject_display_name, position, created_at_ms, started_at_ms, finished_at_ms
      )
      VALUES ($1, 'completed', NULL, NULL, 'evidence_backed', 'research-batch-1', 'user-maya', 'Maya Chen', 1, 1000, 1000, 1100)
    `,
  });
  await harness.query({
    values: [
      "document-maya",
      "org-1",
      "research-task-1",
      `## Working profile

### Current focus
- 2026-08-15 — Improving the customer feedback loop. Source: Slack #product
`,
    ],
    text: `
      INSERT INTO "openmeld"."organization_documents" (
        id, organization_id, last_member_research_task_id, draft_content, kind, subject_user_id, title, draft_created_by, draft_created_at
      )
      VALUES ($1, $2, $3, $4, 'member_profile', 'user-maya', 'Profile Report', 'center_agent', 1000)
    `,
  });
  await harness.query({
    values: ["research-task-1", "user-maya", "document-maya"],
    text: `
      INSERT INTO "openmeld"."center_agent_member_research_computer_files" (
        task_id, subject_user_id, document_id, path, created_at_ms
      )
      VALUES ($1, $2, $3, 'Profile Reports/Maya Chen.md', 1000)
    `,
  });
  await harness.query({
    text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, "created_at")
      VALUES ('org-1', 'Ampli Lift', 'ampli-lift', 1700000000000) ON CONFLICT DO NOTHING`,
  });
}

async function seedWelcomeDelivery(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    messageTs: string | null;
    status: "delivered" | "pending";
    updatedAtMs: number;
  }
): Promise<void> {
  await harness.query({
    values: [
      input.status,
      input.messageTs,
      input.status === "pending" ? null : null,
      input.updatedAtMs,
    ],
    text: `
      INSERT INTO "openmeld"."slack_invited_member_welcome_deliveries" (
        interaction_id, target_slack_user_id, research_task_id,
        status, claim_id, attempt_count, message_ts, failure_code,
        created_at_ms, updated_at_ms
      ) VALUES (
        'invite-1', 'U_MAYA', 'research-task-1',
        $1, 'claim-1', 1, $2, $3, 2500, $4
      )
    `,
  });
}
