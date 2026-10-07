import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { inboxItemSchema } from "@openmeld/schemas";
import type { InboxItem } from "@openmeld/schemas/types";
export type ComputerConnectionIncident = {
  ownerUserId: string;
  target: Extract<
    InboxItem["sourceTarget"],
    {
      kind: "computer_connection";
    }
  >;
  openedAtMs: number;
  changedAtMs: number;
};
export function readInboxComputerIdentity(
  db: PostgresDatabase,
  ownerUserId: string,
  deviceId: string
) {
  return db
    .query<{
      computerId: string;
      name: string;
    }>({
      text: `SELECT d.connected_computer_id AS "computerId",
    coalesce(nullif(d.user_display_name, ''), nullif(d.observed_display_name, ''), 'Computer') AS name
    FROM "openmeld"."openMeldDaemon_owned_devices" d
    INNER JOIN "openmeld"."openMeldDaemon_connected_computers" c ON c.owner_user_id = d.owner_user_id
      AND c.connected_computer_id = d.connected_computer_id
    WHERE d.owner_user_id = $1 AND d.device_id = $2
      AND NOT EXISTS (SELECT 1 FROM "openmeld"."openMeldDaemon_forgotten_devices" f
        WHERE f.owner_user_id = d.owner_user_id AND f.device_id = d.device_id)
    LIMIT 1`,
      values: [ownerUserId, deviceId],
    })
    .then((result) => result.rows[0] ?? null);
}
/** Runtime Transport calls this with its durable incident, never a client status read. */
export async function projectComputerConnectionInbox(
  db: PostgresDatabase,
  incident: ComputerConnectionIncident
): Promise<void> {
  const computer = await readInboxComputerIdentity(
    db,
    incident.ownerUserId,
    incident.target.deviceId
  );
  if (!computer || computer.computerId !== incident.target.computerId) {
    return;
  }
  const open = incident.target.state === "disconnected";
  const name = computer.name.slice(0, 100);
  const title = {
    disconnected: `${name} disconnected`,
    restored: `${name} connection restored`,
    deactivated: `${name} connection stopped`,
  }[incident.target.state];
  const item = inboxItemSchema.parse({
    id: `inbox_computer_${incident.target.incidentId}`,
    organizationId: null,
    recipientUserId: incident.ownerUserId,
    kind: "computer_connection",
    attention: "action_required",
    importance: "urgent",
    title,
    contextLabel: name,
    preview: open
      ? "This Computer unexpectedly lost its connection and cannot receive new local work. Open the Computer to check its connection."
      : "This connection request has ended. No action is needed for this incident.",
    sourceTarget: incident.target,
    sourceFacts: {
      version: 1,
      recipientReasons: ["device_owner"],
      requestCategory: "action",
    },
    readAt: null,
    resolutionStatus: open ? "open" : "resolved",
    occurredAt: new Date(incident.openedAtMs).toISOString(),
    createdAt: new Date(incident.openedAtMs).toISOString(),
    updatedAt: new Date(incident.changedAtMs).toISOString(),
  });
  // The guard is repeated in the write: forgetting/re-enrolling during the
  // display-name read cannot retarget this old incident to another Computer.
  await db.query({
    text: `INSERT INTO "openmeld"."inbox_items"
    (id, organization_id, recipient_user_id, kind, attention, importance, title, preview, context_label,
     source_kind, source_key, source_target_json, source_facts_json, resolution_status, resolved_at_ms,
     occurred_at_ms, created_at_ms, updated_at_ms)
    SELECT $1, NULL, $2, 'computer_connection', 'action_required', 'urgent', $3, $4, $5,
      'computer_connection', $6, $7, $8, $9, $10, $11, $12, $13
    WHERE EXISTS (SELECT 1 FROM "openmeld"."openMeldDaemon_owned_devices" d
      INNER JOIN "openmeld"."openMeldDaemon_connected_computers" c ON c.owner_user_id = d.owner_user_id
        AND c.connected_computer_id = d.connected_computer_id
      WHERE d.owner_user_id = $14 AND d.device_id = $15 AND d.connected_computer_id = $16
        AND NOT EXISTS (SELECT 1 FROM "openmeld"."openMeldDaemon_forgotten_devices" f
          WHERE f.owner_user_id = d.owner_user_id AND f.device_id = d.device_id))
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, preview = excluded.preview,
      source_target_json = excluded.source_target_json, resolution_status = excluded.resolution_status,
      resolved_at_ms = excluded.resolved_at_ms, updated_at_ms = GREATEST(inbox_items.updated_at_ms, excluded.updated_at_ms)
    WHERE inbox_items.organization_id IS NULL AND inbox_items.recipient_user_id = excluded.recipient_user_id
      AND inbox_items.source_kind = excluded.source_kind AND inbox_items.source_key = excluded.source_key
      AND inbox_items.resolution_status = 'open'`,
    values: [
      item.id,
      item.recipientUserId,
      item.title,
      item.preview,
      item.contextLabel,
      incident.target.incidentId,
      JSON.stringify(item.sourceTarget),
      JSON.stringify(item.sourceFacts),
      item.resolutionStatus,
      open ? null : incident.changedAtMs,
      incident.openedAtMs,
      incident.openedAtMs,
      incident.changedAtMs,
      incident.ownerUserId,
      incident.target.deviceId,
      incident.target.computerId,
    ],
  });
  // No email enqueue. Read/Dismiss and execution outcomes are deliberately untouched.
}
