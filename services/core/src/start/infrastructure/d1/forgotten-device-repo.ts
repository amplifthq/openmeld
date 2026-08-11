import { currentDeviceTargetDeviceIdSchema } from "@openmeld/schemas";

export type ForgottenDeviceRecord = {
  ownerUserId: string;
  deviceId: string;
  forgottenAtMs: number;
  updatedAtMs: number;
};

type ForgottenDeviceRow = {
  owner_user_id: string;
  device_id: string;
  forgotten_at_ms: number;
  updated_at_ms: number;
};

export async function readForgottenDeviceRecord(input: {
  db: D1Database;
  userId: string;
  deviceId: string;
}): Promise<ForgottenDeviceRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT owner_user_id, device_id, forgotten_at_ms, updated_at_ms
        FROM openMeldDaemon_forgotten_devices
        WHERE owner_user_id = ? AND device_id = ?
        LIMIT 1
      `
    )
    .bind(input.userId, assertValidDeviceId(input.deviceId))
    .first<ForgottenDeviceRow>();

  return row ? mapForgottenDeviceRow(row) : null;
}

export async function upsertForgottenDeviceRecord(input: {
  db: D1Database;
  userId: string;
  deviceId: string;
  forgottenAtMs: number;
  updatedAtMs: number;
}): Promise<void> {
  await input.db
    .prepare(
      `
        INSERT INTO openMeldDaemon_forgotten_devices (
          owner_user_id,
          device_id,
          forgotten_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_user_id, device_id) DO UPDATE SET
          forgotten_at_ms = excluded.forgotten_at_ms,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(
      input.userId,
      assertValidDeviceId(input.deviceId),
      input.forgottenAtMs,
      input.updatedAtMs
    )
    .run();
}

export async function deleteForgottenDeviceRecord(input: {
  db: D1Database;
  userId: string;
  deviceId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        DELETE FROM openMeldDaemon_forgotten_devices
        WHERE owner_user_id = ? AND device_id = ?
      `
    )
    .bind(input.userId, assertValidDeviceId(input.deviceId))
    .run();
}

function mapForgottenDeviceRow(row: ForgottenDeviceRow): ForgottenDeviceRecord {
  return {
    ownerUserId: row.owner_user_id,
    deviceId: assertValidDeviceId(row.device_id),
    forgottenAtMs: row.forgotten_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function assertValidDeviceId(deviceId: string): string {
  const parsed = currentDeviceTargetDeviceIdSchema.safeParse(deviceId);
  if (!parsed.success) {
    throw new Error(
      `forgotten device id is invalid: ${parsed.error.issues[0]?.message ?? "invalid deviceId"}`
    );
  }
  return parsed.data;
}
