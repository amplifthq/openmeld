import { resolveCurrentDeviceFromBindings } from "./current-device-derivation-repo";

export type ForgetCurrentComputerRecordResult =
  | {
      status: "already_missing";
      forgottenDeviceId: null;
    }
  | {
      status: "forgotten";
      forgottenDeviceId: string;
    };

export async function forgetComputerRecordAtomically(input: {
  db: D1Database;
  userId: string;
  deviceId: string;
  forgottenAtMs: number;
}): Promise<ForgetCurrentComputerRecordResult> {
  const ownedDevice = await readOwnedDevice(input);
  if (!ownedDevice) {
    return {
      status: "already_missing",
      forgottenDeviceId: null,
    };
  }

  const statements = buildForgetComputerStatements({
    db: input.db,
    userId: input.userId,
    deviceId: input.deviceId,
    forgottenAtMs: input.forgottenAtMs,
  });
  await input.db.batch(statements);

  return {
    status: "forgotten",
    forgottenDeviceId: input.deviceId,
  };
}

export async function forgetCurrentComputerRecordAtomically(input: {
  db: D1Database;
  userId: string;
  forgottenAtMs: number;
}): Promise<ForgetCurrentComputerRecordResult> {
  const current = await resolveCurrentDeviceFromBindings({
    db: input.db,
    userId: input.userId,
  });
  if (current.availability !== "resolved") {
    return {
      status: "already_missing",
      forgottenDeviceId: null,
    };
  }

  const deviceId = current.deviceId;
  const statements = buildForgetComputerStatements({
    db: input.db,
    userId: input.userId,
    deviceId,
    forgottenAtMs: input.forgottenAtMs,
  });
  await input.db.batch(statements);

  return {
    status: "forgotten",
    forgottenDeviceId: deviceId,
  };
}

async function readOwnedDevice(input: {
  db: D1Database;
  userId: string;
  deviceId: string;
}): Promise<{ deviceId: string } | null> {
  // TODO(2026-05-15): Rename this storage-only lookup with the Local Runtime
  // registry cleanup; it must not become a public owned-device read model again.
  const row = await input.db
    .prepare(
      `
        SELECT device_id
        FROM openMeldDaemon_owned_devices
        WHERE owner_user_id = ? AND device_id = ?
        LIMIT 1
      `
    )
    .bind(input.userId, input.deviceId)
    .first<{ device_id: string }>();

  return row ? { deviceId: row.device_id } : null;
}

function buildForgetComputerStatements(input: {
  db: D1Database;
  userId: string;
  deviceId: string;
  forgottenAtMs: number;
}): D1PreparedStatement[] {
  const deviceId = input.deviceId;

  return [
    input.db
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
      .bind(input.userId, deviceId, input.forgottenAtMs, input.forgottenAtMs),
    input.db
      .prepare(
        `
          DELETE FROM agent_activity_session_inventory_candidates
          WHERE owner_user_id = ? AND device_id = ?
        `
      )
      .bind(input.userId, deviceId),
    input.db
      .prepare(
        `
          DELETE FROM agent_activity_session_inventory
          WHERE owner_user_id = ? AND device_id = ?
        `
      )
      .bind(input.userId, deviceId),
    input.db
      .prepare(
        `
          DELETE FROM agent_activity_session_inventory_sources
          WHERE owner_user_id = ? AND device_id = ?
        `
      )
      .bind(input.userId, deviceId),
    input.db
      .prepare(
        `
          DELETE FROM openMeldDaemon_owned_devices
          WHERE owner_user_id = ? AND device_id = ?
        `
      )
      .bind(input.userId, deviceId),
  ];
}
