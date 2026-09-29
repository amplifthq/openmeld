import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDispatchOwnedRuntimeEnv,
  ensureDispatchOwnedRuntimeCliShims,
  resolveDispatchOwnedRuntimeActionCliEntryCommand,
  resolveDispatchOwnedRuntimeCliShimDir,
} from "../src/runtime/dispatch-owned-runtime";
import {
  OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
  OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV,
  OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH_ENV,
} from "../src/runtime/dispatch-runtime-env";
import { OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV } from "../src/runtime/dispatch-space-action-context";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("dispatch-owned runtime env", () => {
  it("prepends a dispatch-scoped OpenMeld CLI shim directory to PATH", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    const contextPath = join(
      openMeldHome,
      "dispatch-space-actions",
      "ctx",
      "context.json"
    );
    const env = buildDispatchOwnedRuntimeEnv({
      cliEntryPath: "/tmp/current-openmeld-dev.mjs",
      dispatchId: "dispatch-123",
      targetProfileId: "agt_executor",
      env: {
        OPENMELD_HOME: openMeldHome,
        PATH: ["/usr/local/bin", "/usr/bin"].join(delimiter),
      },
      spaceActionContextPath: contextPath,
    });

    const shimDir = resolveDispatchOwnedRuntimeCliShimDir({
      env: {
        OPENMELD_HOME: openMeldHome,
      },
      spaceActionContextPath: contextPath,
    });
    expect(env.PATH?.split(delimiter)[0]).toBe(shimDir);
    expect(env.PATH).toContain("/usr/local/bin");
    expect(env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV]).toBe(
      "dispatch-owned-runtime"
    );
    expect(env[OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]).toBe("dispatch-123");
    expect(env[OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]).toBe(
      "agt_executor"
    );
    expect(env.OPENMELD_USER_FACING_CLI_COMMAND).toBe("openmeld");
    expect(env[OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH_ENV]).toBe(
      join(shimDir, "openmeld")
    );
    expect(env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]).toBe(contextPath);
    expect(env.OPENSSL_CONF).toBe("/dev/null");
  });

  it("injects the dispatch Space Action context path when provided", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    const env = buildDispatchOwnedRuntimeEnv({
      cliEntryPath: "/tmp/current-openmeld-dev.mjs",
      dispatchId: "dispatch-123",
      targetProfileId: "agt_executor",
      env: {
        OPENMELD_HOME: openMeldHome,
      },
      spaceActionContextPath: "/tmp/openmeld-space-action-context.json",
    });

    expect(env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]).toBe(
      "/tmp/openmeld-space-action-context.json"
    );
  });

  it("generates openmeld, openmeld-dev, and openmeld-canary shim commands in the runtime directory", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    const shimDir = ensureDispatchOwnedRuntimeCliShims({
      cliEntryPath: "/tmp/current-openmeld-dev.mjs",
      env: {
        OPENMELD_HOME: openMeldHome,
      },
    });

    expect(existsSync(`${shimDir}/openmeld`)).toBe(true);
    expect(existsSync(`${shimDir}/openmeld-dev`)).toBe(true);
    expect(existsSync(`${shimDir}/openmeld-canary`)).toBe(true);
    const openMeldShim = readFileSync(`${shimDir}/openmeld`, "utf8");
    expect(openMeldShim).toContain("#!/usr/bin/env node");
    expect(openMeldShim).toContain(JSON.stringify(process.execPath));
    expect(openMeldShim).toContain(
      JSON.stringify("/tmp/current-openmeld-dev.mjs")
    );
  });

  it("generates direct binary shims without a Node script entry", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    const shimDir = ensureDispatchOwnedRuntimeCliShims({
      cliEntryPath: "/tmp/openmeld-binary",
      distribution: "binary",
      env: {
        OPENMELD_HOME: openMeldHome,
      },
    });

    const openMeldShim = readFileSync(`${shimDir}/openmeld`, "utf8");
    expect(openMeldShim).toContain("#!/bin/sh");
    expect(openMeldShim).toContain("exec '/tmp/openmeld-binary' \"$@\"");
    expect(openMeldShim).not.toContain("#!/usr/bin/env node");
    expect(openMeldShim).not.toContain("process.argv");
  });

  it("uses the managed Windows executable directly for a dispatch Space Action MCP", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    const managedCli = join(openMeldHome, "bin", "openmeld.exe");
    const contextPath = join(openMeldHome, "action", "context.json");
    const env = buildDispatchOwnedRuntimeEnv({
      cliEntryPath: managedCli,
      dispatchId: "dispatch-windows-wake",
      targetProfileId: "agent-windows-wake",
      distribution: "binary",
      platform: "win32",
      env: { OPENMELD_HOME: openMeldHome },
      spaceActionContextPath: contextPath,
    });

    expect(env.OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH).toBe(managedCli);
    expect(env.PATH?.split(delimiter)[0]).toBe(join(openMeldHome, "bin"));
    expect(env.OPENMELD_SPACE_ACTION_CONTEXT_PATH).toBe(contextPath);
    expect(env.OPENSSL_CONF).toBeUndefined();
    expect(env.OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID).toBe(
      "dispatch-windows-wake"
    );
    expect(existsSync(join(openMeldHome, "action", "bin", "openmeld"))).toBe(
      false
    );
  });

  it("targets the managed CLI when a background binary Service creates a shim", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    const shimDir = ensureDispatchOwnedRuntimeCliShims({
      distribution: "binary",
      env: {
        OPENMELD_HOME: openMeldHome,
      },
    });

    const openMeldShim = readFileSync(`${shimDir}/openmeld`, "utf8");
    expect(openMeldShim).toContain(
      `exec '${join(openMeldHome, "bin", "openmeld")}' "$@"`
    );
    expect(openMeldShim).not.toContain(`exec '${process.execPath}' "$@"`);
  });

  it("keeps the Service lane when provider environment contains only task overrides", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    vi.stubEnv("OPENMELD_HOME", openMeldHome);
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    const env = buildDispatchOwnedRuntimeEnv({
      dispatchId: "dispatch-first-wake",
      targetProfileId: "agent-first-wake",
      distribution: "binary",
      env: { PROVIDER_SESSION: "session-1" },
      spaceActionContextPath: join(openMeldHome, "action", "context.json"),
    });
    expect(env.OPENMELD_ENV_PRESET).toBe("dev-local");
    expect(env.OPENMELD_HOME).toBe(openMeldHome);
    const commandPath = env.OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH;
    if (!commandPath) {
      throw new Error("Dispatch reply command was not provided");
    }
    const shim = readFileSync(commandPath, "utf8");
    expect(shim).toContain(
      `exec '${join(openMeldHome, "bin", "openmeld")}' "$@"`
    );
  });

  it("embeds dispatch identity and context into dispatch-scoped shims", () => {
    const openMeldHome = mkdtempSync(`${tmpdir()}/dispatch-owned-runtime-`);
    tempDirs.push(openMeldHome);
    const contextPath = join(
      openMeldHome,
      "dispatch-space-actions",
      "ctx",
      "context.json"
    );
    const shimDir = ensureDispatchOwnedRuntimeCliShims({
      cliEntryPath: "/tmp/current-openmeld-dev.mjs",
      dispatchId: "dispatch-123",
      env: {
        OPENMELD_HOME: openMeldHome,
      },
      spaceActionContextPath: contextPath,
      targetProfileId: "agt_executor",
    });

    const openMeldDevShim = readFileSync(`${shimDir}/openmeld-dev`, "utf8");
    expect(openMeldDevShim).toContain('"OPENMELD_SPACE_ACTION_CONTEXT_PATH"');
    expect(openMeldDevShim).toContain(contextPath);
    expect(openMeldDevShim).toContain(
      '"OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID"'
    );
    expect(openMeldDevShim).toContain("dispatch-123");
    expect(openMeldDevShim).toContain(
      '"OPENMELD_USER_FACING_CLI_COMMAND":"openmeld-dev"'
    );
  });

  it("resolves dispatch action command names from the active lane instead of npx", () => {
    expect(
      resolveDispatchOwnedRuntimeActionCliEntryCommand({
        env: {
          OPENMELD_ENV_PRESET: "prod",
          OPENMELD_USER_FACING_CLI_COMMAND: "npx -y openmeld@latest",
        },
      })
    ).toBe("openmeld");
    expect(
      resolveDispatchOwnedRuntimeActionCliEntryCommand({
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
          OPENMELD_USER_FACING_CLI_COMMAND: "npx -y openmeld@latest",
        },
      })
    ).toBe("openmeld-dev");
    expect(
      resolveDispatchOwnedRuntimeActionCliEntryCommand({
        env: {
          OPENMELD_ENV_PRESET: "canary",
        },
      })
    ).toBe("openmeld-canary");
  });
});
