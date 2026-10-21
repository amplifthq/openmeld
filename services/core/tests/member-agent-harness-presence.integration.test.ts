import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  hasAnyAgentProfileBinding,
  listOwnerRuntimeHarnessCatalog,
  recordRuntimeHarnessObservation,
} from "../src/member-agent/infrastructure/postgresql/runtime-harness-presence-repo";
import { env } from "../test-support/worker-env";

const db = () => {
  const database = getPostgresDatabase(env);
  if (!database) {
    throw new Error("PostgreSQL test binding is missing");
  }
  return database;
};

async function seedRuntime(input: {
  deviceId: string;
  ownerUserId: string;
  runtimeId: string;
}) {
  const nowMs = Date.now();
  await db().query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_registry_records" (
      openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane,
      created_at_ms, last_registered_at_ms, updated_at_ms
    ) VALUES ($1, 'owner_account', $2, $3, 'prod', $4, $4, $4)`,
    values: [input.runtimeId, input.ownerUserId, input.deviceId, nowMs],
  });
  await db().query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_agent_controller_reports" (
      openmeld_service_runtime_id, agent_controller_ref, report_status,
      observed_at_ms, expires_at_ms, reported_reason_codes_json,
      agent_controller_interface_json, accepted_at_ms, updated_at_ms
    ) VALUES ($1, 'builtin:claude-code', 'ready', $2, $3, '[]', NULL, $2, $2)`,
    values: [input.runtimeId, nowMs, nowMs + 600_000],
  });
}

function observe(input: {
  detection: "detected" | "undetected" | "unknown";
  observedAtMs: number;
  runtimeId: string;
}) {
  return recordRuntimeHarnessObservation({
    agentControllerRef: "builtin:claude-code",
    db: db(),
    detection: input.detection,
    nowMs: input.observedAtMs,
    observedAtMs: input.observedAtMs,
    openMeldServiceRuntimeId: input.runtimeId,
  });
}

describe("runtime Harness presence fact", () => {
  it("records detections in order and reports when a Harness newly appears", async () => {
    const suffix = crypto.randomUUID();
    const ownerUserId = `owner-${suffix}`;
    const runtimeId = `runtime-${suffix}`;
    await seedRuntime({ deviceId: `device-${suffix}`, ownerUserId, runtimeId });

    expect(
      await observe({ detection: "detected", observedAtMs: 1000, runtimeId })
    ).toEqual({ applied: true, becamePresent: true });
    expect(
      await observe({ detection: "detected", observedAtMs: 2000, runtimeId })
    ).toEqual({ applied: true, becamePresent: false });
    expect(
      await observe({ detection: "undetected", observedAtMs: 3000, runtimeId })
    ).toEqual({ applied: true, becamePresent: false });
    // A replayed or older report changes nothing.
    expect(
      await observe({ detection: "detected", observedAtMs: 3000, runtimeId })
    ).toEqual({ applied: false, becamePresent: false });
    expect(
      await observe({ detection: "unknown", observedAtMs: 4000, runtimeId })
    ).toEqual({ applied: true, becamePresent: false });
    expect(
      await observe({ detection: "undetected", observedAtMs: 5000, runtimeId })
    ).toEqual({ applied: true, becamePresent: false });

    const [entry] = await listOwnerRuntimeHarnessCatalog({
      db: db(),
      ownerUserId,
    });
    expect(entry).toMatchObject({
      agentControllerRef: "builtin:claude-code",
      fact: {
        firstUndetectedAtMs: 3000,
        lastDetectedAtMs: 2000,
        undetectedReportCount: 2,
      },
      lane: "prod",
      openMeldServiceRuntimeId: runtimeId,
      reportStatus: "ready",
    });

    // A reinstall resets the debounce and counts as a new appearance.
    expect(
      await observe({ detection: "detected", observedAtMs: 6000, runtimeId })
    ).toEqual({ applied: true, becamePresent: true });
    const [reinstalled] = await listOwnerRuntimeHarnessCatalog({
      db: db(),
      ownerUserId,
    });
    expect(reinstalled?.fact).toEqual({
      firstUndetectedAtMs: null,
      lastDetectedAtMs: 6000,
      undetectedReportCount: 0,
    });
  });

  it("excludes forgotten computers and other owners from the catalog", async () => {
    const suffix = crypto.randomUUID();
    const ownerUserId = `owner-${suffix}`;
    await seedRuntime({
      deviceId: `kept-${suffix}`,
      ownerUserId,
      runtimeId: `kept-${suffix}`,
    });
    await seedRuntime({
      deviceId: `forgotten-${suffix}`,
      ownerUserId,
      runtimeId: `forgotten-${suffix}`,
    });
    await seedRuntime({
      deviceId: `other-${suffix}`,
      ownerUserId: `other-${suffix}`,
      runtimeId: `other-${suffix}`,
    });
    await db().query({
      text: `INSERT INTO "openmeld"."openMeldDaemon_forgotten_devices"
        (owner_user_id, device_id, forgotten_at_ms, updated_at_ms)
        VALUES ($1, $2, 1, 1)`,
      values: [ownerUserId, `forgotten-${suffix}`],
    });

    const entries = await listOwnerRuntimeHarnessCatalog({
      db: db(),
      ownerUserId,
    });

    expect(entries.map((entry) => entry.openMeldServiceRuntimeId)).toEqual([
      `kept-${suffix}`,
    ]);
    expect(entries[0]?.fact).toBeNull();
  });

  it("reports no Binding for a Profile that never bound", async () => {
    expect(
      await hasAnyAgentProfileBinding({
        agentProfileId: `agt_${crypto.randomUUID()}`,
        db: db(),
        ownerUserId: `owner-${crypto.randomUUID()}`,
      })
    ).toBe(false);
  });
});
