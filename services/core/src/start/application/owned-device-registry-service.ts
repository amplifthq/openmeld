import { writeCurrentDeviceObservedMetadataResponseSchema } from "@openmeld/schemas";
import type {
  LocalRuntimeComputer,
  ObservedDeviceMetadata,
  WriteCurrentDeviceObservedMetadataResponse,
} from "@openmeld/schemas/types";

// TODO(2026-05-15): Rename this storage-only legacy record to Local Runtime
// registry terminology after the public Local Runtime contract remains stable.
// Public API/read models must not revive Owned Device response shapes.
export type OwnedDeviceRegistryRecord = {
  ownerUserId: string;
  deviceId: string;
  connectedComputerId?: string | null;
  observedDisplayName: string | null;
  userDisplayName: string | null;
  platformFamily: LocalRuntimeComputer["platformFamily"] | null;
  osVersion: string | null;
  deviceType: "laptop" | "desktop" | "server" | "unknown" | null;
  firstSeenAtMs: number;
  lastObservedAtMs: number | null;
  updatedAtMs: number;
};

export type OwnedDeviceRegistryStore = {
  readForgottenDevice(input: {
    userId: string;
    deviceId: string;
  }): Promise<{ deviceId: string } | null>;
  readOwnedDeviceRegistryRecord(input: {
    userId: string;
    deviceId: string;
  }): Promise<OwnedDeviceRegistryRecord | null>;
  upsertOwnedDeviceRegistryRecord(input: {
    record: OwnedDeviceRegistryRecord;
  }): Promise<void>;
};

export async function ensureOwnedDevicePlaceholderUseCase(input: {
  store: OwnedDeviceRegistryStore;
  userId: string;
  deviceId: string;
  now?: Date;
}): Promise<OwnedDeviceRegistryRecord> {
  const existing = await input.store.readOwnedDeviceRegistryRecord({
    userId: input.userId,
    deviceId: input.deviceId,
  });
  if (existing) {
    return existing;
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const record: OwnedDeviceRegistryRecord = {
    ownerUserId: input.userId,
    deviceId: input.deviceId,
    observedDisplayName: null,
    userDisplayName: null,
    platformFamily: null,
    osVersion: null,
    deviceType: null,
    firstSeenAtMs: nowMs,
    lastObservedAtMs: null,
    updatedAtMs: nowMs,
  };

  await input.store.upsertOwnedDeviceRegistryRecord({
    record,
  });

  return record;
}

export async function mergeOwnedDeviceObservedMetadataUseCase(input: {
  store: OwnedDeviceRegistryStore;
  userId: string;
  deviceId: string;
  observedDisplayName?: string | null;
  platformFamily?: LocalRuntimeComputer["platformFamily"] | null;
  osVersion?: string | null;
  deviceType?: OwnedDeviceRegistryRecord["deviceType"];
  observedAtMs: number;
  now?: Date;
}): Promise<OwnedDeviceRegistryRecord> {
  const existing = await input.store.readOwnedDeviceRegistryRecord({
    userId: input.userId,
    deviceId: input.deviceId,
  });
  const nowMs = (input.now ?? new Date()).getTime();

  const record: OwnedDeviceRegistryRecord =
    existing === null
      ? {
          ownerUserId: input.userId,
          deviceId: input.deviceId,
          connectedComputerId: null,
          observedDisplayName: input.observedDisplayName ?? null,
          userDisplayName: null,
          platformFamily: input.platformFamily ?? null,
          osVersion: input.osVersion ?? null,
          deviceType: input.deviceType ?? null,
          firstSeenAtMs: input.observedAtMs,
          lastObservedAtMs: input.observedAtMs,
          updatedAtMs: nowMs,
        }
      : {
          ownerUserId: existing.ownerUserId,
          deviceId: existing.deviceId,
          connectedComputerId: existing.connectedComputerId,
          observedDisplayName:
            input.observedDisplayName === undefined
              ? existing.observedDisplayName
              : input.observedDisplayName,
          userDisplayName: existing.userDisplayName,
          platformFamily:
            input.platformFamily === undefined
              ? existing.platformFamily
              : input.platformFamily,
          osVersion:
            input.osVersion === undefined
              ? existing.osVersion
              : input.osVersion,
          deviceType:
            input.deviceType === undefined
              ? existing.deviceType
              : input.deviceType,
          firstSeenAtMs: existing.firstSeenAtMs,
          lastObservedAtMs:
            existing.lastObservedAtMs === null
              ? input.observedAtMs
              : Math.max(existing.lastObservedAtMs, input.observedAtMs),
          updatedAtMs: nowMs,
        };

  await input.store.upsertOwnedDeviceRegistryRecord({
    record,
  });

  return record;
}

export async function writeCurrentDeviceObservedMetadataUseCase(input: {
  store: OwnedDeviceRegistryStore;
  userId: string;
  deviceId: string;
  metadata: ObservedDeviceMetadata;
  now?: Date;
}): Promise<WriteCurrentDeviceObservedMetadataResponse> {
  const forgotten = await input.store.readForgottenDevice({
    userId: input.userId,
    deviceId: input.deviceId,
  });
  if (forgotten) {
    console.info("[core.current_device.forgotten_observation_ignored]", {
      event: "current_device.forgotten_observation_ignored",
      userId: input.userId,
      deviceId: input.deviceId,
    });
    return buildWriteCurrentDeviceObservedMetadataResponse(input.metadata);
  }

  await mergeOwnedDeviceObservedMetadataUseCase({
    store: input.store,
    userId: input.userId,
    deviceId: input.deviceId,
    observedDisplayName: input.metadata.observedDisplayName,
    platformFamily: input.metadata.platformFamily,
    osVersion: input.metadata.osVersion,
    deviceType: input.metadata.deviceType,
    observedAtMs: input.metadata.observedAtMs,
    now: input.now,
  });

  return buildWriteCurrentDeviceObservedMetadataResponse(input.metadata);
}

function buildWriteCurrentDeviceObservedMetadataResponse(
  metadata: ObservedDeviceMetadata
): WriteCurrentDeviceObservedMetadataResponse {
  const parsed = writeCurrentDeviceObservedMetadataResponseSchema.safeParse({
    metadata,
  });
  if (!parsed.success) {
    throw new Error(
      `failed to build current device observed metadata response: ${parsed.error.message}`
    );
  }
  return parsed.data;
}
