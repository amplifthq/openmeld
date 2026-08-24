import { describe, expect, it } from "vitest";
import type { DaemonServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-manager";
import {
  buildLaunchdPlist,
  buildSystemdUnitFile,
  parseDaemonServiceEnvironmentTargetFromDefinition,
} from "../src/local-service/lifecycle/daemon-service-manager";

const commandSpec: DaemonServiceCommandSpec = {
  executable: "/opt/openmeld/openmeld",
  args: ["service", "run", "--mode", "foreground"],
  env: {
    OPENMELD_ENV_PRESET: "dev-local",
    OPENMELD_GATEWAY_URL: "http://localhost:31025",
    OPENMELD_AUTH_URL: "http://localhost:31026",
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
  },
};

const expectedTarget = {
  preset: "dev-local",
  gatewayUrl: "http://localhost:31025",
  authBaseUrl: "http://localhost:31026",
  userFacingCommand: "openmeld-dev",
} as const;

describe("local service manager environment target", () => {
  it("reads the target from a generated launchd definition", () => {
    expect(
      parseDaemonServiceEnvironmentTargetFromDefinition({
        controller: "launchd",
        definition: buildLaunchdPlist(commandSpec),
      })
    ).toEqual(expectedTarget);
  });

  it("reads the target from a generated systemd definition", () => {
    expect(
      parseDaemonServiceEnvironmentTargetFromDefinition({
        controller: "systemd",
        definition: buildSystemdUnitFile(commandSpec),
      })
    ).toEqual(expectedTarget);
  });

  it("reads the target from a Windows runner definition", () => {
    expect(
      parseDaemonServiceEnvironmentTargetFromDefinition({
        controller: "windows-service",
        definition: [
          "@echo off",
          'set "OPENMELD_ENV_PRESET=dev-local"',
          'set "OPENMELD_GATEWAY_URL=http://localhost:31025"',
          'set "OPENMELD_AUTH_URL=http://localhost:31026"',
          'set "OPENMELD_USER_FACING_CLI_COMMAND=openmeld-dev"',
        ].join("\r\n"),
      })
    ).toEqual(expectedTarget);
  });

  it("fails closed when the registered environment is incomplete", () => {
    expect(
      parseDaemonServiceEnvironmentTargetFromDefinition({
        controller: "launchd",
        definition: buildLaunchdPlist({
          ...commandSpec,
          env: {
            ...commandSpec.env,
            OPENMELD_AUTH_URL: "",
          },
        }),
      })
    ).toBeNull();
  });
});
