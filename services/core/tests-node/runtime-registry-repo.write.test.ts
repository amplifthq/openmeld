import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  readRuntimeRegistryRecord,
  registerRuntimeRegistryRecord,
} from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const lookupInput = (input?: {
  deviceId?: string;
  lane?: string;
  ownerId?: string;
}): RuntimeLookupInput =>
  createRuntimeLookupInput({
    owner: {
      kind: "owner_account",
      id: input?.ownerId ?? "owner-1",
    },
    deviceId: input?.deviceId ?? "device-1",
    lane: input?.lane ?? "openmeld-dev",
  });

const openMeldServiceRuntimeId = (
  lookup: RuntimeLookupInput,
  value: string
): AuthorityOpenMeldServiceRuntimeId =>
  createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: lookup,
    openMeldServiceRuntimeId: value,
    source: "runtime_registry_authority",
  });

describe("runtime registry repo write-side", () => {
  it("creates and reads one authoritative Runtime Registry openMeldServiceRuntimeId", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const created = await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: openMeldServiceRuntimeId(
            runtimeLookupInput,
            "runtime_opaque_1"
          ),
          runtimeLookupInput,
        },
      });

      expect(created).toEqual({
        status: "created",
        openMeldServiceRuntimeId: openMeldServiceRuntimeId(
          runtimeLookupInput,
          "runtime_opaque_1"
        ),
      });
      await expect(
        readRuntimeRegistryRecord({
          db: harness.db,
          runtimeLookupInput,
        })
      ).resolves.toEqual({
        status: "found",
        openMeldServiceRuntimeId: openMeldServiceRuntimeId(
          runtimeLookupInput,
          "runtime_opaque_1"
        ),
      });
    } finally {
      harness.close();
    }
  });

  it("reuses the existing openMeldServiceRuntimeId for duplicate registration and retry", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const runtimeLookupInput = lookupInput();
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: openMeldServiceRuntimeId(
            runtimeLookupInput,
            "runtime_first"
          ),
          runtimeLookupInput,
        },
      });

      const retried = await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 200,
          openMeldServiceRuntimeId: openMeldServiceRuntimeId(
            runtimeLookupInput,
            "runtime_retry_candidate"
          ),
          runtimeLookupInput,
        },
      });

      expect(retried).toEqual({
        status: "reused",
        openMeldServiceRuntimeId: openMeldServiceRuntimeId(
          runtimeLookupInput,
          "runtime_first"
        ),
      });
      expect(
        harness.queryAll<{
          openmeld_service_runtime_id: string;
          last_registered_at_ms: number;
        }>({
          sql: `
              SELECT openmeld_service_runtime_id, last_registered_at_ms
              FROM openMeldDaemon_runtime_registry_records
              WHERE owner_kind = ? AND owner_id = ? AND device_id = ? AND lane = ?
            `,
          params: ["owner_account", "owner-1", "device-1", "openmeld-dev"],
        })
      ).toEqual([
        {
          openmeld_service_runtime_id: "runtime_first",
          last_registered_at_ms: 200,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps lane, owner, and device identity isolated", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const baseLookup = lookupInput();
      const otherLaneLookup = lookupInput({ lane: "openmeld-canary" });
      const otherOwnerLookup = lookupInput({ ownerId: "owner-2" });
      const otherDeviceLookup = lookupInput({ deviceId: "device-2" });

      for (const [runtimeLookupInput, value] of [
        [baseLookup, "runtime_base"],
        [otherLaneLookup, "runtime_other_lane"],
        [otherOwnerLookup, "runtime_other_owner"],
        [otherDeviceLookup, "runtime_other_device"],
      ] as const) {
        await registerRuntimeRegistryRecord({
          db: harness.db,
          record: {
            nowMs: 100,
            openMeldServiceRuntimeId: openMeldServiceRuntimeId(
              runtimeLookupInput,
              value
            ),
            runtimeLookupInput,
          },
        });
      }

      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: `
            SELECT openmeld_service_runtime_id
            FROM openMeldDaemon_runtime_registry_records
            ORDER BY openmeld_service_runtime_id
          `,
        })
      ).toEqual([
        { openmeld_service_runtime_id: "runtime_base" },
        { openmeld_service_runtime_id: "runtime_other_device" },
        { openmeld_service_runtime_id: "runtime_other_lane" },
        { openmeld_service_runtime_id: "runtime_other_owner" },
      ]);
    } finally {
      harness.close();
    }
  });

  it("converges concurrent duplicate registration to one openMeldServiceRuntimeId", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const runtimeLookupInput = lookupInput();
      const results = await Promise.all([
        registerRuntimeRegistryRecord({
          db: harness.db,
          record: {
            nowMs: 100,
            openMeldServiceRuntimeId: openMeldServiceRuntimeId(
              runtimeLookupInput,
              "runtime_concurrent_a"
            ),
            runtimeLookupInput,
          },
        }),
        registerRuntimeRegistryRecord({
          db: harness.db,
          record: {
            nowMs: 101,
            openMeldServiceRuntimeId: openMeldServiceRuntimeId(
              runtimeLookupInput,
              "runtime_concurrent_b"
            ),
            runtimeLookupInput,
          },
        }),
      ]);

      const values = results.map((result) =>
        result.status === "created" || result.status === "reused"
          ? result.openMeldServiceRuntimeId.value
          : result.status
      );
      expect(new Set(values).size).toBe(1);
      const rows = harness.queryAll<{ openmeld_service_runtime_id: string }>({
        sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_registry_records",
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.openmeld_service_runtime_id).toBe(values[0]);
      expect(results.map((result) => result.status).sort()).toEqual([
        "created",
        "reused",
      ]);
    } finally {
      harness.close();
    }
  });

  it("reports a conflict when an opaque openMeldServiceRuntimeId collides with another identity", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const firstLookup = lookupInput();
      const secondLookup = lookupInput({ lane: "openmeld-canary" });
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: openMeldServiceRuntimeId(
            firstLookup,
            "runtime_collision"
          ),
          runtimeLookupInput: firstLookup,
        },
      });

      await expect(
        registerRuntimeRegistryRecord({
          db: harness.db,
          record: {
            nowMs: 200,
            openMeldServiceRuntimeId: openMeldServiceRuntimeId(
              secondLookup,
              "runtime_collision"
            ),
            runtimeLookupInput: secondLookup,
          },
        })
      ).resolves.toEqual({
        status: "conflict",
        reason: "openmeld_service_runtime_id_collision",
      });
    } finally {
      harness.close();
    }
  });

  it("blocks forgotten owner-account devices without creating Runtime Registry truth", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const runtimeLookupInput = lookupInput();
      harness.run({
        sql: `
          INSERT INTO openMeldDaemon_forgotten_devices (
            owner_user_id,
            device_id,
            forgotten_at_ms,
            updated_at_ms
          )
          VALUES (?, ?, ?, ?)
        `,
        params: ["owner-1", "device-1", 100, 100],
      });

      await expect(
        registerRuntimeRegistryRecord({
          db: harness.db,
          record: {
            nowMs: 200,
            openMeldServiceRuntimeId: openMeldServiceRuntimeId(
              runtimeLookupInput,
              "runtime_forgotten"
            ),
            runtimeLookupInput,
          },
        })
      ).resolves.toEqual({
        status: "conflict",
        reason: "device_forgotten",
      });
      expect(
        harness.queryAll<{ openmeld_service_runtime_id: string }>({
          sql: "SELECT openmeld_service_runtime_id FROM openMeldDaemon_runtime_registry_records",
        })
      ).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("does not refresh an existing Runtime Registry row after the device is forgotten", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const runtimeLookupInput = lookupInput();
      await registerRuntimeRegistryRecord({
        db: harness.db,
        record: {
          nowMs: 100,
          openMeldServiceRuntimeId: openMeldServiceRuntimeId(
            runtimeLookupInput,
            "runtime_before_forget"
          ),
          runtimeLookupInput,
        },
      });
      harness.run({
        sql: `
          INSERT INTO openMeldDaemon_forgotten_devices (
            owner_user_id,
            device_id,
            forgotten_at_ms,
            updated_at_ms
          )
          VALUES (?, ?, ?, ?)
        `,
        params: ["owner-1", "device-1", 150, 150],
      });

      await expect(
        registerRuntimeRegistryRecord({
          db: harness.db,
          record: {
            nowMs: 200,
            openMeldServiceRuntimeId: openMeldServiceRuntimeId(
              runtimeLookupInput,
              "runtime_after_forget"
            ),
            runtimeLookupInput,
          },
        })
      ).resolves.toEqual({
        status: "conflict",
        reason: "device_forgotten",
      });
      expect(
        harness.queryAll<{
          last_registered_at_ms: number;
          openmeld_service_runtime_id: string;
          updated_at_ms: number;
        }>({
          sql: `
            SELECT openmeld_service_runtime_id, last_registered_at_ms, updated_at_ms
            FROM openMeldDaemon_runtime_registry_records
          `,
        })
      ).toEqual([
        {
          openmeld_service_runtime_id: "runtime_before_forget",
          last_registered_at_ms: 100,
          updated_at_ms: 100,
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("rejects stored lookup-derived openMeldServiceRuntimeId values during lookup", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldDaemon_runtime_registry_records"
    );
    try {
      const runtimeLookupInput = lookupInput();
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        params: [
          "owner_account:owner-1:device-1:openmeld-dev",
          "owner_account",
          "owner-1",
          "device-1",
          "openmeld-dev",
          100,
          100,
          100,
        ],
      });

      await expect(
        readRuntimeRegistryRecord({
          db: harness.db,
          runtimeLookupInput,
        })
      ).resolves.toEqual({
        status: "conflict",
        reason: "openmeld_service_runtime_id_not_opaque",
      });
    } finally {
      harness.close();
    }
  });
});
