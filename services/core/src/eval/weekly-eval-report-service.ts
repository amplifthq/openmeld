import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import type { Profile } from "@openmeld/protocol";
import type {
  OpenMeldRequestContext,
  OrganizationWeeklyEvalMetrics,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import type { CoreBindings } from "../lib/bindings";
import { identityDb, projectionsDb } from "../lib/bindings";
import { resolveNamedSpaceId } from "../rpc/space-ref";
import { emitSpaceTextSignalOnceByClientMessageId } from "../rpc/space-signal-emitter";
import {
  collectOrganizationWeeklyEvalMetrics,
  createOrganizationWeeklyEvalReport,
  readOrganizationWeeklyEvalReport,
} from "./eval-report-repository";

export const EVAL_WEEKLY_REPORT_CRON = "0 5 * * 1";

// Intentional internal dogfood scope: this report only serves OpenMeld's
// official Organization work loop, so its destination Space and Organization
// slug remain fixed until reporting becomes a tenant-configurable product.
export const QUALITY_SPACE_NAME = "OpenMeld Quality";

const OFFICIAL_ORGANIZATION_SLUG = "openmeld";
const QUALITY_SPACE_ID_NAMESPACE = "eval-quality-space-v1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type EvalReportPublisher = {
  organizationId: string;
  ownerName: string;
  ownerUserId: string;
  profileId: string;
  profileName: string;
};

export type WeeklyEvalReportRunResult =
  | {
      reason: "official_organization_not_found";
      status: "skipped";
    }
  | {
      organizationId: string;
      periodEndMs: number;
      periodStartMs: number;
      reportSignalId: string;
      spaceId: string;
      status: "published";
    };

export async function runWeeklyEvalReport(input: {
  env: CoreBindings;
  nowMs: number;
}): Promise<WeeklyEvalReportRunResult> {
  const identityDatabase = identityDb(input.env);
  const reportDatabase = projectionsDb(input.env);
  if (!(identityDatabase && reportDatabase)) {
    throw new Error("Weekly eval reporting requires the shared Core database");
  }

  const publisher =
    await readOfficialOrganizationEvalPublisher(identityDatabase);
  if (!publisher) {
    console.log(
      JSON.stringify({
        event: "core.eval.weekly_report.skipped",
        reason: "official_organization_not_found",
      })
    );
    return {
      reason: "official_organization_not_found",
      status: "skipped",
    };
  }

  const period = resolveCompletedWeeklyEvalPeriod(input.nowMs);
  const previousPeriod = {
    periodEndMs: period.periodStartMs,
    periodStartMs: period.periodStartMs - WEEK_MS,
  };
  const storedMetrics = await readOrganizationWeeklyEvalReport({
    db: reportDatabase,
    organizationId: publisher.organizationId,
    ...period,
  });
  const metrics =
    storedMetrics ??
    (await createOrganizationWeeklyEvalReport({
      createdAtMs: input.nowMs,
      db: reportDatabase,
      metrics: await collectOrganizationWeeklyEvalMetrics({
        env: input.env,
        organizationId: publisher.organizationId,
        ...period,
      }),
      organizationId: publisher.organizationId,
      ...period,
    }));
  const previousMetrics = await readOrganizationWeeklyEvalReport({
    db: reportDatabase,
    organizationId: publisher.organizationId,
    ...previousPeriod,
  });

  const { context, profile, spaceId } = await ensureQualitySpace({
    env: input.env,
    publisher,
  });
  const clientMessageId = buildWeeklyEvalClientMessageId({
    organizationId: publisher.organizationId,
    periodStartMs: period.periodStartMs,
  });
  const signal = await emitSpaceTextSignalOnceByClientMessageId({
    authoringPolicy: "system_emitted",
    clientMessageId,
    context,
    env: input.env,
    meta: {
      clientMessageId,
      purpose: "eval.weekly_quality_report",
    },
    profile,
    spaceAccess: createAuthenticatedSpaceAccessContext({
      requestContext: context,
      spaceId,
    }),
    spaceId,
    text: formatWeeklyEvalReportMarkdown({
      metrics,
      periodEndMs: period.periodEndMs,
      periodStartMs: period.periodStartMs,
      previousMetrics,
    }),
  });

  const result: WeeklyEvalReportRunResult = {
    organizationId: publisher.organizationId,
    periodEndMs: period.periodEndMs,
    periodStartMs: period.periodStartMs,
    reportSignalId: signal.id,
    spaceId,
    status: "published",
  };
  console.log(
    JSON.stringify({
      event: "core.eval.weekly_report.published",
      ...result,
    })
  );
  return result;
}

export function resolveCompletedWeeklyEvalPeriod(nowMs: number): {
  periodEndMs: number;
  periodStartMs: number;
} {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("Weekly eval reporting requires a nonnegative nowMs");
  }
  const now = new Date(nowMs);
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const periodEndMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday
  );
  return {
    periodEndMs,
    periodStartMs: periodEndMs - WEEK_MS,
  };
}

export function formatWeeklyEvalReportMarkdown(input: {
  metrics: OrganizationWeeklyEvalMetrics;
  periodEndMs: number;
  periodStartMs: number;
  previousMetrics: OrganizationWeeklyEvalMetrics | null;
}): string {
  const periodLastDayMs = input.periodEndMs - 24 * 60 * 60 * 1000;
  return [
    "# Weekly Quality Report",
    "",
    `**Period:** ${formatUtcDate(input.periodStartMs)} to ${formatUtcDate(periodLastDayMs)} (UTC)`,
    "",
    "## This week",
    "",
    "| Metric | Result | Week over week |",
    "| --- | ---: | ---: |",
    `| Wakes | ${input.metrics.wakeTotal} | ${formatCountChange(input.metrics.wakeTotal, input.previousMetrics?.wakeTotal)} |`,
    `| Closure rate | ${formatRateResult(input.metrics.closureCount, input.metrics.wakeTotal)} | ${formatRateChange(input.metrics.closureRate, input.previousMetrics?.closureRate)} |`,
    `| Failure rate | ${formatRateResult(input.metrics.failureCount, input.metrics.wakeTotal)} | ${formatRateChange(input.metrics.failureRate, input.previousMetrics?.failureRate)} |`,
    `| Stay-silent rate | ${formatRateResult(input.metrics.silentCount, input.metrics.wakeTotal)} | ${formatRateChange(input.metrics.silentRate, input.previousMetrics?.silentRate)} |`,
    `| Staleness rate | ${formatRateResult(input.metrics.staleReplyCount, input.metrics.replyCount)} | ${formatRateChange(input.metrics.stalenessRate, input.previousMetrics?.stalenessRate)} |`,
    `| Concurrency overlaps | ${input.metrics.concurrencyOverlap} | ${formatCountChange(input.metrics.concurrencyOverlap, input.previousMetrics?.concurrencyOverlap)} |`,
    "",
    "## Known gaps",
    "",
    "- Repair trigger rate: Pending instrumentation. Repair runs in the local daemon and is not present in the server ledgers.",
    "- Late ledger facts: A weekly report is settled on its first run and is not revised after publication, so later-arriving facts remain available only in raw diagnostics.",
    "- Concurrency overlap is an estimate based on overlapping execution projection timestamps for different agents in the same Space; it is not an exact lifecycle-event count.",
    "- Organization attribution uses the current Space Index projection. Missing or stale projection rows can make a report incomplete.",
    "- Exact Space-ledger rates currently require one Durable Object call per indexed Space and need a rollup before an Organization exceeds the safe per-invocation fan-out limit.",
  ].join("\n");
}

async function readOfficialOrganizationEvalPublisher(
  db: D1Database
): Promise<EvalReportPublisher | null> {
  const organization = await db
    .prepare(
      `
        SELECT id
        FROM organizations
        WHERE slug = ?
        LIMIT 1
      `
    )
    .bind(OFFICIAL_ORGANIZATION_SLUG)
    .first<{ id: string }>();
  if (!organization) {
    return null;
  }

  const publisher = await db
    .prepare(
      `
        SELECT
          designation.organization_id,
          profile.profile_id,
          profile.profile_name,
          profile.owner_user_id,
          owner.name AS owner_name
        FROM center_agent_designations AS designation
        INNER JOIN openmeld_profiles AS profile
          ON profile.profile_id = designation.agent_profile_id
        INNER JOIN users AS owner
          ON owner.id = profile.owner_user_id
        WHERE designation.organization_id = ?
          AND profile.organization_id = designation.organization_id
          AND profile.profile_kind = 'agent'
          AND profile.managed_role = 'center_agent'
          AND profile.status = 'active'
        LIMIT 1
      `
    )
    .bind(organization.id)
    .first<{
      organization_id: string;
      owner_name: string;
      owner_user_id: string;
      profile_id: string;
      profile_name: string;
    }>();
  if (!publisher) {
    throw new Error(
      `Weekly eval reporting could not resolve the official Organization's active Center Agent`
    );
  }
  return {
    organizationId: publisher.organization_id,
    ownerName: publisher.owner_name,
    ownerUserId: publisher.owner_user_id,
    profileId: publisher.profile_id,
    profileName: publisher.profile_name,
  };
}

async function ensureQualitySpace(input: {
  env: CoreBindings;
  publisher: EvalReportPublisher;
}): Promise<{
  context: OpenMeldRequestContext;
  profile: Profile;
  spaceId: string;
}> {
  const objectId = resolveNamedSpaceId(
    input.env.OPENMELD_SPACES,
    `${QUALITY_SPACE_ID_NAMESPACE}:${input.publisher.organizationId}`
  );
  const spaceId = objectId.toString();
  const context: OpenMeldRequestContext = {
    activeOrganizationId: input.publisher.organizationId,
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      ownerUserId: input.publisher.ownerUserId,
      profileKind: "agent",
      profileName: input.publisher.profileName,
      requestId: `eval-weekly-quality-space:${input.publisher.organizationId}`,
      openMeldProfileId: input.publisher.profileId,
    },
  };
  const profile: Profile = {
    kind: "agent",
    owner: input.publisher.ownerUserId,
    ownerName: input.publisher.ownerName,
    profileId: input.publisher.profileId,
    profileName: input.publisher.profileName,
  };
  const stub = input.env.OPENMELD_SPACES.get(objectId);
  const meta = await stub.rpcPatchMeta({
    context,
    creator: {
      kind: "agent",
      ownerName: input.publisher.ownerName,
      ownerUserId: input.publisher.ownerUserId,
      profileId: input.publisher.profileId,
      profileName: input.publisher.profileName,
    },
    initializeIfAbsent: true,
    name: QUALITY_SPACE_NAME,
    organizationId: input.publisher.organizationId,
    spaceId,
    visibility: "public",
  });
  if (meta.organizationId !== input.publisher.organizationId) {
    throw new Error(
      `Weekly eval Quality Space ${spaceId} belongs to a different Organization`
    );
  }
  if (meta.name !== QUALITY_SPACE_NAME) {
    throw new Error(
      `Weekly eval Quality Space ${spaceId} is not named ${QUALITY_SPACE_NAME}`
    );
  }

  return { context, profile, spaceId };
}

function buildWeeklyEvalClientMessageId(input: {
  organizationId: string;
  periodStartMs: number;
}): string {
  return `eval-weekly:${input.organizationId}:${input.periodStartMs}`;
}

function formatUtcDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function formatRateResult(numerator: number, denominator: number): string {
  const rate = denominator > 0 ? numerator / denominator : 0;
  return `${numerator} / ${denominator} (${(rate * 100).toFixed(1)}%)`;
}

function formatRateChange(
  current: number,
  previous: number | undefined
): string {
  if (previous === undefined) {
    return "Not available";
  }
  const percentagePoints = (current - previous) * 100;
  if (percentagePoints === 0) {
    return "No change";
  }
  return `${percentagePoints > 0 ? "+" : ""}${percentagePoints.toFixed(1)} pp`;
}

function formatCountChange(
  current: number,
  previous: number | undefined
): string {
  if (previous === undefined) {
    return "Not available";
  }
  const change = current - previous;
  if (change === 0) {
    return "No change";
  }
  return `${change > 0 ? "+" : ""}${change}`;
}
