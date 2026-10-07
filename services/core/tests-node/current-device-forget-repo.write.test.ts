import { describe, expect, it } from "vitest";
import {
  forgetComputerRecordAtomically,
  forgetCurrentComputerRecordAtomically,
} from "../src/start/infrastructure/postgresql/current-device-forget-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("current device forget repo write-side", () => {
  it("tombstones the selected computer and leaves retired start tables out of the write path", async () => {
    const harness = await createPostgresHarness();
    const forgottenAtMs = Date.parse("2026-04-10T00:00:00.000Z");

    try {
      await seedCurrentDeviceState(harness, {
        deviceId: "device-current",
        ownerUserId: "owner-1",
      });
      await seedOtherOwnedDevice(harness, {
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
        await harness.queryFirst({
          text: 'SELECT device_id, forgotten_at_ms FROM "openmeld"."openMeldDaemon_forgotten_devices" WHERE owner_user_id = $1',
          values: ["owner-1"],
        })
      ).toEqual({
        device_id: "device-current",
        forgotten_at_ms: forgottenAtMs,
      });
      // The pointer table is dormant after the Binding merge: the forget
      // batch no longer touches it; the row dies with the table drop.
      expect(
        await harness.queryFirst({
          text: 'SELECT device_id FROM "openmeld"."openMeldDaemon_current_device_targets" WHERE owner_user_id = $1',
          values: ["owner-1"],
        })
      ).toEqual({ device_id: "device-current" });
      expect(
        await harness.queryAll({
          text: 'SELECT device_id FROM "openmeld"."openMeldDaemon_owned_devices" WHERE owner_user_id = $1 ORDER BY device_id',
          values: ["owner-1"],
        })
      ).toEqual([{ device_id: "device-other" }]);
    } finally {
      await harness.close();
    }
  });

  it("returns already_missing when there is no selected computer", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });

  it("tombstones a non-current owned computer without clearing the current target", async () => {
    const harness = await createPostgresHarness();
    const forgottenAtMs = Date.parse("2026-04-10T00:00:00.000Z");

    try {
      await seedCurrentDeviceState(harness, {
        deviceId: "device-current",
        ownerUserId: "owner-1",
      });
      await seedOtherOwnedDevice(harness, {
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
        await harness.queryFirst({
          text: 'SELECT device_id FROM "openmeld"."openMeldDaemon_current_device_targets" WHERE owner_user_id = $1',
          values: ["owner-1"],
        })
      ).toEqual({ device_id: "device-current" });
      expect(
        await harness.queryAll({
          text: 'SELECT device_id FROM "openmeld"."openMeldDaemon_owned_devices" WHERE owner_user_id = $1 ORDER BY device_id',
          values: ["owner-1"],
        })
      ).toEqual([{ device_id: "device-current" }]);
      expect(
        await harness.queryFirst({
          text: 'SELECT device_id, forgotten_at_ms FROM "openmeld"."openMeldDaemon_forgotten_devices" WHERE owner_user_id = $1 AND device_id = $2',
          values: ["owner-1", "device-other"],
        })
      ).toEqual({
        device_id: "device-other",
        forgotten_at_ms: forgottenAtMs,
      });
    } finally {
      await harness.close();
    }
  });
});

async function seedCurrentDeviceState(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    deviceId: string;
    ownerUserId: string;
  }
) {
  const agentProfileId = "agt_00000000-0000-4000-8000-000000000001";
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ($1,'Owner',$1::text||'@example.com') ON CONFLICT (id) DO NOTHING`,
    values: [input.ownerUserId],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org-1','Organization','org-1',1700000000000) ON CONFLICT (id) DO NOTHING`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id,profile_name,profile_handle,profile_kind,organization_id,owner_user_id,source) VALUES ($1,'Agent',$1,'agent','org-1',$2,'migration') ON CONFLICT (profile_id) DO NOTHING`,
    values: [agentProfileId, input.ownerUserId],
  });
  await harness.query({
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_current_device_targets" (owner_user_id, device_id, runtime_lane, updated_at_ms)
      VALUES ($1, $2, $3, $4)
    `,
    values: [input.ownerUserId, input.deviceId, "dev-local", 1],
  });
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
      VALUES ($1, 'owner_account', $2, $3, 'dev-local', 1, 1, 1)
    `,
    values: [`runtime-${input.deviceId}`, input.ownerUserId, input.deviceId],
  });
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
        updated_at_ms
      )
      VALUES ($1, 'owner_account', $2, $3, $4, 'builtin:codex', 'enabled_primary', 1, 1)
    `,
    values: [
      `binding-${input.deviceId}`,
      input.ownerUserId,
      agentProfileId,
      `runtime-${input.deviceId}`,
    ],
  });
  await seedOtherOwnedDevice(harness, input);
}

async function seedOtherOwnedDevice(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    deviceId: string;
    ownerUserId: string;
  }
) {
  await harness.query({
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_owned_devices" (
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
      VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL, $3, NULL, $4)
    `,
    values: [input.ownerUserId, input.deviceId, 1, 1],
  });
}
