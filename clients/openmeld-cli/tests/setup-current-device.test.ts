import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  collectObservedDeviceMetadataMock,
  createCliApiClientFoundationMock,
  createCurrentDeviceApiMock,
  readDaemonServiceContractMock,
  enrollLocalRuntimeMock,
  upsertDaemonServiceContractMock,
  writeObservedMetadataMock,
} = vi.hoisted(() => ({
  collectObservedDeviceMetadataMock: vi.fn(),
  createCliApiClientFoundationMock: vi.fn(),
  createCurrentDeviceApiMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  enrollLocalRuntimeMock: vi.fn(),
  upsertDaemonServiceContractMock: vi.fn(),
  writeObservedMetadataMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createCurrentDeviceApi: createCurrentDeviceApiMock,
}));

vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: readDaemonServiceContractMock,
  upsertDaemonServiceContract: upsertDaemonServiceContractMock,
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: createCliApiClientFoundationMock,
}));

vi.mock("../src/system/observed-device-metadata", () => ({
  collectObservedDeviceMetadata: collectObservedDeviceMetadataMock,
}));

const { syncLocalSetupCurrentDeviceTargetFromServiceContract } = await import(
  "../src/commands/setup-current-device"
);

describe("syncLocalSetupCurrentDeviceTargetFromServiceContract", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    createCliApiClientFoundationMock.mockReturnValue({
      gatewayUrl: "https://gateway.openmeld.test",
    });
    createCurrentDeviceApiMock.mockReturnValue({
      enrollLocalRuntime: enrollLocalRuntimeMock,
      writeObservedMetadata: writeObservedMetadataMock,
    });
    collectObservedDeviceMetadataMock.mockResolvedValue({
      deviceType: "desktop",
      platformFamily: "macos",
    });
    readDaemonServiceContractMock.mockResolvedValue({
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      autoStart: true,
      bundleId: "bundle-1",
      connectedComputerId: "connected-from-previous-account",
      daemonVersion: "0.6.9",
      desiredState: "background",
      deviceId: "device-local",
      gatewayUrl: "https://gateway.openmeld.test",
      generation: 12,
      heartbeatMs: 25_000,
      lane: "dev-local",
      ownerUserId: "owner-current",
      profileId: "profile-from-previous-account",
      serviceController: "launchd",
      updatedAt: "2026-05-30T00:00:00.000Z",
    });
    enrollLocalRuntimeMock.mockResolvedValue({
      connectedComputerId: "connected-for-current-account",
      deviceId: "device-local",
      runtimeLane: "dev-local",
    });
  });

  it("does not submit cached connected computer identity across account switches", async () => {
    await expect(
      syncLocalSetupCurrentDeviceTargetFromServiceContract({
        gatewayUrl: "https://gateway.openmeld.test",
      })
    ).resolves.toEqual({
      deviceId: "device-local",
      runtimeLane: "dev-local",
    });

    expect(enrollLocalRuntimeMock).toHaveBeenCalledWith({
      deviceId: "device-local",
      runtimeLane: "dev-local",
    });
    expect(upsertDaemonServiceContractMock).toHaveBeenCalledWith({
      autoStart: true,
      bundleId: "bundle-1",
      connectedComputerId: "connected-for-current-account",
      daemonVersion: "0.6.9",
      desiredState: "background",
      deviceId: "device-local",
      gatewayUrl: "https://gateway.openmeld.test",
      heartbeatMs: 25_000,
      lane: "dev-local",
      ownerUserId: "owner-current",
      profileId: "profile-from-previous-account",
      serviceController: "launchd",
    });
  });

  it("reconnects to the computer selected by the trusted Prepare Session", async () => {
    await syncLocalSetupCurrentDeviceTargetFromServiceContract({
      connectedComputerId: "connected-from-prepare-session",
      gatewayUrl: "https://gateway.openmeld.test",
    });

    expect(enrollLocalRuntimeMock).toHaveBeenCalledWith({
      connectedComputerId: "connected-from-prepare-session",
      deviceId: "device-local",
      runtimeLane: "dev-local",
    });
  });

  it.each([
    "collection",
    "reporting",
  ])("preserves enrolled identity when optional metadata %s fails", async (stage) => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const failure = new Error("private diagnostic payload must not leak");
    (stage === "collection"
      ? collectObservedDeviceMetadataMock
      : writeObservedMetadataMock
    ).mockRejectedValueOnce(failure);
    await expect(
      syncLocalSetupCurrentDeviceTargetFromServiceContract({
        gatewayUrl: "https://gateway.openmeld.test",
      })
    ).resolves.toEqual({ deviceId: "device-local", runtimeLane: "dev-local" });
    expect(upsertDaemonServiceContractMock).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.stringify(warning.mock.calls)).not.toContain(failure.message);
  });

  it.each([
    "enrollment",
    "identity persistence",
  ])("still rejects necessary %s failures before collecting metadata", async (stage) => {
    const failure = new Error("Required identity step failed");
    (stage === "enrollment"
      ? enrollLocalRuntimeMock
      : upsertDaemonServiceContractMock
    ).mockRejectedValueOnce(failure);
    await expect(
      syncLocalSetupCurrentDeviceTargetFromServiceContract({
        gatewayUrl: "https://gateway.openmeld.test",
      })
    ).rejects.toBe(failure);
    expect(collectObservedDeviceMetadataMock).not.toHaveBeenCalled();
    expect(writeObservedMetadataMock).not.toHaveBeenCalled();
  });
});
