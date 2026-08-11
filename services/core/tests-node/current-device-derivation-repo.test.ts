import { describe, expect, it } from "vitest";
import { resolveCurrentDeviceFromBindings } from "../src/start/infrastructure/d1/current-device-derivation-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const T0 = Date.parse("2026-04-10T00:00:00.000Z");

function createHarnessWithBindingTables() {
  const harness = createSqliteD1Harness();
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_agent_profile_bindings"
  );
  applyDrizzleMigrationForTable(
    harness,
    "openMeldDaemon_runtime_registry_records"
  );
  return harness;
}

function insertBinding(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    bindingId: string;
    ownerUserId: string;
    agentProfileId: string;
    openMeldServiceRuntimeId: string;
    bindingState?: string;
  }
): void {
  const bindingState = input.bindingState ?? "enabled_primary";
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
        updated_at_ms,
        disabled_at_ms
      )
      VALUES (?, 'owner_account', ?, ?, ?, 'builtin:codex', ?, ?, ?, ?)
    `,
    params: [
      input.bindingId,
      input.ownerUserId,
      input.agentProfileId,
      input.openMeldServiceRuntimeId,
      bindingState,
      T0,
      T0,
      bindingState === "enabled_primary" ? null : T0,
    ],
  });
}

function insertRuntimeRecord(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    openMeldServiceRuntimeId: string;
    ownerUserId: string;
    deviceId: string;
    lane?: string;
    lastRegisteredAtMs?: number;
  }
): void {
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
      VALUES (?, 'owner_account', ?, ?, ?, ?, ?, ?)
    `,
    params: [
      input.openMeldServiceRuntimeId,
      input.ownerUserId,
      input.deviceId,
      input.lane ?? "dev-local",
      T0,
      input.lastRegisteredAtMs ?? T0,
      T0,
    ],
  });
}

describe("current device derivation from Bindings", () => {
  it("resolves the device of the owner's enabled-primary Binding runtime", async () => {
    const harness = createHarnessWithBindingTables();
    try {
      insertBinding(harness, {
        bindingId: "binding-1",
        ownerUserId: "owner-1",
        agentProfileId: "agt-1",
        openMeldServiceRuntimeId: "runtime-1",
      });
      insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-1",
        ownerUserId: "owner-1",
        deviceId: "device-1",
      });

      await expect(
        resolveCurrentDeviceFromBindings({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual({
        availability: "resolved",
        deviceId: "device-1",
        runtimeLane: "dev-local",
      });
    } finally {
      harness.close();
    }
  });

  it("returns missing when the owner has no enabled-primary Binding", async () => {
    const harness = createHarnessWithBindingTables();
    try {
      insertBinding(harness, {
        bindingId: "binding-1",
        ownerUserId: "owner-1",
        agentProfileId: "agt-1",
        openMeldServiceRuntimeId: "runtime-1",
        bindingState: "disabled_historical",
      });
      insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-1",
        ownerUserId: "owner-1",
        deviceId: "device-1",
      });

      await expect(
        resolveCurrentDeviceFromBindings({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual({ availability: "missing" });
    } finally {
      harness.close();
    }
  });

  it("returns missing when the Binding runtime has no registry record", async () => {
    const harness = createHarnessWithBindingTables();
    try {
      insertBinding(harness, {
        bindingId: "binding-1",
        ownerUserId: "owner-1",
        agentProfileId: "agt-1",
        openMeldServiceRuntimeId: "runtime-unregistered",
      });

      await expect(
        resolveCurrentDeviceFromBindings({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual({ availability: "missing" });
    } finally {
      harness.close();
    }
  });

  it("prefers the most recently registered runtime across Binding devices", async () => {
    const harness = createHarnessWithBindingTables();
    try {
      insertBinding(harness, {
        bindingId: "binding-old",
        ownerUserId: "owner-1",
        agentProfileId: "agt-old",
        openMeldServiceRuntimeId: "runtime-old",
      });
      insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-old",
        ownerUserId: "owner-1",
        deviceId: "device-old",
        lastRegisteredAtMs: T0,
      });
      insertBinding(harness, {
        bindingId: "binding-new",
        ownerUserId: "owner-1",
        agentProfileId: "agt-new",
        openMeldServiceRuntimeId: "runtime-new",
      });
      insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-new",
        ownerUserId: "owner-1",
        deviceId: "device-new",
        lastRegisteredAtMs: T0 + 60_000,
      });

      await expect(
        resolveCurrentDeviceFromBindings({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual({
        availability: "resolved",
        deviceId: "device-new",
        runtimeLane: "dev-local",
      });
    } finally {
      harness.close();
    }
  });

  it("skips forgotten devices and falls back to the next Binding device", async () => {
    const harness = createHarnessWithBindingTables();
    try {
      insertBinding(harness, {
        bindingId: "binding-forgotten",
        ownerUserId: "owner-1",
        agentProfileId: "agt-forgotten",
        openMeldServiceRuntimeId: "runtime-forgotten",
      });
      insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-forgotten",
        ownerUserId: "owner-1",
        deviceId: "device-forgotten",
        lastRegisteredAtMs: T0 + 60_000,
      });
      insertBinding(harness, {
        bindingId: "binding-kept",
        ownerUserId: "owner-1",
        agentProfileId: "agt-kept",
        openMeldServiceRuntimeId: "runtime-kept",
      });
      insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-kept",
        ownerUserId: "owner-1",
        deviceId: "device-kept",
        lastRegisteredAtMs: T0,
      });
      harness.run({
        sql: `
          INSERT INTO openMeldDaemon_forgotten_devices (
            owner_user_id,
            device_id,
            forgotten_at_ms,
            updated_at_ms
          )
          VALUES ('owner-1', 'device-forgotten', ?, ?)
        `,
        params: [T0 + 120_000, T0 + 120_000],
      });

      await expect(
        resolveCurrentDeviceFromBindings({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual({
        availability: "resolved",
        deviceId: "device-kept",
        runtimeLane: "dev-local",
      });
    } finally {
      harness.close();
    }
  });

  it("does not resolve another owner's Binding devices", async () => {
    const harness = createHarnessWithBindingTables();
    try {
      insertBinding(harness, {
        bindingId: "binding-other",
        ownerUserId: "owner-other",
        agentProfileId: "agt-other",
        openMeldServiceRuntimeId: "runtime-other",
      });
      insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-other",
        ownerUserId: "owner-other",
        deviceId: "device-other",
      });

      await expect(
        resolveCurrentDeviceFromBindings({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual({ availability: "missing" });
    } finally {
      harness.close();
    }
  });
});
