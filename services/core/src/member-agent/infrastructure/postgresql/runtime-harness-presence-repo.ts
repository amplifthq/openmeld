import type { RuntimeAgentControllerReportStatus } from "@openmeld/agent-runtime";
import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "@openmeld/db/postgresql";
import { daemonServiceLaneSchema } from "@openmeld/schemas";
import type { DaemonServiceLane } from "@openmeld/schemas/types";
import type {
  HarnessReportDetection,
  RuntimeHarnessPresenceFact,
} from "../../application/harness-presence-policy";

export type RuntimeHarnessCatalogEntry = {
  agentControllerRef: string;
  deviceId: string;
  fact: RuntimeHarnessPresenceFact | null;
  lane: DaemonServiceLane;
  openMeldServiceRuntimeId: string;
  reasonCodes: readonly string[];
  // Core time of the latest accepted report; unlike the expiry, it is not
  // shortened by the Agent Controller auth-check freshness.
  reportAcceptedAtMs: number;
  reportExpiresAtMs: number;
  reportObservedAtMs: number;
  reportStatus: RuntimeAgentControllerReportStatus;
};

type CatalogRow = {
  agent_controller_ref: string;
  device_id: string;
  expires_at_ms: number | string;
  first_undetected_at_ms: number | string | null;
  lane: string;
  last_detected_at_ms: number | string | null;
  observed_at_ms: number | string;
  openmeld_service_runtime_id: string;
  presence_runtime_id: string | null;
  report_status: RuntimeAgentControllerReportStatus;
  report_updated_at_ms: number | string;
  reported_reason_codes_json: string;
  undetected_report_count: number | string | null;
};

/**
 * The owner's current builtin Harness catalog: one entry per (computer,
 * builtin Agent Controller) with its latest accepted report and the debounce
 * fact. Forgotten computers are excluded.
 */
export async function listOwnerRuntimeHarnessCatalog(input: {
  db: PostgresDatabase;
  ownerUserId: string;
}): Promise<RuntimeHarnessCatalogEntry[]> {
  const result = await input.db.query<CatalogRow>({
    text: `
      SELECT
        runtime.openmeld_service_runtime_id,
        runtime.device_id,
        runtime.lane,
        report.agent_controller_ref,
        report.report_status,
        report.observed_at_ms,
        report.expires_at_ms,
        report.reported_reason_codes_json,
        report.updated_at_ms AS report_updated_at_ms,
        presence.openmeld_service_runtime_id AS presence_runtime_id,
        presence.last_detected_at_ms,
        presence.undetected_report_count,
        presence.first_undetected_at_ms
      FROM "openmeld"."openMeldDaemon_runtime_registry_records" runtime
      JOIN "openmeld"."openMeldDaemon_runtime_agent_controller_reports" report
        ON report.openmeld_service_runtime_id = runtime.openmeld_service_runtime_id
      LEFT JOIN "openmeld"."openMeldDaemon_runtime_harness_presence" presence
        ON presence.openmeld_service_runtime_id = report.openmeld_service_runtime_id
        AND presence.agent_controller_ref = report.agent_controller_ref
      WHERE runtime.owner_kind = 'owner_account'
        AND runtime.owner_id = $1
        AND report.agent_controller_ref LIKE 'builtin:%'
        AND NOT EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldDaemon_forgotten_devices" forgotten
          WHERE forgotten.owner_user_id = $1
            AND forgotten.device_id = runtime.device_id
        )
      ORDER BY runtime.device_id ASC, runtime.lane ASC, report.agent_controller_ref ASC
    `,
    values: [input.ownerUserId],
  });
  return result.rows.flatMap((row) => {
    const lane = daemonServiceLaneSchema.safeParse(row.lane);
    if (!lane.success) {
      return [];
    }
    return [
      {
        agentControllerRef: row.agent_controller_ref,
        deviceId: row.device_id,
        fact: row.presence_runtime_id
          ? {
              firstUndetectedAtMs: toNullableNumber(row.first_undetected_at_ms),
              lastDetectedAtMs: toNullableNumber(row.last_detected_at_ms),
              undetectedReportCount: Number(row.undetected_report_count ?? 0),
            }
          : null,
        lane: lane.data,
        openMeldServiceRuntimeId: row.openmeld_service_runtime_id,
        reasonCodes: parseReasonCodes(row.reported_reason_codes_json),
        reportAcceptedAtMs: Number(row.report_updated_at_ms),
        reportExpiresAtMs: Number(row.expires_at_ms),
        reportObservedAtMs: Number(row.observed_at_ms),
        reportStatus: row.report_status,
      },
    ];
  });
}

export type RuntimeHarnessObservationResult = {
  // False when an equal or newer report was already recorded.
  applied: boolean;
  // The Harness is detected now and the previous report did not detect it:
  // first sighting, a sighting after misses, a reinstall, or the member
  // turning it back on in Local agents.
  becameDetected: boolean;
};

/**
 * Record one accepted catalog report in the debounce fact. Reports apply in
 * observation order only; a replay or an older report changes nothing.
 */
export async function recordRuntimeHarnessObservation(input: {
  agentControllerRef: string;
  db: PostgresDatabase;
  detection: HarnessReportDetection;
  nowMs: number;
  observedAtMs: number;
  openMeldServiceRuntimeId: string;
}): Promise<RuntimeHarnessObservationResult> {
  return await input.db.transaction(async (client) => {
    // Lock the current row so the transition compares against the version
    // this write replaces, never a snapshot a concurrent writer changed.
    const previous = await client.query<{
      last_detected_at_ms: number | string | null;
      last_report_observed_at_ms: number | string;
      undetected_report_count: number | string;
    }>({
      text: `
        SELECT last_detected_at_ms, last_report_observed_at_ms, undetected_report_count
        FROM "openmeld"."openMeldDaemon_runtime_harness_presence"
        WHERE openmeld_service_runtime_id = $1 AND agent_controller_ref = $2
        FOR UPDATE
      `,
      values: [input.openMeldServiceRuntimeId, input.agentControllerRef],
    });
    const written = await client.query({
      text: `
        INSERT INTO "openmeld"."openMeldDaemon_runtime_harness_presence" AS presence (
          openmeld_service_runtime_id,
          agent_controller_ref,
          last_report_observed_at_ms,
          last_detected_at_ms,
          undetected_report_count,
          first_undetected_at_ms,
          updated_at_ms
        )
        VALUES (
          $1,
          $2,
          $3,
          CASE WHEN $4 = 'detected' THEN $3::bigint ELSE NULL END,
          CASE WHEN $4 = 'undetected' THEN 1 ELSE 0 END,
          CASE WHEN $4 = 'undetected' THEN $3::bigint ELSE NULL END,
          $5
        )
        ON CONFLICT (openmeld_service_runtime_id, agent_controller_ref) DO UPDATE SET
          last_report_observed_at_ms = EXCLUDED.last_report_observed_at_ms,
          last_detected_at_ms = CASE
            WHEN $4 = 'detected' THEN EXCLUDED.last_report_observed_at_ms
            ELSE presence.last_detected_at_ms
          END,
          undetected_report_count = CASE
            WHEN $4 = 'detected' THEN 0
            WHEN $4 = 'undetected' THEN presence.undetected_report_count + 1
            ELSE presence.undetected_report_count
          END,
          first_undetected_at_ms = CASE
            WHEN $4 = 'detected' THEN NULL
            WHEN $4 = 'undetected'
              THEN COALESCE(presence.first_undetected_at_ms, EXCLUDED.last_report_observed_at_ms)
            ELSE presence.first_undetected_at_ms
          END,
          updated_at_ms = EXCLUDED.updated_at_ms
        WHERE presence.last_report_observed_at_ms < EXCLUDED.last_report_observed_at_ms
      `,
      values: [
        input.openMeldServiceRuntimeId,
        input.agentControllerRef,
        input.observedAtMs,
        input.detection,
        input.nowMs,
      ],
    });
    if ((written.rowCount ?? 0) === 0) {
      return { applied: false, becameDetected: false };
    }
    const row = previous.rows[0];
    const previousReportDetected =
      row !== undefined &&
      row.last_detected_at_ms !== null &&
      Number(row.last_detected_at_ms) ===
        Number(row.last_report_observed_at_ms);
    return {
      applied: true,
      becameDetected: input.detection === "detected" && !previousReportDetected,
    };
  });
}

function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function parseReasonCodes(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((code): code is string => typeof code === "string")
    : [];
}

/** Whether the owner's Agent Profile has any Binding row, enabled or not. */
export async function hasAnyAgentProfileBinding(input: {
  agentProfileId: string;
  db: PostgresDatabase;
  ownerUserId: string;
}): Promise<boolean> {
  const result = await input.db.query<{ present: number }>({
    text: `
      SELECT 1 AS present
      FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
      WHERE owner_kind = 'owner_account'
        AND owner_id = $1
        AND agent_profile_id = $2
      LIMIT 1
    `,
    values: [input.ownerUserId, input.agentProfileId],
  });
  return result.rows.length > 0;
}

// The controller ref that groups the Profile: its enabled primary Binding,
// else its most recent Binding (a disabled Binding keeps its harness), or
// null when the Profile never bound under this owner. Same order as the
// MemberAgent backfill.
export async function readAgentProfileGroupingControllerRef(input: {
  agentProfileId: string;
  // The database, or the client of a transaction that holds the owner lock.
  db: {
    query<T extends QueryResultRow = QueryResultRow>(
      query: QueryConfig
    ): Promise<QueryResult<T>>;
  };
  ownerUserId: string;
}): Promise<string | null> {
  const result = await input.db.query<{ agent_controller_ref: string }>({
    text: `
      SELECT agent_controller_ref
      FROM "openmeld"."openMeldDaemon_agent_profile_bindings"
      WHERE owner_kind = 'owner_account'
        AND owner_id = $1
        AND agent_profile_id = $2
      ORDER BY (binding_state = 'enabled_primary') DESC,
        created_at_ms DESC,
        updated_at_ms DESC,
        binding_id DESC
      LIMIT 1
    `,
    values: [input.ownerUserId, input.agentProfileId],
  });
  return result.rows[0]?.agent_controller_ref ?? null;
}
