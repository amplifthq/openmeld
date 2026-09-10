export type SpaceMessagePinRecord = {
  signalId: string;
  pinnedByProfileId: string;
  pinnedAt: string;
};

type PinTable = "space_message_pins" | "space_file_pins";

export function listSpaceMessagePins(
  sql: SqlStorage,
  table: PinTable = "space_message_pins"
): SpaceMessagePinRecord[] {
  return [
    ...sql.exec<{
      signal_id: string;
      pinned_by_profile_id: string;
      pinned_at: string;
    }>(
      `SELECT signal_id, pinned_by_profile_id, pinned_at FROM ${table} ORDER BY pinned_at DESC, signal_id`
    ),
  ].map((row) => ({
    signalId: row.signal_id,
    pinnedByProfileId: row.pinned_by_profile_id,
    pinnedAt: row.pinned_at,
  }));
}

/** A duplicate pin never transfers ownership; only the original pinner may remove it. */
export function mutateSpaceMessagePin(
  sql: SqlStorage,
  input: SpaceMessagePinRecord & { action: "pin" | "unpin" },
  table: PinTable = "space_message_pins"
): "ok" | "forbidden" {
  const existing = [
    ...sql.exec<{ pinned_by_profile_id: string }>(
      `SELECT pinned_by_profile_id FROM ${table} WHERE signal_id = ?`,
      input.signalId
    ),
  ][0];
  if (input.action === "unpin") {
    if (existing && existing.pinned_by_profile_id !== input.pinnedByProfileId) {
      return "forbidden";
    }
    sql.exec(`DELETE FROM ${table} WHERE signal_id = ?`, input.signalId);
  } else {
    sql.exec(
      `INSERT OR IGNORE INTO ${table} (signal_id, pinned_by_profile_id, pinned_at) VALUES (?, ?, ?)`,
      input.signalId,
      input.pinnedByProfileId,
      input.pinnedAt
    );
  }
  return "ok";
}
