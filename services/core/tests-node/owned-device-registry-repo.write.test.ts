import { describe, expect, it } from "vitest";
import {
  listOwnedDeviceRegistryRecords,
  readOwnedDeviceRegistryRecord,
  upsertOwnedDeviceRegistryRecord,
} from "../src/start/infrastructure/d1/owned-device-registry-repo";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("owned device registry repo write-side", () => {
  it("writes and reads a canonical owned device registry row", async () => {
    const harness = createSqliteD1Harness();
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
      harness.close();
    }
  });

  it("lists owned device registry rows ordered by updatedAtMs descending", async () => {
    const harness = createSqliteD1Harness();
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
    } finally {
      harness.close();
    }
  });
});
