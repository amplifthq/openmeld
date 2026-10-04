import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
  userId: string;
  deviceId: string;
}): Promise<ForgottenDeviceRecord | null> {
  const row = await input.db
    .query<ForgottenDeviceRow>({
      text: `
        SELECT owner_user_id, device_id, forgotten_at_ms, updated_at_ms
        FROM "openmeld"."openMeldDaemon_forgotten_devices"
        WHERE owner_user_id = $1 AND device_id = $2
        LIMIT 1
      `,
      values: [input.userId, assertValidDeviceId(input.deviceId)],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapForgottenDeviceRow(row) : null;
}
export async function upsertForgottenDeviceRecord(input: {
  db: PostgresDatabase;
  userId: string;
  deviceId: string;
  forgottenAtMs: number;
  updatedAtMs: number;
}): Promise<void> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldDaemon_forgotten_devices" (
          owner_user_id,
          device_id,
          forgotten_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(owner_user_id, device_id) DO UPDATE SET
          forgotten_at_ms = excluded.forgotten_at_ms,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      input.userId,
      assertValidDeviceId(input.deviceId),
      input.forgottenAtMs,
      input.updatedAtMs,
    ],
  });
}
export async function deleteForgottenDeviceRecord(input: {
  db: PostgresDatabase;
  userId: string;
  deviceId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        DELETE FROM "openmeld"."openMeldDaemon_forgotten_devices"
        WHERE owner_user_id = $1 AND device_id = $2
      `,
    values: [input.userId, assertValidDeviceId(input.deviceId)],
  });
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
