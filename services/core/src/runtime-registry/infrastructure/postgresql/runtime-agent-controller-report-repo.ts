import {
  type AuthorityOpenMeldServiceRuntimeId,
  areAgentControllerInterfaceAccountsSame,
  createAuthorityOpenMeldServiceRuntimeId,
  isAgentControllerUsageRefreshUnavailable,
  parseAgentControllerRef,
  type RuntimeAgentControllerReportStatus,
} from "@openmeld/agent-runtime";
import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";
import { agentControllerInterfaceSnapshotSchema } from "@openmeld/schemas";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { isServiceAuthFreshnessRequired } from "../../../local-components/update-projection";
import type {
  AcceptedRuntimeAgentControllerReport,
  RuntimeAgentControllerReportAcceptanceResult,
  RuntimeAgentControllerReportStoreInput,
} from "../../application/runtime-agent-controller-report-service";

type RuntimeAgentControllerReportRow = {
  openmeld_service_runtime_id: string;
  agent_controller_ref: string;
  report_status: RuntimeAgentControllerReportStatus;
  observed_at_ms: number;
  expires_at_ms: number;
  reported_reason_codes_json: string;
  agent_controller_interface_json: string | null;
  accepted_at_ms: number;
  updated_at_ms: number;
};
export function acceptRuntimeAgentControllerReportRecord(input: {
  db: PostgresDatabase;
  nowMs: number;
  report: AcceptedRuntimeAgentControllerReport;
}): Promise<RuntimeAgentControllerReportAcceptanceResult> {
  return writeCurrentAgentControllerReport({
    db: input.db,
    nowMs: input.nowMs,
    report: input.report,
  });
}
export async function readCurrentRuntimeAgentControllerReport(input: {
  agentControllerRef: string;
  db: PostgresDatabase;
  openMeldServiceRuntimeId: {
    value: string;
  };
}): Promise<AcceptedRuntimeAgentControllerReport | null> {
  const row = await input.db
    .query<RuntimeAgentControllerReportRow>({
      text: `
        SELECT
          openmeld_service_runtime_id,
          agent_controller_ref,
          report_status,
          observed_at_ms,
          expires_at_ms,
          reported_reason_codes_json,
          agent_controller_interface_json,
          accepted_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_runtime_agent_controller_reports"
        WHERE openmeld_service_runtime_id = $1 AND agent_controller_ref = $2
        LIMIT 1
      `,
      values: [input.openMeldServiceRuntimeId.value, input.agentControllerRef],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRuntimeAgentControllerReportRow(row) : null;
}
export async function readCurrentRuntimeAgentControllerReports(input: {
  agentControllerRefs?: readonly string[];
  db: PostgresDatabase;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
}): Promise<readonly AcceptedRuntimeAgentControllerReport[]> {
  const openMeldServiceRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId.value,
    source: input.openMeldServiceRuntimeId.source,
  });
  const agentControllerRefs = normalizeAgentControllerRefs(
    input.agentControllerRefs
  );
  const query =
    agentControllerRefs.length > 0
      ? `
        SELECT
          openmeld_service_runtime_id,
          agent_controller_ref,
          report_status,
          observed_at_ms,
          expires_at_ms,
          reported_reason_codes_json,
          agent_controller_interface_json,
          accepted_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_runtime_agent_controller_reports"
        WHERE openmeld_service_runtime_id = $1 AND agent_controller_ref = ANY($2::text[])
        ORDER BY agent_controller_ref ASC NULLS FIRST
      `
      : `
        SELECT
          openmeld_service_runtime_id,
          agent_controller_ref,
          report_status,
          observed_at_ms,
          expires_at_ms,
          reported_reason_codes_json,
          agent_controller_interface_json,
          accepted_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_runtime_agent_controller_reports"
        WHERE openmeld_service_runtime_id = $1
        ORDER BY agent_controller_ref ASC NULLS FIRST
      `;
  const rows = await input.db.query<RuntimeAgentControllerReportRow>({
    text: query,
    values: [
      openMeldServiceRuntimeId.value,
      ...(agentControllerRefs.length ? [agentControllerRefs] : []),
    ],
  });
  return rows.rows.map(mapRuntimeAgentControllerReportRow);
}
async function writeCurrentAgentControllerReport(
  input: RuntimeAgentControllerReportStoreInput & {
    db: PostgresDatabase;
  }
): Promise<RuntimeAgentControllerReportAcceptanceResult> {
  if (input.report.expiresAtMs <= input.nowMs) {
    return {
      reason: "stale",
      status: "rejected",
    };
  }
  const existing = await readCurrentRuntimeAgentControllerReport({
    agentControllerRef: input.report.agentControllerRef,
    db: input.db,
    openMeldServiceRuntimeId: input.report.openMeldServiceRuntimeId,
  });
  const writeInput = {
    ...input,
    report: preserveObservationEvidence({
      currentReport: existing,
      nextReport: input.report,
    }),
  };
  const existingDecision = resolveExistingReportDecision({
    currentReport: existing,
    nextReport: writeInput.report,
  });
  if (existingDecision) {
    return existingDecision;
  }
  if (existing) {
    return updateNewerCurrentAgentControllerReport(writeInput);
  }
  const insertResult = await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_runtime_agent_controller_reports" (
          openmeld_service_runtime_id,
          agent_controller_ref,
          report_status,
          observed_at_ms,
          expires_at_ms,
          reported_reason_codes_json,
          agent_controller_interface_json,
          accepted_at_ms,
          updated_at_ms
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
        WHERE EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldDaemon_runtime_registry_records"
          WHERE openmeld_service_runtime_id = $10
        )
        ON CONFLICT(openmeld_service_runtime_id, agent_controller_ref) DO NOTHING
      `,
    values: [
      writeInput.report.openMeldServiceRuntimeId.value,
      writeInput.report.agentControllerRef,
      writeInput.report.status,
      writeInput.report.observedAtMs,
      writeInput.report.expiresAtMs,
      JSON.stringify(writeInput.report.reasonCodes),
      stringifyAgentControllerInterface(
        writeInput.report.agentControllerInterface
      ),
      input.nowMs,
      input.nowMs,
      writeInput.report.openMeldServiceRuntimeId.value,
    ],
  });
  if (getChangedRows(insertResult) > 0) {
    return {
      currentReport: writeInput.report,
      outcome: "created",
      status: "accepted",
    };
  }
  if (
    !(await readRuntimeRegistryRecordExists({
      db: input.db,
      openMeldServiceRuntimeId: input.report.openMeldServiceRuntimeId.value,
    }))
  ) {
    return {
      reason: "runtime_missing",
      status: "rejected",
    };
  }
  return resolveConcurrentAgentControllerReportWrite(writeInput);
}
async function updateNewerCurrentAgentControllerReport(
  input: RuntimeAgentControllerReportStoreInput & {
    db: PostgresDatabase;
  }
): Promise<RuntimeAgentControllerReportAcceptanceResult> {
  const updateResult = await input.db.query<{ expires_at_ms: number | string }>(
    {
      text: `
        UPDATE "openmeld"."openMeldDaemon_runtime_agent_controller_reports"
        SET
          report_status = $1,
          observed_at_ms = $2,
          expires_at_ms = CASE
            WHEN $11::boolean AND agent_controller_interface_json::jsonb ->> 'checkedAt'
              = $5::jsonb ->> 'checkedAt'
            THEN LEAST(expires_at_ms, $3)
            ELSE $3
          END,
          reported_reason_codes_json = $4,
          agent_controller_interface_json = $5,
          accepted_at_ms = $6,
          updated_at_ms = $7
        WHERE openmeld_service_runtime_id = $8 AND agent_controller_ref = $9 AND observed_at_ms < $10
        RETURNING expires_at_ms
      `,
      values: [
        input.report.status,
        input.report.observedAtMs,
        input.report.expiresAtMs,
        JSON.stringify(input.report.reasonCodes),
        stringifyAgentControllerInterface(
          input.report.agentControllerInterface
        ),
        input.nowMs,
        input.nowMs,
        input.report.openMeldServiceRuntimeId.value,
        input.report.agentControllerRef,
        input.report.observedAtMs,
        isServiceAuthFreshnessRequired(),
      ],
    }
  );
  if (getChangedRows(updateResult) > 0) {
    return {
      currentReport: {
        ...input.report,
        expiresAtMs: Number(
          updateResult.rows[0]?.expires_at_ms ?? input.report.expiresAtMs
        ),
      },
      outcome: "updated",
      status: "accepted",
    };
  }
  return resolveConcurrentAgentControllerReportWrite(input);
}
async function resolveConcurrentAgentControllerReportWrite(
  input: RuntimeAgentControllerReportStoreInput & {
    db: PostgresDatabase;
  }
): Promise<RuntimeAgentControllerReportAcceptanceResult> {
  const currentReport = await readCurrentRuntimeAgentControllerReport({
    agentControllerRef: input.report.agentControllerRef,
    db: input.db,
    openMeldServiceRuntimeId: input.report.openMeldServiceRuntimeId,
  });
  const writeInput = {
    ...input,
    report: preserveObservationEvidence({
      currentReport,
      nextReport: input.report,
    }),
  };
  const decision = resolveExistingReportDecision({
    currentReport,
    nextReport: writeInput.report,
  });
  if (decision) {
    return decision;
  }
  if (currentReport) {
    return updateNewerCurrentAgentControllerReport(writeInput);
  }
  return {
    reason: "runtime_missing",
    status: "rejected",
  };
}
function preserveObservationEvidence(input: {
  currentReport: AcceptedRuntimeAgentControllerReport | null;
  nextReport: AcceptedRuntimeAgentControllerReport;
}): AcceptedRuntimeAgentControllerReport {
  let nextReport = input.nextReport;
  // Republishing the same native observation must not renew its authority.
  if (
    isServiceAuthFreshnessRequired() &&
    input.currentReport?.agentControllerInterface?.checkedAt &&
    input.currentReport.agentControllerInterface.checkedAt ===
      input.nextReport.agentControllerInterface?.checkedAt
  ) {
    nextReport = {
      ...nextReport,
      expiresAtMs: Math.min(
        input.currentReport.expiresAtMs,
        nextReport.expiresAtMs
      ),
    };
  }
  const currentLimits =
    input.currentReport?.agentControllerInterface?.usageLimits;
  const nextSnapshot = nextReport.agentControllerInterface;
  if (!nextSnapshot) {
    return nextReport;
  }
  const nextLimits = nextSnapshot?.usageLimits;
  const providerReadIsUnavailable =
    areAgentControllerInterfaceAccountsSame(
      input.currentReport?.agentControllerInterface?.auth,
      nextSnapshot?.auth
    ) && isAgentControllerUsageRefreshUnavailable(nextLimits);
  const hasKnownCapacity = currentLimits?.some(
    (limit) => limit.usedPercent !== null
  );
  if (!(providerReadIsUnavailable && hasKnownCapacity && currentLimits)) {
    return nextReport;
  }
  return {
    ...nextReport,
    agentControllerInterface: {
      ...nextSnapshot,
      usageLimits: currentLimits.map((limit) =>
        limit.usedPercent === null ? limit : { ...limit, status: "stale" }
      ),
    },
  };
}
function resolveExistingReportDecision(input: {
  currentReport: AcceptedRuntimeAgentControllerReport | null;
  nextReport: AcceptedRuntimeAgentControllerReport;
}): RuntimeAgentControllerReportAcceptanceResult | null {
  if (!input.currentReport) {
    return null;
  }
  if (input.nextReport.observedAtMs < input.currentReport.observedAtMs) {
    return {
      currentReport: input.currentReport,
      reason: "out_of_order",
      status: "rejected",
    };
  }
  if (input.nextReport.observedAtMs === input.currentReport.observedAtMs) {
    if (areSameReport(input.nextReport, input.currentReport)) {
      return {
        currentReport: input.currentReport,
        outcome: "reused",
        status: "accepted",
      };
    }
    return {
      currentReport: input.currentReport,
      reason: "conflict",
      status: "rejected",
    };
  }
  return null;
}
function areSameReport(
  left: AcceptedRuntimeAgentControllerReport,
  right: AcceptedRuntimeAgentControllerReport
): boolean {
  return (
    left.openMeldServiceRuntimeId.value ===
      right.openMeldServiceRuntimeId.value &&
    left.agentControllerRef === right.agentControllerRef &&
    left.status === right.status &&
    left.observedAtMs === right.observedAtMs &&
    left.expiresAtMs === right.expiresAtMs &&
    JSON.stringify(left.reasonCodes) === JSON.stringify(right.reasonCodes) &&
    stringifyAgentControllerInterface(left.agentControllerInterface) ===
      stringifyAgentControllerInterface(right.agentControllerInterface)
  );
}
function mapRuntimeAgentControllerReportRow(
  row: RuntimeAgentControllerReportRow
): AcceptedRuntimeAgentControllerReport {
  return {
    agentControllerRef: row.agent_controller_ref,
    ...(row.agent_controller_interface_json
      ? {
          agentControllerInterface: readAgentControllerInterface(
            row.agent_controller_interface_json
          ),
        }
      : {}),
    expiresAtMs: row.expires_at_ms,
    observedAtMs: row.observed_at_ms,
    reasonCodes: readReasonCodes(row.reported_reason_codes_json),
    openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: row.openmeld_service_runtime_id,
      source: "runtime_registry_authority",
    }),
    status: row.report_status,
  };
}
function readReasonCodes(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !(
      Array.isArray(parsed) &&
      parsed.every((reasonCode) => typeof reasonCode === "string")
    )
  ) {
    throw new Error("runtime agent controller report reason codes are corrupt");
  }
  return parsed;
}
function stringifyAgentControllerInterface(
  snapshot: AgentControllerInterfaceSnapshot | undefined
): string | null {
  return snapshot ? JSON.stringify(snapshot) : null;
}
function readAgentControllerInterface(
  value: string
): AgentControllerInterfaceSnapshot {
  const parsed: unknown = JSON.parse(value);
  const result = agentControllerInterfaceSnapshotSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("runtime agent controller interface snapshot is corrupt", {
      cause: result.error,
    });
  }
  return result.data;
}
function normalizeAgentControllerRefs(
  agentControllerRefs: readonly string[] | undefined
): readonly string[] {
  const normalized = new Set<string>();
  for (const agentControllerRef of agentControllerRefs ?? []) {
    const parsed = parseAgentControllerRef(agentControllerRef);
    if (!parsed) {
      throw new Error(
        "runtime agent controller report read agentControllerRef is invalid"
      );
    }
    normalized.add(parsed.ref);
  }
  return Array.from(normalized).sort();
}
async function readRuntimeRegistryRecordExists(input: {
  db: PostgresDatabase;
  openMeldServiceRuntimeId: string;
}): Promise<boolean> {
  const row = await input.db
    .query<{
      openmeld_service_runtime_id: string;
    }>({
      text: `
        SELECT openmeld_service_runtime_id
        FROM "openmeld"."openMeldDaemon_runtime_registry_records"
        WHERE openmeld_service_runtime_id = $1
        LIMIT 1
      `,
      values: [input.openMeldServiceRuntimeId],
    })
    .then((result) => result.rows[0] ?? null);
  return row !== null;
}
function getChangedRows(result: QueryResult): number {
  const changes = result.rowCount;
  if (typeof changes !== "number") {
    throw new Error(
      "runtime agent controller report write result is missing changed row count"
    );
  }
  return changes;
}
