import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  currentDeviceTargetDeviceIdSchema,
  localRuntimePlatformFamilySchema,
} from "@openmeld/schemas";
import type { OwnedDeviceRegistryRecord } from "../../application/owned-device-registry-service";

// TODO(2026-05-15): Rename this repo and its exported functions to Local
// Runtime registry terminology after the owned-device table is renamed or
// explicitly quarantined as storage-only. Do not expose this name through APIs.
type OwnedDeviceRegistryRow = {
  owner_user_id: string;
  device_id: string;
  connected_computer_id: string | null;
  observed_display_name: string | null;
  user_display_name: string | null;
  platform_family: string | null;
  os_version: string | null;
  device_type: string | null;
  first_seen_at_ms: number;
  last_observed_at_ms: number | null;
  updated_at_ms: number;
};
export async function readOwnedDeviceRegistryRecord(input: {
  db: PostgresDatabase;
  userId: string;
  deviceId: string;
}): Promise<OwnedDeviceRegistryRecord | null> {
  const row = await input.db
    .query<OwnedDeviceRegistryRow>({
      text: `
        SELECT
          owner_user_id,
          device_id,
          connected_computer_id,
          observed_display_name,
          user_display_name,
          platform_family,
          os_version,
          device_type,
          first_seen_at_ms,
          last_observed_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_owned_devices"
        WHERE owner_user_id = $1 AND device_id = $2
        LIMIT 1
      `,
      values: [input.userId, assertValidDeviceId(input.deviceId)],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapOwnedDeviceRegistryRow(row) : null;
}
export async function listOwnedDeviceRegistryRecords(input: {
  db: PostgresDatabase;
  userId: string;
}): Promise<readonly OwnedDeviceRegistryRecord[]> {
  return await listOwnedDeviceRegistryRecordsForUsers({
    db: input.db,
    userIds: [input.userId],
  });
}
export async function listOwnedDeviceRegistryRecordsForUsers(input: {
  db: PostgresDatabase;
  userIds: readonly string[];
}): Promise<readonly OwnedDeviceRegistryRecord[]> {
  if (input.userIds.length === 0) {
    return [];
  }
  const rows = await input.db.query<OwnedDeviceRegistryRow>({
    text: `
        SELECT
          owner_user_id,
          device_id,
          connected_computer_id,
          observed_display_name,
          user_display_name,
          platform_family,
          os_version,
          device_type,
          first_seen_at_ms,
          last_observed_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldDaemon_owned_devices"
        WHERE owner_user_id = ANY($1::text[])
        ORDER BY updated_at_ms DESC NULLS LAST, device_id ASC NULLS FIRST
      `,
    values: [input.userIds],
  });
  return (rows.rows ?? []).map((row) => mapOwnedDeviceRegistryRow(row));
}
export async function upsertOwnedDeviceRegistryRecord(input: {
  db: PostgresDatabase;
  record: OwnedDeviceRegistryRecord;
}): Promise<void> {
  const record = normalizeOwnedDeviceRegistryRecord(input.record);
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_owned_devices" (
          owner_user_id,
          device_id,
          connected_computer_id,
          observed_display_name,
          user_display_name,
          platform_family,
          os_version,
          device_type,
          first_seen_at_ms,
          last_observed_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT(owner_user_id, device_id) DO UPDATE SET
          connected_computer_id = excluded.connected_computer_id,
          observed_display_name = excluded.observed_display_name,
          user_display_name = excluded.user_display_name,
          platform_family = excluded.platform_family,
          os_version = excluded.os_version,
          device_type = excluded.device_type,
          first_seen_at_ms = excluded.first_seen_at_ms,
          last_observed_at_ms = excluded.last_observed_at_ms,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      record.ownerUserId,
      record.deviceId,
      record.connectedComputerId ?? null,
      record.observedDisplayName,
      record.userDisplayName,
      record.platformFamily,
      record.osVersion,
      record.deviceType,
      record.firstSeenAtMs,
      record.lastObservedAtMs,
      record.updatedAtMs,
    ],
  });
}
function assertValidDeviceId(deviceId: string): string {
  const parsed = currentDeviceTargetDeviceIdSchema.safeParse(deviceId);
  if (!parsed.success) {
    throw new Error(
      `owned device registry deviceId is invalid: ${parsed.error.issues[0]?.message ?? "invalid deviceId"}`
    );
  }
  return parsed.data;
}
function normalizeOwnedDeviceRegistryRecord(
  record: OwnedDeviceRegistryRecord
): OwnedDeviceRegistryRecord {
  return {
    ownerUserId: record.ownerUserId,
    deviceId: assertValidDeviceId(record.deviceId),
    connectedComputerId: normalizeOptionalText(
      record.connectedComputerId ?? null
    ),
    observedDisplayName: normalizeOptionalText(record.observedDisplayName),
    userDisplayName: normalizeOptionalText(record.userDisplayName),
    platformFamily: normalizePlatformFamily(record.platformFamily),
    osVersion: normalizeOptionalText(record.osVersion),
    deviceType: normalizeDeviceType(record.deviceType),
    firstSeenAtMs: record.firstSeenAtMs,
    lastObservedAtMs: normalizeOptionalTimestamp(record.lastObservedAtMs),
    updatedAtMs: record.updatedAtMs,
  };
}
function mapOwnedDeviceRegistryRow(
  row: OwnedDeviceRegistryRow
): OwnedDeviceRegistryRecord {
  return {
    ownerUserId: row.owner_user_id,
    deviceId: assertValidDeviceId(row.device_id),
    connectedComputerId: normalizeOptionalText(row.connected_computer_id),
    observedDisplayName: normalizeOptionalText(row.observed_display_name),
    userDisplayName: normalizeOptionalText(row.user_display_name),
    platformFamily: normalizePlatformFamily(row.platform_family),
    osVersion: normalizeOptionalText(row.os_version),
    deviceType: normalizeDeviceType(row.device_type),
    firstSeenAtMs: row.first_seen_at_ms,
    lastObservedAtMs: normalizeOptionalTimestamp(row.last_observed_at_ms),
    updatedAtMs: row.updated_at_ms,
  };
}
function normalizeOptionalText(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function normalizeOptionalTimestamp(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return value;
}
function normalizePlatformFamily(
  value: string | null
): OwnedDeviceRegistryRecord["platformFamily"] {
  if (value === null) {
    return null;
  }
  const parsed = localRuntimePlatformFamilySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `owned device registry platformFamily is invalid: ${value}`
    );
  }
  return parsed.data;
}
function normalizeDeviceType(
  value: string | null
): OwnedDeviceRegistryRecord["deviceType"] {
  if (value === null) {
    return null;
  }
  if (
    value === "laptop" ||
    value === "desktop" ||
    value === "server" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`owned device registry deviceType is invalid: ${value}`);
}
