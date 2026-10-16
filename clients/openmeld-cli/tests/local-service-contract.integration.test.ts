import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { LocalRuntimeEnrollmentResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { syncLocalSetupCurrentDeviceTargetFromServiceContract } from "../src/commands/setup-current-device";
import {
  beginAuthSessionTransition,
  getAuthSession,
  setAuthSession,
} from "../src/config/auth-session";
import {
  clearDaemonServiceContract,
  daemonServiceContractPath,
  isDaemonServiceContractIdentityReusable,
  isUnsafeProductionDaemonServiceContractIdentity,
  readDaemonServiceContract,
  restoreRefusedDaemonStopIntent,
  upsertDaemonServiceContract,
} from "../src/config/daemon-service-contract";
import {
  acquireDaemonServiceLifecycleLock,
  daemonRuntimeStateRootPath,
  releaseDaemonServiceLifecycleLock,
  withDaemonServiceLifecycleLock,
} from "../src/config/daemon-state";
import { resolveOpenMeldServiceOwnedPathInput } from "../src/config/paths";
import { writeDaemonServiceContract } from "../src/local-service/lifecycle/daemon-service-contract-writer";
import { collectObservedDeviceMetadata } from "../src/system/observed-device-metadata";
import { withTempHome } from "./helpers/fs";

vi.mock("../src/system/observed-device-metadata", () => ({
  collectObservedDeviceMetadata: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rename: vi.fn(original.rename) };
});

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
            if (change === "generation") {
              await upsertDaemonServiceContract({
                ...running,
                heartbeatMs: 6000,
              });
              preserved = await upsertDaemonServiceContract(running);
            } else {
              preserved = await upsertDaemonServiceContract({
                ...running,
                ...(change === "owner" ? { ownerUserId: "owner-other" } : {}),
                ...(change === "device" ? { deviceId: "device-other" } : {}),
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

  it.each([
    "owned",
    "non-owner",
    "replaced",
    "expired",
    "account changed",
  ])("keeps enrollment within its %s Computer auth transition", async (change) => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      const candidate = {
        accessToken: "test-candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli-dev",
        user: { id: "owner-current" },
        ...(change === "expired"
          ? { expiresAt: new Date(Date.now() - 60_000).toISOString() }
          : {}),
      };
      let transition = await beginAuthSessionTransition(candidate, {
        computerHandoff: {
          gatewayUrl: "https://gateway.openmeld.invalid",
          prepareContinuation: { prepareSessionId: "owned-prepare" },
        },
      });
      let settled = false;
      const running = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        ownerUserId: "owner-current",
        deviceId: "device-current",
        heartbeatMs: 5000,
      });
      let enrollmentRequested = false;
      const transport = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => {
          if (!enrollmentRequested) {
            enrollmentRequested = true;
            if (change === "replaced") {
              await transition.commit();
              settled = true;
              transition = await beginAuthSessionTransition(candidate, {
                computerHandoff: { gatewayUrl: running.gatewayUrl },
              });
              settled = false;
            } else if (change === "account changed") {
              await transition.commit();
              settled = true;
              await setAuthSession({
                ...candidate,
                user: { id: "owner-other" },
              });
            }
          }
          return Response.json({
            deviceId: "device-current",
            runtimeLane: "dev-local",
            connectedComputerId: "computer-enrolled",
          } satisfies LocalRuntimeEnrollmentResponse);
        });
      try {
        const enroll = () =>
          syncLocalSetupCurrentDeviceTargetFromServiceContract({
            gatewayUrl: running.gatewayUrl,
          });
        if (change === "non-owner") {
          const require = createRequire(import.meta.url);
          const vitestRequire = createRequire(
            require.resolve("vitest/package.json")
          );
          const loader = join(
            vitestRequire.resolve("tsx/package.json"),
            "..",
            "dist",
            "loader.mjs"
          );
          const moduleUrl = new URL(
            "../src/commands/setup-current-device.ts",
            import.meta.url
          ).href;
          const { stdout } = await promisify(execFile)(
            process.execPath,
            [
              "--import",
              loader,
              "--input-type=module",
              "--eval",
              `
              const { syncLocalSetupCurrentDeviceTargetFromServiceContract: enroll } = await import(${JSON.stringify(moduleUrl)});
              globalThis.fetch = async () => Response.json({ deviceId: "device-current", runtimeLane: "dev-local", connectedComputerId: "computer-foreign" });
              try { await enroll({ gatewayUrl: "https://gateway.openmeld.invalid" }); console.log(JSON.stringify({ status: "accepted" })); }
              catch { console.log(JSON.stringify({ status: "rejected" })); }
            `,
            ],
            { env: process.env, timeout: 10_000 }
          );
          expect(JSON.parse(stdout)).toEqual({ status: "rejected" });
        } else if (change === "owned") {
          await expect(enroll()).resolves.toEqual({
            deviceId: "device-current",
            runtimeLane: "dev-local",
          });
          expect(await readDaemonServiceContract()).toMatchObject({
            connectedComputerId: "computer-enrolled",
            generation: running.generation,
            ownerUserId: "owner-current",
          });
          const journal = JSON.parse(
            await readFile(
              join(home, ".openmeld", "auth", "session-transition.json"),
              "utf8"
            )
          );
          expect(journal.state).toBe("pending");
          await transition.commit();
          settled = true;
          expect((await getAuthSession())?.user?.id).toBe("owner-current");
        } else {
          await expect(enroll()).rejects.toThrow();
        }
        if (change !== "owned") {
          expect(await readDaemonServiceContract()).toEqual(running);
        }
      } finally {
        transport.mockRestore();
        if (!settled) {
          await transition.rollback();
        }
      }
    });
  });

  it.each([
    "install writer",
    "clear",
  ])("serializes %s at the enrollment rename boundary", async (operation) => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "test-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli-dev",
        user: { id: "owner-current" },
      });
      const running = await upsertDaemonServiceContract({
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        ownerUserId: "owner-current",
        deviceId: "device-current",
        heartbeatMs: 5000,
      });
      const originalFs =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises"
        );
      const reached = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      let paused = false;
      vi.mocked(rename).mockImplementation(async (from, to) => {
        if (!paused && to === daemonServiceContractPath()) {
          paused = true;
          reached.resolve();
          await resume.promise;
        }
        await originalFs.rename(from, to);
      });
      const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({
          deviceId: running.deviceId,
          runtimeLane: running.lane,
          connectedComputerId: "computer-enrolled",
        } satisfies LocalRuntimeEnrollmentResponse)
      );
      const enrollment = syncLocalSetupCurrentDeviceTargetFromServiceContract({
        gatewayUrl: running.gatewayUrl,
      });
      const newer = {
        ...running,
        bundleId: "newer-installed-bundle",
        daemonVersion: "0.2.7",
        desiredState: "stopped" as const,
      };
      try {
        await reached.promise;
        await expect(
          operation === "install writer"
            ? writeDaemonServiceContract(newer)
            : clearDaemonServiceContract()
        ).rejects.toMatchObject({ contentionState: "active" });
        expect(await readDaemonServiceContract()).toEqual(running);
      } finally {
        resume.resolve();
        await enrollment;
        vi.mocked(rename).mockImplementation(originalFs.rename);
        transport.mockRestore();
      }
      const enrolled = await readDaemonServiceContract();
      expect(enrolled).toMatchObject({
        generation: running.generation,
        connectedComputerId: "computer-enrolled",
      });
      if (operation === "install writer") {
        await writeDaemonServiceContract(newer);
        expect(await readDaemonServiceContract()).toMatchObject({
          bundleId: newer.bundleId,
          desiredState: "stopped",
          generation: running.generation + 1,
          connectedComputerId: "computer-enrolled",
        });
      } else {
        await clearDaemonServiceContract();
        expect(await readDaemonServiceContract()).toBeNull();
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
      const stopped = await upsertDaemonServiceContract({
        ...third,
        desiredState: "stopped",
        autoStart: false,
      });
      expect(stopped.generation).toBe(third.generation);
      expect((await readDaemonServiceContract())?.desiredState).toBe("stopped");
      const restarted = await upsertDaemonServiceContract({
        ...stopped,
        desiredState: "background",
      });
      expect(restarted.generation).toBe(stopped.generation + 1);
      await expect(
        restoreRefusedDaemonStopIntent({ previous: third, stopped })
      ).rejects.toThrow("Service changed after Stop was refused");
      expect(await readDaemonServiceContract()).toEqual(restarted);
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

      const input = {
        daemonVersion: "0.2.6",
        bundleId: "service-bundle-1",
        desiredState: "background" as const,
        serviceController: "launchd" as const,
        autoStart: true,
        gatewayUrl: "http://localhost:8080",
        profileId: "hum_felix",
        deviceId: "device_123",
        heartbeatMs: 5000,
      };
      const lockMeta = {
        intent: "upgrade_reconcile" as const,
        command: "test explicit contract root",
      };
      const held = await acquireDaemonServiceLifecycleLock(
        lockMeta,
        resolveOpenMeldServiceOwnedPathInput(pathInput)
      );
      try {
        await expect(
          upsertDaemonServiceContract(input, pathInput)
        ).rejects.toMatchObject({ contentionState: "active" });
        await expect(
          clearDaemonServiceContract(pathInput)
        ).rejects.toMatchObject({ contentionState: "active" });
      } finally {
        await releaseDaemonServiceLifecycleLock(held);
      }
      await withDaemonServiceLifecycleLock(
        lockMeta,
        async () => {
          await upsertDaemonServiceContract(input, pathInput);
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
