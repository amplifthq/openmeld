import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  AGENT_EXECUTION_READINESS_IMPACT_TAXONOMY,
  type AgentExecutionReadinessImpactClearingTrigger,
  type AgentExecutionReadinessImpactKind,
  type AgentExecutionReadinessImpactReasonCode,
  type AgentExecutionReadinessImpactSource,
  resolveAgentExecutionReadinessImpactReasonCode,
  resolveAgentExecutionReadinessImpactTaxonomyEntry,
} from "@openmeld/schemas";

const EXACT_EXECUTION_SCOPE = "agent_profile_binding_agent_controller_report";
const CURRENT_READINESS_BLOCKER_EFFECT = "current_readiness_blocker";
const MATCHING_EXECUTION_RUNNING_CLEARING_TRIGGER =
  "matching_execution_running";
const MATCHING_EXECUTION_SUCCESS_CLEARING_TRIGGER =
  "matching_execution_success";
export type AgentExecutionReadinessImpactExecutionIdentity = {
  bindingId: string;
  agentControllerRef: string;
  openMeldServiceRuntimeId: string;
};
export type FreshAgentExecutionReadinessImpact = {
  expiresAtMs: number;
  impactKind: AgentExecutionReadinessImpactKind;
  observedAtMs: number;
  reasonCode: AgentExecutionReadinessImpactReasonCode;
  source: AgentExecutionReadinessImpactSource;
};
type FreshAgentExecutionReadinessImpactRow = {
  expiresAtMs?: unknown;
  impactKind?: unknown;
  observedAtMs?: unknown;
  reasonCode?: unknown;
  source?: unknown;
};
export const isAcceptedAgentExecutionReadinessImpactReasonCode = (
  value: unknown
): boolean =>
  resolveAcceptedAgentExecutionReadinessImpactReasonCode(value) !== null;
export const resolveAcceptedAgentExecutionReadinessImpactReasonCode = (
  value: unknown
): AgentExecutionReadinessImpactReasonCode | null =>
  resolveAgentExecutionReadinessImpactReasonCode(value);
export type WriteAgentExecutionReadinessImpactInput = {
  agentProfileId: string;
  db: PostgresDatabase;
  executionIdentity: AgentExecutionReadinessImpactExecutionIdentity;
  observedAtMs: number;
  reasonCode: string;
  sourceAttemptId: string;
  sourceDispatchId: string;
};
export const writeAgentExecutionReadinessImpact = async (
  input: WriteAgentExecutionReadinessImpactInput
): Promise<"written" | "not_applicable"> => {
  const taxonomy = resolveAgentExecutionReadinessImpactTaxonomyEntry(
    input.reasonCode
  );
  if (!taxonomy) {
    return "not_applicable";
  }
  const observedAtMs = normalizeTimestampMs(input.observedAtMs);
  const expiresAtMs = observedAtMs + taxonomy.freshTtlMs;
  const impactId = buildReadinessImpactId({
    agentProfileId: input.agentProfileId,
    executionIdentity: input.executionIdentity,
    impactKind: taxonomy.impactKind,
  });
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_agent_execution_readiness_impacts" (
          impact_id,
          impact_kind,
          agent_profile_id,
          binding_id,
          openmeld_service_runtime_id,
          agent_controller_ref,
          reason_code,
          source,
          source_dispatch_id,
          source_attempt_id,
          observed_at_ms,
          expires_at_ms,
          cleared_at_ms,
          cleared_by_dispatch_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NULL, $13, $14)
        ON CONFLICT(agent_profile_id, binding_id, openmeld_service_runtime_id, agent_controller_ref, impact_kind)
        DO UPDATE SET
          reason_code = excluded.reason_code,
          source = excluded.source,
          source_dispatch_id = excluded.source_dispatch_id,
          source_attempt_id = excluded.source_attempt_id,
          observed_at_ms = excluded.observed_at_ms,
          expires_at_ms = excluded.expires_at_ms,
          cleared_at_ms = NULL,
          cleared_by_dispatch_id = NULL,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      impactId,
      taxonomy.impactKind,
      input.agentProfileId,
      input.executionIdentity.bindingId,
      input.executionIdentity.openMeldServiceRuntimeId,
      input.executionIdentity.agentControllerRef,
      taxonomy.reasonCode,
      taxonomy.source,
      input.sourceDispatchId,
      input.sourceAttemptId,
      observedAtMs,
      expiresAtMs,
      observedAtMs,
      observedAtMs,
    ],
  });
  return "written";
};
export const writeAcceptedAgentExecutionReadinessImpact = async (
  input: WriteAgentExecutionReadinessImpactInput
): Promise<"written" | "not_applicable"> =>
  writeAgentExecutionReadinessImpact(input);
/**
 * `cleared` means at least one current readiness impact row was cleared, so
 * the readiness projection changed. `unchanged` means no row matched.
 */
export type AgentExecutionReadinessImpactClearResult = "cleared" | "unchanged";
type ClearAgentExecutionReadinessImpactInput = {
  agentProfileId: string;
  clearedAtMs: number;
  db: PostgresDatabase;
  executionIdentity: AgentExecutionReadinessImpactExecutionIdentity;
  sourceDispatchId: string;
};
export const clearAgentExecutionReadinessImpactForExecutionRunning = async (
  input: ClearAgentExecutionReadinessImpactInput & {
    executionAuthorizedAtMs: number;
  }
): Promise<AgentExecutionReadinessImpactClearResult> =>
  clearAgentExecutionReadinessImpactForTrigger({
    ...input,
    clearingTrigger: MATCHING_EXECUTION_RUNNING_CLEARING_TRIGGER,
    runningExecutionBoundary: {
      authorizedAtMs: normalizeTimestampMs(input.executionAuthorizedAtMs),
      sourceDispatchId: input.sourceDispatchId,
    },
  });
export const clearAgentExecutionReadinessImpactForExecutionSuccess = async (
  input: ClearAgentExecutionReadinessImpactInput
): Promise<AgentExecutionReadinessImpactClearResult> =>
  clearAgentExecutionReadinessImpactForTrigger({
    ...input,
    clearingTrigger: MATCHING_EXECUTION_SUCCESS_CLEARING_TRIGGER,
  });
const clearAgentExecutionReadinessImpactForTrigger = async (
  input: ClearAgentExecutionReadinessImpactInput & {
    clearingTrigger: AgentExecutionReadinessImpactClearingTrigger;
    runningExecutionBoundary?: {
      authorizedAtMs: number;
      sourceDispatchId: string;
    };
  }
): Promise<AgentExecutionReadinessImpactClearResult> => {
  const clearedAtMs = normalizeTimestampMs(input.clearedAtMs);
  const clearableTaxonomyEntries = listClearableTaxonomyEntries(
    input.clearingTrigger
  );
  if (clearableTaxonomyEntries.length === 0) {
    return "unchanged";
  }
  const clearableTaxonomyClause = clearableTaxonomyEntries
    .map((_, index) => {
      const offset = 7 + (input.runningExecutionBoundary ? 2 : 0) + index * 3;
      return `(impact_kind = $${offset + 1} AND reason_code = $${offset + 2} AND source = $${offset + 3})`;
    })
    .join(" OR ");
  const runningExecutionBoundaryClause = input.runningExecutionBoundary
    ? `
          AND (
            observed_at_ms <= $8
            OR source_dispatch_id = $9
          )`
    : "";
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldDaemon_agent_execution_readiness_impacts"
        SET
          cleared_at_ms = $1,
          cleared_by_dispatch_id = $2,
          updated_at_ms = $3
        WHERE agent_profile_id = $4
          AND binding_id = $5
          AND openmeld_service_runtime_id = $6
          AND agent_controller_ref = $7
          AND cleared_at_ms IS NULL
          ${runningExecutionBoundaryClause}
          AND (${clearableTaxonomyClause})
      `,
    values: [
      clearedAtMs,
      input.sourceDispatchId,
      clearedAtMs,
      input.agentProfileId,
      input.executionIdentity.bindingId,
      input.executionIdentity.openMeldServiceRuntimeId,
      input.executionIdentity.agentControllerRef,
      ...(input.runningExecutionBoundary
        ? [
            input.runningExecutionBoundary.authorizedAtMs,
            input.runningExecutionBoundary.sourceDispatchId,
          ]
        : []),
      ...clearableTaxonomyEntries.flatMap((entry) => [
        entry.impactKind,
        entry.reasonCode,
        entry.source,
      ]),
    ],
  });
  // A driver that cannot report the row count must not suppress the
  // readiness invalidation that follows a real clear.
  if (typeof result.rowCount !== "number") {
    return "cleared";
  }
  return result.rowCount > 0 ? "cleared" : "unchanged";
};
export const readFreshAgentExecutionReadinessImpactForBinding = async (input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  db: PostgresDatabase;
  nowMs: number;
  openMeldServiceRuntimeId: string;
}): Promise<FreshAgentExecutionReadinessImpact | null> => {
  const result = await input.db.query<FreshAgentExecutionReadinessImpactRow>({
    text: `
        SELECT
          impact_kind AS "impactKind",
          reason_code AS "reasonCode",
          source,
          observed_at_ms AS "observedAtMs",
          expires_at_ms AS "expiresAtMs"
        FROM "openmeld"."openMeldDaemon_agent_execution_readiness_impacts"
        WHERE agent_profile_id = $1
          AND binding_id = $2
          AND openmeld_service_runtime_id = $3
          AND agent_controller_ref = $4
          AND cleared_at_ms IS NULL
          AND expires_at_ms > $5
        ORDER BY observed_at_ms DESC NULLS LAST
      `,
    values: [
      input.agentProfileId,
      input.bindingId,
      input.openMeldServiceRuntimeId,
      input.agentControllerRef,
      normalizeTimestampMs(input.nowMs),
    ],
  });
  for (const row of result.rows ?? []) {
    const impact = normalizeFreshReadinessImpactRow(row);
    if (impact) {
      return impact;
    }
  }
  return null;
};
export async function readFreshAgentExecutionReadinessImpactsForBindings(input: {
  bindings: readonly (AgentExecutionReadinessImpactExecutionIdentity & {
    agentProfileId: string;
  })[];
  db: PostgresDatabase;
  nowMs: number;
}): Promise<
  (FreshAgentExecutionReadinessImpact &
    AgentExecutionReadinessImpactExecutionIdentity & {
      agentProfileId: string;
    })[]
> {
  if (input.bindings.length === 0) {
    return [];
  }
  const result = await input.db.query<
    FreshAgentExecutionReadinessImpactRow &
      AgentExecutionReadinessImpactExecutionIdentity & {
        agentProfileId: string;
      }
  >({
    text: `
      SELECT impact.agent_profile_id AS "agentProfileId",
        impact.binding_id AS "bindingId",
        impact.openmeld_service_runtime_id AS "openMeldServiceRuntimeId",
        impact.agent_controller_ref AS "agentControllerRef",
        impact.impact_kind AS "impactKind", impact.reason_code AS "reasonCode", impact.source,
        impact.observed_at_ms AS "observedAtMs", impact.expires_at_ms AS "expiresAtMs"
      FROM "openmeld"."openMeldDaemon_agent_execution_readiness_impacts" AS impact
      JOIN UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
        AS requested(profile_id, binding_id, runtime_id, controller_ref)
        ON impact.agent_profile_id = requested.profile_id
        AND impact.binding_id = requested.binding_id
        AND impact.openmeld_service_runtime_id = requested.runtime_id
        AND impact.agent_controller_ref = requested.controller_ref
      WHERE impact.cleared_at_ms IS NULL AND impact.expires_at_ms > $5
      ORDER BY impact.observed_at_ms DESC NULLS LAST
    `,
    values: [
      input.bindings.map((binding) => binding.agentProfileId),
      input.bindings.map((binding) => binding.bindingId),
      input.bindings.map((binding) => binding.openMeldServiceRuntimeId),
      input.bindings.map((binding) => binding.agentControllerRef),
      normalizeTimestampMs(input.nowMs),
    ],
  });
  return result.rows.flatMap((row) => {
    const impact = normalizeFreshReadinessImpactRow(row);
    return impact ? [{ ...row, ...impact }] : [];
  });
}
function normalizeFreshReadinessImpactRow(
  row: FreshAgentExecutionReadinessImpactRow
): FreshAgentExecutionReadinessImpact | null {
  const reasonCode = normalizeReadinessImpactReasonCode(row.reasonCode);
  const observedAtMs = parseTimestampMs(row.observedAtMs);
  const expiresAtMs = parseTimestampMs(row.expiresAtMs);
  const taxonomy = reasonCode
    ? resolveAgentExecutionReadinessImpactTaxonomyEntry(reasonCode)
    : null;
  if (
    !taxonomy ||
    taxonomy.effect !== CURRENT_READINESS_BLOCKER_EFFECT ||
    taxonomy.scope !== EXACT_EXECUTION_SCOPE ||
    row.impactKind !== taxonomy.impactKind ||
    row.source !== taxonomy.source ||
    !reasonCode ||
    observedAtMs === null ||
    expiresAtMs === null
  ) {
    return null;
  }
  return {
    expiresAtMs,
    impactKind: taxonomy.impactKind,
    observedAtMs,
    reasonCode,
    source: taxonomy.source,
  };
}
function normalizeReadinessImpactReasonCode(
  value: unknown
): AgentExecutionReadinessImpactReasonCode | null {
  return resolveAgentExecutionReadinessImpactReasonCode(value);
}
function buildReadinessImpactId(input: {
  agentProfileId: string;
  executionIdentity: AgentExecutionReadinessImpactExecutionIdentity;
  impactKind: AgentExecutionReadinessImpactKind;
}): string {
  return [
    "readiness_impact",
    input.impactKind,
    input.agentProfileId,
    input.executionIdentity.bindingId,
    input.executionIdentity.openMeldServiceRuntimeId,
    input.executionIdentity.agentControllerRef,
  ].join(":");
}
function normalizeTimestampMs(value: number): number {
  return Math.max(0, Math.trunc(value));
}
function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}
function listClearableTaxonomyEntries(
  clearingTrigger: AgentExecutionReadinessImpactClearingTrigger
) {
  return AGENT_EXECUTION_READINESS_IMPACT_TAXONOMY.filter(
    (entry) =>
      entry.scope === EXACT_EXECUTION_SCOPE &&
      entry.clearingTriggers.includes(clearingTrigger)
  );
}
