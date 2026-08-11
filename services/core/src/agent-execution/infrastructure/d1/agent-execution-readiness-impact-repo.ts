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
  db: D1Database;
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

  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_agent_execution_readiness_impacts (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
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
      `
    )
    .bind(
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
      observedAtMs
    )
    .run();

  return "written";
};

export const writeAcceptedAgentExecutionReadinessImpact = async (
  input: WriteAgentExecutionReadinessImpactInput
): Promise<"written" | "not_applicable"> =>
  writeAgentExecutionReadinessImpact(input);

type ClearAgentExecutionReadinessImpactInput = {
  agentProfileId: string;
  clearedAtMs: number;
  db: D1Database;
  executionIdentity: AgentExecutionReadinessImpactExecutionIdentity;
  sourceDispatchId: string;
};

export const clearAgentExecutionReadinessImpactForExecutionRunning = async (
  input: ClearAgentExecutionReadinessImpactInput & {
    executionAuthorizedAtMs: number;
  }
): Promise<"cleared"> =>
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
): Promise<"cleared"> =>
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
): Promise<"cleared"> => {
  const clearedAtMs = normalizeTimestampMs(input.clearedAtMs);
  const clearableTaxonomyEntries = listClearableTaxonomyEntries(
    input.clearingTrigger
  );
  if (clearableTaxonomyEntries.length === 0) {
    return "cleared";
  }
  const clearableTaxonomyClause = clearableTaxonomyEntries
    .map(() => "(impact_kind = ? AND reason_code = ? AND source = ?)")
    .join(" OR ");
  const runningExecutionBoundaryClause = input.runningExecutionBoundary
    ? `
          AND (
            observed_at_ms <= ?
            OR source_dispatch_id = ?
          )`
    : "";
  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_agent_execution_readiness_impacts
        SET
          cleared_at_ms = ?,
          cleared_by_dispatch_id = ?,
          updated_at_ms = ?
        WHERE agent_profile_id = ?
          AND binding_id = ?
          AND openmeld_service_runtime_id = ?
          AND agent_controller_ref = ?
          AND cleared_at_ms IS NULL
          ${runningExecutionBoundaryClause}
          AND (${clearableTaxonomyClause})
      `
    )
    .bind(
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
      ])
    )
    .run();
  return "cleared";
};

export const readFreshAgentExecutionReadinessImpactForBinding = async (input: {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  db: D1Database;
  nowMs: number;
  openMeldServiceRuntimeId: string;
}): Promise<FreshAgentExecutionReadinessImpact | null> => {
  const result = await input.db
    .prepare(
      `
        SELECT
          impact_kind AS impactKind,
          reason_code AS reasonCode,
          source,
          observed_at_ms AS observedAtMs,
          expires_at_ms AS expiresAtMs
        FROM openMeldDaemon_agent_execution_readiness_impacts
        WHERE agent_profile_id = ?
          AND binding_id = ?
          AND openmeld_service_runtime_id = ?
          AND agent_controller_ref = ?
          AND cleared_at_ms IS NULL
          AND expires_at_ms > ?
        ORDER BY observed_at_ms DESC
      `
    )
    .bind(
      input.agentProfileId,
      input.bindingId,
      input.openMeldServiceRuntimeId,
      input.agentControllerRef,
      normalizeTimestampMs(input.nowMs)
    )
    .all<FreshAgentExecutionReadinessImpactRow>();

  for (const row of result.results ?? []) {
    const impact = normalizeFreshReadinessImpactRow(row);
    if (impact) {
      return impact;
    }
  }

  return null;
};

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
