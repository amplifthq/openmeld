import { delimiter } from "node:path";
import { WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { daemonRuntimeRootPath } from "../src/config/daemon-state";
import { resolveOpenMeldRootDir } from "../src/config/paths";
import {
  daemonServiceBinaryExecutablePath,
  daemonServiceExecutableWrapperPath,
  daemonServiceLauncherPath,
  daemonServiceLegacyWrapperPath,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { buildDaemonSystemServiceCommandSpec } from "../src/local-service/lifecycle/daemon-service-command-spec";

const ENV_KEYS = [
  "GEMINI_HOME",
  "AGENT_SERVE_CONFIG_DIR",
  "CURSOR_API_KEY_FILE",
  "OPENMELD_DEV_MODE",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_GATEWAY_URL",
  "OPENMELD_AUTH_URL",
  "OPENMELD_HOME",
  "OPENMELD_USER_FACING_CLI_COMMAND",
  "OPENMELD_CLI_BINARY_MANIFEST_URL",
  "OPENMELD_WINDOWS_INTERNAL_PREVIEW",
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
    process.env.GEMINI_HOME = "/test-owned/antigravity-profile";
    process.env.AGENT_SERVE_CONFIG_DIR = "/test-owned/bdk";
    process.env.CURSOR_API_KEY_FILE = "/test-owned/bdk-key";

    const spec = buildDaemonSystemServiceCommandSpec({
      controller: "launchd",
    });

    expect(spec.env.OPENMELD_ENV_PRESET).toBe("dev-local");
    expect(spec.env.GEMINI_HOME).toBe("/test-owned/antigravity-profile");
    expect(spec.env.AGENT_SERVE_CONFIG_DIR).toBe("/test-owned/bdk");
    expect(spec.env.CURSOR_API_KEY_FILE).toBe("/test-owned/bdk-key");
    expect(spec.env.OPENMELD_USER_FACING_CLI_COMMAND).toBe("openmeld-dev");
    expect(spec.executable).toBe("/bin/sh");
    expect(spec.args[0]).toMatch(DEV_SERVICE_WRAPPER_PATH_PATTERN);
  });

  it("does not persist a dispatch-scoped Space Action shim in the Service PATH", () => {
    const originalPath = process.env.PATH;
    const dispatchShim =
      "/Users/dev/.openmeld/runtime/daemon/dispatch-space-actions/dispatch-123/bin";
    process.env.PATH = ["/usr/local/bin", dispatchShim, "/usr/bin"].join(
      delimiter
    );
    try {
      const spec = buildDaemonSystemServiceCommandSpec({
        controller: "launchd",
      });

      expect(spec.env.PATH).toBe(
        ["/usr/local/bin", "/usr/bin"].join(delimiter)
      );
    } finally {
      if (originalPath === undefined) {
        process.env.PATH = undefined;
      } else {
        process.env.PATH = originalPath;
      }
    }
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

  it("persists the Windows terminal Path and required runtime directories, not arbitrary secrets", () => {
    const originalEnv = process.env;
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform"
    );
    process.env = {
      Path: "C:\\Node;C:\\npm",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\Test",
      TEMP: "C:\\Temp",
      PRIVATE_SECRET: "not-forwarded",
      OPENMELD_ENV_PRESET: "prod",
      OPENMELD_HOME: "/test-owned/windows-environment",
      OPENMELD_CLI_BINARY_MANIFEST_URL: WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL,
      OPENMELD_WINDOWS_INTERNAL_PREVIEW: "1",
    };
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      const spec = buildDaemonSystemServiceCommandSpec({
        controller: "windows-service",
        distribution: "npm",
      });
      expect(spec.env).toMatchObject({
        PATH: "C:\\Node;C:\\npm",
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\Test",
        TEMP: "C:\\Temp",
        OPENMELD_CLI_BINARY_MANIFEST_URL: WINDOWS_INTERNAL_PREVIEW_MANIFEST_URL,
        OPENMELD_WINDOWS_INTERNAL_PREVIEW: "1",
      });
      expect(spec.env).not.toHaveProperty("Path");
      expect(spec.env).not.toHaveProperty("PRIVATE_SECRET");
      expect(spec.executable).toBe(process.execPath);

      // The public Windows setup command clears this override. The registered
      // action must still carry its default root for ownership and execution.
      Reflect.deleteProperty(process.env, "OPENMELD_HOME");
      const defaultSpec = buildDaemonSystemServiceCommandSpec({
        controller: "windows-service",
        distribution: "binary",
        binaryExecutablePath:
          "C:\\Users\\Test\\.openmeld\\runtime\\daemon\\bundles\\active\\openmeld.exe",
      });
      expect(defaultSpec.env.OPENMELD_HOME).toBe(resolveOpenMeldRootDir());
    } finally {
      process.env = originalEnv;
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
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
