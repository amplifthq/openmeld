import { describe, expect, it } from "vitest";
import {
  forgetComputerRecordAtomically,
  forgetCurrentComputerRecordAtomically,
} from "../src/start/infrastructure/d1/current-device-forget-repo";
import {
  applyDrizzleMigrationForTable,
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("current device forget repo write-side", () => {
  it("tombstones the selected computer and leaves retired start tables out of the write path", async () => {
    const harness = createSqliteD1Harness();
    const forgottenAtMs = Date.parse("2026-04-10T00:00:00.000Z");

    try {
      seedCurrentDeviceState(harness, {
        deviceId: "device-current",
        ownerUserId: "owner-1",
      });
      seedOtherOwnedDevice(harness, {
        deviceId: "device-other",
        ownerUserId: "owner-1",
      });

      await expect(
        forgetCurrentComputerRecordAtomically({
          db: harness.db,
          userId: "owner-1",
          forgottenAtMs,
        })
      ).resolves.toEqual({
        status: "forgotten",
        forgottenDeviceId: "device-current",
      });

      expect(
        harness.queryFirst({
          sql: "SELECT device_id, forgotten_at_ms FROM openMeldDaemon_forgotten_devices WHERE owner_user_id = ?",
          params: ["owner-1"],
        })
      ).toEqual({
        device_id: "device-current",
        forgotten_at_ms: forgottenAtMs,
      });
      // The pointer table is dormant after the Binding merge: the forget
      // batch no longer touches it; the row dies with the table drop.
      expect(
        harness.queryFirst({
          sql: "SELECT device_id FROM openMeldDaemon_current_device_targets WHERE owner_user_id = ?",
          params: ["owner-1"],
        })
      ).toEqual({ device_id: "device-current" });
      expect(
        harness.queryAll({
          sql: "SELECT device_id FROM openMeldDaemon_owned_devices WHERE owner_user_id = ? ORDER BY device_id",
          params: ["owner-1"],
        })
      ).toEqual([{ device_id: "device-other" }]);
    } finally {
      harness.close();
    }
  });

  it("returns already_missing when there is no selected computer", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_agent_profile_bindings"
    );
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );

    try {
      await expect(
        forgetCurrentComputerRecordAtomically({
          db: harness.db,
          userId: "owner-1",
          forgottenAtMs: Date.parse("2026-04-10T00:00:00.000Z"),
        })
      ).resolves.toEqual({
        status: "already_missing",
        forgottenDeviceId: null,
      });
    } finally {
      harness.close();
    }
  });

  it("tombstones a non-current owned computer without clearing the current target", async () => {
    const harness = createSqliteD1Harness();
    const forgottenAtMs = Date.parse("2026-04-10T00:00:00.000Z");

    try {
      seedCurrentDeviceState(harness, {
        deviceId: "device-current",
        ownerUserId: "owner-1",
      });
      seedOtherOwnedDevice(harness, {
        deviceId: "device-other",
        ownerUserId: "owner-1",
      });

      await expect(
        forgetComputerRecordAtomically({
          db: harness.db,
          userId: "owner-1",
          deviceId: "device-other",
          forgottenAtMs,
        })
      ).resolves.toEqual({
        status: "forgotten",
        forgottenDeviceId: "device-other",
      });

      expect(
        harness.queryFirst({
          sql: "SELECT device_id FROM openMeldDaemon_current_device_targets WHERE owner_user_id = ?",
          params: ["owner-1"],
        })
      ).toEqual({ device_id: "device-current" });
      expect(
        harness.queryAll({
          sql: "SELECT device_id FROM openMeldDaemon_owned_devices WHERE owner_user_id = ? ORDER BY device_id",
          params: ["owner-1"],
        })
      ).toEqual([{ device_id: "device-current" }]);
      expect(
        harness.queryFirst({
          sql: "SELECT device_id, forgotten_at_ms FROM openMeldDaemon_forgotten_devices WHERE owner_user_id = ? AND device_id = ?",
          params: ["owner-1", "device-other"],
        })
      ).toEqual({
        device_id: "device-other",
        forgotten_at_ms: forgottenAtMs,
      });
    } finally {
      harness.close();
    }
  });
});

function seedCurrentDeviceState(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    deviceId: string;
    ownerUserId: string;
  }
) {
  for (const sql of [
    "CREATE TABLE organizations (id TEXT PRIMARY KEY)",
    "CREATE TABLE projects (id TEXT PRIMARY KEY)",
  ]) {
    harness.run({ sql });
  }
  applyDrizzleMigrationsForTables(harness, [
    "agent_activity_session_inventory",
    "agent_activity_session_inventory_candidates",
    "agent_activity_session_inventory_sources",
  ]);
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_agent_profile_bindings"
  );
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_runtime_registry_records"
  );
  harness.run({
    sql: `
      INSERT INTO openMeldDaemon_current_device_targets (owner_user_id, device_id, runtime_lane, updated_at_ms)
      VALUES (?, ?, ?, ?)
    `,
    params: [input.ownerUserId, input.deviceId, "dev-local", 1],
  });
  harness.run({
    sql: `
      INSERT INTO openMeldDaemon_runtime_registry_records (
        openmeld_service_runtime_id,
        owner_kind,
        owner_id,
        device_id,
        lane,
        created_at_ms,
        last_registered_at_ms,
        updated_at_ms
      )
      VALUES (?, 'owner_account', ?, ?, 'dev-local', 1, 1, 1)
    `,
    params: [`runtime-${input.deviceId}`, input.ownerUserId, input.deviceId],
  });
  harness.run({
    sql: `
      INSERT INTO openMeldDaemon_agent_profile_bindings (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        agent_controller_ref,
        binding_state,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, 'owner_account', ?, ?, ?, 'builtin:codex', 'enabled_primary', 1, 1)
    `,
    params: [
      `binding-${input.deviceId}`,
      input.ownerUserId,
      `agt-${input.deviceId}`,
      `runtime-${input.deviceId}`,
    ],
  });
  seedOtherOwnedDevice(harness, input);
}

function seedOtherOwnedDevice(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    deviceId: string;
    ownerUserId: string;
  }
) {
  harness.run({
    sql: `
      INSERT INTO openMeldDaemon_owned_devices (
        owner_user_id,
        device_id,
        observed_display_name,
        user_display_name,
        platform_family,
        os_version,
        device_type,
        first_seen_at_ms,
        last_observed_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?)
    `,
    params: [input.ownerUserId, input.deviceId, 1, 1],
  });
}
