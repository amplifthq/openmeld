import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearDaemonServiceContract,
  daemonServiceContractPath,
  isDaemonServiceContractIdentityReusable,
  isUnsafeProductionDaemonServiceContractIdentity,
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../src/config/daemon-service-contract";
import { daemonRuntimeStateRootPath } from "../src/config/daemon-state";
import { withTempHome } from "./helpers/fs";

describe("local service contract store", () => {
  it("classifies known production fixture identities as unsafe", () => {
    expect(
      isUnsafeProductionDaemonServiceContractIdentity({
        lane: "prod",
        profileId: "2a6552de-1198-4671-b93c-ef1a423ee03b",
        deviceId: "device_123",
      })
    ).toBe(true);
    expect(
      isUnsafeProductionDaemonServiceContractIdentity({
        lane: "prod",
        profileId: "agt_existing",
        deviceId: "real-device-id",
      })
    ).toBe(true);
    expect(
      isUnsafeProductionDaemonServiceContractIdentity({
        lane: "prod",
        profileId: "11111111-1111-4111-8111-111111111111",
        deviceId: "real-device-id",
      })
    ).toBe(true);
    expect(
      isUnsafeProductionDaemonServiceContractIdentity({
        lane: "dev-local",
        profileId: "agt_existing",
        deviceId: "device_123",
      })
    ).toBe(false);
  });

  it("reuses only same-lane non-fixture service contract identity", () => {
    const pathInput = {
      env: {
        OPENMELD_ENV_PRESET: "prod",
      } satisfies NodeJS.ProcessEnv,
    };

    expect(
      isDaemonServiceContractIdentityReusable(
        {
          lane: "prod",
          profileId: "2a6552de-1198-4671-b93c-ef1a423ee03b",
          deviceId: "real-device-id",
        },
        pathInput
      )
    ).toBe(true);
    expect(
      isDaemonServiceContractIdentityReusable(
        {
          lane: "prod",
          profileId: "2a6552de-1198-4671-b93c-ef1a423ee03b",
          deviceId: "device_123",
        },
        pathInput
      )
    ).toBe(false);
    expect(
      isDaemonServiceContractIdentityReusable(
        {
          lane: "dev-local",
          profileId: "agt_dev",
          deviceId: "real-device-id",
        },
        pathInput
      )
    ).toBe(false);
  });

  it("refuses to mutate the published production lane during tests", async () => {
    const productionPathInput = {
      env: {
        ...process.env,
        OPENMELD_HOME: "",
        OPENMELD_ENV_PRESET: "prod",
        NODE_ENV: "test",
      },
      homeDir: homedir(),
      argv: ["openmeld"],
    };

    await expect(
      upsertDaemonServiceContract(
        {
          daemonVersion: "0.2.6",
          bundleId: "service-bundle-1",
          desiredState: "background",
          serviceController: "launchd",
          autoStart: true,
          gatewayUrl: "http://localhost:8080",
          profileId: "hum_felix",
          deviceId: "device_123",
          heartbeatMs: 5000,
        },
        productionPathInput
      )
    ).rejects.toThrow(
      "Refusing to mutate OpenMeld Service contract in the published production lane during tests."
    );

    await expect(
      clearDaemonServiceContract(productionPathInput)
    ).rejects.toThrow(
      "Refusing to mutate OpenMeld Service contract in the published production lane during tests."
    );
  });

  it("refuses production fixture identities outside isolated test roots", async () => {
    await withTempHome(async (home) => {
      await expect(
        upsertDaemonServiceContract(
          {
            daemonVersion: "0.2.6",
            bundleId: "service-bundle-1",
            desiredState: "background",
            serviceController: "launchd",
            autoStart: true,
            gatewayUrl: "https://gateway.openmeld.invalid",
            profileId: "agt_existing",
            deviceId: "device-123",
            heartbeatMs: 5000,
          },
          {
            env: {
              OPENMELD_HOME: join(home, ".openmeld"),
              OPENMELD_ENV_PRESET: "prod",
              NODE_ENV: "production",
            },
            homeDir: home,
            argv: ["openmeld"],
          }
        )
      ).rejects.toThrow(
        "Refusing to write OpenMeld Service contract with a test fixture identity in the published production lane."
      );
    });
  });

  it("writes contract into runtime local service state root", async () => {
    await withTempHome(async () => {
      const contract = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_123",
        heartbeatMs: 5000,
      });

      expect(daemonServiceContractPath()).toBe(
        join(daemonRuntimeStateRootPath(), "service-contract.json")
      );
      expect(contract.lane).toBe("prod");
      expect(contract.generation).toBe(1);
    });
  });

  it("does not require a profile because OpenMeld Service is a device-level carrier", async () => {
    await withTempHome(async () => {
      const contract = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      expect(contract.profileId).toBeUndefined();
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        deviceId: "device_local_runtime",
      });
    });
  });

  it("removes a legacy profile when the contract is rewritten as a device-level carrier", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_legacy",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      const rewritten = await upsertDaemonServiceContract({
        daemonVersion: "0.2.7",
        bundleId: "service-bundle-2",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      expect(rewritten.profileId).toBeUndefined();
      expect(rewritten.generation).toBe(2);
      await expect(readDaemonServiceContract()).resolves.not.toHaveProperty(
        "profileId"
      );
    });
  });

  it("stores connected computer enrollment evidence without replacing local device identity", async () => {
    await withTempHome(async () => {
      const contract = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_local_runtime",
        connectedComputerId: "computer_core_owned",
        heartbeatMs: 5000,
      });

      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        deviceId: "device_local_runtime",
        connectedComputerId: "computer_core_owned",
      });
      expect(contract.deviceId).toBe("device_local_runtime");
      expect(contract.connectedComputerId).toBe("computer_core_owned");
    });
  });

  it("preserves connected computer evidence across ordinary service contract rewrites", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_local_runtime",
        connectedComputerId: "computer_core_owned",
        heartbeatMs: 5000,
      });

      const rewritten = await upsertDaemonServiceContract({
        daemonVersion: "0.2.7",
        bundleId: "service-bundle-2",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      expect(rewritten.connectedComputerId).toBe("computer_core_owned");
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        connectedComputerId: "computer_core_owned",
      });
    });
  });

  it("stores owner evidence and treats owner changes as semantic contract changes", async () => {
    await withTempHome(async () => {
      const first = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        ownerUserId: "owner-old",
        profileId: "hum_old",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      const rewritten = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        ownerUserId: "owner-new",
        profileId: "hum_new",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      expect(first.ownerUserId).toBe("owner-old");
      expect(rewritten.ownerUserId).toBe("owner-new");
      expect(rewritten.generation).toBe(2);
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        ownerUserId: "owner-new",
        profileId: "hum_new",
      });
    });
  });

  it("does not carry connected computer evidence across owner changes", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        ownerUserId: "owner-old",
        profileId: "hum_old",
        deviceId: "device_local_runtime",
        connectedComputerId: "computer_old_account",
        heartbeatMs: 5000,
      });

      const rewritten = await upsertDaemonServiceContract({
        daemonVersion: "0.2.7",
        bundleId: "service-bundle-2",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        ownerUserId: "owner-new",
        profileId: "hum_new",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      expect(rewritten.connectedComputerId).toBeUndefined();
      await expect(readDaemonServiceContract()).resolves.not.toHaveProperty(
        "connectedComputerId"
      );
    });
  });

  it("preserves connected computer evidence when a legacy profile-scoped contract becomes device-scoped", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_legacy",
        deviceId: "device_local_runtime",
        connectedComputerId: "computer_core_owned",
        heartbeatMs: 5000,
      });

      const rewritten = await upsertDaemonServiceContract({
        daemonVersion: "0.2.7",
        bundleId: "service-bundle-2",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        deviceId: "device_local_runtime",
        heartbeatMs: 5000,
      });

      expect(rewritten.profileId).toBeUndefined();
      expect(rewritten.connectedComputerId).toBe("computer_core_owned");
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        connectedComputerId: "computer_core_owned",
      });
    });
  });

  it("keeps generation stable for semantic no-op writes and increments on real changes", async () => {
    await withTempHome(async () => {
      const first = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "stopped",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_123",
        heartbeatMs: 5000,
      });
      const second = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "stopped",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_123",
        heartbeatMs: 5000,
      });
      const third = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_123",
        heartbeatMs: 5000,
      });

      expect(second).toEqual(first);
      expect(third.generation).toBe(2);
      expect(third.desiredState).toBe("background");
    });
  });

  it("binds lane to resolveOpenMeldEnvPreset and leaves no temp files behind", async () => {
    await withTempHome(async (home) => {
      const pathInput = {
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
        } satisfies NodeJS.ProcessEnv,
        homeDir: home,
      };

      await upsertDaemonServiceContract(
        {
          daemonVersion: "0.2.6",
          bundleId: "service-bundle-1",
          desiredState: "background",
          serviceController: "launchd",
          autoStart: true,
          gatewayUrl: "http://localhost:8080",
          profileId: "hum_felix",
          deviceId: "device_123",
          heartbeatMs: 5000,
        },
        pathInput
      );

      const contract = await readDaemonServiceContract(pathInput);
      const entries = await readdir(daemonRuntimeStateRootPath(pathInput));
      expect(contract?.lane).toBe("dev-local");
      expect(entries.some((entry) => entry.includes(".tmp-"))).toBe(false);
    });
  });

  it("returns null for malformed files and clears state", async () => {
    await withTempHome(async () => {
      await mkdir(dirname(daemonServiceContractPath()), { recursive: true });
      await writeFile(daemonServiceContractPath(), "{bad-json", "utf8");
      expect(await readDaemonServiceContract()).toBeNull();

      await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "stopped",
        serviceController: "unknown",
        autoStart: false,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_123",
        heartbeatMs: 5000,
      });
      await clearDaemonServiceContract();
      expect(await readDaemonServiceContract()).toBeNull();
    });
  });
});
