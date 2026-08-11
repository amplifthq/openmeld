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
  db: D1Database;
  userId: string;
  deviceId: string;
  requestedConnectedComputerId?: string;
  connectedAtMs: number;
  createConnectedComputerId?: () => string;
}): Promise<
  | { status: "connected"; connectedComputerId: string }
  | { status: "requested_not_found"; requestedConnectedComputerId: string }
> {
  const deviceId = assertValidBoundedId({
    label: "connected computer deviceId",
    value: input.deviceId,
  });
  const existing = await input.db
    .prepare(
      `
        SELECT connected_computer_id
        FROM openMeldDaemon_owned_devices
        WHERE owner_user_id = ? AND device_id = ?
        LIMIT 1
      `
    )
    .bind(input.userId, deviceId)
    .first<OwnedDeviceConnectionRow>();
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
    input.db
      .prepare(
        `
        INSERT INTO openMeldDaemon_connected_computers (
          owner_user_id,
          connected_computer_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_user_id, connected_computer_id) DO UPDATE SET
          updated_at_ms = excluded.updated_at_ms
      `
      )
      .bind(
        input.userId,
        connectedComputerId,
        input.connectedAtMs,
        input.connectedAtMs
      ),
    input.db
      .prepare(
        `
        UPDATE openMeldDaemon_owned_devices
        SET connected_computer_id = ?,
            updated_at_ms = ?
        WHERE owner_user_id = ? AND device_id = ?
      `
      )
      .bind(connectedComputerId, input.connectedAtMs, input.userId, deviceId),
  ];
  const previousConnectedComputerId = existing?.connected_computer_id ?? null;
  if (
    previousConnectedComputerId !== null &&
    previousConnectedComputerId !== connectedComputerId
  ) {
    statements.push(
      input.db
        .prepare(
          `
            DELETE FROM openMeldDaemon_connected_computers
            WHERE owner_user_id = ?
              AND connected_computer_id = ?
              AND NOT EXISTS (
                SELECT 1
                FROM openMeldDaemon_owned_devices
                WHERE owner_user_id = ?
                  AND connected_computer_id = ?
              )
          `
        )
        .bind(
          input.userId,
          previousConnectedComputerId,
          input.userId,
          previousConnectedComputerId
        )
    );
  }
  await input.db.batch(statements);

  return { status: "connected", connectedComputerId };
}

export async function readConnectedComputerIdentityRecord(input: {
  db: D1Database;
  userId: string;
  connectedComputerId: string;
}): Promise<{ connectedComputerId: string } | null> {
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
  db: D1Database;
  userId: string;
  connectedComputerId: string;
}): Promise<string | null> {
  const row = await input.db
    .prepare(
      `
        SELECT connected_computer_id
        FROM openMeldDaemon_connected_computers
        WHERE owner_user_id = ? AND connected_computer_id = ?
        LIMIT 1
      `
    )
    .bind(input.userId, input.connectedComputerId)
    .first<ConnectedComputerRow>();

  return row?.connected_computer_id ?? null;
}
