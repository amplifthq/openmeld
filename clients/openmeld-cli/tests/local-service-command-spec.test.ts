import { afterEach, describe, expect, it } from "vitest";
import { daemonRuntimeRootPath } from "../src/config/daemon-state";
import {
  daemonServiceBinaryExecutablePath,
  daemonServiceExecutableWrapperPath,
  daemonServiceLauncherPath,
  daemonServiceLegacyWrapperPath,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { buildDaemonSystemServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-command-spec";

const ENV_KEYS = [
  "OPENMELD_DEV_MODE",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_GATEWAY_URL",
  "OPENMELD_AUTH_URL",
  "OPENMELD_HOME",
  "OPENMELD_USER_FACING_CLI_COMMAND",
  "OPENMELD_CLI_BINARY_MANIFEST_URL",
] as const;
const DAEMON_SERVICE_LAUNCHER_PATH_PATTERN = /daemon-service-launcher\.mjs$/;
const PROD_SERVICE_WRAPPER_PATH_PATTERN = /\/OpenMeld Service$/;
const DEV_SERVICE_WRAPPER_PATH_PATTERN = /\/OpenMeld Service Dev$/;
const CANARY_SERVICE_WRAPPER_PATH_PATTERN = /\/OpenMeld Service Canary$/;
const PROD_BINARY_SERVICE_PATH_PATTERN = /\/OpenMeld Service Binary$/;

describe("local service system service command spec", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("propagates the dev-local lane into the managed system service env", () => {
    process.env.OPENMELD_ENV_PRESET = "dev-local";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-dev";

    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    expect(spec.env.OPENMELD_ENV_PRESET).toBe("dev-local");
    expect(spec.env.OPENMELD_USER_FACING_CLI_COMMAND).toBe("openmeld-dev");
    expect(spec.executable).toBe("/bin/sh");
    expect(spec.args[0]).toMatch(DEV_SERVICE_WRAPPER_PATH_PATTERN);
  });

  it("propagates the canary lane into the managed system service env", () => {
    process.env.OPENMELD_ENV_PRESET = "canary";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";

    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    expect(spec.env.OPENMELD_ENV_PRESET).toBe("canary");
    expect(spec.env.OPENMELD_USER_FACING_CLI_COMMAND).toBe("openmeld-canary");
    expect(spec.executable).toBe("/bin/sh");
    expect(spec.args[0]).toMatch(CANARY_SERVICE_WRAPPER_PATH_PATTERN);
  });

  it("uses the system shell to execute the OpenMeld-owned launchd wrapper", () => {
    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    expect(spec.executable).toBe("/bin/sh");
    expect(spec.args[0]).toBe(daemonServiceExecutableWrapperPath());
    expect(spec.args[0]).toMatch(PROD_SERVICE_WRAPPER_PATH_PATTERN);
    expect(spec.executable).not.toBe(daemonServiceLegacyWrapperPath());
    expect(spec.executable).not.toBe(process.execPath);
    expect(spec.args).toEqual([
      daemonServiceExecutableWrapperPath(),
      "service",
      "run",
      "--mode",
      "foreground",
    ]);
  });

  it("keeps non-launchd service registration on the stable launcher", () => {
    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "systemd",
    });

    expect(spec.executable).toBe(process.execPath);
    expect(spec.args).toEqual([
      daemonServiceLauncherPath(),
      "service",
      "run",
      "--mode",
      "foreground",
    ]);
    expect(spec.args[0]).toMatch(DAEMON_SERVICE_LAUNCHER_PATH_PATTERN);
  });

  it("keeps the macOS binary Service executable path stable across versions", () => {
    const previousSpec = buildDaemonSystemServiceCommandSpec({
      binaryExecutablePath: "/Users/dev/.openmeld/versions/0.2.14/openmeld",
      controller: "launchd",
      distribution: "binary",
    });
    const nextSpec = buildDaemonSystemServiceCommandSpec({
      binaryExecutablePath: "/Users/dev/.openmeld/versions/0.2.15/openmeld",
      controller: "launchd",
      distribution: "binary",
    });

    expect(previousSpec.executable).toBe(daemonServiceBinaryExecutablePath());
    expect(nextSpec.executable).toBe(previousSpec.executable);
    expect(previousSpec.executable).not.toBe(
      daemonServiceExecutableWrapperPath()
    );
    expect(previousSpec.executable).toMatch(PROD_BINARY_SERVICE_PATH_PATTERN);
    expect(previousSpec.args).toEqual([
      "service",
      "run",
      "--mode",
      "foreground",
    ]);
  });

  it("keeps non-macOS binary Service registration on its prepared binary", () => {
    const managedBinaryPath = "/Users/dev/.openmeld/versions/0.2.14/openmeld";
    const spec = buildDaemonSystemServiceCommandSpec({
      binaryExecutablePath: managedBinaryPath,
      controller: "systemd",
      distribution: "binary",
    });

    expect(spec.executable).toBe(managedBinaryPath);
    expect(spec.args).toEqual(["service", "run", "--mode", "foreground"]);
  });

  it("uses the stable OpenMeld daemon runtime root as the managed service working directory", () => {
    process.env.OPENMELD_HOME = "/tmp/openmeld-service-home";

    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    expect(spec.workingDirectory).toBe(daemonRuntimeRootPath());
    expect(spec.workingDirectory).toBe(
      "/tmp/openmeld-service-home/runtime/daemon"
    );
    expect(spec.workingDirectory).not.toBe(process.cwd());
  });

  it("writes the default canary gateway and auth target into the managed system service env", () => {
    process.env.OPENMELD_ENV_PRESET = "canary";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";

    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    expect(spec.env.OPENMELD_ENV_PRESET).toBe("canary");
    expect(spec.env.OPENMELD_USER_FACING_CLI_COMMAND).toBe("openmeld-canary");
    expect(spec.env.OPENMELD_GATEWAY_URL).toBe("http://localhost:8080");
    expect(spec.env.OPENMELD_AUTH_URL).toBe("http://localhost:8788");
  });

  it("writes explicit gateway and auth overrides into the managed system service env", () => {
    process.env.OPENMELD_ENV_PRESET = "canary";
    process.env.OPENMELD_USER_FACING_CLI_COMMAND = "openmeld-canary";
    process.env.OPENMELD_GATEWAY_URL = "https://gateway-preview.openmeld.test";
    process.env.OPENMELD_AUTH_URL = "https://auth-preview.openmeld.test";
    process.env.OPENMELD_DEV_MODE = "1";
    process.env.OPENMELD_HOME = "/tmp/openmeld-fresh-home";
    process.env.OPENMELD_CLI_BINARY_MANIFEST_URL =
      "https://staging.openmeld.ai/cli/manifest.json";

    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    expect(spec.env.OPENMELD_ENV_PRESET).toBe("canary");
    expect(spec.env.OPENMELD_USER_FACING_CLI_COMMAND).toBe("openmeld-canary");
    expect(spec.env.OPENMELD_DEV_MODE).toBe("1");
    expect(spec.env.OPENMELD_HOME).toBe("/tmp/openmeld-fresh-home");
    expect(spec.env.OPENMELD_GATEWAY_URL).toBe(
      "https://gateway-preview.openmeld.test"
    );
    expect(spec.env.OPENMELD_AUTH_URL).toBe(
      "https://auth-preview.openmeld.test"
    );
    expect(spec.env.OPENMELD_CLI_BINARY_MANIFEST_URL).toBe(
      "https://staging.openmeld.ai/cli/manifest.json"
    );
  });
});
