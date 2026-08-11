import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import {
  agentControllerInterfaceSnapshotSchema,
  daemonServiceLaneSchema,
} from "@openmeld/schemas";
import type {
  AgentControllerInterfaceSnapshot,
  DaemonServiceLane,
} from "@openmeld/schemas/types";
import type { RuntimeLookupStoreResult } from "../../application/runtime-lookup-service";
import type {
  RuntimeRegistrationStoreRecordInput,
  RuntimeRegistrationStoreResult,
} from "../../application/runtime-registration-service";

type RuntimeRegistryRow = {
  openmeld_service_runtime_id: string;
  owner_kind: string;
  owner_id: string;
  device_id: string;
  lane: string;
  created_at_ms: number;
  last_registered_at_ms: number;
  updated_at_ms: number;
};

// TODO(2026-05-15): Rename this local runtime inventory row away from
// owned-device terminology after the storage-facing registry cleanup lands.
type OwnedDeviceExecutionTargetRow = {
  openmeld_service_runtime_id: string;
  device_id: string;
  lane: string;
  last_registered_at_ms: number;
  agent_controller_ref: string | null;
  report_status: string | null;
  observed_at_ms: number | null;
  expires_at_ms: number | null;
  reported_reason_codes_json: string | null;
  agent_controller_interface_json: string | null;
};

type RuntimeDeviceDisplayNameRow = {
  observed_display_name: string | null;
  user_display_name: string | null;
};

// TODO(2026-05-15): Rename this exported projection to
// LocalRuntimeExecutionTargetRecord and update Core callers in the same cleanup.
export type OwnedDeviceExecutionTargetRecord = {
  agentControllerRef: string | null;
  agentControllerInterface?: AgentControllerInterfaceSnapshot | null;
  capabilityEnabled: boolean;
  capabilityReasonCodes: readonly string[];
  capabilityStatus: "ready" | "not_ready" | "stale" | "unknown";
  deviceId: string;
  lastObservedAtMs: number | null;
  openMeldServiceRuntimeId: string;
  runtimeLane: DaemonServiceLane;
};

export type RuntimeRegistryRecord = {
  openMeldServiceRuntimeId: ReturnType<
    typeof createAuthorityOpenMeldServiceRuntimeId
  >;
  runtimeLookupInput: RuntimeLookupInput;
};

export type RuntimeRegistryRecordByIdReadResult =
  | {
      record: RuntimeRegistryRecord;
      status: "found";
    }
  | {
      status: "missing";
    }
  | {
      reason: string;
      status: "conflict";
    };

export async function registerRuntimeRegistryRecord(input: {
  db: D1Database;
  record: RuntimeRegistrationStoreRecordInput;
}): Promise<RuntimeRegistrationStoreResult> {
  const record = input.record;

  try {
    const insertResult = await input.db
      .prepare(
        `
          INSERT INTO openMeldDaemon_runtime_registry_records (
            openmeld_service_runtime_id,
            owner_kind,
            owner_id,
            device_id,
            lane,
            created_at_ms,
            last_registered_at_ms,
            updated_at_ms
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1
            FROM openMeldDaemon_forgotten_devices
            WHERE owner_user_id = ? AND device_id = ?
          )
          ON CONFLICT(owner_kind, owner_id, device_id, lane) DO NOTHING
        `
      )
      .bind(
        record.openMeldServiceRuntimeId.value,
        record.runtimeLookupInput.owner.kind,
        record.runtimeLookupInput.owner.id,
        record.runtimeLookupInput.deviceId,
        record.runtimeLookupInput.lane,
        record.nowMs,
        record.nowMs,
        record.nowMs,
        record.runtimeLookupInput.owner.id,
        record.runtimeLookupInput.deviceId
      )
      .run();

    if (getChangedRows(insertResult) > 0) {
      return {
        status: "created",
        openMeldServiceRuntimeId: record.openMeldServiceRuntimeId,
      };
    }
  } catch (error) {
    if (isRuntimeIdCollision(error)) {
      return {
        status: "conflict",
        reason: "openmeld_service_runtime_id_collision",
      };
    }
    throw new Error("runtime registry record insert failed", {
      cause: error,
    });
  }

  if (
    await readForgottenOwnerAccountDevice({
      db: input.db,
      runtimeLookupInput: record.runtimeLookupInput,
    })
  ) {
    return {
      status: "conflict",
      reason: "device_forgotten",
    };
  }

  await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_runtime_registry_records
        SET
          last_registered_at_ms = ?,
          updated_at_ms = ?
        WHERE owner_kind = ? AND owner_id = ? AND device_id = ? AND lane = ?
          AND NOT EXISTS (
            SELECT 1
            FROM openMeldDaemon_forgotten_devices
            WHERE owner_user_id = ? AND device_id = ?
          )
      `
    )
    .bind(
      record.nowMs,
      record.nowMs,
      record.runtimeLookupInput.owner.kind,
      record.runtimeLookupInput.owner.id,
      record.runtimeLookupInput.deviceId,
      record.runtimeLookupInput.lane,
      record.runtimeLookupInput.owner.id,
      record.runtimeLookupInput.deviceId
    )
    .run();

  if (
    await readForgottenOwnerAccountDevice({
      db: input.db,
      runtimeLookupInput: record.runtimeLookupInput,
    })
  ) {
    return {
      status: "conflict",
      reason: "device_forgotten",
    };
  }

  const existing = await readRuntimeRegistryRecord({
    db: input.db,
    runtimeLookupInput: record.runtimeLookupInput,
  });

  if (existing.status === "found") {
    return {
      status: "reused",
      openMeldServiceRuntimeId: existing.openMeldServiceRuntimeId,
    };
  }

  if (existing.status === "missing") {
    return {
      status: "conflict",
      reason: "runtime_record_missing_after_conflict",
    };
  }

  return existing;
}

export async function readRuntimeRegistryRecord(input: {
  db: D1Database;
  runtimeLookupInput: RuntimeLookupInput;
}): Promise<RuntimeLookupStoreResult> {
  const row = await input.db
    .prepare(
      `
        SELECT
          openmeld_service_runtime_id,
          owner_kind,
          owner_id,
          device_id,
          lane,
          created_at_ms,
          last_registered_at_ms,
          updated_at_ms
        FROM openMeldDaemon_runtime_registry_records
        WHERE owner_kind = ? AND owner_id = ? AND device_id = ? AND lane = ?
        LIMIT 1
      `
    )
    .bind(
      input.runtimeLookupInput.owner.kind,
      input.runtimeLookupInput.owner.id,
      input.runtimeLookupInput.deviceId,
      input.runtimeLookupInput.lane
    )
    .first<RuntimeRegistryRow>();

  return row
    ? mapRuntimeRegistryRow({
        row,
        runtimeLookupInput: input.runtimeLookupInput,
      })
    : { status: "missing" };
}

export async function readRuntimeRegistryRecordByRuntimeId(input: {
  db: D1Database;
  openMeldServiceRuntimeId: string;
}): Promise<RuntimeRegistryRecordByIdReadResult> {
  const row = await input.db
    .prepare(
      `
        SELECT
          openmeld_service_runtime_id,
          owner_kind,
          owner_id,
          device_id,
          lane,
          created_at_ms,
          last_registered_at_ms,
          updated_at_ms
        FROM openMeldDaemon_runtime_registry_records
        WHERE openmeld_service_runtime_id = ?
        LIMIT 1
      `
    )
    .bind(input.openMeldServiceRuntimeId)
    .first<RuntimeRegistryRow>();

  if (!row) {
    return { status: "missing" };
  }

  try {
    if (
      row.owner_kind !== "owner_account" &&
      row.owner_kind !== "owner_principal"
    ) {
      return {
        reason: "runtime_owner_invalid",
        status: "conflict",
      };
    }
    const runtimeLookupInput = createRuntimeLookupInput({
      deviceId: row.device_id,
      lane: row.lane,
      owner: {
        id: row.owner_id,
        kind: row.owner_kind,
      },
    });
    return {
      record: {
        openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
          lookupInput: runtimeLookupInput,
          openMeldServiceRuntimeId: row.openmeld_service_runtime_id,
          source: "runtime_registry_authority",
        }),
        runtimeLookupInput,
      },
      status: "found",
    };
  } catch (error) {
    return {
      reason: getRuntimeIdInvalidReason(error),
      status: "conflict",
    };
  }
}

export async function readRuntimeDeviceDisplayNameByRuntimeId(input: {
  db: D1Database;
  openMeldServiceRuntimeId: string;
}): Promise<string | null> {
  const openMeldServiceRuntimeId = input.openMeldServiceRuntimeId.trim();
  if (!openMeldServiceRuntimeId) {
    throw new Error("openMeldServiceRuntimeId is required");
  }

  const row = await input.db
    .prepare(
      `
        SELECT
          owned.observed_display_name,
          owned.user_display_name
        FROM openMeldDaemon_runtime_registry_records AS runtime
        LEFT JOIN openMeldDaemon_owned_devices AS owned
          ON owned.owner_user_id = runtime.owner_id
          AND owned.device_id = runtime.device_id
        WHERE runtime.openmeld_service_runtime_id = ?
        LIMIT 1
      `
    )
    .bind(openMeldServiceRuntimeId)
    .first<RuntimeDeviceDisplayNameRow>();

  return row
    ? (normalizeOptionalDisplayName(row.user_display_name) ??
        normalizeOptionalDisplayName(row.observed_display_name))
    : null;
}

export async function listOwnedDeviceExecutionTargetRecords(input: {
  db: D1Database;
  nowMs: number;
  userId: string;
}): Promise<readonly OwnedDeviceExecutionTargetRecord[]> {
  const rows = await input.db
    .prepare(
      `
        SELECT
          runtime.openmeld_service_runtime_id,
          runtime.device_id,
          runtime.lane,
          runtime.last_registered_at_ms,
          capability.agent_controller_ref,
          capability.report_status,
          capability.observed_at_ms,
          capability.expires_at_ms,
          capability.reported_reason_codes_json,
          capability.agent_controller_interface_json
        FROM openMeldDaemon_runtime_registry_records runtime
        LEFT JOIN openMeldDaemon_runtime_agent_controller_reports capability
          ON capability.openmeld_service_runtime_id = runtime.openmeld_service_runtime_id
        WHERE runtime.owner_kind = 'owner_account'
          AND runtime.owner_id = ?
        ORDER BY runtime.device_id ASC, runtime.lane ASC, capability.agent_controller_ref ASC
      `
    )
    .bind(input.userId)
    .all<OwnedDeviceExecutionTargetRow>();

  return rows.results.flatMap((row) =>
    mapOwnedDeviceExecutionTargetRow({
      nowMs: input.nowMs,
      row,
    })
  );
}

function mapRuntimeRegistryRow(input: {
  row: RuntimeRegistryRow;
  runtimeLookupInput: RuntimeLookupInput;
}): RuntimeLookupStoreResult {
  try {
    return {
      status: "found",
      openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
        lookupInput: input.runtimeLookupInput,
        openMeldServiceRuntimeId: input.row.openmeld_service_runtime_id,
        source: "runtime_registry_authority",
      }),
    };
  } catch (error) {
    return {
      status: "conflict",
      reason: getRuntimeIdInvalidReason(error),
    };
  }
}

function mapOwnedDeviceExecutionTargetRow(input: {
  nowMs: number;
  row: OwnedDeviceExecutionTargetRow;
}): OwnedDeviceExecutionTargetRecord[] {
  const runtimeLane = daemonServiceLaneSchema.safeParse(input.row.lane);
  if (!runtimeLane.success) {
    return [];
  }

  const agentControllerInterface = parseAgentControllerInterface(
    input.row.agent_controller_interface_json
  );
  const capabilityReasonCodes = [
    ...parseReasonCodes(input.row.reported_reason_codes_json),
    ...agentControllerInterface.reasonCodes,
  ];
  return [
    {
      agentControllerRef: input.row.agent_controller_ref,
      agentControllerInterface: agentControllerInterface.snapshot,
      capabilityEnabled: resolveCapabilityEnabled({
        reasonCodes: capabilityReasonCodes,
        reportStatus: input.row.report_status,
      }),
      capabilityReasonCodes,
      capabilityStatus: resolveCapabilityStatus({
        expiresAtMs: input.row.expires_at_ms,
        nowMs: input.nowMs,
        reportStatus: input.row.report_status,
      }),
      deviceId: input.row.device_id,
      lastObservedAtMs:
        input.row.observed_at_ms ?? input.row.last_registered_at_ms ?? null,
      openMeldServiceRuntimeId: input.row.openmeld_service_runtime_id,
      runtimeLane: runtimeLane.data,
    },
  ];
}

function resolveCapabilityStatus(input: {
  expiresAtMs: number | null;
  nowMs: number;
  reportStatus: string | null;
}): OwnedDeviceExecutionTargetRecord["capabilityStatus"] {
  if (!input.reportStatus) {
    return "unknown";
  }
  if (input.expiresAtMs !== null && input.expiresAtMs <= input.nowMs) {
    return "stale";
  }
  return input.reportStatus === "ready" ? "ready" : "not_ready";
}

function resolveCapabilityEnabled(input: {
  reasonCodes: readonly string[];
  reportStatus: string | null;
}): boolean {
  if (!input.reportStatus) {
    return false;
  }
  if (input.reportStatus === "disabled") {
    return false;
  }
  if (input.reasonCodes.includes("local_agent_preparation.not_enabled")) {
    return false;
  }
  return true;
}

function parseReasonCodes(value: string | null): readonly string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return ["runtime.agent_controller_report_reason_codes_invalid"];
  }
}

function parseAgentControllerInterface(value: string | null): {
  reasonCodes: readonly string[];
  snapshot: AgentControllerInterfaceSnapshot | null;
} {
  if (!value) {
    return { reasonCodes: [], snapshot: null };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    const result = agentControllerInterfaceSnapshotSchema.safeParse(parsed);
    if (!result.success) {
      return {
        reasonCodes: ["runtime.agent_controller_interface.invalid"],
        snapshot: null,
      };
    }
    return { reasonCodes: [], snapshot: result.data };
  } catch {
    return {
      reasonCodes: ["runtime.agent_controller_interface.invalid_json"],
      snapshot: null,
    };
  }
}

function normalizeOptionalDisplayName(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function getRuntimeIdInvalidReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("runtime.id_not_opaque")
    ? "openmeld_service_runtime_id_not_opaque"
    : "openmeld_service_runtime_id_invalid";
}

function getChangedRows(result: D1Result): number {
  const changes = (result.meta as { changes?: unknown } | undefined)?.changes;
  if (typeof changes !== "number") {
    throw new Error(
      "runtime registry write result is missing changed row count"
    );
  }
  return changes;
}

function isRuntimeIdCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unique") &&
    normalized.includes("openmeld_service_runtime_id")
  );
}

async function readForgottenOwnerAccountDevice(input: {
  db: D1Database;
  runtimeLookupInput: RuntimeLookupInput;
}): Promise<boolean> {
  const row = await input.db
    .prepare(
      `
        SELECT forgotten_at_ms
        FROM openMeldDaemon_forgotten_devices
        WHERE owner_user_id = ? AND device_id = ?
        LIMIT 1
      `
    )
    .bind(input.runtimeLookupInput.owner.id, input.runtimeLookupInput.deviceId)
    .first<{ forgotten_at_ms: number }>();

  return row !== null;
}
