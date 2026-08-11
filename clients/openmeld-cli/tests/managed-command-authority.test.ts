import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveManagedCliDelegation,
  runManagedCliDelegation,
} from "../src/local-components/managed-command-authority";

describe("managed CLI command authority", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.map((root) => rm(root, { recursive: true, force: true }))
    );
    tempRoots.length = 0;
  });

  async function installManagedCli(version: string): Promise<{
    env: NodeJS.ProcessEnv;
    managedBinaryPath: string;
  }> {
    const home = await mkdtemp(join(tmpdir(), "wl-command-authority-"));
    tempRoots.push(home);
    const versionDir = join(home, ".openmeld", "versions", version);
    const binDir = join(home, ".openmeld", "bin");
    const managedBinaryPath = join(versionDir, "openmeld");
    await mkdir(versionDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(managedBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(managedBinaryPath, 0o755);
    await symlink(`../versions/${version}/openmeld`, join(binDir, "openmeld"));
    return {
      env: {
        HOME: home,
        OPENMELD_ENV_PRESET: "prod",
      },
      managedBinaryPath: await realpath(managedBinaryPath),
    };
  }

  it("hands normal npm-distribution commands to an equally current managed CLI", async () => {
    const installed = await installManagedCli("0.3.16");

    await expect(
      resolveManagedCliDelegation({
        argv: ["node", "/global/openmeld.js", "service", "status"],
        currentVersion: "0.3.16",
        distribution: "npm",
        env: installed.env,
      })
    ).resolves.toEqual({
      args: ["service", "status"],
      command: installed.managedBinaryPath,
      reason: "managed_cli_is_current",
      status: "delegate",
    });
  });

  it("hands upgrade to an older managed CLI so that it upgrades its own managed channel", async () => {
    const installed = await installManagedCli("0.3.15");

    await expect(
      resolveManagedCliDelegation({
        argv: ["node", "/global/openmeld.js", "upgrade", "--yes"],
        currentVersion: "0.3.16",
        distribution: "npm",
        env: installed.env,
      })
    ).resolves.toEqual({
      args: ["upgrade", "--yes"],
      command: installed.managedBinaryPath,
      reason: "managed_cli_upgrade_owns_channel",
      status: "delegate",
    });
  });

  it("keeps newer npm commands local until the older managed CLI is explicitly upgraded", async () => {
    const installed = await installManagedCli("0.3.15");

    await expect(
      resolveManagedCliDelegation({
        argv: ["node", "/global/openmeld.js", "service", "status"],
        currentVersion: "0.3.16",
        distribution: "npm",
        env: installed.env,
      })
    ).resolves.toEqual({ status: "stay" });
  });

  it("does not mistake an option value named upgrade for the upgrade command", async () => {
    const installed = await installManagedCli("0.3.15");

    await expect(
      resolveManagedCliDelegation({
        argv: [
          "node",
          "/global/openmeld.js",
          "space",
          "create",
          "--title",
          "upgrade",
        ],
        currentVersion: "0.3.16",
        distribution: "npm",
        env: installed.env,
      })
    ).resolves.toEqual({ status: "stay" });
  });

  it("propagates command arguments, the recursion guard, and the managed CLI exit code", async () => {
    const installed = await installManagedCli("0.3.16");
    await writeFile(
      installed.managedBinaryPath,
      [
        "#!/bin/sh",
        '[ "$OPENMELD_INTERNAL_MANAGED_CLI_DELEGATION" = "1" ] || exit 41',
        '[ "$1" = "service" ] || exit 42',
        '[ "$2" = "status" ] || exit 43',
        "exit 23",
        "",
      ].join("\n"),
      "utf8"
    );

    await expect(
      runManagedCliDelegation(
        {
          args: ["service", "status"],
          command: installed.managedBinaryPath,
          reason: "managed_cli_is_current",
          status: "delegate",
        },
        installed.env
      )
    ).resolves.toBe(23);
  });

  it.each([
    {
      name: "binary distribution",
      distribution: "binary" as const,
      argv: ["openmeld", "openmeld", "service", "status"],
      env: {},
    },
    {
      name: "custom OPENMELD_HOME",
      distribution: "npm" as const,
      argv: ["node", "/global/openmeld.js", "service", "status"],
      env: { OPENMELD_HOME: "/tmp/isolated-openmeld" },
    },
    {
      name: "service carrier process",
      distribution: "npm" as const,
      argv: ["node", "/global/openmeld.js", "service", "run"],
      env: {},
    },
    {
      name: "upgrade service-alignment handoff",
      distribution: "npm" as const,
      argv: [
        "node",
        "/global/openmeld.js",
        "upgrade",
        "--internal-align-service",
      ],
      env: {},
    },
  ])("does not delegate $name", async (input) => {
    const installed = await installManagedCli("0.3.16");

    await expect(
      resolveManagedCliDelegation({
        argv: input.argv,
        currentVersion: "0.3.16",
        distribution: input.distribution,
        env: { ...installed.env, ...input.env },
      })
    ).resolves.toEqual({ status: "stay" });
  });
});
