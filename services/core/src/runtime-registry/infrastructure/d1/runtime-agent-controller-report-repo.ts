import {
  type AuthorityOpenMeldServiceRuntimeId,
  areAgentControllerInterfaceAccountsSame,
  createAuthorityOpenMeldServiceRuntimeId,
  parseAgentControllerRef,
  type RuntimeAgentControllerReportStatus,
} from "@openmeld/agent-runtime";
import { agentControllerInterfaceSnapshotSchema } from "@openmeld/schemas";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
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
  db: D1Database;
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
  db: D1Database;
  openMeldServiceRuntimeId: { value: string };
}): Promise<AcceptedRuntimeAgentControllerReport | null> {
  const row = await input.db
    .prepare(
      `
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
        FROM openMeldDaemon_runtime_agent_controller_reports
        WHERE openmeld_service_runtime_id = ? AND agent_controller_ref = ?
        LIMIT 1
      `
    )
    .bind(input.openMeldServiceRuntimeId.value, input.agentControllerRef)
    .first<RuntimeAgentControllerReportRow>();

  return row ? mapRuntimeAgentControllerReportRow(row) : null;
}

export async function readCurrentRuntimeAgentControllerReports(input: {
  agentControllerRefs?: readonly string[];
  db: D1Database;
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
        FROM openMeldDaemon_runtime_agent_controller_reports
        WHERE openmeld_service_runtime_id = ? AND agent_controller_ref IN (${agentControllerRefs
          .map(() => "?")
          .join(", ")})
        ORDER BY agent_controller_ref ASC
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
        FROM openMeldDaemon_runtime_agent_controller_reports
        WHERE openmeld_service_runtime_id = ?
        ORDER BY agent_controller_ref ASC
      `;
  const rows = await input.db
    .prepare(query)
    .bind(openMeldServiceRuntimeId.value, ...agentControllerRefs)
    .all<RuntimeAgentControllerReportRow>();

  return rows.results.map(mapRuntimeAgentControllerReportRow);
}

async function writeCurrentAgentControllerReport(
  input: RuntimeAgentControllerReportStoreInput & { db: D1Database }
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
    report: preserveLastKnownUsageLimits({
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

  const insertResult = await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_runtime_agent_controller_reports (
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
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM openMeldDaemon_runtime_registry_records
          WHERE openmeld_service_runtime_id = ?
        )
        ON CONFLICT(openmeld_service_runtime_id, agent_controller_ref) DO NOTHING
      `
    )
    .bind(
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
      writeInput.report.openMeldServiceRuntimeId.value
    )
    .run();

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
  input: RuntimeAgentControllerReportStoreInput & { db: D1Database }
): Promise<RuntimeAgentControllerReportAcceptanceResult> {
  const updateResult = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_runtime_agent_controller_reports
        SET
          report_status = ?,
          observed_at_ms = ?,
          expires_at_ms = ?,
          reported_reason_codes_json = ?,
          agent_controller_interface_json = ?,
          accepted_at_ms = ?,
          updated_at_ms = ?
        WHERE openmeld_service_runtime_id = ? AND agent_controller_ref = ? AND observed_at_ms < ?
      `
    )
    .bind(
      input.report.status,
      input.report.observedAtMs,
      input.report.expiresAtMs,
      JSON.stringify(input.report.reasonCodes),
      stringifyAgentControllerInterface(input.report.agentControllerInterface),
      input.nowMs,
      input.nowMs,
      input.report.openMeldServiceRuntimeId.value,
      input.report.agentControllerRef,
      input.report.observedAtMs
    )
    .run();

  if (getChangedRows(updateResult) > 0) {
    return {
      currentReport: input.report,
      outcome: "updated",
      status: "accepted",
    };
  }

  return resolveConcurrentAgentControllerReportWrite(input);
}

async function resolveConcurrentAgentControllerReportWrite(
  input: RuntimeAgentControllerReportStoreInput & { db: D1Database }
): Promise<RuntimeAgentControllerReportAcceptanceResult> {
  const currentReport = await readCurrentRuntimeAgentControllerReport({
    agentControllerRef: input.report.agentControllerRef,
    db: input.db,
    openMeldServiceRuntimeId: input.report.openMeldServiceRuntimeId,
  });
  const writeInput = {
    ...input,
    report: preserveLastKnownUsageLimits({
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

function preserveLastKnownUsageLimits(input: {
  currentReport: AcceptedRuntimeAgentControllerReport | null;
  nextReport: AcceptedRuntimeAgentControllerReport;
}): AcceptedRuntimeAgentControllerReport {
  const currentLimits =
    input.currentReport?.agentControllerInterface?.usageLimits;
  const nextSnapshot = input.nextReport.agentControllerInterface;
  if (!nextSnapshot) {
    return input.nextReport;
  }
  const nextLimits = nextSnapshot?.usageLimits;
  const providerReadIsUnavailable =
    areAgentControllerInterfaceAccountsSame(
      input.currentReport?.agentControllerInterface?.auth,
      nextSnapshot?.auth
    ) &&
    nextLimits?.length === 1 &&
    nextLimits[0]?.status === "unavailable";
  const hasKnownCapacity = currentLimits?.some(
    (limit) => limit.usedPercent !== null
  );
  if (!(providerReadIsUnavailable && hasKnownCapacity && currentLimits)) {
    return input.nextReport;
  }

  return {
    ...input.nextReport,
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
  db: D1Database;
  openMeldServiceRuntimeId: string;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        SELECT openmeld_service_runtime_id
        FROM openMeldDaemon_runtime_registry_records
        WHERE openmeld_service_runtime_id = ?
        LIMIT 1
      `
    )
    .bind(input.openMeldServiceRuntimeId)
    .first<{ openmeld_service_runtime_id: string }>();

  return row !== null;
}

function getChangedRows(result: D1Result): number {
  const changes = (result.meta as { changes?: unknown } | undefined)?.changes;
  if (typeof changes !== "number") {
    throw new Error(
      "runtime agent controller report write result is missing changed row count"
    );
  }
  return changes;
}
