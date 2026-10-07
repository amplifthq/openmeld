import { describe, expect, it } from "vitest";
import {
  listOwnedDeviceRegistryRecords,
  listOwnedDeviceRegistryRecordsForUsers,
  readOwnedDeviceRegistryRecord,
  upsertOwnedDeviceRegistryRecord,
} from "../src/start/infrastructure/postgresql/owned-device-registry-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("owned device registry repo write-side", () => {
  it("writes and reads a canonical owned device registry row", async () => {
    const harness = await createPostgresHarness();
    try {
      await upsertOwnedDeviceRegistryRecord({
        db: harness.db,
        record: {
          ownerUserId: "owner-1",
          deviceId: "device-1",
          observedDisplayName: "Felix's MacBook Pro",
          userDisplayName: null,
          platformFamily: "macOS",
          osVersion: "15.0",
          deviceType: "laptop",
          firstSeenAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
          lastObservedAtMs: Date.parse("2026-04-14T09:05:00.000Z"),
          updatedAtMs: Date.parse("2026-04-14T09:05:00.000Z"),
        },
      });

      await expect(
        readOwnedDeviceRegistryRecord({
          db: harness.db,
          userId: "owner-1",
          deviceId: "device-1",
        })
      ).resolves.toEqual({
        ownerUserId: "owner-1",
        deviceId: "device-1",
        connectedComputerId: null,
        observedDisplayName: "Felix's MacBook Pro",
        userDisplayName: null,
        platformFamily: "macOS",
        osVersion: "15.0",
        deviceType: "laptop",
        firstSeenAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
        lastObservedAtMs: Date.parse("2026-04-14T09:05:00.000Z"),
        updatedAtMs: Date.parse("2026-04-14T09:05:00.000Z"),
      });
    } finally {
      await harness.close();
    }
  });

  it("lists owned device registry rows ordered by updatedAtMs descending", async () => {
    const harness = await createPostgresHarness();
    try {
      await upsertOwnedDeviceRegistryRecord({
        db: harness.db,
        record: {
          ownerUserId: "owner-1",
          deviceId: "device-older",
          observedDisplayName: null,
          userDisplayName: null,
          platformFamily: null,
          osVersion: null,
          deviceType: null,
          firstSeenAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
          lastObservedAtMs: null,
          updatedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
        },
      });
      await upsertOwnedDeviceRegistryRecord({
        db: harness.db,
        record: {
          ownerUserId: "owner-1",
          deviceId: "device-newer",
          observedDisplayName: "Office Mac mini",
          userDisplayName: null,
          platformFamily: "macOS",
          osVersion: "15.0",
          deviceType: "desktop",
          firstSeenAtMs: Date.parse("2026-04-14T09:10:00.000Z"),
          lastObservedAtMs: Date.parse("2026-04-14T09:10:00.000Z"),
          updatedAtMs: Date.parse("2026-04-14T09:10:00.000Z"),
        },
      });

      await expect(
        listOwnedDeviceRegistryRecords({
          db: harness.db,
          userId: "owner-1",
        })
      ).resolves.toEqual([
        {
          ownerUserId: "owner-1",
          deviceId: "device-newer",
          connectedComputerId: null,
          observedDisplayName: "Office Mac mini",
          userDisplayName: null,
          platformFamily: "macOS",
          osVersion: "15.0",
          deviceType: "desktop",
          firstSeenAtMs: Date.parse("2026-04-14T09:10:00.000Z"),
          lastObservedAtMs: Date.parse("2026-04-14T09:10:00.000Z"),
          updatedAtMs: Date.parse("2026-04-14T09:10:00.000Z"),
        },
        {
          ownerUserId: "owner-1",
          deviceId: "device-older",
          connectedComputerId: null,
          observedDisplayName: null,
          userDisplayName: null,
          platformFamily: null,
          osVersion: null,
          deviceType: null,
          firstSeenAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
          lastObservedAtMs: null,
          updatedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
        },
      ]);
      const records = await listOwnedDeviceRegistryRecordsForUsers({
        db: harness.db,
        userIds: ["owner-1", "missing-owner"],
      });
      expect(
        records.map((record) => [record.ownerUserId, record.deviceId])
      ).toEqual([
        ["owner-1", "device-newer"],
        ["owner-1", "device-older"],
      ]);
      expect(
        await listOwnedDeviceRegistryRecordsForUsers({
          db: harness.db,
          userIds: ["other-owner"],
        })
      ).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
