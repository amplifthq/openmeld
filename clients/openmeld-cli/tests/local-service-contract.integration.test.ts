import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { LocalRuntimeEnrollmentResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { syncLocalSetupCurrentDeviceTargetFromServiceContract } from "../src/commands/setup-current-device";
import { setAuthSession } from "../src/config/auth-session";
import {
  clearDaemonServiceContract,
  daemonServiceContractPath,
  isDaemonServiceContractIdentityReusable,
  isUnsafeProductionDaemonServiceContractIdentity,
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../src/config/daemon-service-contract";
import {
  daemonRuntimeStateRootPath,
  withDaemonServiceLifecycleLock,
} from "../src/config/daemon-state";
import { collectObservedDeviceMetadata } from "../src/system/observed-device-metadata";
import { withTempHome } from "./helpers/fs";

vi.mock("../src/system/observed-device-metadata", () => ({
  collectObservedDeviceMetadata: vi.fn(),
}));

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

  it("keeps the running generation for first enrollment of the same owned runtime, but fences replacement identity", async () => {
    await withTempHome(async () => {
      const running = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        ownerUserId: "owner-current",
        deviceId: "device-current",
        heartbeatMs: 5000,
      });
      const enrolled = await upsertDaemonServiceContract({
        ...running,
        connectedComputerId: "computer-current",
      });
      expect(enrolled.generation).toBe(running.generation);
      expect(enrolled.connectedComputerId).toBe("computer-current");
      const replaced = await upsertDaemonServiceContract({
        ...enrolled,
        connectedComputerId: "computer-replacement",
      });
      expect(replaced.generation).toBe(enrolled.generation + 1);
      const accountSwitch = await upsertDaemonServiceContract({
        ...replaced,
        ownerUserId: "owner-other",
        connectedComputerId: "computer-other",
      });
      expect(accountSwitch.generation).toBe(replaced.generation + 1);
    });
  });

  it.each([
    "account before request",
    "gateway before request",
    "account during request",
    "owner",
    "device",
    "lane",
    "gateway",
    "stop",
    "generation",
    "first enrollment",
  ])("rejects a late enrollment after %s changes", async (change) => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const signIn = async (
        id: string,
        authBaseUrl = "https://auth.openmeld.invalid"
      ) =>
        await setAuthSession({
          accessToken: `test-token-${id}`,
          tokenType: "Bearer",
          authBaseUrl,
          clientId: "openmeld-cli-dev",
          user: { id, email: `${id}@example.invalid` },
        });
      await signIn("owner-current");
      const running = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "https://gateway.openmeld.invalid",
        ownerUserId: "owner-current",
        deviceId: "device-current",
        heartbeatMs: 5000,
      });
      let preserved = running;
      if (change === "account before request") {
        await signIn("owner-other");
      }
      if (change === "gateway before request") {
        await signIn("owner-current", "https://auth.other.invalid");
      }
      const metadata = vi.mocked(collectObservedDeviceMetadata);
      const transport = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => {
          if (change === "account during request") {
            await signIn("owner-other");
          } else if (change !== "account before request") {
            await withDaemonServiceLifecycleLock(
              {
                intent: "upgrade_reconcile",
                command: "test concurrent Service change",
              },
              async () => {
                if (change === "generation") {
                  await upsertDaemonServiceContract({
                    ...running,
                    heartbeatMs: 6000,
                  });
                  preserved = await upsertDaemonServiceContract(running);
                } else {
                  preserved = await upsertDaemonServiceContract({
                    ...running,
                    ...(change === "owner"
                      ? { ownerUserId: "owner-other" }
                      : {}),
                    ...(change === "device"
                      ? { deviceId: "device-other" }
                      : {}),
                    ...(change === "lane" ? { lane: "canary" as const } : {}),
                    ...(change === "gateway"
                      ? { gatewayUrl: "https://other.invalid" }
                      : {}),
                    ...(change === "stop"
                      ? { desiredState: "stopped" as const, autoStart: false }
                      : {}),
                    ...(change === "first enrollment"
                      ? { connectedComputerId: "computer-newer" }
                      : {}),
                  });
                }
              }
            );
          }
          return Response.json({
            deviceId: "device-current",
            runtimeLane: "dev-local",
            connectedComputerId: "computer-late",
          } satisfies LocalRuntimeEnrollmentResponse);
        });
      try {
        await expect(
          syncLocalSetupCurrentDeviceTargetFromServiceContract({
            gatewayUrl:
              change === "gateway before request"
                ? "https://gateway.other.invalid"
                : running.gatewayUrl,
          })
        ).rejects.toThrow();
        expect(await readDaemonServiceContract()).toEqual(preserved);
        if (change.endsWith("before request")) {
          expect(transport).not.toHaveBeenCalled();
        }
        expect(metadata).not.toHaveBeenCalled();
      } finally {
        transport.mockRestore();
        metadata.mockReset();
      }
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
