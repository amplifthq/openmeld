import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type OpenMeldPathResolutionInput,
  openMeldManagedVersionBinaryPath,
} from "../src/config/paths";
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
  it("matches binary launchd definitions that point at the stable Service executable", async () => {
    await withTempHome(async () => {
      const pathInput = testPathInput();
      const stableExecutablePath =
        daemonServiceExecutableWrapperPath(pathInput);
      const definitionPath = await writeLaunchdDefinition(stableExecutablePath);

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
          commandSummary: `${stableExecutablePath} service run --mode foreground`,
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).toBe(true);
    });
  });

  it("rejects a versioned binary launchd definition so repair migrates it to the stable executable", async () => {
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
      ).resolves.toBe(false);
      expect(
        matchesExpectedDaemonServiceManagerCommand({
          commandSummary: `${managedBinaryPath} service run --mode foreground`,
          controller: "launchd",
          definitionPath,
          distribution: "binary",
          pathInput,
        })
      ).toBe(false);
    });
  });

  it("does not accept an unrelated launchd path in binary distribution", async () => {
    await withTempHome(async () => {
      const pathInput = testPathInput();
      const unrelatedPath = join(
        process.env.OPENMELD_HOME ?? "",
        "runtime",
        "daemon",
        "service-manager",
        "OpenMeld Service Copy"
      );
      const definitionPath = await writeLaunchdDefinition(unrelatedPath);

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
          commandSummary: `${unrelatedPath} service run --mode foreground`,
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
