import {
  serviceConnectionIncidentSchema,
  serviceConnectionIncidentsResponseSchema,
} from "@openmeld/schemas";
import type {
  PeopleComputerTarget,
  ServiceConnectionIncident,
  ServiceConnectionIncidentReceipt,
} from "@openmeld/schemas/types";
import { WAKE_EVIDENCE_RETENTION_MS } from "../dispatch/infrastructure/d1/wake-evidence-retention";
import { createCoreRpcHttpError } from "../rpc/errors";

export async function deleteExpiredServiceConnectionIncidents(input: {
  db: D1Database;
  nowMs: number;
}) {
  let deleted = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await input.db
      .prepare(
        "DELETE FROM openmeld_service_connection_incidents WHERE rowid IN (SELECT rowid FROM openmeld_service_connection_incidents WHERE received_at_ms < ? LIMIT 500)"
      )
      .bind(input.nowMs - WAKE_EVIDENCE_RETENTION_MS)
      .run();
    const changes = Number(result.meta.changes ?? 0);
    deleted += changes;
    if (changes < 500) {
      break;
    }
  }
  return { deleted };
}

export async function storeServiceConnectionIncident(input: {
  db: D1Database;
  ownerUserId: string;
  incident: ServiceConnectionIncident;
  nowMs: number;
}): Promise<ServiceConnectionIncidentReceipt> {
  const incident = serviceConnectionIncidentSchema.parse(input.incident);
  const payload = JSON.stringify(incident);
  await input.db
    .prepare(`INSERT OR IGNORE INTO openmeld_service_connection_incidents
    (owner_user_id, incident_id, device_id, runtime_lane, started_at_ms, ended_at_ms, received_at_ms, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.ownerUserId,
      incident.incidentId,
      incident.deviceId,
      incident.runtimeLane,
      incident.startedAtMs,
      incident.endedAtMs,
      input.nowMs,
      payload
    )
    .run();
  const stored = await input.db
    .prepare(`SELECT payload_json, received_at_ms FROM openmeld_service_connection_incidents
    WHERE owner_user_id = ? AND incident_id = ?`)
    .bind(input.ownerUserId, incident.incidentId)
    .first<{ payload_json: string; received_at_ms: number }>();
  if (!stored) {
    throw new Error("computer.connection_incident.receipt_missing");
  }
  if (stored.payload_json !== payload) {
    throw createCoreRpcHttpError({
      status: 409,
      code: "computer.connection_incident.conflict",
      reason:
        "This connection incident was already recorded with different evidence.",
    });
  }
  // Time retention is shared with other operational evidence; this per-device
  // hard cap also prevents a faulty reporter from growing storage without bound.
  await input.db
    .prepare(`DELETE FROM openmeld_service_connection_incidents WHERE owner_user_id = ? AND device_id = ? AND runtime_lane = ?
    AND incident_id NOT IN (SELECT incident_id FROM openmeld_service_connection_incidents
      WHERE owner_user_id = ? AND device_id = ? AND runtime_lane = ? ORDER BY received_at_ms DESC, incident_id DESC LIMIT 100)`)
    .bind(
      input.ownerUserId,
      incident.deviceId,
      incident.runtimeLane,
      input.ownerUserId,
      incident.deviceId,
      incident.runtimeLane
    )
    .run();
  return {
    incidentId: incident.incidentId,
    receivedAtMs: stored.received_at_ms,
  };
}

export async function readServiceConnectionIncidents(input: {
  db: D1Database;
  ownerUserId: string;
  target: PeopleComputerTarget;
  nowMs: number;
  interval?: { startedAtMs: number; endedAtMs: number };
}) {
  const rows = await input.db
    .prepare(`SELECT payload_json, received_at_ms FROM openmeld_service_connection_incidents
    WHERE owner_user_id = ? AND device_id = ? AND runtime_lane = ? AND received_at_ms >= ? AND ended_at_ms >= ? AND started_at_ms <= ?
    ORDER BY received_at_ms DESC, incident_id DESC LIMIT 20`)
    .bind(
      input.ownerUserId,
      input.target.deviceId,
      input.target.runtimeLane,
      input.nowMs - WAKE_EVIDENCE_RETENTION_MS,
      input.interval?.startedAtMs ?? 0,
      input.interval?.endedAtMs ?? Number.MAX_SAFE_INTEGER
    )
    .all<{ payload_json: string; received_at_ms: number }>();
  return serviceConnectionIncidentsResponseSchema.parse({
    incidents: rows.results.map((row) => ({
      ...serviceConnectionIncidentSchema.parse(JSON.parse(row.payload_json)),
      receivedAtMs: row.received_at_ms,
    })),
  });
}
