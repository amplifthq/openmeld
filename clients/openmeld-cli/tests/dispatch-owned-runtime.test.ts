import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
} from "../src/runtime/dispatch-runtime-env";
import { OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV } from "../src/runtime/dispatch-space-action-context";

const tempDirs: string[] = [];

afterEach(() => {
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
    expect(env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]).toBe(contextPath);
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
    expect(readFileSync(`${shimDir}/openmeld`, "utf8")).toContain(
      "/tmp/current-openmeld-dev.mjs"
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
