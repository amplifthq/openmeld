import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  daemonRuntimeRootPath,
  installDaemon,
  uninstallDaemon,
} from "../src/config/daemon-state";
import { DAEMON_DEVICE_ID_FILE } from "../src/local-service/core/constants";
import {
  ensureDaemonRuntimePaths,
  resolveDaemonDeviceId,
  resolvePreferredDaemonDeviceId,
} from "../src/local-service/state/daemon-device-id";
import { withTempHome } from "./helpers/fs";

describe("local service device id", () => {
  it("treats blank explicit device ids as unset before falling back to the contract", () => {
    expect(
      resolvePreferredDaemonDeviceId({
        explicitDeviceId: "device-explicit",
        contractDeviceId: "device-from-contract",
      })
    ).toBe("device-explicit");

    expect(
      resolvePreferredDaemonDeviceId({
        explicitDeviceId: "",
        contractDeviceId: "device-from-contract",
      })
    ).toBe("device-from-contract");

    expect(
      resolvePreferredDaemonDeviceId({
        explicitDeviceId: "   ",
        contractDeviceId: "device-from-contract",
      })
    ).toBe("device-from-contract");

    expect(
      resolvePreferredDaemonDeviceId({
        explicitDeviceId: "   ",
        contractDeviceId: null,
      })
    ).toBeUndefined();
  });

  it("persists an explicit device id so future runs stay on the same device identity", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();

      await expect(
        resolveDaemonDeviceId({
          deviceId: "device-contract-123",
          deviceIdPath: runtimePaths.deviceIdPath,
        })
      ).resolves.toBe("device-contract-123");

      await expect(readFile(runtimePaths.deviceIdPath, "utf8")).resolves.toBe(
        "device-contract-123\n"
      );
    });
  });

  it("keeps the same device identity when OpenMeld Service is uninstalled and installed again", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });
      const firstRuntimePaths = await ensureDaemonRuntimePaths();
      const firstDeviceId = await resolveDaemonDeviceId({
        deviceIdPath: firstRuntimePaths.deviceIdPath,
      });

      await uninstallDaemon();
      await installDaemon({
        daemonVersion: "1.0.0",
        source: "daemon.command.install",
      });
      const secondRuntimePaths = await ensureDaemonRuntimePaths();
      const secondDeviceId = await resolveDaemonDeviceId({
        deviceIdPath: secondRuntimePaths.deviceIdPath,
      });

      expect(secondDeviceId).toBe(firstDeviceId);
    });
  });

  it("migrates the existing runtime device identity before service cleanup can remove it", async () => {
    await withTempHome(async () => {
      const legacyDataPath = join(daemonRuntimeRootPath(), "data");
      await mkdir(legacyDataPath, { recursive: true });
      await writeFile(
        join(legacyDataPath, DAEMON_DEVICE_ID_FILE),
        "device-from-v0.3.6\n",
        "utf8"
      );

      const runtimePaths = await ensureDaemonRuntimePaths();

      await expect(
        resolveDaemonDeviceId({ deviceIdPath: runtimePaths.deviceIdPath })
      ).resolves.toBe("device-from-v0.3.6");
    });
  });

  it("replaces a persisted device id when the caller marks it unsafe", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      await writeFile(runtimePaths.deviceIdPath, "device_123\n", "utf8");

      const deviceId = await resolveDaemonDeviceId({
        deviceIdPath: runtimePaths.deviceIdPath,
        shouldDiscardPersistedDeviceId: (value) => value === "device_123",
      });

      expect(deviceId).not.toBe("device_123");
      await expect(readFile(runtimePaths.deviceIdPath, "utf8")).resolves.toBe(
        `${deviceId}\n`
      );
    });
  });
});
