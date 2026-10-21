import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { recordAiUsage } from "../src/usage/ai-usage-repository";
import { rpcReadOrganizationAiUsage } from "../src/usage/ai-usage-rpc";
import { rpcReadOrganizationUsageOverview } from "../src/usage/organization-usage-overview-rpc";
import { env } from "../test-support/worker-env";

const FIXED_NOW_MS = Date.parse("2026-07-16T23:30:00.000Z");
const ownedOrganizationUsers = new Map<string, string>();
afterEach(async () => {
  vi.restoreAllMocks();
  for (const [organizationId, userId] of ownedOrganizationUsers) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_daily_admissions" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."routines" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."organizations" WHERE id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."users" WHERE id = $1',
              values: [],
            },
            values: [userId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
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
  it("returns model spend while ignoring retired daily allowances and wake counts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
    const fixture = await seedMemberFixture();
    await seedUsage(fixture, {
      admittedCount: 12,
      routineStatuses: ["enabled", "enabled", "paused"],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."organization_ai_usage_policies" VALUES ($1, $2, $3)',
        values: [],
      },
      values: [fixture.organizationId, 1_000_000_000, FIXED_NOW_MS],
    });
    await recordAiUsage(getPostgresDatabase(env), {
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
        dailyLimitNanoUsd: null,
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
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Usage Test User\', $2, 1, 1, 1)',
            values: [],
          },
          values: [userId, `${userId}@example.com`],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Usage Test Organization\', $2, 1)',
            values: [],
          },
          values: [organizationId, `usage-${suffix}`],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', 1)',
            values: [],
          },
          values: [`member_usage_${suffix}`, organizationId, userId],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
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
    {
      ...{
        text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_daily_admissions" (
          organization_id, day_utc, admitted_count,
          last_admission_idempotency_key, created_at_ms, updated_at_ms
        ) VALUES ($1, '2026-07-16', $2, 'usage-test-admission', $3, $4)
      `,
        values: [],
      },
      values: [
        fixture.organizationId,
        input.admittedCount,
        FIXED_NOW_MS,
        FIXED_NOW_MS,
      ],
    },
    ...input.routineStatuses.map((status, index) => ({
      ...{
        text: `
          INSERT INTO "openmeld"."routines" (
            id, organization_id, name, instructions, schedule_kind,
            cron_expression, timezone, destination_kind, target_space_id,
            status, next_due_at, created_by_user_id, updated_by_user_id,
            created_at_ms, updated_at_ms
          ) VALUES ($1, $2, $3, 'Review the work queue.', 'cron', '0 9 * * *',
            'UTC', 'space', 'space-usage-test', $4, $5, $6, $7, $8, $9)
        `,
        values: [],
      },
      values: [
        `routine_usage_${crypto.randomUUID()}`,
        fixture.organizationId,
        `Usage Routine ${index + 1}`,
        status,
        status === "enabled" ? FIXED_NOW_MS + 60_000 : null,
        fixture.userId,
        fixture.userId,
        FIXED_NOW_MS,
        FIXED_NOW_MS,
      ],
    })),
  ];
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of statements) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
}
