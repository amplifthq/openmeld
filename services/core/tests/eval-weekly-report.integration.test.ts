import { runInDurableObject } from "cloudflare:test";
import { randomUUID } from "node:crypto";
import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  collectOrganizationWeeklyEvalMetrics,
  createOrganizationWeeklyEvalReport,
  readOrganizationExecutionEvalMetrics,
} from "../src/eval/eval-report-repository";
import type { CoreBindings } from "../src/lib/bindings";
import { resolveNamedSpaceId } from "../src/rpc/space-ref";
import {
  EVAL_WEEKLY_REPORT_CRON,
  runCoreScheduledTasks,
} from "../src/scheduled/core-scheduled-tasks";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

const PERIOD_START_MS = Date.parse("2026-07-06T00:00:00.000Z");
const PERIOD_END_MS = Date.parse("2026-07-13T00:00:00.000Z");
describe("weekly Organization eval metrics", () => {
  it("counts only wakes created for the Organization during the period", async () => {
    const organizationId = `org-eval-wake-${randomUUID()}`;
    const otherOrganizationId = `org-eval-wake-other-${randomUUID()}`;
    const spaceId = randomUUID().replaceAll("-", "").padEnd(64, "0");
    const otherSpaceId = randomUUID().replaceAll("-", "").padEnd(64, "1");
    await seedOrganizationSpace({ organizationId, spaceId });
    await seedOrganizationSpace({
      organizationId: otherOrganizationId,
      spaceId: otherSpaceId,
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 1,
      spaceId,
      status: "reply_published",
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS - 1,
      spaceId,
      status: "reply_published",
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 2,
      spaceId: otherSpaceId,
      status: "reply_published",
    });
    const metrics = await readOrganizationExecutionEvalMetrics({
      db: getPostgresDatabase(env),
      organizationId,
      periodEndMs: PERIOD_END_MS,
      periodStartMs: PERIOD_START_MS,
    });
    expect(metrics.wakeTotal).toBe(1);
  });
  it("counts only explicit visible terminal outcomes as closed", async () => {
    const organizationId = `org-eval-closure-${randomUUID()}`;
    const spaceId = randomUUID().replaceAll("-", "").padEnd(64, "2");
    await seedOrganizationSpace({ organizationId, spaceId });
    for (const status of [
      "reply_published",
      "failed_terminal",
      "cancelled",
      "running",
      "failed_retryable",
    ]) {
      await seedRuntimeCoordinatorExecution({
        createdAtMs: PERIOD_START_MS + 10,
        spaceId,
        status,
      });
    }
    const metrics = await readOrganizationExecutionEvalMetrics({
      db: getPostgresDatabase(env),
      organizationId,
      periodEndMs: PERIOD_END_MS,
      periodStartMs: PERIOD_START_MS,
    });
    expect(metrics.closureCount).toBe(3);
    expect(metrics.closureRate).toBe(0.6);
  });
  it("counts terminal failures without treating stops as failures", async () => {
    const organizationId = `org-eval-failure-${randomUUID()}`;
    const spaceId = randomUUID().replaceAll("-", "").padEnd(64, "3");
    await seedOrganizationSpace({ organizationId, spaceId });
    for (const status of [
      "failed_terminal",
      "cancelled",
      "reply_published",
      "failed_retryable",
    ]) {
      await seedRuntimeCoordinatorExecution({
        createdAtMs: PERIOD_START_MS + 20,
        spaceId,
        status,
      });
    }
    const metrics = await readOrganizationExecutionEvalMetrics({
      db: getPostgresDatabase(env),
      organizationId,
      periodEndMs: PERIOD_END_MS,
      periodStartMs: PERIOD_START_MS,
    });
    expect(metrics.failureCount).toBe(1);
    expect(metrics.failureRate).toBe(0.25);
  });
  it("counts overlapping in-flight executions for different agents in one Space", async () => {
    const organizationId = `org-eval-overlap-${randomUUID()}`;
    const spaceId = randomUUID().replaceAll("-", "").padEnd(64, "4");
    const otherSpaceId = randomUUID().replaceAll("-", "").padEnd(64, "5");
    await seedOrganizationSpace({ organizationId, spaceId });
    await seedSpaceIndex({ organizationId, spaceId: otherSpaceId });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 100,
      spaceId,
      status: "running",
      targetProfileId: "agent-a",
      updatedAtMs: PERIOD_START_MS + 150,
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 200,
      spaceId,
      status: "reply_published",
      targetProfileId: "agent-b",
      updatedAtMs: PERIOD_START_MS + 300,
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 300,
      spaceId,
      status: "reply_published",
      targetProfileId: "agent-c",
      updatedAtMs: PERIOD_START_MS + 400,
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 200,
      spaceId: otherSpaceId,
      status: "reply_published",
      targetProfileId: "agent-d",
      updatedAtMs: PERIOD_START_MS + 300,
    });
    const metrics = await readOrganizationExecutionEvalMetrics({
      db: getPostgresDatabase(env),
      organizationId,
      periodEndMs: PERIOD_END_MS,
      periodStartMs: PERIOD_START_MS,
    });
    expect(metrics.concurrencyOverlap).toBe(2);
  });
  it("counts stay-silent notices from the Organization's Space ledger", async () => {
    const organizationId = `org-eval-silent-${randomUUID()}`;
    const { spaceId, stub } = resolveTestSpace("silent");
    await seedOrganizationSpace({ organizationId, spaceId });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 100,
      spaceId,
      status: "reply_published",
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 200,
      spaceId,
      status: "reply_published",
    });
    await seedSignal(stub, {
      data: {
        dispatchId: `dispatch-${randomUUID()}`,
        generatedBy: "openmeld",
        noticeType: "stay_silent",
        text: "No public update was needed.",
      },
      id: randomUUID(),
      spaceId,
      ts: PERIOD_START_MS + 300,
      type: "signal.system_notice",
      v: 1,
    });
    await seedSignal(stub, {
      data: {
        dispatchId: `dispatch-${randomUUID()}`,
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        text: "The Wake failed.",
      },
      id: randomUUID(),
      spaceId,
      ts: PERIOD_START_MS + 400,
      type: "signal.system_notice",
      v: 1,
    });
    await seedSignal(stub, {
      data: {
        dispatchId: `dispatch-${randomUUID()}`,
        generatedBy: "openmeld",
        noticeType: "stay_silent",
        text: "Outside the reporting window.",
      },
      id: randomUUID(),
      spaceId,
      ts: PERIOD_END_MS,
      type: "signal.system_notice",
      v: 1,
    });
    const metrics = await collectOrganizationWeeklyEvalMetrics({
      env: env as unknown as CoreBindings,
      organizationId,
      periodEndMs: PERIOD_END_MS,
      periodStartMs: PERIOD_START_MS,
    });
    expect(metrics.silentCount).toBe(1);
    expect(metrics.silentRate).toBe(0.5);
  });
  it("counts staleness metadata only on replies during the period", async () => {
    const organizationId = `org-eval-staleness-${randomUUID()}`;
    const { spaceId, stub } = resolveTestSpace("staleness");
    await seedOrganizationSpace({ organizationId, spaceId });
    await seedSignal(
      stub,
      createReplySignal({
        spaceId,
        stale: true,
        ts: PERIOD_START_MS + 100,
      })
    );
    await seedSignal(
      stub,
      createReplySignal({
        spaceId,
        stale: false,
        ts: PERIOD_START_MS + 200,
      })
    );
    await seedSignal(stub, {
      data: {
        meta: { staleness: { newMessagesDuringComposition: 1 } },
        text: "This is not a reply.",
      },
      id: randomUUID(),
      spaceId,
      ts: PERIOD_START_MS + 300,
      type: "signal.text",
      v: 1,
    });
    await seedSignal(
      stub,
      createReplySignal({
        spaceId,
        stale: true,
        ts: PERIOD_END_MS,
      })
    );
    const metrics = await collectOrganizationWeeklyEvalMetrics({
      env: env as unknown as CoreBindings,
      organizationId,
      periodEndMs: PERIOD_END_MS,
      periodStartMs: PERIOD_START_MS,
    });
    expect(metrics.replyCount).toBe(2);
    expect(metrics.staleReplyCount).toBe(1);
    expect(metrics.stalenessRate).toBe(0.5);
  });
  it("returns explicit zero metrics for an Organization with no data", async () => {
    const organizationId = `org-eval-empty-${randomUUID()}`;
    await seedOrganization(organizationId);
    const metrics = await collectOrganizationWeeklyEvalMetrics({
      env: env as unknown as CoreBindings,
      organizationId,
      periodEndMs: PERIOD_END_MS,
      periodStartMs: PERIOD_START_MS,
    });
    expect(metrics).toEqual({
      schemaVersion: 1,
      wakeTotal: 0,
      closureCount: 0,
      closureRate: 0,
      failureCount: 0,
      failureRate: 0,
      silentCount: 0,
      silentRate: 0,
      replyCount: 0,
      staleReplyCount: 0,
      stalenessRate: 0,
      concurrencyOverlap: 0,
    });
  });
  it("publishes one idempotent real report message when the weekly scheduled task is triggered", async () => {
    const fixture = await seedOfficialOrganizationCenterAgent();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."members" SET role = \'admin\' WHERE organization_id = $1',
        values: [],
      },
      values: [fixture.organizationId],
    });
    await expect(
      runCoreScheduledTasks({
        cron: EVAL_WEEKLY_REPORT_CRON,
        env: env as unknown as CoreBindings,
        nowMs: Date.parse("2026-07-20T05:00:00.000Z"),
      })
    ).rejects.toThrow(
      "Weekly eval Quality Space requires a current organization owner"
    );
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const qualityObjectId = resolveNamedSpaceId(
      namespace,
      `eval-quality-space-v1:${fixture.organizationId}`
    );
    const qualitySpace = namespace.get(qualityObjectId);
    const emptyMetaCount = await runInDurableObject(
      qualitySpace,
      (_instance, state) =>
        state.storage.sql
          .exec<{
            count: number;
          }>("SELECT COUNT(*) AS count FROM space_meta")
          .one().count
    );
    expect(emptyMetaCount).toBe(0);
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."members" SET role = \'owner\' WHERE organization_id = $1',
        values: [],
      },
      values: [fixture.organizationId],
    });
    await createOrganizationWeeklyEvalReport({
      createdAtMs: PERIOD_START_MS,
      db: getPostgresDatabase(env),
      metrics: emptyWeeklyEvalMetrics(),
      organizationId: fixture.organizationId,
      periodEndMs: PERIOD_START_MS,
      periodStartMs: PERIOD_START_MS - 7 * 24 * 60 * 60 * 1000,
    });
    const { spaceId: sourceSpaceId } = resolveTestSpace("scheduled-source");
    await seedSpaceIndex({
      organizationId: fixture.organizationId,
      spaceId: sourceSpaceId,
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 100,
      spaceId: sourceSpaceId,
      status: "reply_published",
    });
    const scheduledInput = {
      cron: EVAL_WEEKLY_REPORT_CRON,
      env: env as unknown as CoreBindings,
      nowMs: Date.parse("2026-07-13T05:00:00.000Z"),
    };
    await runCoreScheduledTasks(scheduledInput);
    const laterOwner = await seedOrganizationOwner({
      label: "later",
      organizationId: fixture.organizationId,
    });
    await seedRuntimeCoordinatorExecution({
      createdAtMs: PERIOD_START_MS + 200,
      spaceId: sourceSpaceId,
      status: "failed_terminal",
    });
    await runCoreScheduledTasks(scheduledInput);
    const reportRow = await getPostgresDatabase(env)
      .query<{
        metrics_json: string;
      }>({
        ...{
          text: `
        SELECT metrics_json
        FROM "openmeld"."eval_reports"
        WHERE organization_id = $1
          AND period_start = $2
          AND period_end = $3
      `,
          values: [],
        },
        values: [fixture.organizationId, PERIOD_START_MS, PERIOD_END_MS],
      })
      .then((result) => result.rows[0] ?? null);
    expect(JSON.parse(reportRow?.metrics_json ?? "null")).toMatchObject({
      schemaVersion: 1,
      wakeTotal: 1,
      closureRate: 1,
      failureRate: 0,
    });
    const evidence = await runInDurableObject(
      qualitySpace,
      (_instance, state) => {
        const [meta] = state.storage.sql
          .exec<{
            creator_json: string;
            name: string;
            organization_id: string;
            owner_user_ids_json: string;
          }>(
            "SELECT creator_json, name, organization_id, owner_user_ids_json FROM space_meta LIMIT 1"
          )
          .toArray();
        const members = state.storage.sql
          .exec<{
            owner_user_id_snapshot: string | null;
            profile_id: string;
          }>(
            "SELECT owner_user_id_snapshot, profile_id FROM space_members WHERE status = 'active' ORDER BY profile_id ASC"
          )
          .toArray();
        const signals = state.storage.sql
          .exec<{
            payload_json: string;
          }>(
            "SELECT payload_json FROM space_signals WHERE type = 'signal.text' ORDER BY ts ASC"
          )
          .toArray();
        return { members, meta, signals };
      }
    );
    expect(evidence.meta).toMatchObject({
      name: "OpenMeld Quality",
      organization_id: fixture.organizationId,
    });
    const creator = JSON.parse(evidence.meta?.creator_json ?? "null") as {
      kind?: string;
      ownerUserId?: string;
      profileId?: string;
    };
    expect(creator).toMatchObject({
      kind: "agent",
      profileId: fixture.profileId,
    });
    expect(creator.ownerUserId).toBeUndefined();
    expect(JSON.parse(evidence.meta?.owner_user_ids_json ?? "null")).toEqual(
      [...fixture.ownerUserIds].sort()
    );
    expect(evidence.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profile_id: fixture.profileId }),
        ...fixture.ownerProfileIds.map((profileId) =>
          expect.objectContaining({ profile_id: profileId })
        ),
      ])
    );
    expect(evidence.members).not.toContainEqual(
      expect.objectContaining({ profile_id: laterOwner.profileId })
    );
    expect(evidence.signals).toHaveLength(1);
    const reportSignal = JSON.parse(
      evidence.signals[0]?.payload_json ?? "null"
    ) as {
      data?: {
        text?: string;
      };
      profile?: {
        profileId?: string;
        owner?: string;
        ownerName?: string;
      };
      type?: string;
    };
    expect(reportSignal.type).toBe("signal.text");
    expect(reportSignal.profile).toMatchObject({
      profileId: fixture.profileId,
    });
    expect(reportSignal.profile?.owner).toBeUndefined();
    expect(reportSignal.profile?.ownerName).toBeUndefined();
    expect(reportSignal.data?.text).toContain("# Weekly Quality Report");
    expect(reportSignal.data?.text).toContain("| Wakes | 1 | +1 |");
    expect(reportSignal.data?.text).not.toContain("| Wakes | 2 |");
    expect(reportSignal.data?.text).toContain("## Known gaps");
    expect(reportSignal.data?.text).toContain("Repair trigger rate");
    expect(reportSignal.data?.text).toContain("Late ledger facts");
  });
  it("does not leave owner references when one initial owner is invalid", async () => {
    const organizationId = `org-eval-owner-atomic-${randomUUID()}`;
    await seedOrganization(organizationId);
    const primaryOwner = await seedOrganizationOwner({
      label: "atomic",
      organizationId,
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const objectId = namespace.idFromName(`eval-owner-atomic-${randomUUID()}`);
    const spaceId = objectId.toString();
    const space = namespace.get(objectId);
    const initialization = await space.rpcInitializeSpaceMetaWithOwners({
      creator: {
        kind: "agent",
        profileId: `agt_${randomUUID()}`,
        profileName: "Center Agent",
      },
      name: "OpenMeld Quality",
      organizationId,
      owners: [
        toResolvedOwnerMember(primaryOwner),
        {
          agentControllerRef: null,
          ownerName: "Former Owner",
          ownerUserId: `missing-owner-${randomUUID()}`,
          profileId: randomUUID(),
          profileKind: "human",
          profileName: "Former Owner",
        },
      ],
      spaceId,
      visibility: "public",
    });
    expect(initialization).toEqual({
      reason: "The initial Space owners must be current organization owners.",
      status: "owners_invalid",
    });
    const metaCount = await runInDurableObject(
      space,
      (_instance, state) =>
        state.storage.sql
          .exec<{
            count: number;
          }>("SELECT COUNT(*) AS count FROM space_meta")
          .one().count
    );
    const referenceCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."space_owner_member_references" WHERE space_id = $1',
          values: [],
        },
        values: [spaceId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(metaCount).toBe(0);
    expect(referenceCount?.count).toBe(0);
  });
});
function emptyWeeklyEvalMetrics() {
  return {
    schemaVersion: 1 as const,
    wakeTotal: 0,
    closureCount: 0,
    closureRate: 0,
    failureCount: 0,
    failureRate: 0,
    silentCount: 0,
    silentRate: 0,
    replyCount: 0,
    staleReplyCount: 0,
    stalenessRate: 0,
    concurrencyOverlap: 0,
  };
}
function createReplySignal(input: {
  spaceId: string;
  stale: boolean;
  ts: number;
}): Parameters<typeof seedSignal>[1] {
  return {
    data: {
      ...(input.stale
        ? { meta: { staleness: { newMessagesDuringComposition: 1 } } }
        : {}),
      replyTo: {
        previewText: "How did the week go?",
        profileId: "profile-eval-author",
        profileKind: "human",
        profileName: "Eval Author",
        signalId: `signal-source-${randomUUID()}`,
      },
      text: "Here is the weekly update.",
    },
    id: randomUUID(),
    spaceId: input.spaceId,
    ts: input.ts,
    type: "signal.text",
    v: 1,
  };
}
function resolveTestSpace(label: string): {
  spaceId: string;
  stub: DurableObjectStub<Space>;
} {
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const id = namespace.idFromName(`eval-${label}-${randomUUID()}`);
  return { spaceId: id.toString(), stub: namespace.get(id) };
}
async function seedSignal(
  stub: DurableObjectStub<Space>,
  signal: {
    data: Record<string, unknown>;
    id: string;
    spaceId: string;
    ts: number;
    type: string;
    v: 1;
  }
): Promise<void> {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      `
        INSERT INTO space_signals (
          id,
          ts,
          type,
          profile_id,
          profile_kind,
          client_message_id,
          payload_json
        )
        VALUES (?, ?, ?, NULL, NULL, NULL, ?)
      `,
      signal.id,
      signal.ts,
      signal.type,
      JSON.stringify(signal)
    );
  });
}
async function seedOrganizationSpace(input: {
  organizationId: string;
  spaceId: string;
}): Promise<void> {
  await seedOrganization(input.organizationId);
  await seedSpaceIndex(input);
}
async function seedOrganization(organizationId: string): Promise<void> {
  const nowMs = Date.now();
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ($1, $2, $3, $4)
    `,
      values: [],
    },
    values: [organizationId, `Eval ${organizationId}`, organizationId, nowMs],
  });
}
async function seedOfficialOrganizationCenterAgent(): Promise<{
  organizationId: string;
  ownerProfileIds: string[];
  ownerUserIds: string[];
  profileId: string;
}> {
  const organizationId = `org-official-eval-${randomUUID()}`;
  const profileId = `agt_${randomUUID()}`;
  const nowMs = Date.now();
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ($1, 'OpenMeld', 'openmeld', $2)
    `,
      values: [],
    },
    values: [organizationId, nowMs],
  });
  const owners = await Promise.all([
    seedOrganizationOwner({ label: "primary", organizationId }),
    seedOrganizationOwner({ label: "secondary", organizationId }),
  ]);
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          created_by_user_id,
          creator_profile_id,
          source,
          managed_role,
          last_used_at,
          created_at,
          updated_at
        )
        VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, NULL, 'auth_bootstrap', 'center_agent', NULL, $5, $6)
      `,
            values: [],
          },
          values: [
            profileId,
            `quality-center-agent-${randomUUID()}`,
            organizationId,
            owners[0]?.userId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."center_agent_designations" (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        )
        VALUES ($1, $2, NULL, $3, $4)
      `,
            values: [],
          },
          values: [organizationId, profileId, owners[0]?.userId, nowMs],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    organizationId,
    ownerProfileIds: owners.map((owner) => owner.profileId),
    ownerUserIds: owners.map((owner) => owner.userId),
    profileId,
  };
}
async function seedOrganizationOwner(input: {
  label: string;
  organizationId: string;
}): Promise<{
  profileId: string;
  profileName: string;
  userId: string;
}> {
  const nowMs = Date.now();
  const profileId = randomUUID();
  const userId = `user-official-eval-${randomUUID()}`;
  const profileName = `Quality Owner ${input.label}`;
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."users" (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 1, $4, $5)
      `,
            values: [],
          },
          values: [
            userId,
            profileName,
            `quality-${randomUUID()}@example.com`,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, 'owner', $4)
      `,
            values: [],
          },
          values: [
            `member-${randomUUID()}`,
            input.organizationId,
            userId,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          created_by_user_id,
          creator_profile_id,
          source,
          managed_role,
          last_used_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'human', 1, 'active', NULL, $4, $5, NULL, 'auth_bootstrap', NULL, NULL, $6, $7)
      `,
            values: [],
          },
          values: [
            profileId,
            profileName,
            `quality-owner-${randomUUID()}`,
            userId,
            userId,
            nowMs,
            nowMs,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return { profileId, profileName, userId };
}
function toResolvedOwnerMember(owner: {
  profileId: string;
  profileName: string;
  userId: string;
}) {
  return {
    agentControllerRef: null,
    ownerName: owner.profileName,
    ownerUserId: owner.userId,
    profileId: owner.profileId,
    profileKind: "human" as const,
    profileName: owner.profileName,
  };
}
async function seedSpaceIndex(input: {
  organizationId: string;
  spaceId: string;
}): Promise<void> {
  const nowMs = Date.now();
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        organization_visibility,
        status,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      )
      VALUES ($1, $2, 'private', 'active', $3, $4, $5)
    `,
      values: [],
    },
    values: [input.spaceId, input.organizationId, nowMs, nowMs, randomUUID()],
  });
}
async function seedRuntimeCoordinatorExecution(input: {
  createdAtMs: number;
  spaceId: string;
  status: string;
  targetProfileId?: string;
  updatedAtMs?: number;
}): Promise<void> {
  const executionId = randomUUID();
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions" (
        runtime_coordinator_execution_id,
        model_version,
        space_id,
        dispatch_id,
        target_profile_id,
        openmeld_service_runtime_id_source,
        openmeld_service_runtime_id,
        binding_id,
        agent_controller_ref,
        status,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
      values: [],
    },
    values: [
      executionId,
      "openmeld.runtime_coordinator.execution.v1",
      input.spaceId,
      `dispatch-${executionId}`,
      input.targetProfileId ?? `agent-${executionId}`,
      "reported",
      `runtime-${executionId}`,
      `binding-${executionId}`,
      "codex",
      input.status,
      input.createdAtMs,
      input.updatedAtMs ?? input.createdAtMs + 1,
    ],
  });
}
