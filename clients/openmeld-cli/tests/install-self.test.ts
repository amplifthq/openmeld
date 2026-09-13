import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDaemonServiceUpdateWorkerRegistrationPath } from "../src/config/daemon-service-update-worker-registration";
import { daemonServiceActiveBundleStatePath } from "../src/config/daemon-state";
import {
  buildInstallSelfJsonPayload,
  performManagedInstall,
  pruneManagedInstallVersions,
  resolveCliSelfVersion,
  withManagedInstallTransaction,
} from "../src/local-components/managed-install";
import { persistPendingDaemonServiceUpdate } from "../src/local-service/lifecycle/daemon-service-update-state";

const PLATFORM_TOKEN_REGEX = /^[a-z0-9]+-[a-z0-9]+$/;

describe("managed install (install-self)", () => {
  const originalHome = process.env.OPENMELD_HOME;
  const originalOsHome = process.env.HOME;
  let home: string;
  let source: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "wl-install-self-"));
    process.env.HOME = home;
    process.env.OPENMELD_HOME = home;
    source = path.join(home, "source-binary");
    await writeFile(source, "#!/bin/sh\necho fake\n");
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      Reflect.deleteProperty(process.env, "OPENMELD_HOME");
    } else {
      process.env.OPENMELD_HOME = originalHome;
    }
    if (originalOsHome === undefined) {
      Reflect.deleteProperty(process.env, "HOME");
    } else {
      process.env.HOME = originalOsHome;
    }
    await rm(home, { recursive: true, force: true });
  });

  async function installNewerVersion(version: string): Promise<void> {
    const versionDir = path.join(home, "versions", version);
    await mkdir(versionDir, { recursive: true });
    await writeFile(path.join(versionDir, "openmeld"), "newer");
    await chmod(path.join(versionDir, "openmeld"), 0o755);
    await mkdir(path.join(home, "bin"), { recursive: true });
    await symlink(
      path.join("..", "versions", version, "openmeld"),
      path.join(home, "bin", "openmeld")
    );
  }

  it("installs into versions/<v> and points bin/openmeld at it", async () => {
    const version = resolveCliSelfVersion();
    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("installed");
    expect(outcome.previousVersion).toBeNull();
    await expect(
      lstat(path.join(home, "versions", version, "openmeld"))
    ).resolves.toBeDefined();
    const target = await readlink(path.join(home, "bin", "openmeld"));
    expect(target).toBe(path.join("..", "versions", version, "openmeld"));
  });

  it("is idempotent for the same version", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("noop_same_version");
    expect(outcome.previousVersion).toBe(resolveCliSelfVersion());
  });

  it("retains the active Service across CLI cleanup and releases it after replacement", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    for (const version of ["0.1.0", "0.2.0"]) {
      const versionDir = path.join(home, "versions", version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(path.join(versionDir, "openmeld"), version);
      await chmod(path.join(versionDir, "openmeld"), 0o755);
    }
    const statePath = daemonServiceActiveBundleStatePath();
    await mkdir(path.dirname(statePath), { recursive: true });
    const serviceRoot = path.join(home, "versions", "0.1.0");
    await writeFile(
      statePath,
      JSON.stringify({
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId: "active-service",
        daemonVersion: "0.1.0",
        entryScriptRelativePath: "openmeld",
        bundleFormat: "binary_v1",
        sourceEntryScriptPath: path.join(serviceRoot, "openmeld"),
        sourcePackageRootPath: serviceRoot,
        sourceDistRootPath: serviceRoot,
        sourceKind: "package_install",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );

    await pruneManagedInstallVersions({ pathInput: {} });
    await expect(
      readFile(path.join(serviceRoot, "openmeld"), "utf8")
    ).resolves.toBe("0.1.0");
    await rm(statePath);
    await pruneManagedInstallVersions({ pathInput: {} });
    await expect(lstat(serviceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(path.join(home, "versions", "0.2.0", "openmeld"))
    ).resolves.toBeDefined();
  });

  it("keeps the managed install valid when two upgrades run together", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    for (const version of ["0.1.0", "0.2.0", "0.3.9"]) {
      const versionDir = path.join(home, "versions", version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(path.join(versionDir, "openmeld"), version);
      await chmod(path.join(versionDir, "openmeld"), 0o755);
    }

    await Promise.all([
      performManagedInstall({ force: true, sourceBinaryPath: source }),
      performManagedInstall({ force: true, sourceBinaryPath: source }),
    ]);

    await expect(readlink(path.join(home, "bin", "openmeld"))).resolves.toBe(
      path.join("..", "versions", resolveCliSelfVersion(), "openmeld")
    );
    await expect(
      readFile(
        path.join(home, "versions", resolveCliSelfVersion(), "openmeld"),
        "utf8"
      )
    ).resolves.toBe("#!/bin/sh\necho fake\n");
    await expect(readdir(path.join(home, "versions"))).resolves.toHaveLength(2);
  });

  it("serializes a durable target commit with other managed install mutations", async () => {
    const firstTransactionEntered = Promise.withResolvers<void>();
    const releaseFirstTransaction = Promise.withResolvers<void>();
    const secondTransactionEntered = Promise.withResolvers<void>();

    const firstTransaction = withManagedInstallTransaction(async () => {
      firstTransactionEntered.resolve();
      await releaseFirstTransaction.promise;
    });
    await firstTransactionEntered.promise;

    const secondTransaction = withManagedInstallTransaction(() => {
      secondTransactionEntered.resolve();
      return Promise.resolve();
    });
    const firstBoundary = await Promise.race([
      secondTransactionEntered.promise.then(() => "second_entered" as const),
      Promise.resolve("second_blocked" as const),
    ]);

    expect(firstBoundary).toBe("second_blocked");
    releaseFirstTransaction.resolve();
    await Promise.all([firstTransaction, secondTransaction]);
    await expect(secondTransactionEntered.promise).resolves.toBeUndefined();
  });

  it("keeps the current binary and one rollback version instead of accumulating every release", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    for (const version of ["0.1.0", "0.2.0", "0.3.9", "0.3.11"]) {
      const versionDir = path.join(home, "versions", version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(path.join(versionDir, "openmeld"), version);
      await chmod(path.join(versionDir, "openmeld"), 0o755);
    }
    await mkdir(path.join(home, "versions", "0.3.8"));
    await mkdir(path.join(home, "versions", "0.3.9+."));
    await writeFile(
      path.join(home, "versions", "0.3.9+.", "openmeld"),
      "invalid-version"
    );
    await mkdir(path.join(home, "versions", "manual-backup"));

    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("noop_same_version");
    const installedVersions = await readdir(path.join(home, "versions"));
    expect(installedVersions.sort()).toEqual(
      ["0.3.11", "0.3.9+.", resolveCliSelfVersion(), "manual-backup"].sort()
    );
  });

  it("keeps a legacy update worker's pinned version until the worker is re-registered", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    for (const version of ["0.1.0", "0.2.0", "0.3.9"]) {
      const versionDir = path.join(home, "versions", version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(path.join(versionDir, "openmeld"), version);
      await chmod(path.join(versionDir, "openmeld"), 0o755);
    }
    const registrationPath = resolveDaemonServiceUpdateWorkerRegistrationPath(
      { homeDir: home },
      process.platform
    );
    if (registrationPath === null) {
      throw new Error(`Unsupported test platform: ${process.platform}`);
    }
    await mkdir(path.dirname(registrationPath), { recursive: true });
    await writeFile(
      registrationPath,
      `<plist><array><string>${path.join(
        home,
        "versions",
        "0.1.0",
        "openmeld"
      )}</string></array></plist>`
    );

    await performManagedInstall({ sourceBinaryPath: source });

    await expect(readdir(path.join(home, "versions"))).resolves.toEqual(
      expect.arrayContaining(["0.1.0", "0.3.9", resolveCliSelfVersion()])
    );
  });

  it("keeps the version referenced by a durable pending Service update", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    for (const version of ["0.1.0", "0.3.9"]) {
      const versionDir = path.join(home, "versions", version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(path.join(versionDir, "openmeld"), version);
      await chmod(path.join(versionDir, "openmeld"), 0o755);
    }
    await persistPendingDaemonServiceUpdate({
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "pending-service-update",
      phase: "waiting_for_work",
      preparedBundle: {
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleFormat: "binary_v1",
        bundleId: "binary-0.1.0",
        createdAt: "2026-08-29T00:00:00.000Z",
        daemonVersion: "0.1.0",
        entryScriptRelativePath: "openmeld",
        sourceDistFingerprint: "abc123",
        sourceDistRootPath: path.join(home, "versions", "0.1.0"),
        sourceEntryScriptPath: path.join(home, "versions", "0.1.0", "openmeld"),
        sourceKind: "package_install",
        sourcePackageRootPath: path.join(home, "versions", "0.1.0"),
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
      requestedAt: "2026-08-29T00:00:00.000Z",
      requestSource: "automatic",
      targetVersion: "0.1.0",
      updatedAt: "2026-08-29T00:00:00.000Z",
      urgency: "required",
    });

    await performManagedInstall({ sourceBinaryPath: source });

    await expect(readdir(path.join(home, "versions"))).resolves.toEqual(
      expect.arrayContaining(["0.1.0", "0.3.9", resolveCliSelfVersion()])
    );
  });

  it("prunes after a Service update commit without deleting the current CLI or durable target", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    for (const version of ["0.1.0", "0.2.0", "0.3.9"]) {
      const versionDir = path.join(home, "versions", version);
      await mkdir(versionDir, { recursive: true });
      await writeFile(path.join(versionDir, "openmeld"), version);
      await chmod(path.join(versionDir, "openmeld"), 0o755);
    }
    await persistPendingDaemonServiceUpdate({
      v: 2,
      schema: "openmeld-daemon-service-update-job-v2",
      attempts: 0,
      desiredState: "background",
      errorMessage: null,
      jobId: "committed-service-update",
      phase: "waiting_for_work",
      preparedBundle: {
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleFormat: "binary_v1",
        bundleId: "binary-0.1.0",
        createdAt: "2026-08-29T00:00:00.000Z",
        daemonVersion: "0.1.0",
        entryScriptRelativePath: "openmeld",
        sourceDistFingerprint: "abc123",
        sourceDistRootPath: path.join(home, "versions", "0.1.0"),
        sourceEntryScriptPath: path.join(home, "versions", "0.1.0", "openmeld"),
        sourceKind: "package_install",
        sourcePackageRootPath: path.join(home, "versions", "0.1.0"),
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
      requestedAt: "2026-08-29T00:00:00.000Z",
      requestSource: "automatic",
      targetVersion: "0.1.0",
      updatedAt: "2026-08-29T00:00:00.000Z",
      urgency: "required",
    });

    await pruneManagedInstallVersions({
      pathInput: {
        env: { ...process.env, OPENMELD_HOME: home },
        homeDir: home,
      },
      preferredRollbackVersion: "0.3.9",
    });

    await expect(readdir(path.join(home, "versions"))).resolves.toEqual(
      ["0.1.0", "0.3.9", resolveCliSelfVersion()].sort()
    );
    await expect(readlink(path.join(home, "bin", "openmeld"))).resolves.toBe(
      path.join("..", "versions", resolveCliSelfVersion(), "openmeld")
    );
  });

  it("repairs an incomplete current version instead of reporting a no-op", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    const managedBinaryPath = path.join(
      home,
      "versions",
      resolveCliSelfVersion(),
      "openmeld"
    );
    await rm(managedBinaryPath);
    await mkdir(managedBinaryPath);

    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("installed");
    await expect(lstat(managedBinaryPath)).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    expect((await lstat(managedBinaryPath)).isFile()).toBe(true);
  });

  it("repairs a broken current pointer whose versioned binary is missing", async () => {
    const version = resolveCliSelfVersion();
    await performManagedInstall({ sourceBinaryPath: source });
    const managedBinaryPath = path.join(home, "versions", version, "openmeld");
    await rm(managedBinaryPath);

    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("installed");
    await expect(readFile(managedBinaryPath, "utf8")).resolves.toBe(
      "#!/bin/sh\necho fake\n"
    );
    await expect(readlink(path.join(home, "bin", "openmeld"))).resolves.toBe(
      path.join("..", "versions", version, "openmeld")
    );
  });

  it("replaces a non-symlink current pointer", async () => {
    const currentPointerPath = path.join(home, "bin", "openmeld");
    await mkdir(path.dirname(currentPointerPath), { recursive: true });
    await writeFile(currentPointerPath, "stale unmanaged binary");

    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("installed");
    expect(outcome.previousVersion).toBeNull();
    await expect(readlink(currentPointerPath)).resolves.toBe(
      path.join("..", "versions", resolveCliSelfVersion(), "openmeld")
    );
  });

  it("replaces the same version when forced", async () => {
    await performManagedInstall({ sourceBinaryPath: source });
    await writeFile(source, "#!/bin/sh\necho replacement\n");

    const outcome = await performManagedInstall({
      force: true,
      sourceBinaryPath: source,
    });

    expect(outcome.result).toBe("installed");
    expect(outcome.previousVersion).toBe(resolveCliSelfVersion());
    await expect(
      readFile(
        path.join(home, "versions", resolveCliSelfVersion(), "openmeld"),
        "utf8"
      )
    ).resolves.toBe("#!/bin/sh\necho replacement\n");
  });

  it("does not downgrade when a newer version is present", async () => {
    await installNewerVersion("99.9.9");
    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("noop_newer_present");
    expect(outcome.previousVersion).toBe("99.9.9");
  });

  it("places the current versioned binary without moving the pointer when a newer version is present", async () => {
    await installNewerVersion("99.9.9");
    const outcome = await performManagedInstall({ sourceBinaryPath: source });

    expect(outcome.result).toBe("noop_newer_present");
    await expect(
      lstat(path.join(home, "versions", resolveCliSelfVersion(), "openmeld"))
    ).resolves.toBeDefined();
    await expect(
      readFile(
        path.join(home, "versions", resolveCliSelfVersion(), "openmeld"),
        "utf8"
      )
    ).resolves.toBe("#!/bin/sh\necho fake\n");
    await expect(readlink(path.join(home, "bin", "openmeld"))).resolves.toBe(
      path.join("..", "versions", "99.9.9", "openmeld")
    );
  });

  it("downgrades a newer version only with force", async () => {
    await installNewerVersion("99.9.9");
    const outcome = await performManagedInstall({
      force: true,
      sourceBinaryPath: source,
    });

    expect(outcome.result).toBe("installed");
    expect(outcome.forced).toBe(true);
    const target = await readlink(path.join(home, "bin", "openmeld"));
    expect(target).toBe(
      path.join("..", "versions", resolveCliSelfVersion(), "openmeld")
    );
  });

  it("emits the frozen install-self json shape", async () => {
    const outcome = await performManagedInstall({ sourceBinaryPath: source });
    const payload = buildInstallSelfJsonPayload(outcome);

    expect(payload).toMatchObject({
      schemaVersion: 1,
      type: "cli.install_self",
      result: "installed",
      version: resolveCliSelfVersion(),
      previousVersion: null,
      forced: false,
    });
    expect(payload.platform).toMatch(PLATFORM_TOKEN_REGEX);
    expect(Object.keys(payload).sort()).toEqual([
      "currentPointerPath",
      "forced",
      "managedBinaryPath",
      "platform",
      "previousVersion",
      "result",
      "schemaVersion",
      "type",
      "version",
    ]);
  });
});
