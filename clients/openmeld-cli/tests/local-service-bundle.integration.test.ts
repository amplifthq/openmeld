import { type SpawnOptionsWithoutStdio, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonRuntimeLeasePath } from "../src/config/daemon-runtime-lease";
import { daemonServiceContractPath } from "../src/config/daemon-service-contract";
import { installDaemon } from "../src/config/daemon-state";
import { openMeldManagedVersionBinaryPath } from "../src/config/paths";
import {
  activateDaemonServiceBundle,
  cleanupInactiveDaemonServiceBundles,
  daemonServiceActiveBundlePath,
  daemonServiceExecutableWrapperPath,
  daemonServiceLauncherPath,
  daemonServiceLegacyWrapperPath,
  discardPreparedDaemonServiceBundle,
  prepareDaemonServiceBundle,
  readDaemonActiveBundleState,
  resolveAlignedDaemonActiveBundleEntryPath,
  resolveCurrentDaemonSourceDistFingerprint,
  resolveDaemonBundleRootPath,
  verifyDaemonActiveBundleIntegrity,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { ensureDaemonSystemServiceCommandFiles } from "../src/local-service/lifecycle/daemon-service-command-spec";
import { withTempHome } from "./helpers/fs";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;

type DaemonBundleFixtureLayout = "workspace" | "package_install";

type DaemonBundleFixture = {
  cliScriptPath: string;
  distRootPath: string;
  packageRootPath: string;
  cleanup: () => Promise<void>;
};

async function createDaemonBundleFixture(
  layout: DaemonBundleFixtureLayout
): Promise<DaemonBundleFixture> {
  const fixtureRoot = await mkdtemp(
    join(
      tmpdir(),
      layout === "workspace"
        ? "openmeld-daemon-workspace-"
        : "openmeld-daemon-package-install-"
    )
  );
  const packageRootPath =
    layout === "workspace"
      ? join(fixtureRoot, "openmeld", "clients", "openmeld-cli")
      : join(fixtureRoot, "package-install", "node_modules", "openmeld");
  const dependencyStoreRoot =
    layout === "workspace"
      ? join(packageRootPath, "node_modules")
      : join(fixtureRoot, "package-install", "node_modules");
  const distRootPath = join(packageRootPath, "dist");
  const commanderRootPath = join(dependencyStoreRoot, "commander");
  const kleurRootPath = join(dependencyStoreRoot, "kleur");

  await mkdir(distRootPath, { recursive: true });
  await mkdir(commanderRootPath, { recursive: true });
  await mkdir(kleurRootPath, { recursive: true });
  await writeFile(
    join(packageRootPath, "package.json"),
    `${JSON.stringify(
      {
        name: "openmeld",
        version: "0.1.9",
        type: "module",
        dependencies: {
          commander: "^14.0.0",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(distRootPath, "openmeld.js"),
    'import "commander";\nconsole.log("ok");\n',
    "utf8"
  );
  await writeFile(
    join(commanderRootPath, "package.json"),
    `${JSON.stringify(
      {
        name: "commander",
        version: "14.0.0",
        type: "module",
        exports: "./index.js",
        dependencies: {
          kleur: "^4.1.5",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(commanderRootPath, "index.js"),
    'import { green } from "kleur";\nexport const program = green("ok");\n',
    "utf8"
  );
  await writeFile(
    join(kleurRootPath, "package.json"),
    `${JSON.stringify(
      {
        name: "kleur",
        version: "4.1.5",
        type: "module",
        exports: "./index.js",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(kleurRootPath, "index.js"),
    "export const green = (value) => value;\n",
    "utf8"
  );

  return {
    cliScriptPath: join(distRootPath, "openmeld.js"),
    distRootPath,
    packageRootPath,
    cleanup: async () => {
      await rm(fixtureRoot, { recursive: true, force: true });
    },
  };
}

async function addEntrylessRuntimeDependency(
  fixture: DaemonBundleFixture
): Promise<void> {
  const packageJsonPath = join(fixture.packageRootPath, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(
      {
        ...packageJson,
        dependencies: {
          ...packageJson.dependencies,
          "@entryless/no-root-export": "1.0.0",
          "@entryless/sdk": "1.0.0",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const dependencyStoreRoot = join(fixture.packageRootPath, "node_modules");
  const noRootExportPath = join(
    dependencyStoreRoot,
    "@entryless",
    "no-root-export"
  );
  const entrylessSdkRootPath = join(dependencyStoreRoot, "@entryless", "sdk");
  const entrylessChildRootPath = join(dependencyStoreRoot, "entryless-child");
  await mkdir(noRootExportPath, { recursive: true });
  await mkdir(entrylessSdkRootPath, { recursive: true });
  await mkdir(entrylessChildRootPath, { recursive: true });
  await writeFile(
    join(noRootExportPath, "package.json"),
    `${JSON.stringify(
      {
        name: "@entryless/no-root-export",
        version: "1.0.0",
        type: "module",
        exports: {
          "./client": "./client.js",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(noRootExportPath, "client.js"),
    "export const client = 'ok';\n",
    "utf8"
  );
  await writeFile(
    join(entrylessSdkRootPath, "package.json"),
    `${JSON.stringify(
      {
        name: "@entryless/sdk",
        version: "1.0.0",
        type: "module",
        exports: {
          ".": "./dist/cjs/index.js",
        },
        dependencies: {
          "entryless-child": "1.0.0",
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(entrylessChildRootPath, "package.json"),
    `${JSON.stringify(
      {
        name: "entryless-child",
        version: "1.0.0",
        type: "module",
        exports: "./index.js",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(entrylessChildRootPath, "index.js"),
    "export const value = 'ok';\n",
    "utf8"
  );
}

async function withCliScriptArgv<T>(
  cliScriptPath: string,
  fn: () => Promise<T>
): Promise<T> {
  const hadArgvEntry = process.argv.length > 1;
  const previousArgvEntry = process.argv[1];
  if (hadArgvEntry) {
    process.argv[1] = cliScriptPath;
  } else {
    process.argv.push(cliScriptPath);
  }

  try {
    return await fn();
  } finally {
    if (hadArgvEntry) {
      process.argv[1] = previousArgvEntry ?? "";
    } else {
      process.argv.splice(1);
    }
  }
}

async function runNodeScript(
  scriptPath: string,
  args: string[] = [],
  options: SpawnOptionsWithoutStdio = {}
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stderr,
        stdout,
      });
    });
  });
}

describe("local service bundle", () => {
  it("stages and validates a replacement without changing the active service bundle", async () => {
    await withTempHome(async () => {
      const fixture = await createDaemonBundleFixture("package_install");

      try {
        const currentBundle = await prepareDaemonServiceBundle({
          daemonVersion: "1.2.2",
          cliScriptPath: fixture.cliScriptPath,
        });
        const replacementBundle = await prepareDaemonServiceBundle({
          activate: false,
          daemonVersion: "1.2.3",
          cliScriptPath: fixture.cliScriptPath,
        });

        await expect(readDaemonActiveBundleState()).resolves.toMatchObject({
          bundleId: currentBundle.bundleId,
          daemonVersion: "1.2.2",
        });
        await expect(
          stat(resolveDaemonBundleRootPath(replacementBundle.bundleId))
        ).resolves.toBeDefined();

        await discardPreparedDaemonServiceBundle(replacementBundle);

        await expect(
          stat(resolveDaemonBundleRootPath(replacementBundle.bundleId))
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readDaemonActiveBundleState()).resolves.toMatchObject({
          bundleId: currentBundle.bundleId,
          daemonVersion: "1.2.2",
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  it("activates a fully prepared replacement only when explicitly requested", async () => {
    await withTempHome(async () => {
      const fixture = await createDaemonBundleFixture("package_install");

      try {
        const replacementBundle = await prepareDaemonServiceBundle({
          activate: false,
          daemonVersion: "1.2.3",
          cliScriptPath: fixture.cliScriptPath,
        });

        await expect(readDaemonActiveBundleState()).resolves.toBeNull();

        await activateDaemonServiceBundle(replacementBundle);

        await expect(readDaemonActiveBundleState()).resolves.toMatchObject({
          bundleId: replacementBundle.bundleId,
          daemonVersion: "1.2.3",
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  it("prepares an active bundle and stable launcher under OpenMeld runtime", async () => {
    await withTempHome(async () => {
      const previousPreset = process.env.OPENMELD_ENV_PRESET;
      let fixture: DaemonBundleFixture | null = null;
      process.env.OPENMELD_ENV_PRESET = "dev-local";

      try {
        fixture = await createDaemonBundleFixture("workspace");
        await mkdir(join(fixture.distRootPath, "binary"), { recursive: true });
        await writeFile(
          join(fixture.distRootPath, "binary", "manifest.json"),
          '{"schemaVersion":1}\n',
          "utf8"
        );
        await writeFile(
          join(
            fixture.distRootPath,
            "binary",
            "openmeld-cli-darwin-arm64-1.2.3"
          ),
          "compiled binary\n",
          "utf8"
        );
        await mkdir(join(fixture.distRootPath, "native"), { recursive: true });
        await writeFile(
          join(fixture.distRootPath, "native", "openmeld-keychain.node"),
          "macOS secure storage addon\n",
          "utf8"
        );
        const bundleState = await prepareDaemonServiceBundle({
          daemonVersion: "1.2.3",
          cliScriptPath: fixture.cliScriptPath,
        });

        const activeState = await readDaemonActiveBundleState();
        const entryPath = await withCliScriptArgv(
          fixture.cliScriptPath,
          async () => await resolveAlignedDaemonActiveBundleEntryPath()
        );
        const bundleRootPath = resolveDaemonBundleRootPath(
          bundleState.bundleId
        );
        const bundlePackageJsonPath = join(bundleRootPath, "package.json");
        const bundleNodeModulesPath = join(bundleRootPath, "node_modules");
        const bundleCommanderPath = join(bundleNodeModulesPath, "commander");
        const wrapperPath = daemonServiceExecutableWrapperPath();
        const legacyWrapperPath = daemonServiceLegacyWrapperPath();

        expect(activeState?.bundleId).toBe(bundleState.bundleId);
        expect(activeState?.daemonVersion).toBe("1.2.3");
        expect(activeState?.bundleFormat).toBe("self_contained_v1");
        expect(activeState?.sourceDistFingerprint).toBe(
          bundleState.sourceDistFingerprint
        );
        expect(bundleState.sourceDistFingerprint).toMatch(SHA256_HEX_RE);
        expect(entryPath).toBe(
          join(
            resolveDaemonBundleRootPath(bundleState.bundleId),
            "dist",
            "openmeld.js"
          )
        );

        await expect(stat(daemonServiceLauncherPath())).resolves.toBeDefined();
        await expect(stat(wrapperPath)).resolves.toMatchObject({
          mode: expect.any(Number),
        });
        await expect(stat(legacyWrapperPath)).resolves.toMatchObject({
          mode: expect.any(Number),
        });
        const wrapperStats = await stat(wrapperPath);
        expect(wrapperStats.mode % 0o1000).toBe(0o700);
        await expect(readFile(wrapperPath, "utf8")).resolves.toBe(
          [
            "#!/bin/sh",
            `exec '${process.execPath}' '${daemonServiceLauncherPath()}' "$@"`,
            "",
          ].join("\n")
        );
        await expect(readFile(legacyWrapperPath, "utf8")).resolves.toBe(
          [
            "#!/bin/sh",
            `exec '${process.execPath}' '${daemonServiceLauncherPath()}' "$@"`,
            "",
          ].join("\n")
        );
        await expect(stat(entryPath ?? "")).resolves.toBeDefined();
        await expect(
          stat(join(bundleRootPath, "dist", "binary", "manifest.json"))
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          stat(join(bundleRootPath, "dist", "native", "openmeld-keychain.node"))
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(stat(bundlePackageJsonPath)).resolves.toBeDefined();
        await expect(
          readFile(bundlePackageJsonPath, "utf8")
        ).resolves.toContain('"type": "module"');
        await expect(
          lstat(bundleNodeModulesPath).then((stats) => stats.isSymbolicLink())
        ).resolves.toBe(false);
        await expect(stat(bundleNodeModulesPath)).resolves.toBeDefined();
        await expect(stat(bundleCommanderPath)).resolves.toBeDefined();
        if (!(activeState && entryPath)) {
          throw new Error("Expected the prepared Service bundle to be active.");
        }
        await expect(
          verifyDaemonActiveBundleIntegrity(activeState)
        ).resolves.toBe(true);
        await writeFile(entryPath, "corrupted Service bundle", "utf8");
        await expect(
          verifyDaemonActiveBundleIntegrity(activeState)
        ).resolves.toBe(false);
      } finally {
        await fixture?.cleanup();
        if (previousPreset === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
        } else {
          process.env.OPENMELD_ENV_PRESET = previousPreset;
        }
      }
    });
  });

  it("lets the stable launcher recover when active bundle state points at a missing bundle", async () => {
    await withTempHome(async () => {
      const fixture = await createDaemonBundleFixture("package_install");

      try {
        await installDaemon({
          daemonVersion: "1.2.3",
          source: "daemon.command.install",
        });
        const bundleState = await prepareDaemonServiceBundle({
          daemonVersion: "1.2.3",
          cliScriptPath: fixture.cliScriptPath,
        });
        await writeFile(
          daemonServiceActiveBundlePath(),
          `${JSON.stringify(
            {
              ...bundleState,
              bundleId: "service-bundle",
              updatedAt: "2026-03-08T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        const result = await runNodeScript(daemonServiceLauncherPath(), [
          "service",
          "status",
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("ok");
        expect(result.stderr).toContain("recovered bundle");
        await expect(readDaemonActiveBundleState()).resolves.toMatchObject({
          bundleId: bundleState.bundleId,
          bundleFormat: "self_contained_v1",
          daemonVersion: "1.2.3",
          entryScriptRelativePath: "dist/openmeld.js",
        });
      } finally {
        await fixture.cleanup();
      }
    });
  });

  it("refuses to prepare a repo-local workspace bundle outside the dev lane", async () => {
    await withTempHome(async () => {
      const fixture = await createDaemonBundleFixture("workspace");

      try {
        await expect(
          prepareDaemonServiceBundle({
            daemonVersion: "1.2.3",
            cliScriptPath: fixture.cliScriptPath,
          })
        ).rejects.toThrow(
          "Repo-local service files are only allowed through `openmeld-dev`."
        );
      } finally {
        await fixture.cleanup();
      }
    });
  });

  it("refuses to resolve a drifted active bundle entry when install-state and bundle-state disagree", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.2.0",
        source: "daemon.command.install",
      });
      const bundleRootPath = resolveDaemonBundleRootPath("workspace-bundle");
      const entryPath = join(bundleRootPath, "dist", "openmeld.js");

      await mkdir(join(bundleRootPath, "dist"), { recursive: true });
      await writeFile(entryPath, 'console.log("ok");\n', "utf8");
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleId: "workspace-bundle",
            daemonVersion: "1.0.0",
            entryScriptRelativePath: "dist/openmeld.js",
            bundleFormat: "self_contained_v1",
            sourceEntryScriptPath: "/tmp/workspace-cli/dist/openmeld.js",
            sourcePackageRootPath: "/tmp/workspace-cli",
            sourceDistRootPath: "/tmp/workspace-cli/dist",
            sourceKind: "workspace",
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(
        resolveAlignedDaemonActiveBundleEntryPath()
      ).resolves.toBeNull();
    });
  });

  it("materializes a physical stable macOS Service executable from the active signed binary", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "1.2.3",
        source: "daemon.command.install",
      });
      const managedBinaryPath = openMeldManagedVersionBinaryPath("1.2.3");
      const managedBinaryContent = "binary fixture";
      const managedBinaryFingerprint = createHash("sha256")
        .update(managedBinaryContent)
        .digest("hex");
      await mkdir(dirname(managedBinaryPath), { recursive: true });
      await writeFile(managedBinaryPath, managedBinaryContent, "utf8");
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleId: "binary-bundle",
            daemonVersion: "1.2.3",
            entryScriptRelativePath: "openmeld",
            bundleFormat: "binary_v1",
            sourceEntryScriptPath: managedBinaryPath,
            sourcePackageRootPath: dirname(managedBinaryPath),
            sourceDistRootPath: dirname(managedBinaryPath),
            sourceDistFingerprint: managedBinaryFingerprint,
            sourceKind: "package_install",
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      const stableExecutablePath = daemonServiceExecutableWrapperPath();
      await symlink(managedBinaryPath, stableExecutablePath);
      await ensureDaemonSystemServiceCommandFiles({
        controller: "launchd",
        distribution: "binary",
      });

      const stableExecutableStat = await lstat(stableExecutablePath);
      expect(stableExecutableStat.isFile()).toBe(true);
      expect(stableExecutableStat.isSymbolicLink()).toBe(false);
      await expect(readFile(stableExecutablePath, "utf8")).resolves.toBe(
        managedBinaryContent
      );

      await expect(resolveAlignedDaemonActiveBundleEntryPath()).resolves.toBe(
        stableExecutablePath
      );
      const activeBundle = await readDaemonActiveBundleState();
      if (!activeBundle) {
        throw new Error("Expected the binary active bundle fixture to exist.");
      }
      await expect(
        verifyDaemonActiveBundleIntegrity(activeBundle)
      ).resolves.toBe(true);

      await writeFile(stableExecutablePath, "corrupted binary fixture", "utf8");
      await expect(
        verifyDaemonActiveBundleIntegrity(activeBundle)
      ).resolves.toBe(false);
    });
  });

  it("replaces the stable macOS Service executable on upgrade and rollback", async () => {
    await withTempHome(async () => {
      const activateBinaryVersion = async (input: {
        content: string;
        version: string;
      }): Promise<void> => {
        const managedBinaryPath = openMeldManagedVersionBinaryPath(
          input.version
        );
        await mkdir(dirname(managedBinaryPath), { recursive: true });
        await writeFile(managedBinaryPath, input.content, "utf8");
        await mkdir(dirname(daemonServiceActiveBundlePath()), {
          recursive: true,
        });
        await writeFile(
          daemonServiceActiveBundlePath(),
          `${JSON.stringify(
            {
              v: 2,
              schema: "openmeld-daemon-active-bundle-v2",
              bundleId: `binary-${input.version}`,
              daemonVersion: input.version,
              entryScriptRelativePath: "openmeld",
              bundleFormat: "binary_v1",
              sourceEntryScriptPath: managedBinaryPath,
              sourcePackageRootPath: dirname(managedBinaryPath),
              sourceDistRootPath: dirname(managedBinaryPath),
              sourceDistFingerprint: createHash("sha256")
                .update(input.content)
                .digest("hex"),
              sourceKind: "package_install",
              createdAt: "2026-03-08T00:00:00.000Z",
              updatedAt: "2026-03-08T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        await ensureDaemonSystemServiceCommandFiles({
          controller: "launchd",
          distribution: "binary",
        });
      };
      const stableExecutablePath = daemonServiceExecutableWrapperPath();

      await activateBinaryVersion({
        content: "previous signed binary fixture",
        version: "1.2.3",
      });
      await expect(readFile(stableExecutablePath, "utf8")).resolves.toBe(
        "previous signed binary fixture"
      );

      await activateBinaryVersion({
        content: "next signed binary fixture",
        version: "1.2.4",
      });
      await expect(readFile(stableExecutablePath, "utf8")).resolves.toBe(
        "next signed binary fixture"
      );

      await activateBinaryVersion({
        content: "previous signed binary fixture",
        version: "1.2.3",
      });
      await expect(readFile(stableExecutablePath, "utf8")).resolves.toBe(
        "previous signed binary fixture"
      );
      await expect(
        lstat(stableExecutablePath).then((stats) => stats.isSymbolicLink())
      ).resolves.toBe(false);
    });
  });

  it("rejects a stale binary active bundle when service run expects a newer version", async () => {
    await withTempHome(async () => {
      await installDaemon({
        daemonVersion: "0.2.14",
        source: "daemon.command.install",
      });
      const oldManagedBinaryPath = openMeldManagedVersionBinaryPath("0.2.14");
      const oldManagedBinaryContent = "old binary fixture";
      const oldManagedBinaryFingerprint = createHash("sha256")
        .update(oldManagedBinaryContent)
        .digest("hex");
      await mkdir(dirname(oldManagedBinaryPath), { recursive: true });
      await writeFile(oldManagedBinaryPath, oldManagedBinaryContent, "utf8");
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 2,
            schema: "openmeld-daemon-active-bundle-v2",
            bundleId: "binary-0.2.14",
            daemonVersion: "0.2.14",
            entryScriptRelativePath: "openmeld",
            bundleFormat: "binary_v1",
            sourceEntryScriptPath: oldManagedBinaryPath,
            sourcePackageRootPath: dirname(oldManagedBinaryPath),
            sourceDistRootPath: dirname(oldManagedBinaryPath),
            sourceDistFingerprint: oldManagedBinaryFingerprint,
            sourceKind: "package_install",
            createdAt: "2026-07-07T00:00:00.000Z",
            updatedAt: "2026-07-07T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await writeFile(
        daemonServiceContractPath(),
        `${JSON.stringify(
          {
            schema: "openmeld-daemon-service-contract-v1",
            v: 1,
            lane: "prod",
            daemonVersion: "0.2.14",
            bundleId: "binary-0.2.14",
            desiredState: "background",
            serviceController: "launchd",
            autoStart: true,
            gatewayUrl: "https://gateway.openmeld.invalid",
            deviceId: "device-prod-realistic",
            heartbeatMs: 25_000,
            generation: 1,
            updatedAt: "2026-07-07T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(resolveAlignedDaemonActiveBundleEntryPath()).resolves.toBe(
        oldManagedBinaryPath
      );
      await expect(
        resolveAlignedDaemonActiveBundleEntryPath({
          expectedVersion: "0.2.15",
        })
      ).resolves.toBeNull();
    });
  });

  it("prefers the service contract over stale install-state when resolving the active bundle entry", async () => {
    await withTempHome(async () => {
      const previousPreset = process.env.OPENMELD_ENV_PRESET;
      let fixture: DaemonBundleFixture | null = null;
      process.env.OPENMELD_ENV_PRESET = "dev-local";

      try {
        fixture = await createDaemonBundleFixture("workspace");
        const sourceDistFingerprint =
          await resolveCurrentDaemonSourceDistFingerprint({
            cliScriptPath: fixture.cliScriptPath,
          });
        await installDaemon({
          daemonVersion: "0.2.0",
          source: "daemon.command.install",
        });
        const bundleRootPath = resolveDaemonBundleRootPath("workspace-bundle");
        const entryPath = join(bundleRootPath, "dist", "openmeld.js");

        await mkdir(join(bundleRootPath, "dist"), { recursive: true });
        await writeFile(entryPath, 'console.log("ok");\n', "utf8");
        await writeFile(
          daemonServiceActiveBundlePath(),
          `${JSON.stringify(
            {
              v: 2,
              schema: "openmeld-daemon-active-bundle-v2",
              bundleId: "workspace-bundle",
              daemonVersion: "1.0.0",
              entryScriptRelativePath: "dist/openmeld.js",
              bundleFormat: "self_contained_v1",
              sourceEntryScriptPath: fixture.cliScriptPath,
              sourcePackageRootPath: fixture.packageRootPath,
              sourceDistRootPath: fixture.distRootPath,
              sourceDistFingerprint,
              sourceKind: "workspace",
              createdAt: "2026-03-08T00:00:00.000Z",
              updatedAt: "2026-03-08T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        await writeFile(
          daemonServiceContractPath(),
          `${JSON.stringify(
            {
              schema: "openmeld-daemon-service-contract-v1",
              v: 1,
              lane: "dev-local",
              daemonVersion: "1.0.0",
              bundleId: "workspace-bundle",
              desiredState: "background",
              serviceController: "launchd",
              autoStart: true,
              gatewayUrl: "https://gateway.openmeld.invalid",
              profileId: "agt_existing",
              deviceId: "device_123",
              heartbeatMs: 25_000,
              generation: 1,
              updatedAt: "2026-03-08T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        await expect(
          withCliScriptArgv(
            fixture.cliScriptPath,
            async () => await resolveAlignedDaemonActiveBundleEntryPath()
          )
        ).resolves.toBe(entryPath);
      } finally {
        await fixture?.cleanup();
        if (previousPreset === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
        } else {
          process.env.OPENMELD_ENV_PRESET = previousPreset;
        }
      }
    });
  });

  it("normalizes legacy active bundle state into the current schema", async () => {
    await withTempHome(async () => {
      await mkdir(
        join(process.env.HOME ?? "", ".openmeld", "runtime", "daemon", "state"),
        {
          recursive: true,
        }
      );
      await writeFile(
        daemonServiceActiveBundlePath(),
        `${JSON.stringify(
          {
            v: 1,
            schema: "openmeld-daemon-active-bundle-v1",
            bundleId: "legacy-bundle",
            daemonVersion: "0.1.9",
            entryScriptRelativePath: "dist/openmeld.js",
            sourceDistRootPath: "/tmp/legacy-cli/dist",
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(readDaemonActiveBundleState()).resolves.toMatchObject({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleFormat: "legacy_linked_v1",
        sourceEntryScriptPath: "/tmp/legacy-cli/dist/openmeld.js",
        sourcePackageRootPath: "/tmp/legacy-cli",
      });
    });
  });

  it("keeps a self-contained bundle usable after the source package disappears", async () => {
    await withTempHome(async () => {
      const fixtureRoot = await mkdtemp(
        join(tmpdir(), "openmeld-daemon-bundle-")
      );
      const fixturePackageRoot = join(fixtureRoot, "openmeld");
      const fixtureDistRoot = join(fixturePackageRoot, "dist");
      const fixtureDependencyRoot = join(
        fixturePackageRoot,
        "node_modules",
        "commander"
      );
      const fixtureTransitiveDependencyRoot = join(
        fixturePackageRoot,
        "node_modules",
        "kleur"
      );

      try {
        await mkdir(fixtureDistRoot, { recursive: true });
        await mkdir(fixtureDependencyRoot, { recursive: true });
        await mkdir(fixtureTransitiveDependencyRoot, { recursive: true });
        await writeFile(
          join(fixturePackageRoot, "package.json"),
          `${JSON.stringify(
            {
              name: "openmeld",
              version: "0.1.9",
              type: "module",
              dependencies: {
                commander: "^14.0.0",
              },
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        await writeFile(
          join(fixtureDistRoot, "openmeld.js"),
          'import "commander";\nconsole.log("ok");\n',
          "utf8"
        );
        await writeFile(
          join(fixtureDependencyRoot, "package.json"),
          `${JSON.stringify(
            {
              name: "commander",
              version: "14.0.0",
              type: "module",
              exports: "./index.js",
              dependencies: {
                kleur: "^4.1.5",
              },
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        await writeFile(
          join(fixtureDependencyRoot, "index.js"),
          'import { green } from "kleur";\nexport const program = green("ok");\n',
          "utf8"
        );
        await writeFile(
          join(fixtureTransitiveDependencyRoot, "package.json"),
          `${JSON.stringify(
            {
              name: "kleur",
              version: "4.1.5",
              type: "module",
              exports: "./index.js",
            },
            null,
            2
          )}\n`,
          "utf8"
        );
        await writeFile(
          join(fixtureTransitiveDependencyRoot, "index.js"),
          "export const green = (value) => value;\n",
          "utf8"
        );

        const bundleState = await prepareDaemonServiceBundle({
          daemonVersion: "0.1.9",
          cliScriptPath: join(fixtureDistRoot, "openmeld.js"),
        });
        await rm(fixturePackageRoot, { recursive: true, force: true });

        const bundleRootPath = resolveDaemonBundleRootPath(
          bundleState.bundleId
        );
        await expect(
          stat(join(bundleRootPath, "dist", "openmeld.js"))
        ).resolves.toBeDefined();
        await expect(
          stat(join(bundleRootPath, "node_modules", "commander", "index.js"))
        ).resolves.toBeDefined();
        await expect(
          stat(join(bundleRootPath, "node_modules", "kleur", "index.js"))
        ).resolves.toBeDefined();
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  });

  it("bundles runtime dependencies from a package install with hoisted node_modules", async () => {
    await withTempHome(async () => {
      const fixture = await createDaemonBundleFixture("package_install");

      try {
        const bundleState = await prepareDaemonServiceBundle({
          daemonVersion: "0.1.9",
          cliScriptPath: fixture.cliScriptPath,
        });
        const bundleRootPath = resolveDaemonBundleRootPath(
          bundleState.bundleId
        );

        await expect(
          stat(join(bundleRootPath, "dist", "openmeld.js"))
        ).resolves.toBeDefined();
        await expect(
          stat(join(bundleRootPath, "node_modules", "commander", "index.js"))
        ).resolves.toBeDefined();
        await expect(
          stat(join(bundleRootPath, "node_modules", "kleur", "index.js"))
        ).resolves.toBeDefined();
      } finally {
        await fixture.cleanup();
      }
    });
  });

  it("bundles dependency packages whose root export has no installed entry file", async () => {
    await withTempHome(async () => {
      const previousPreset = process.env.OPENMELD_ENV_PRESET;
      let fixture: DaemonBundleFixture | null = null;
      process.env.OPENMELD_ENV_PRESET = "dev-local";

      try {
        fixture = await createDaemonBundleFixture("workspace");
        await addEntrylessRuntimeDependency(fixture);

        const bundleState = await prepareDaemonServiceBundle({
          daemonVersion: "0.1.9",
          cliScriptPath: fixture.cliScriptPath,
        });
        const bundleRootPath = resolveDaemonBundleRootPath(
          bundleState.bundleId
        );

        await expect(
          stat(
            join(
              bundleRootPath,
              "node_modules",
              "@entryless",
              "no-root-export",
              "package.json"
            )
          )
        ).resolves.toBeDefined();
        await expect(
          stat(
            join(
              bundleRootPath,
              "node_modules",
              "@entryless",
              "sdk",
              "package.json"
            )
          )
        ).resolves.toBeDefined();
        await expect(
          stat(
            join(bundleRootPath, "node_modules", "entryless-child", "index.js")
          )
        ).resolves.toBeDefined();
      } finally {
        await fixture?.cleanup();
        if (previousPreset === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
        } else {
          process.env.OPENMELD_ENV_PRESET = previousPreset;
        }
      }
    });
  });

  it("cleans inactive bundles while keeping the active bundle", async () => {
    await withTempHome(async () => {
      const previousPreset = process.env.OPENMELD_ENV_PRESET;
      let fixture: DaemonBundleFixture | null = null;
      process.env.OPENMELD_ENV_PRESET = "dev-local";

      try {
        fixture = await createDaemonBundleFixture("workspace");
        const firstBundle = await prepareDaemonServiceBundle({
          daemonVersion: "1.0.0",
          cliScriptPath: fixture.cliScriptPath,
        });
        const secondBundle = await prepareDaemonServiceBundle({
          daemonVersion: "2.0.0",
          cliScriptPath: fixture.cliScriptPath,
        });

        await cleanupInactiveDaemonServiceBundles();

        await expect(
          stat(resolveDaemonBundleRootPath(secondBundle.bundleId))
        ).resolves.toBeDefined();
        await expect(
          stat(resolveDaemonBundleRootPath(firstBundle.bundleId))
        ).rejects.toThrow();
      } finally {
        await fixture?.cleanup();
        if (previousPreset === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
        } else {
          process.env.OPENMELD_ENV_PRESET = previousPreset;
        }
      }
    });
  });

  it("keeps the runtime bundle while the runtime lease still points at it", async () => {
    await withTempHome(async () => {
      const previousPreset = process.env.OPENMELD_ENV_PRESET;
      let fixture: DaemonBundleFixture | null = null;
      process.env.OPENMELD_ENV_PRESET = "dev-local";

      try {
        fixture = await createDaemonBundleFixture("workspace");
        const runtimeBundle = await prepareDaemonServiceBundle({
          daemonVersion: "1.0.0",
          cliScriptPath: fixture.cliScriptPath,
        });
        const activeBundle = await prepareDaemonServiceBundle({
          daemonVersion: "2.0.0",
          cliScriptPath: fixture.cliScriptPath,
        });
        await writeFile(
          daemonRuntimeLeasePath(),
          `${JSON.stringify(
            {
              schema: "openmeld-daemon-runtime-lease-v1",
              v: 1,
              generation: 2,
              bundleId: runtimeBundle.bundleId,
              pid: process.pid,
              mode: "background",
              startedAt: "2026-03-07T00:00:00.000Z",
              updatedAt: "2026-03-07T00:00:00.000Z",
              heartbeatAt: "2026-03-07T00:00:00.000Z",
              serviceController: "launchd",
              managedBySystemService: true,
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        await cleanupInactiveDaemonServiceBundles();

        await expect(
          stat(resolveDaemonBundleRootPath(runtimeBundle.bundleId))
        ).resolves.toBeDefined();
        await expect(
          stat(resolveDaemonBundleRootPath(activeBundle.bundleId))
        ).resolves.toBeDefined();
      } finally {
        await fixture?.cleanup();
        if (previousPreset === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
        } else {
          process.env.OPENMELD_ENV_PRESET = previousPreset;
        }
      }
    });
  });
});
