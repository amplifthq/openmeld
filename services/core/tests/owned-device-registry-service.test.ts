import { describe, expect, it } from "vitest";
import {
  ensureOwnedDevicePlaceholderUseCase,
  mergeOwnedDeviceObservedMetadataUseCase,
  writeCurrentDeviceObservedMetadataUseCase,
} from "../src/start/application/owned-device-registry-service";

describe("owned device registry service", () => {
  it("creates a placeholder registry row when the device is first selected", async () => {
    const store = createInMemoryOwnedDeviceRegistryStore();

    await expect(
      ensureOwnedDevicePlaceholderUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-1",
        now: new Date("2026-04-14T09:00:00.000Z"),
      })
    ).resolves.toEqual({
      ownerUserId: "owner-1",
      deviceId: "device-1",
      observedDisplayName: null,
      userDisplayName: null,
      platformFamily: null,
      osVersion: null,
      deviceType: null,
      firstSeenAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
      lastObservedAtMs: null,
      updatedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
    });
  });

  it("merges observed metadata without overwriting firstSeen or userDisplayName", async () => {
    const store = createInMemoryOwnedDeviceRegistryStore({
      rows: [
        {
          ownerUserId: "owner-1",
          deviceId: "device-1",
          observedDisplayName: "Old machine name",
          userDisplayName: "Work Laptop",
          platformFamily: "macOS",
          osVersion: "14.6",
          deviceType: "laptop",
          firstSeenAtMs: Date.parse("2026-04-14T08:00:00.000Z"),
          lastObservedAtMs: Date.parse("2026-04-14T08:30:00.000Z"),
          updatedAtMs: Date.parse("2026-04-14T08:30:00.000Z"),
        },
      ],
    });

    await expect(
      mergeOwnedDeviceObservedMetadataUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-1",
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.0",
        deviceType: "laptop",
        observedAtMs: Date.parse("2026-04-14T08:10:00.000Z"),
        now: new Date("2026-04-14T09:00:00.000Z"),
      })
    ).resolves.toEqual({
      ownerUserId: "owner-1",
      deviceId: "device-1",
      observedDisplayName: "Felix's MacBook Pro",
      userDisplayName: "Work Laptop",
      platformFamily: "macOS",
      osVersion: "15.0",
      deviceType: "laptop",
      firstSeenAtMs: Date.parse("2026-04-14T08:00:00.000Z"),
      lastObservedAtMs: Date.parse("2026-04-14T08:30:00.000Z"),
      updatedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
    });
  });

  it("uses the first real observed timestamp after a placeholder row already exists", async () => {
    const store = createInMemoryOwnedDeviceRegistryStore({
      rows: [
        {
          ownerUserId: "owner-1",
          deviceId: "device-1",
          observedDisplayName: null,
          userDisplayName: null,
          platformFamily: null,
          osVersion: null,
          deviceType: null,
          firstSeenAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
          lastObservedAtMs: null,
          updatedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
        },
      ],
    });

    await expect(
      mergeOwnedDeviceObservedMetadataUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-1",
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.0",
        deviceType: "laptop",
        observedAtMs: Date.parse("2026-04-14T08:45:00.000Z"),
        now: new Date("2026-04-14T09:05:00.000Z"),
      })
    ).resolves.toEqual({
      ownerUserId: "owner-1",
      deviceId: "device-1",
      observedDisplayName: "Felix's MacBook Pro",
      userDisplayName: null,
      platformFamily: "macOS",
      osVersion: "15.0",
      deviceType: "laptop",
      firstSeenAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
      lastObservedAtMs: Date.parse("2026-04-14T08:45:00.000Z"),
      updatedAtMs: Date.parse("2026-04-14T09:05:00.000Z"),
    });
  });

  it("returns the canonical observed metadata write response", async () => {
    const store = createInMemoryOwnedDeviceRegistryStore();

    await expect(
      writeCurrentDeviceObservedMetadataUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-1",
        metadata: {
          observedDisplayName: "Felix's MacBook Pro",
          platformFamily: "macOS",
          osVersion: "15.4",
          deviceType: "laptop",
          observedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
        },
        now: new Date("2026-04-14T09:01:00.000Z"),
      })
    ).resolves.toEqual({
      metadata: {
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.4",
        deviceType: "laptop",
        observedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
      },
    });
  });

  it("ignores current computer metadata writes for forgotten devices", async () => {
    const store = createInMemoryOwnedDeviceRegistryStore({
      forgottenDevices: [{ userId: "owner-1", deviceId: "device-1" }],
    });

    await expect(
      writeCurrentDeviceObservedMetadataUseCase({
        store,
        userId: "owner-1",
        deviceId: "device-1",
        metadata: {
          observedDisplayName: "Felix's MacBook Pro",
          platformFamily: "macOS",
          osVersion: "15.4",
          deviceType: "laptop",
          observedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
        },
        now: new Date("2026-04-14T09:01:00.000Z"),
      })
    ).resolves.toEqual({
      metadata: {
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.4",
        deviceType: "laptop",
        observedAtMs: Date.parse("2026-04-14T09:00:00.000Z"),
      },
    });

    await expect(
      store.readOwnedDeviceRegistryRecord({
        userId: "owner-1",
        deviceId: "device-1",
      })
    ).resolves.toBeNull();
  });
});

type OwnedDeviceRegistryRow = {
  ownerUserId: string;
  deviceId: string;
  observedDisplayName: string | null;
  userDisplayName: string | null;
  platformFamily: "macOS" | "Windows" | "Linux" | "Unknown" | null;
  osVersion: string | null;
  deviceType: "laptop" | "desktop" | "server" | "unknown" | null;
  firstSeenAtMs: number;
  lastObservedAtMs: number | null;
  updatedAtMs: number;
};

function createInMemoryOwnedDeviceRegistryStore(input?: {
  forgottenDevices?: readonly {
    userId: string;
    deviceId: string;
  }[];
  rows?: readonly OwnedDeviceRegistryRow[];
}): {
  readOwnedDeviceRegistryRecord(input: {
    userId: string;
    deviceId: string;
  }): Promise<OwnedDeviceRegistryRow | null>;
  readForgottenDevice(input: {
    userId: string;
    deviceId: string;
  }): Promise<{ deviceId: string } | null>;
  upsertOwnedDeviceRegistryRecord(input: {
    record: OwnedDeviceRegistryRow;
  }): Promise<void>;
} {
  const rows = new Map<string, OwnedDeviceRegistryRow>(
    (input?.rows ?? []).map((row) => [buildOwnedDeviceRegistryKey(row), row])
  );
  const forgottenDevices = new Set(
    (input?.forgottenDevices ?? []).map((entry) =>
      buildOwnedDeviceRegistryKey({
        ownerUserId: entry.userId,
        deviceId: entry.deviceId,
      })
    )
  );

  return {
    readOwnedDeviceRegistryRecord: async (input) =>
      rows.get(`${input.userId}:${input.deviceId}`) ?? null,
    readForgottenDevice: async (input) =>
      forgottenDevices.has(
        buildOwnedDeviceRegistryKey({
          ownerUserId: input.userId,
          deviceId: input.deviceId,
        })
      )
        ? { deviceId: input.deviceId }
        : null,
    upsertOwnedDeviceRegistryRecord: (input) => {
      rows.set(buildOwnedDeviceRegistryKey(input.record), input.record);
      return Promise.resolve();
    },
  };
}

function buildOwnedDeviceRegistryKey(input: {
  ownerUserId: string;
  deviceId: string;
}): string {
  return `${input.ownerUserId}:${input.deviceId}`;
}
