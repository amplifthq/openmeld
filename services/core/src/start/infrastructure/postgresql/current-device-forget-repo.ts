import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
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
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  return {
    status: "forgotten",
    forgottenDeviceId: input.deviceId,
  };
}
export async function forgetCurrentComputerRecordAtomically(input: {
  db: PostgresDatabase;
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
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  return {
    status: "forgotten",
    forgottenDeviceId: deviceId,
  };
}
async function readOwnedDevice(input: {
  db: PostgresDatabase;
  userId: string;
  deviceId: string;
}): Promise<{
  deviceId: string;
} | null> {
  // TODO(2026-05-15): Rename this storage-only lookup with the Local Runtime
  // registry cleanup; it must not become a public owned-device read model again.
  const row = await input.db
    .query<{
      device_id: string;
    }>({
      text: `
        SELECT device_id
        FROM "openmeld"."openMeldDaemon_owned_devices"
        WHERE owner_user_id = $1 AND device_id = $2
        LIMIT 1
      `,
      values: [input.userId, input.deviceId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? { deviceId: row.device_id } : null;
}
function buildForgetComputerStatements(input: {
  db: PostgresDatabase;
  userId: string;
  deviceId: string;
  forgottenAtMs: number;
}): QueryConfig[] {
  const deviceId = input.deviceId;
  return [
    {
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
        deviceId,
        input.forgottenAtMs,
        input.forgottenAtMs,
      ],
    },
    {
      text: `
          DELETE FROM "openmeld"."agent_activity_session_inventory_candidates"
          WHERE owner_user_id = $1 AND device_id = $2
        `,
      values: [input.userId, deviceId],
    },
    {
      text: `
          DELETE FROM "openmeld"."agent_activity_session_inventory"
          WHERE owner_user_id = $1 AND device_id = $2
        `,
      values: [input.userId, deviceId],
    },
    {
      text: `
          DELETE FROM "openmeld"."agent_activity_session_inventory_sources"
          WHERE owner_user_id = $1 AND device_id = $2
        `,
      values: [input.userId, deviceId],
    },
    {
      text: `
          DELETE FROM "openmeld"."openMeldDaemon_owned_devices"
          WHERE owner_user_id = $1 AND device_id = $2
        `,
      values: [input.userId, deviceId],
    },
  ];
}
