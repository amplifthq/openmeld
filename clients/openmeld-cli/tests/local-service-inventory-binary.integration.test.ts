import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => true,
  resolveOpenMeldDistribution: () => "binary",
}));

import { upsertDaemonServiceContract } from "../src/config/daemon-service-contract";
import type { DaemonStatus } from "../src/config/daemon-state";
import {
  type OpenMeldPathResolutionInput,
  openMeldManagedBinaryPath,
} from "../src/config/paths";
import { resolveCliSelfVersion } from "../src/local-components/managed-install";
import { resolveCurrentDaemonExpectedVersion } from "../src/local-service/lifecycle/current-daemon-version";
import {
  daemonServiceActiveBundlePath,
  daemonServiceBinaryExecutablePath,
  prepareDaemonServiceBundle,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { inspectDaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";
import type {
  DaemonServiceManager,
  DaemonServiceManagerRuntimeStatus,
} from "../src/local-service/lifecycle/daemon-service-manager";
import { withTempHome } from "./helpers/fs";

function createInstalledStatus(version: string): DaemonStatus {
  return {
    installed: true,
    state: {
      v: 1,
      schema: "openmeld-daemon-install-v1",
      daemonVersion: version,
      installSource: "daemon.command.install",
      installedAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
  };
}

function createServiceManager(
  status: DaemonServiceManagerRuntimeStatus
): DaemonServiceManager {
  return {
    controller: "launchd",
    deactivate: async () => undefined,
    disableAutostart: async () => undefined,
    enableAutostart: async () => undefined,
    install: async () => undefined,
    start: async () => undefined,
    status: async () => status,
    stop: async () => undefined,
    uninstall: async () => undefined,
    waitUntilAbsent: async () => undefined,
    waitUntilRunning: async () => undefined,
    waitUntilStopped: async () => undefined,
  };
}

function testPathInput(): OpenMeldPathResolutionInput {
  return {
    env: process.env,
    homeDir: process.env.HOME,
  };
}

async function writeLaunchdDefinition(commandPath: string): Promise<string> {
  const root =
    process.env.OPENMELD_HOME ??
    (() => {
      throw new Error("OPENMELD_HOME must be set by withTempHome");
    })();
  const definitionPath = join(
    root,
    "Library",
    "LaunchAgents",
    "com.openmeld.openmeld-background-service.plist"
  );
  await mkdir(dirname(definitionPath), { recursive: true });
  await writeFile(
    definitionPath,
    `<plist><array><string>${commandPath}</string><string>service</string><string>run</string></array></plist>\n`,
    "utf8"
  );
  return definitionPath;
}

describe("binary local service inventory", () => {
  it.each([
    "0.0.1",
    "999.0.0",
  ])("does not select a downgrade for an installed Service (selected=%s)", async (selectedVersion) => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "1.0.0",
        bundleId: "installed-service",
        desiredState: "stopped",
        serviceController: "launchd",
        autoStart: false,
        gatewayUrl: "http://localhost:8080",
        deviceId: "service-test-device",
        heartbeatMs: 25_000,
      });
      await expect(
        resolveCurrentDaemonExpectedVersion(selectedVersion)
      ).resolves.toBe(selectedVersion === "0.0.1" ? "1.0.0" : "999.0.0");
    });
  });
  it("stages a separately selected Service without replacing the CLI or active Service", async () => {
    await withTempHome(async () => {
      const contents = Buffer.from("selected Service release");
      const sha256 = createHash("sha256").update(contents).digest("hex");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(contents));
      vi.stubGlobal("fetch", fetchMock);
      try {
        const bundle = await prepareDaemonServiceBundle({
          activate: false,
          daemonVersion: "0.0.1",
          binaryRelease: {
            version: "0.0.1",
            minRequiredCliVersion: null,
            platform: "darwin-arm64",
            url: "https://example.com/openmeld-cli-darwin-arm64-0.0.1",
            sha256,
            sizeBytes: contents.length,
          },
        });
        expect(bundle.daemonVersion).toBe("0.0.1");
        expect(bundle.sourceDistFingerprint).toBe(sha256);
        await expect(readFile(bundle.sourceEntryScriptPath)).resolves.toEqual(
          contents
        );
        await expect(
          readFile(daemonServiceActiveBundlePath())
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          readFile(daemonServiceBinaryExecutablePath())
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          readFile(openMeldManagedBinaryPath())
        ).rejects.toMatchObject({ code: "ENOENT" });
        await mkdir(dirname(daemonServiceActiveBundlePath()), {
          recursive: true,
        });
        await writeFile(
          daemonServiceActiveBundlePath(),
          JSON.stringify(bundle)
        );
        await mkdir(dirname(daemonServiceBinaryExecutablePath()), {
          recursive: true,
        });
        await writeFile(
          daemonServiceBinaryExecutablePath(),
          "damaged running carrier"
        );
        await expect(
          prepareDaemonServiceBundle({
            activate: false,
            daemonVersion: "0.0.1",
          })
        ).resolves.toEqual(bundle);
        expect(fetchMock).toHaveBeenCalledOnce();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
  it("rejects a different Service target before installing the invoking CLI", async () => {
    await withTempHome(async () => {
      await expect(
        prepareDaemonServiceBundle({ daemonVersion: "0.0.1" })
      ).rejects.toThrow("Acquire the selected Service release");
      await expect(
        readFile(daemonServiceActiveBundlePath())
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        readFile(daemonServiceBinaryExecutablePath())
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
  it("detects changed Service bytes independently of the invoking CLI", async () => {
    await withTempHome(async () => {
      const version = resolveCliSelfVersion();
      const executable = daemonServiceBinaryExecutablePath();
      const contents = "verified Service executable";
      await mkdir(dirname(executable), { recursive: true });
      await mkdir(dirname(daemonServiceActiveBundlePath()), {
        recursive: true,
      });
      await writeFile(executable, contents);
      await writeFile(
        daemonServiceActiveBundlePath(),
        JSON.stringify({
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "binary-integrity",
          daemonVersion: version,
          entryScriptRelativePath: "openmeld",
          bundleFormat: "binary_v1",
          sourceEntryScriptPath: executable,
          sourcePackageRootPath: dirname(executable),
          sourceDistRootPath: dirname(executable),
          sourceDistFingerprint: createHash("sha256")
            .update(contents)
            .digest("hex"),
          sourceKind: "package_install",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
      const inspect = () =>
        inspectDaemonServiceInventory({
          expectedVersion: version,
          readDaemonStatus: async () => createInstalledStatus(version),
          listOwnedProcesses: async () => [],
          resolveServiceManager: async () => null,
        });
      expect((await inspect()).anomalies.map(({ code }) => code)).not.toContain(
        "bundle_content_drift"
      );
      await writeFile(executable, "changed Service executable");
      expect((await inspect()).anomalies.map(({ code }) => code)).toContain(
        "bundle_content_drift"
      );
    });
  });
  it("accepts launchd definitions that point at the stable Service executable", async () => {
    await withTempHome(async () => {
      const pathInput = testPathInput();
      const version = resolveCliSelfVersion();
      const stableExecutablePath = daemonServiceBinaryExecutablePath(pathInput);
      const definitionPath = await writeLaunchdDefinition(stableExecutablePath);

      const inventory = await inspectDaemonServiceInventory({
        expectedVersion: version,
        listOwnedProcesses: async () => [],
        readDaemonStatus: async () => createInstalledStatus(version),
        resolveServiceManager: async () =>
          createServiceManager({
            commandSummary: `${stableExecutablePath} service run --mode foreground`,
            definitionPath,
            enabled: true,
            installed: true,
            running: false,
          }),
      });

      expect(inventory.serviceManagerStatus?.installed).toBe(true);
      expect(
        inventory.anomalies.some(
          (anomaly) => anomaly.code === "service_manager_path_drift"
        )
      ).toBe(false);
    });
  });
});
