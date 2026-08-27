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
import { resolveDaemonServiceUpdateWorkerLaunchdPlistPath } from "../src/config/daemon-service-update-worker-registration";
import {
  buildInstallSelfJsonPayload,
  performManagedInstall,
  resolveCliSelfVersion,
} from "../src/local-components/managed-install";

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
    const registrationPath = resolveDaemonServiceUpdateWorkerLaunchdPlistPath({
      homeDir: home,
    });
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
