import { describe, expect, it } from "vitest";
import { resolveCurrentDeviceFromBindings } from "../src/start/infrastructure/postgresql/current-device-derivation-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const T0 = Date.parse("2026-04-10T00:00:00.000Z");

async function createHarnessWithBindingTables() {
  const harness = await createPostgresHarness();

  return harness;
}

async function insertBinding(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    bindingId: string;
    ownerUserId: string;
    agentProfileId: string;
    openMeldServiceRuntimeId: string;
    bindingState?: string;
  }
): Promise<void> {
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ($1,'Owner',$1::text||'@example.com') ON CONFLICT (id) DO NOTHING`,
    values: [input.ownerUserId],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org-1','Organization','org-1',1700000000000) ON CONFLICT (id) DO NOTHING`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id,profile_name,profile_handle,profile_kind,organization_id,owner_user_id,source) VALUES ($1,'Agent',$1,'agent','org-1',$2,'migration') ON CONFLICT (profile_id) DO NOTHING`,
    values: [input.agentProfileId, input.ownerUserId],
  });
  const bindingState = input.bindingState ?? "enabled_primary";
  await harness.query({
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
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
      VALUES ($1, 'owner_account', $2, $3, $4, 'builtin:codex', $5, $6, $7, $8)
    `,
    values: [
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

async function insertRuntimeRecord(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    openMeldServiceRuntimeId: string;
    ownerUserId: string;
    deviceId: string;
    lane?: string;
    lastRegisteredAtMs?: number;
  }
): Promise<void> {
  await harness.query({
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_runtime_registry_records" (
        openmeld_service_runtime_id,
        owner_kind,
        owner_id,
        device_id,
        lane,
        created_at_ms,
        last_registered_at_ms,
        updated_at_ms
      )
      VALUES ($1, 'owner_account', $2, $3, $4, $5, $6, $7)
    `,
    values: [
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
    const harness = await createHarnessWithBindingTables();
    try {
      await insertBinding(harness, {
        bindingId: "binding-1",
        ownerUserId: "owner-1",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
        openMeldServiceRuntimeId: "runtime-1",
      });
      await insertRuntimeRecord(harness, {
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
      await harness.close();
    }
  });

  it("returns missing when the owner has no enabled-primary Binding", async () => {
    const harness = await createHarnessWithBindingTables();
    try {
      await insertBinding(harness, {
        bindingId: "binding-1",
        ownerUserId: "owner-1",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
        openMeldServiceRuntimeId: "runtime-1",
        bindingState: "disabled_historical",
      });
      await insertRuntimeRecord(harness, {
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
      await harness.close();
    }
  });

  it("returns missing when the Binding runtime has no registry record", async () => {
    const harness = await createHarnessWithBindingTables();
    try {
      await insertBinding(harness, {
        bindingId: "binding-1",
        ownerUserId: "owner-1",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
        openMeldServiceRuntimeId: "runtime-unregistered",
      });

      await expect(
        resolveCurrentDeviceFromBindings({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual({ availability: "missing" });
    } finally {
      await harness.close();
    }
  });

  it("prefers the most recently registered runtime across Binding devices", async () => {
    const harness = await createHarnessWithBindingTables();
    try {
      await insertBinding(harness, {
        bindingId: "binding-old",
        ownerUserId: "owner-1",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000002",
        openMeldServiceRuntimeId: "runtime-old",
      });
      await insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-old",
        ownerUserId: "owner-1",
        deviceId: "device-old",
        lastRegisteredAtMs: T0,
      });
      await insertBinding(harness, {
        bindingId: "binding-new",
        ownerUserId: "owner-1",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000003",
        openMeldServiceRuntimeId: "runtime-new",
      });
      await insertRuntimeRecord(harness, {
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
      await harness.close();
    }
  });

  it("skips forgotten devices and falls back to the next Binding device", async () => {
    const harness = await createHarnessWithBindingTables();
    try {
      await insertBinding(harness, {
        bindingId: "binding-forgotten",
        ownerUserId: "owner-1",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000004",
        openMeldServiceRuntimeId: "runtime-forgotten",
      });
      await insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-forgotten",
        ownerUserId: "owner-1",
        deviceId: "device-forgotten",
        lastRegisteredAtMs: T0 + 60_000,
      });
      await insertBinding(harness, {
        bindingId: "binding-kept",
        ownerUserId: "owner-1",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000005",
        openMeldServiceRuntimeId: "runtime-kept",
      });
      await insertRuntimeRecord(harness, {
        openMeldServiceRuntimeId: "runtime-kept",
        ownerUserId: "owner-1",
        deviceId: "device-kept",
        lastRegisteredAtMs: T0,
      });
      await harness.query({
        text: `
          INSERT INTO "openmeld"."openMeldDaemon_forgotten_devices" (
            owner_user_id,
            device_id,
            forgotten_at_ms,
            updated_at_ms
          )
          VALUES ('owner-1', 'device-forgotten', $1, $2)
        `,
        values: [T0 + 120_000, T0 + 120_000],
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
      await harness.close();
    }
  });

  it("does not resolve another owner's Binding devices", async () => {
    const harness = await createHarnessWithBindingTables();
    try {
      await insertBinding(harness, {
        bindingId: "binding-other",
        ownerUserId: "owner-other",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000006",
        openMeldServiceRuntimeId: "runtime-other",
      });
      await insertRuntimeRecord(harness, {
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
      await harness.close();
    }
  });
});
