import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type OpenMeldPathResolutionInput,
  openMeldManagedVersionBinaryPath,
} from "../src/config/paths";
import { resolveCliSelfVersion } from "../src/local-components/managed-install";
import { daemonServiceExecutableWrapperPath } from "../src/local-service/lifecycle/daemon-service-bundle";
import {
  matchesExpectedDaemonServiceManagerCommand,
  matchesExpectedDaemonServiceManagerDefinition,
} from "../src/local-service/lifecycle/daemon-service-manager-command-match";
import { withTempHome } from "./helpers/fs";

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

describe("local service manager command matching", () => {
  it("matches binary launchd definitions that point at the managed version binary", async () => {
    await withTempHome(async () => {
      const pathInput = testPathInput();
      const managedBinaryPath = openMeldManagedVersionBinaryPath(
        resolveCliSelfVersion(),
        pathInput
      );
      const definitionPath = await writeLaunchdDefinition(managedBinaryPath);

      await expect(
        matchesExpectedDaemonServiceManagerDefinition({
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).resolves.toBe(true);
      expect(
        matchesExpectedDaemonServiceManagerCommand({
          commandSummary: `${managedBinaryPath} service run --mode foreground`,
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).toBe(true);
    });
  });

  it("matches binary launchd definitions that point at another managed version binary", async () => {
    await withTempHome(async () => {
      const pathInput = testPathInput();
      const managedBinaryPath = openMeldManagedVersionBinaryPath(
        "0.2.13",
        pathInput
      );
      const definitionPath = await writeLaunchdDefinition(managedBinaryPath);

      await expect(
        matchesExpectedDaemonServiceManagerDefinition({
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).resolves.toBe(true);
      expect(
        matchesExpectedDaemonServiceManagerCommand({
          commandSummary: `${managedBinaryPath} service run --mode foreground`,
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).toBe(true);
    });
  });

  it("does not accept the npm launchd wrapper as aligned in binary distribution", async () => {
    await withTempHome(async () => {
      const pathInput = testPathInput();
      const wrapperPath = daemonServiceExecutableWrapperPath(pathInput);
      const definitionPath = await writeLaunchdDefinition(wrapperPath);

      await expect(
        matchesExpectedDaemonServiceManagerDefinition({
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).resolves.toBe(false);
      expect(
        matchesExpectedDaemonServiceManagerCommand({
          commandSummary: `${wrapperPath} service run --mode foreground`,
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).toBe(false);
    });
  });

  it("keeps the launchd wrapper aligned for npm distribution", async () => {
    await withTempHome(async () => {
      const pathInput = testPathInput();
      const wrapperPath = daemonServiceExecutableWrapperPath(pathInput);
      const definitionPath = await writeLaunchdDefinition(wrapperPath);

      await expect(
        matchesExpectedDaemonServiceManagerDefinition({
          controller: "launchd",
          definitionPath,
          distribution: "npm",
          pathInput,
        })
      ).resolves.toBe(true);
      expect(
        matchesExpectedDaemonServiceManagerCommand({
          commandSummary: `${wrapperPath} service run --mode foreground`,
          controller: "launchd",
          definitionPath,
          distribution: "npm",
          pathInput,
        })
      ).toBe(true);
    });
  });
});
