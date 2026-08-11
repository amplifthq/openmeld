import { currentDeviceTargetResolvedSchema } from "@openmeld/schemas";
import type { CurrentDeviceTargetResponse } from "@openmeld/schemas/types";
import { readForgottenDeviceRecord } from "./forgotten-device-repo";

type BindingDeviceCandidateRow = {
  device_id: string;
  lane: string;
  last_active_ms: number;
};

/**
 * Derives the owner's current device from Binding intent instead of the
 * retired openMeldDaemon_current_device_targets pointer table: enabled-primary
 * Bindings name an OpenMeld Service Runtime, and the runtime registry record
 * names the device and lane that runtime lives on. The JOIN stays inside
 * the local-state domain (bindings x runtime registry x forgotten devices)
 * per the physical DB split boundary rules.
 */
export async function resolveCurrentDeviceFromBindings(input: {
  db: D1Database;
  userId: string;
}): Promise<CurrentDeviceTargetResponse> {
  const rows = await input.db
    .prepare(
      `
        SELECT
          runtime.device_id,
          runtime.lane,
          MAX(runtime.last_registered_at_ms) AS last_active_ms
        FROM openMeldDaemon_agent_profile_bindings binding
        JOIN openMeldDaemon_runtime_registry_records runtime
          ON runtime.openmeld_service_runtime_id = binding.openmeld_service_runtime_id
          AND runtime.owner_kind = binding.owner_kind
          AND runtime.owner_id = binding.owner_id
        WHERE binding.owner_kind = 'owner_account'
          AND binding.owner_id = ?
          AND binding.binding_state = 'enabled_primary'
        GROUP BY runtime.device_id, runtime.lane
        ORDER BY last_active_ms DESC
      `
    )
    .bind(input.userId)
    .all<BindingDeviceCandidateRow>();

  for (const row of rows.results ?? []) {
    const forgotten = await readForgottenDeviceRecord({
      db: input.db,
      userId: input.userId,
      deviceId: row.device_id,
    });
    if (forgotten) {
      continue;
    }

    const parsed = currentDeviceTargetResolvedSchema.safeParse({
      availability: "resolved",
      deviceId: row.device_id,
      runtimeLane: row.lane,
    });
    if (!parsed.success) {
      throw new Error(
        `binding-derived current device is invalid for user ${input.userId}: ${parsed.error.message}`
      );
    }
    return parsed.data;
  }

  return { availability: "missing" };
}
