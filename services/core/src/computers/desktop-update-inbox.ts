import {
  desktopUpdateObservationRpcInputSchema,
  inboxSourceTargetSchema,
} from "@openmeld/schemas";
import type {
  DesktopUpdateObservation,
  DesktopUpdateObservationResponse,
  DesktopUpdateObservationRpcInput,
  InboxItem,
} from "@openmeld/schemas/types";
import { type CoreBindings, inboxDb } from "../lib/bindings";
import { isLocalComponentVersionAtLeast } from "../local-components/update-projection";
import { createCoreRpcHttpError } from "../rpc/errors";

type InstalledObservation = { sequence: number; observation_json: string };
type UpdateTarget = Extract<
  InboxItem["sourceTarget"],
  { kind: "desktop_update" }
>;
const INSTALLATION_WHERE =
  "owner_user_id = ? AND installation_id = ? AND lane = ?";

export async function rpcReportDesktopUpdateObservation(
  env: CoreBindings,
  raw: DesktopUpdateObservationRpcInput
): Promise<DesktopUpdateObservationResponse> {
  const parsed = desktopUpdateObservationRpcInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw failure(400, "Desktop update observation is invalid.");
  }
  const { context, observation } = parsed.data;
  const actor = context.actorContext;
  if (
    actor.profileKind !== "human" ||
    actor.ownerUserId !== observation.expectedUserId ||
    actor.callerPrincipalId !== observation.expectedUserId
  ) {
    throw failure(
      403,
      "The Desktop account changed. Check the current account before reporting an update."
    );
  }
  const db = inboxDb(env);
  if (!db) {
    throw failure(503, "Inbox is temporarily unavailable.");
  }
  return await reportDesktopUpdateObservation({ db, observation });
}

/** Account/device source projection. No Organization selection, mail, install command or read mutation. */
export async function reportDesktopUpdateObservation(input: {
  db: D1Database;
  observation: DesktopUpdateObservation;
  nowMs?: number;
}): Promise<DesktopUpdateObservationResponse> {
  const observation = input.observation;
  const scope = [
    observation.expectedUserId,
    observation.installationId,
    observation.lane,
  ];
  const serialized = JSON.stringify(observation);
  assertValidDesktopVersions(observation);
  // Compare-and-swap fences the complete read/derive/write batch, not only its
  // sequence. A concurrent newer report cannot leave an older release active.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previous = await input.db
      .prepare(
        `SELECT sequence, observation_json FROM desktop_update_installations WHERE ${INSTALLATION_WHERE}`
      )
      .bind(...scope)
      .first<InstalledObservation>();
    const replay = readObservationReplay(previous, observation, serialized);
    if (replay) {
      return replay;
    }
    const existing = await input.db
      .prepare(`SELECT id, source_target_json FROM inbox_items
      WHERE organization_id IS NULL AND recipient_user_id = ? AND source_kind = 'desktop_update'
        AND json_extract(source_target_json, '$.installationId') = ?
        AND json_extract(source_target_json, '$.lane') = ?
        AND json_extract(source_target_json, '$.state') = 'available'`)
      .bind(...scope)
      .all<{ id: string; source_target_json: string }>();
    const nowMs = input.nowMs ?? Date.now();
    const guard = `EXISTS (SELECT 1 FROM desktop_update_installations WHERE ${INSTALLATION_WHERE} AND sequence = ? AND observation_json = ?)`;
    const guardBindings = [...scope, observation.sequence, serialized];
    const statements = [
      input.db
        .prepare(`INSERT INTO desktop_update_installations
      (owner_user_id, installation_id, lane, sequence, observation_json, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_user_id, installation_id, lane) DO UPDATE SET sequence = excluded.sequence,
        observation_json = excluded.observation_json, updated_at_ms = excluded.updated_at_ms
      WHERE desktop_update_installations.sequence = ?`)
        .bind(
          ...scope,
          observation.sequence,
          serialized,
          nowMs,
          previous?.sequence ?? -1
        ),
    ];
    for (const row of existing.results ?? []) {
      const target = readUpdateTarget(row.source_target_json);
      const state = resolveReleaseState(target, observation);
      if (state === "available") {
        continue;
      }
      const { title, preview } = endedUpdateCopy(target, state);
      statements.push(
        input.db
          .prepare(`UPDATE inbox_items SET source_target_json = ?, title = ?, preview = ?, updated_at_ms = max(updated_at_ms, ?)
        WHERE id = ? AND recipient_user_id = ? AND organization_id IS NULL AND source_kind = 'desktop_update' AND ${guard}`)
          .bind(
            JSON.stringify({ ...target, state }),
            title,
            preview,
            nowMs,
            row.id,
            observation.expectedUserId,
            ...guardBindings
          )
      );
    }
    if (observation.availableVersion) {
      const target: UpdateTarget = {
        kind: "desktop_update",
        installationId: observation.installationId,
        lane: observation.lane,
        deviceName: observation.deviceName,
        platform: observation.platform,
        version: observation.availableVersion,
        state: "available",
      };
      const id = await desktopUpdateItemId(observation, target.version);
      statements.push(
        input.db
          .prepare(`INSERT INTO inbox_items
        (id, organization_id, recipient_user_id, kind, attention, importance, title, preview, context_label,
          source_kind, source_key, source_target_json, source_facts_json, resolution_status, occurred_at_ms, created_at_ms, updated_at_ms)
        SELECT ?, NULL, ?, 'desktop_update', 'update', 'normal', ?, ?, ?, 'desktop_update', ?, ?, ?, 'not_applicable', ?, ?, ?
        WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
          .bind(
            id,
            observation.expectedUserId,
            `OpenMeld ${target.version} is available`,
            `An update is available for Desktop on ${target.deviceName}. Open Updates on that device to continue.`,
            target.deviceName,
            id,
            JSON.stringify(target),
            JSON.stringify({ version: 1, recipientReasons: ["device_owner"] }),
            nowMs,
            nowMs,
            nowMs,
            ...guardBindings
          )
      );
    }
    const [write] = await input.db.batch(statements);
    if (Number(write?.meta.changes) > 0) {
      return { accepted: true, sequence: observation.sequence };
    }
  }
  throw failure(
    409,
    "A newer Desktop observation arrived. Retry the latest native state."
  );
}

function readUpdateTarget(serialized: string): UpdateTarget {
  const target = inboxSourceTargetSchema.parse(JSON.parse(serialized));
  if (target.kind !== "desktop_update") {
    throw failure(500, "Desktop update source is inconsistent.");
  }
  return target;
}

function endedUpdateCopy(
  target: UpdateTarget,
  state: "installed" | "superseded"
) {
  return state === "installed"
    ? {
        title: `OpenMeld ${target.version} installed`,
        preview: `Desktop on ${target.deviceName} confirmed the installed version.`,
      }
    : {
        title: `OpenMeld ${target.version} is no longer offered`,
        preview: `A newer update check replaced this offer on ${target.deviceName}.`,
      };
}

function assertValidDesktopVersions(
  observation: DesktopUpdateObservation
): void {
  const validInstalled = isLocalComponentVersionAtLeast(
    observation.installedVersion,
    observation.installedVersion
  );
  const available = observation.availableVersion;
  if (
    !validInstalled ||
    (available &&
      (!isLocalComponentVersionAtLeast(available, available) ||
        isLocalComponentVersionAtLeast(
          observation.installedVersion,
          available
        )))
  ) {
    throw failure(
      400,
      "The available Desktop version must be newer than its installed version."
    );
  }
}

function readObservationReplay(
  previous: InstalledObservation | null,
  observation: DesktopUpdateObservation,
  serialized: string
): DesktopUpdateObservationResponse | null {
  if (!previous || previous.sequence < observation.sequence) {
    return null;
  }
  if (
    previous.sequence === observation.sequence &&
    previous.observation_json !== serialized
  ) {
    throw failure(
      409,
      "This Desktop observation sequence already describes a different fact."
    );
  }
  return {
    accepted: previous.sequence === observation.sequence,
    sequence: previous.sequence,
  };
}

function resolveReleaseState(
  target: UpdateTarget,
  observation: DesktopUpdateObservation
): UpdateTarget["state"] {
  if (
    isLocalComponentVersionAtLeast(observation.installedVersion, target.version)
  ) {
    return "installed";
  }
  if (
    observation.availableVersion !== undefined &&
    observation.availableVersion !== target.version
  ) {
    return "superseded";
  }
  return "available";
}

async function desktopUpdateItemId(
  observation: DesktopUpdateObservation,
  version: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        observation.expectedUserId,
        observation.installationId,
        observation.lane,
        version,
      ])
    )
  );
  return `inbox_desktop_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function failure(status: number, reason: string) {
  return createCoreRpcHttpError({
    code: "inbox.desktop_update_observation_failed",
    reason,
    status,
  });
}
