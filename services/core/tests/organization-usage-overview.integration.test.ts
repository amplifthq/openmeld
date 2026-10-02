import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { recordAiUsage } from "../src/usage/ai-usage-repository";
import { rpcReadOrganizationAiUsage } from "../src/usage/ai-usage-rpc";
import { rpcReadOrganizationUsageOverview } from "../src/usage/organization-usage-overview-rpc";

const FIXED_NOW_MS = Date.parse("2026-07-16T23:30:00.000Z");
const ownedOrganizationUsers = new Map<string, string>();

afterEach(async () => {
  vi.restoreAllMocks();
  for (const [organizationId, userId] of ownedOrganizationUsers) {
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "DELETE FROM openMeldRemoteAgent_daily_admissions WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM routines WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM members WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?").bind(
        organizationId
      ),
      env.OPENMELD_DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    ]);
  }
  ownedOrganizationUsers.clear();
});

describe("Organization Usage overview", () => {
  it("allows an ordinary organization member to query usage but rejects a different organization", async () => {
    const fixture = await seedMemberFixture();
    const other = await seedMemberFixture();
    const query = {
      fromMs: FIXED_NOW_MS,
      toMs: FIXED_NOW_MS + 1000,
      groupBy: "task" as const,
      includeIssues: true,
    };
    await expect(
      rpcReadOrganizationAiUsage(env as CoreBindings, {
        context: fixture.context,
        query,
      })
    ).resolves.toMatchObject({
      fromMs: query.fromMs,
      toMs: query.toMs,
      models: [],
      coverage: { pendingRequests: 0, collectionFailedRequests: 0 },
      breakdown: { groupBy: "task", groups: [], hasMore: false },
      issues: { records: [], hasMore: false },
    });
    await expect(
      rpcReadOrganizationAiUsage(env as CoreBindings, {
        context: {
          ...fixture.context,
          activeOrganizationId: other.organizationId,
        },
        query,
      })
    ).rejects.toMatchObject({
      code: "organization.membership_required",
      status: 403,
    });
  });
  it("returns zero for a missing daily row and the next UTC midnight", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedMemberFixture();

    await expect(
      rpcReadOrganizationUsageOverview(env as CoreBindings, {
        context: fixture.context,
      })
    ).resolves.toEqual({
      aiSpend: {
        dailyLimitNanoUsd: null,
        resetsAt: "2026-07-17T00:00:00.000Z",
        usedNanoUsd: 0,
        missingCostRequests: 0,
        exhausted: false,
      },
      routines: {
        count: 0,
        limit: 50,
      },
    });
  });

  it("returns model spend and an optional shared allowance while ignoring historical wake counts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedMemberFixture();
    await seedUsage(fixture, {
      admittedCount: 12,
      routineStatuses: ["enabled", "enabled", "paused"],
    });
    await env.OPENMELD_DB.prepare(
      "INSERT INTO organization_ai_usage_policies VALUES (?, ?, ?)"
    )
      .bind(fixture.organizationId, 1_000_000_000, FIXED_NOW_MS)
      .run();
    await recordAiUsage(env.OPENMELD_DB, {
      organizationId: fixture.organizationId,
      runtime: "remote",
      eventId: "test-provider-request",
      provider: "openrouter",
      source: "openrouter_response",
      model: "openai/test",
      occurredAtMs: FIXED_NOW_MS,
      purpose: "agent",
      status: "reported",
      providerRequestId: "provider-1",
      tokens: {
        input: 100,
        output: 20,
        total: 120,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
      },
      cost: { nanoUsd: 200_000_000, kind: "provider_reported" },
      agentProfileId: null,
      spaceId: null,
      taskId: null,
      attemptId: null,
      computerId: null,
      controller: null,
    });

    await expect(
      rpcReadOrganizationUsageOverview(env as CoreBindings, {
        context: fixture.context,
      })
    ).resolves.toMatchObject({
      aiSpend: {
        dailyLimitNanoUsd: 1_000_000_000,
        usedNanoUsd: 200_000_000,
        missingCostRequests: 0,
        exhausted: false,
      },
      routines: {
        count: 3,
        limit: 50,
      },
    });
  });

  it("rejects a signed-in user who is not an active organization member", async () => {
    const fixture = await seedMemberFixture();

    await expect(
      rpcReadOrganizationUsageOverview(env as CoreBindings, {
        context: {
          ...fixture.context,
          actorContext: {
            ...fixture.context.actorContext,
            callerPrincipalId: "not-a-member",
          },
        },
      })
    ).rejects.toMatchObject({
      code: "organization.membership_required",
      status: 403,
    });
  });
});

async function seedMemberFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org_usage_${suffix}`;
  const userId = `user_usage_${suffix}`;
  ownedOrganizationUsers.set(organizationId, userId);
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Usage Test User', ?, 1, 1, 1)"
    ).bind(userId, `${userId}@example.com`),
    env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Usage Test Organization', ?, 1)"
    ).bind(organizationId, `usage-${suffix}`),
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', 1)"
    ).bind(`member_usage_${suffix}`, organizationId, userId),
  ]);
  return {
    context: {
      activeOrganizationId: organizationId,
      actorContext: {
        callerPrincipalId: userId,
        profileKind: "human" as const,
        requestId: `request_usage_${suffix}`,
        openMeldProfileId: crypto.randomUUID(),
      },
    },
    organizationId,
    userId,
  };
}

async function seedUsage(
  fixture: Awaited<ReturnType<typeof seedMemberFixture>>,
  input: {
    admittedCount: number;
    routineStatuses: Array<"enabled" | "paused">;
  }
): Promise<void> {
  const statements = [
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldRemoteAgent_daily_admissions (
          organization_id, day_utc, admitted_count,
          last_admission_idempotency_key, created_at_ms, updated_at_ms
        ) VALUES (?, '2026-07-16', ?, 'usage-test-admission', ?, ?)
      `
    ).bind(
      fixture.organizationId,
      input.admittedCount,
      FIXED_NOW_MS,
      FIXED_NOW_MS
    ),
    ...input.routineStatuses.map((status, index) =>
      env.OPENMELD_DB.prepare(
        `
          INSERT INTO routines (
            id, organization_id, name, instructions, schedule_kind,
            cron_expression, timezone, destination_kind, target_space_id,
            status, next_due_at, created_by_user_id, updated_by_user_id,
            created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, 'Review the work queue.', 'cron', '0 9 * * *',
            'UTC', 'space', 'space-usage-test', ?, ?, ?, ?, ?, ?)
        `
      ).bind(
        `routine_usage_${crypto.randomUUID()}`,
        fixture.organizationId,
        `Usage Routine ${index + 1}`,
        status,
        status === "enabled" ? FIXED_NOW_MS + 60_000 : null,
        fixture.userId,
        fixture.userId,
        FIXED_NOW_MS,
        FIXED_NOW_MS
      )
    ),
  ];
  await env.OPENMELD_DB.batch(statements);
}
