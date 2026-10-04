import type { PostgresDatabase, QueryResult } from "@openmeld/db/postgresql";
import { currentDeviceTargetDeviceIdSchema } from "@openmeld/schemas";

type OwnedDeviceConnectionRow = {
  connected_computer_id: string | null;
};
type ConnectedComputerRow = {
  connected_computer_id: string;
};
function assertValidBoundedId(input: { label: string; value: string }): string {
  const parsed = currentDeviceTargetDeviceIdSchema.safeParse(input.value);
  if (!parsed.success) {
    throw new Error(
      `${input.label} is invalid: ${parsed.error.issues[0]?.message ?? "invalid id"}`
    );
  }
  return parsed.data;
}
export async function connectOwnedDeviceToConnectedComputerRecord(input: {
  db: PostgresDatabase;
  userId: string;
  deviceId: string;
  requestedConnectedComputerId?: string;
  connectedAtMs: number;
  createConnectedComputerId?: () => string;
}): Promise<
  | {
      status: "connected";
      connectedComputerId: string;
    }
  | {
      status: "requested_not_found";
      requestedConnectedComputerId: string;
    }
> {
  const deviceId = assertValidBoundedId({
    label: "connected computer deviceId",
    value: input.deviceId,
  });
  const existing = await input.db
    .query<OwnedDeviceConnectionRow>({
      text: `
        SELECT connected_computer_id
        FROM "openmeld"."openMeldDaemon_owned_devices"
        WHERE owner_user_id = $1 AND device_id = $2
        LIMIT 1
      `,
      values: [input.userId, deviceId],
    })
    .then((result) => result.rows[0] ?? null);
  const requestedConnectedComputerId = input.requestedConnectedComputerId
    ? assertValidBoundedId({
        label: "requested connectedComputerId",
        value: input.requestedConnectedComputerId,
      })
    : null;
  const verifiedRequestedConnectedComputerId =
    requestedConnectedComputerId === null
      ? null
      : ((
          await readConnectedComputerIdentityRecord({
            connectedComputerId: requestedConnectedComputerId,
            db: input.db,
            userId: input.userId,
          })
        )?.connectedComputerId ?? null);
  if (
    requestedConnectedComputerId !== null &&
    verifiedRequestedConnectedComputerId === null
  ) {
    return {
      status: "requested_not_found",
      requestedConnectedComputerId,
    };
  }
  const connectedComputerId =
    verifiedRequestedConnectedComputerId ??
    existing?.connected_computer_id ??
    assertValidBoundedId({
      label: "connectedComputerId",
      value: input.createConnectedComputerId?.() ?? crypto.randomUUID(),
    });
  const statements = [
    {
      text: `
        INSERT INTO "openmeld"."openMeldDaemon_connected_computers" (
          owner_user_id,
          connected_computer_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(owner_user_id, connected_computer_id) DO UPDATE SET
          updated_at_ms = excluded.updated_at_ms
      `,
      values: [
        input.userId,
        connectedComputerId,
        input.connectedAtMs,
        input.connectedAtMs,
      ],
    },
    {
      text: `
        UPDATE "openmeld"."openMeldDaemon_owned_devices"
        SET connected_computer_id = $1,
            updated_at_ms = $2
        WHERE owner_user_id = $3 AND device_id = $4
      `,
      values: [
        connectedComputerId,
        input.connectedAtMs,
        input.userId,
        deviceId,
      ],
    },
  ];
  const previousConnectedComputerId = existing?.connected_computer_id ?? null;
  if (
    previousConnectedComputerId !== null &&
    previousConnectedComputerId !== connectedComputerId
  ) {
    statements.push({
      text: `
            DELETE FROM "openmeld"."openMeldDaemon_connected_computers"
            WHERE owner_user_id = $1
              AND connected_computer_id = $2
              AND NOT EXISTS (
                SELECT 1
                FROM "openmeld"."openMeldDaemon_owned_devices"
                WHERE owner_user_id = $3
                  AND connected_computer_id = $4
              )
          `,
      values: [
        input.userId,
        previousConnectedComputerId,
        input.userId,
        previousConnectedComputerId,
      ],
    });
  }
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  return { status: "connected", connectedComputerId };
}
export async function readConnectedComputerIdentityRecord(input: {
  db: PostgresDatabase;
  userId: string;
  connectedComputerId: string;
}): Promise<{
  connectedComputerId: string;
} | null> {
  const connectedComputerId = assertValidBoundedId({
    label: "connectedComputerId",
    value: input.connectedComputerId,
  });
  const verifiedConnectedComputerId = await readVerifiedConnectedComputerId({
    connectedComputerId,
    db: input.db,
    userId: input.userId,
  });
  return verifiedConnectedComputerId === null
    ? null
    : { connectedComputerId: verifiedConnectedComputerId };
}
async function readVerifiedConnectedComputerId(input: {
  db: PostgresDatabase;
  userId: string;
  connectedComputerId: string;
}): Promise<string | null> {
  const row = await input.db
    .query<ConnectedComputerRow>({
      text: `
        SELECT connected_computer_id
        FROM "openmeld"."openMeldDaemon_connected_computers"
        WHERE owner_user_id = $1 AND connected_computer_id = $2
        LIMIT 1
      `,
      values: [input.userId, input.connectedComputerId],
    })
    .then((result) => result.rows[0] ?? null);
  return row?.connected_computer_id ?? null;
}
