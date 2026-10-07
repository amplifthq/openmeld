import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  serviceConnectionIncidentSchema,
  serviceConnectionIncidentsResponseSchema,
} from "@openmeld/schemas";
import type {
  PeopleComputerTarget,
  ServiceConnectionIncident,
  ServiceConnectionIncidentReceipt,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";

const SERVICE_CONNECTION_INCIDENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export async function deleteExpiredServiceConnectionIncidents(input: {
  db: PostgresDatabase;
  nowMs: number;
}) {
  let deleted = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await input.db.query({
      text: 'DELETE FROM "openmeld"."openmeld_service_connection_incidents" WHERE (owner_user_id, incident_id) IN (SELECT owner_user_id, incident_id FROM "openmeld"."openmeld_service_connection_incidents" WHERE received_at_ms < $1 ORDER BY received_at_ms, owner_user_id, incident_id LIMIT 500)',
      values: [input.nowMs - SERVICE_CONNECTION_INCIDENT_RETENTION_MS],
    });
    const changes = Number(result.rowCount ?? 0);
    deleted += changes;
    if (changes < 500) {
      break;
    }
  }
  return { deleted };
}
export async function storeServiceConnectionIncident(input: {
  db: PostgresDatabase;
  ownerUserId: string;
  incident: ServiceConnectionIncident;
  nowMs: number;
}): Promise<ServiceConnectionIncidentReceipt> {
  const incident = serviceConnectionIncidentSchema.parse(input.incident);
  const payload = JSON.stringify(incident);
  await input.db.query({
    text: `INSERT INTO "openmeld"."openmeld_service_connection_incidents"
    (owner_user_id, incident_id, device_id, runtime_lane, started_at_ms, ended_at_ms, received_at_ms, payload_json)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
    values: [
      input.ownerUserId,
      incident.incidentId,
      incident.deviceId,
      incident.runtimeLane,
      incident.startedAtMs,
      incident.endedAtMs,
      input.nowMs,
      payload,
    ],
  });
  const stored = await input.db
    .query<{
      payload_json: string;
      received_at_ms: number;
    }>({
      text: `SELECT payload_json, received_at_ms FROM "openmeld"."openmeld_service_connection_incidents"
    WHERE owner_user_id = $1 AND incident_id = $2`,
      values: [input.ownerUserId, incident.incidentId],
    })
    .then((result) => result.rows[0] ?? null);
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
  // This per-device cap complements time retention and bounds faulty reporters.
  await input.db.query({
    text: `DELETE FROM "openmeld"."openmeld_service_connection_incidents" WHERE owner_user_id = $1 AND device_id = $2 AND runtime_lane = $3
    AND incident_id NOT IN (SELECT incident_id FROM "openmeld"."openmeld_service_connection_incidents"
      WHERE owner_user_id = $4 AND device_id = $5 AND runtime_lane = $6 ORDER BY received_at_ms DESC NULLS LAST, incident_id DESC NULLS LAST LIMIT 100)`,
    values: [
      input.ownerUserId,
      incident.deviceId,
      incident.runtimeLane,
      input.ownerUserId,
      incident.deviceId,
      incident.runtimeLane,
    ],
  });
  return {
    incidentId: incident.incidentId,
    receivedAtMs: stored.received_at_ms,
  };
}
export async function readServiceConnectionIncidents(input: {
  db: PostgresDatabase;
  ownerUserId: string;
  target: PeopleComputerTarget;
  nowMs: number;
  interval?: {
    startedAtMs: number;
    endedAtMs: number;
  };
}) {
  const rows = await input.db.query<{
    payload_json: string;
    received_at_ms: number;
  }>({
    text: `SELECT payload_json, received_at_ms FROM "openmeld"."openmeld_service_connection_incidents"
    WHERE owner_user_id = $1 AND device_id = $2 AND runtime_lane = $3 AND received_at_ms >= $4 AND ended_at_ms >= $5 AND started_at_ms <= $6
    ORDER BY received_at_ms DESC NULLS LAST, incident_id DESC NULLS LAST LIMIT 20`,
    values: [
      input.ownerUserId,
      input.target.deviceId,
      input.target.runtimeLane,
      input.nowMs - SERVICE_CONNECTION_INCIDENT_RETENTION_MS,
      input.interval?.startedAtMs ?? 0,
      input.interval?.endedAtMs ?? Number.MAX_SAFE_INTEGER,
    ],
  });
  return serviceConnectionIncidentsResponseSchema.parse({
    incidents: rows.rows.map((row) => ({
      ...serviceConnectionIncidentSchema.parse(JSON.parse(row.payload_json)),
      receivedAtMs: row.received_at_ms,
    })),
  });
}
