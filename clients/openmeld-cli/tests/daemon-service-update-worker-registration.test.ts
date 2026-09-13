import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasIndependentMaintenanceRegistration,
  INDEPENDENT_MAINTENANCE_REGISTRATION,
  readBundleIdsFromUpdateWorkerRegistration,
  readDaemonServiceUpdateWorkerProtectedManagedVersions,
  readManagedVersionsFromUpdateWorkerRegistration,
  resolveDaemonServiceUpdateWorkerLaunchdPlistPath,
  resolveDaemonServiceUpdateWorkerRegistrationPath,
  resolveDaemonServiceUpdateWorkerSystemdUnitPath,
  resolveDaemonServiceUpdateWorkerWindowsScriptPath,
} from "../src/config/daemon-service-update-worker-registration";

describe("daemon service update worker registration", () => {
  const temporaryHomes: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryHomes
        .splice(0)
        .map((home) => rm(home, { force: true, recursive: true }))
    );
  });

  it("does not reuse a maintenance registration left by another home in the same lane", async () => {
    const homeDir = join(tmpdir(), `openmeld-worker-${randomUUID()}`);
    temporaryHomes.push(homeDir);
    const root = join(homeDir, "first-install");
    const input = {
      homeDir,
      env: { OPENMELD_ENV_PRESET: "dev-local", OPENMELD_HOME: root },
    };
    const plistPath = resolveDaemonServiceUpdateWorkerLaunchdPlistPath(input);
    await mkdir(dirname(plistPath), { recursive: true });
    await writeFile(
      plistPath,
      `<!-- ${INDEPENDENT_MAINTENANCE_REGISTRATION} --><plist><dict><key>EnvironmentVariables</key><dict><key>OPENMELD_HOME</key><string>${root}</string></dict></dict></plist>`
    );
    await expect(
      hasIndependentMaintenanceRegistration(input, "darwin")
    ).resolves.toBe(true);
    // A valid registration for this home can still point at the old binary
    // after setup installs an npm Service. It must not skip re-registration.
    const npmDefinition = `<!-- ${INDEPENDENT_MAINTENANCE_REGISTRATION} --><plist><dict><key>ProgramArguments</key><array><string>/usr/bin/node</string><string>${root}/runtime/daemon/service-update-worker.mjs</string><string>service</string><string>update-worker</string></array><key>EnvironmentVariables</key><dict><key>OPENMELD_HOME</key><string>${root}</string></dict></dict></plist>`;
    await expect(
      hasIndependentMaintenanceRegistration(input, "darwin", npmDefinition)
    ).resolves.toBe(false);
    await writeFile(plistPath, npmDefinition);
    await expect(
      hasIndependentMaintenanceRegistration(input, "darwin", npmDefinition)
    ).resolves.toBe(true);
    await expect(
      hasIndependentMaintenanceRegistration(
        {
          ...input,
          env: { ...input.env, OPENMELD_HOME: join(homeDir, "second-install") },
        },
        "darwin"
      )
    ).resolves.toBe(false);
  });

  it("recognizes a versioned worker executable that must survive migration", async () => {
    const homeDir = join(tmpdir(), `openmeld-worker-${randomUUID()}`);
    temporaryHomes.push(homeDir);
    const plistPath = resolveDaemonServiceUpdateWorkerLaunchdPlistPath({
      homeDir,
    });
    await mkdir(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    await writeFile(
      plistPath,
      "<array><string>/Users/test/.openmeld/versions/0.3.120/openmeld</string><string>service</string><string>update-worker</string></array>",
      "utf8"
    );

    await expect(
      readDaemonServiceUpdateWorkerProtectedManagedVersions(
        { homeDir },
        "darwin"
      )
    ).resolves.toEqual(new Set(["0.3.120"]));
  });

  it.each([
    {
      executable: "/Users/test/.openmeld/versions/0.3.120/openmeld",
      platform: "darwin" as const,
      resolvePath: resolveDaemonServiceUpdateWorkerLaunchdPlistPath,
    },
    {
      executable: "/home/test/.openmeld/versions/0.3.120/openmeld",
      platform: "linux" as const,
      resolvePath: resolveDaemonServiceUpdateWorkerSystemdUnitPath,
    },
    {
      executable: "C:\\Users\\test\\.openmeld\\versions\\0.3.120\\openmeld.exe",
      platform: "win32" as const,
      resolvePath: resolveDaemonServiceUpdateWorkerWindowsScriptPath,
    },
  ])("reads the legacy $platform worker registration before pruning managed versions", async ({
    executable,
    platform,
    resolvePath,
  }) => {
    const homeDir = join(tmpdir(), `openmeld-worker-${randomUUID()}`);
    temporaryHomes.push(homeDir);
    const registrationPath = resolvePath({ homeDir });
    expect(
      resolveDaemonServiceUpdateWorkerRegistrationPath({ homeDir }, platform)
    ).toBe(registrationPath);
    await mkdir(dirname(registrationPath), { recursive: true });
    await writeFile(registrationPath, executable, "utf8");

    await expect(
      readDaemonServiceUpdateWorkerProtectedManagedVersions(
        { homeDir },
        platform
      )
    ).resolves.toEqual(new Set(["0.3.120"]));
  });

  it("does not treat the stable worker carrier as a managed version", () => {
    expect(
      readManagedVersionsFromUpdateWorkerRegistration(
        "/Users/test/.openmeld/runtime/daemon/service-manager/OpenMeld Update Worker Binary"
      )
    ).toEqual(new Set());
  });

  it("recognizes every self-contained bundle still referenced by the worker registration", () => {
    expect(
      readBundleIdsFromUpdateWorkerRegistration(
        [
          "/Users/test/.openmeld/runtime/daemon/bundles/0.3.120-old/dist/openmeld.js",
          "C:\\Users\\test\\.openmeld\\runtime\\daemon\\bundles\\0.3.121-new\\dist\\openmeld.js",
        ].join("\n")
      )
    ).toEqual(new Set(["0.3.120-old", "0.3.121-new"]));
  });
});
