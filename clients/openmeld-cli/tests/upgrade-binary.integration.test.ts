import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  resolveCliBinaryUpdatePlan,
  verifyCliBinaryCodeSignature,
} from "@openmeld/local-service/cli-binary-update-artifact";
import {
  OPENMELD_MACOS_CLI_SIGNING_REQUIREMENT,
  resolveOpenMeldToolsUpdateTargetVersions,
} from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import type { DaemonServiceUpdateJob } from "../src/local-service/lifecycle/daemon-service-update-state";
import { resolveOpenMeldToolsUpdateFailure } from "../src/local-service/maintenance/openmeld-tools-update-failure";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { seedVersionState } from "./helpers/version";

const {
  canUseInteractivePromptsMock,
  confirmMock,
  inspectDaemonServiceInventoryMock,
  isCancelMock,
  resolveDaemonServiceAlignmentDecisionMock,
  runDaemonServiceFullAlignmentMock,
  scheduleDaemonServiceUpdateMock,
} = vi.hoisted(() => ({
  canUseInteractivePromptsMock: vi.fn(),
  confirmMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  isCancelMock: vi.fn((value: unknown) => value === "__cancel__"),
  resolveDaemonServiceAlignmentDecisionMock: vi.fn(),
  runDaemonServiceFullAlignmentMock: vi.fn(),
  scheduleDaemonServiceUpdateMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process"
    );
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: (value: unknown) => isCancelMock(value),
}));

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => true,
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: (context: unknown) =>
    canUseInteractivePromptsMock(context),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: (...args: unknown[]) =>
    inspectDaemonServiceInventoryMock(...args),
}));

vi.mock(
  "../src/local-service/lifecycle/daemon-service-alignment-target",
  () => ({
    buildDaemonServiceTargetSpec: (input: unknown) => input,
    resolveDaemonServiceAlignmentDecision: (...args: unknown[]) =>
      resolveDaemonServiceAlignmentDecisionMock(...args),
  })
);

vi.mock(
  "../src/local-service/lifecycle/daemon-service-alignment-executor",
  () => ({
    runDaemonServiceFullAlignment: (...args: unknown[]) =>
      runDaemonServiceFullAlignmentMock(...args),
  })
);

vi.mock(
  "../src/local-service/lifecycle/daemon-service-update-coordinator",
  () => ({
    scheduleDaemonServiceUpdate: (...args: unknown[]) =>
      scheduleDaemonServiceUpdateMock(...args),
  })
);

const BINARY_MANIFEST_URL = "https://dev.openmeld.test/cli/manifest.json";
const BINARY_VERSION = "9.9.9";

describe("openmeld upgrade in binary distribution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    vi.stubEnv("OPENMELD_CLI_BINARY_MANIFEST_URL", BINARY_MANIFEST_URL);
    vi.stubGlobal("fetch", vi.fn());
    canUseInteractivePromptsMock.mockReset().mockReturnValue(false);
    confirmMock.mockReset().mockResolvedValue(true);
    inspectDaemonServiceInventoryMock.mockReset().mockResolvedValue({});
    isCancelMock.mockReset().mockImplementation((value: unknown) => {
      return value === "__cancel__";
    });
    resolveDaemonServiceAlignmentDecisionMock.mockReset().mockReturnValue({
      status: "already_aligned",
      reasonCodes: [],
    });
    runDaemonServiceFullAlignmentMock.mockReset().mockResolvedValue({
      status: "aligned",
      targetVersion: packageJson.version,
      inventoryBefore: {},
      inventoryAfter: {},
      reasonCodes: [],
      completedSteps: [],
      restoredBackground: false,
      backupDataPath: null,
      errorMessage: null,
    });
    scheduleDaemonServiceUpdateMock.mockReset().mockResolvedValue({
      status: "scheduled",
      job: {
        jobId: "update-1",
        targetVersion: packageJson.version,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("points binary upgrade recovery to the matching Web lane", async () => {
    const { resolveBinaryUpgradeRecoveryUrl, runUpgrade } =
      await loadUpgradeModules();

    expect(
      resolveBinaryUpgradeRecoveryUrl({
        OPENMELD_ENV_PRESET: "canary",
        OPENMELD_CLI_BINARY_MANIFEST_URL:
          "https://staging.openmeld.ai/cli/manifest.json",
      })
    ).toBe("https://staging.openmeld.ai");
    expect(resolveBinaryUpgradeRecoveryUrl({})).toBe("https://openmeld.ai");
    await withTempHome(async () => {
      await expect(runUpgrade({ view: "human" })).rejects.toThrow(
        "Manual fallback: Open https://openmeld.ai, go to Computers, and use Update manually or Connect Computer to get a fresh setup command. Run that command on this Mac."
      );
    });
  });

  it("downloads the manifest artifact, verifies it, installs itself, and hands off to the managed binary", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const artifactBytes = Buffer.from("fake openmeld binary\n", "utf8");
      const archiveBytes = gzipSync(artifactBytes);
      const manifest = buildBinaryManifest(artifactBytes, { archiveBytes });
      const fetchMock = mockBinaryFetch(manifest, archiveBytes);
      const managedBinaryPath = join(
        home,
        ".openmeld",
        "versions",
        BINARY_VERSION,
        "openmeld"
      );
      mockSpawnSequence([
        {
          code: 0,
          stdout: `${JSON.stringify({
            schemaVersion: 1,
            type: "cli.install_self",
            result: "installed",
            version: BINARY_VERSION,
            platform: currentPlatformToken(),
            managedBinaryPath,
            currentPointerPath: join(home, ".openmeld", "bin", "openmeld"),
            previousVersion: packageJson.version,
            forced: true,
          })}\n`,
        },
        {
          code: 0,
          stdout:
            '{"type":"data","code":"upgrade.reconcile.completed","payload":{"ok":true}}\n',
        },
      ]);

      const {
        runUpgrade,
        readVersionState,
        UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG,
      } = await loadUpgradeModules();
      const { stdout } = await withCapturedStdio(async () => {
        await runUpgrade({
          view: "agent",
          yes: true,
        });
      });

      expect(fetchMock).toHaveBeenCalledWith(
        BINARY_MANIFEST_URL,
        expect.objectContaining({ method: "GET" })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        manifest.channels.stable.platforms[currentPlatformToken()]?.archiveUrl,
        expect.objectContaining({ method: "GET" })
      );
      expect(vi.mocked(spawn).mock.calls).toHaveLength(2);
      const [installCommand, installArgs] =
        vi.mocked(spawn).mock.calls[0] ?? [];
      expect(String(installCommand)).toContain(
        `openmeld-cli-${currentPlatformToken()}-${BINARY_VERSION}`
      );
      expect(installArgs).toEqual(["install-self", "--force", "--json"]);
      expect(vi.mocked(spawn).mock.calls[1]?.[0]).toBe(managedBinaryPath);
      expect(vi.mocked(spawn).mock.calls[1]?.[1]).toEqual([
        "--view",
        "agent",
        "upgrade",
        UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG,
      ]);
      expect(vi.mocked(spawn).mock.calls[1]?.[0]).not.toBe(process.execPath);
      expect(stdout).toContain('"code":"upgrade.installing"');
      expect(stdout).toContain('"distribution":"binary"');
      expect(stdout).toContain(
        `"downloadSizeBytes":${archiveBytes.byteLength}`
      );
      expect(stdout).toContain('"preferredTransport":"archive"');
      expect(stdout).toContain('"code":"upgrade.checking.completed"');
      expect(stdout).toContain('"code":"upgrade.installing.completed"');
      expect(stdout).toContain('"code":"upgrade.service_alignment.started"');
      expect(stdout).toContain('"code":"upgrade.service_alignment.completed"');
      expect(stdout).toContain('"message":"OpenMeld Service check finished."');
      expect(stdout).not.toContain("OpenMeld Service matches the new CLI.");
      expect(stdout).toContain('"durationMs":');
      expect(stdout).toContain('"code":"upgrade.reconcile.completed"');
      expect(stdout).toContain('"code":"upgrade.completed"');
      await expect(readVersionState()).resolves.toMatchObject({
        last_version: BINARY_VERSION,
        latest_version: BINARY_VERSION,
      });
    });
  });

  it("classifies a temporary workspace failure before download as an install failure", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const artifactBytes = Buffer.from("fake openmeld binary\n", "utf8");
      const manifest = buildBinaryManifest(artifactBytes);
      const fetchMock = mockBinaryFetch(manifest, artifactBytes);
      vi.doMock("node:fs/promises", async () => {
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises"
          );
        return {
          ...actual,
          mkdtemp: vi
            .fn()
            .mockRejectedValue(new Error("temporary directory unavailable")),
        };
      });

      try {
        const { runUpgrade } = await loadUpgradeModules();
        let thrown: unknown;
        await withCapturedStdio(async () => {
          try {
            await runUpgrade({ view: "agent", yes: true });
          } catch (error) {
            thrown = error;
          }
        });

        expect(thrown).toEqual(
          expect.objectContaining({
            message: "temporary directory unavailable",
          })
        );
        expect(resolveOpenMeldToolsUpdateFailure(thrown)).toBe(
          "cli.update.install_failed"
        );
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock("node:fs/promises");
      }
    });
  });

  it("stops before install-self when the downloaded binary sha256 does not match the manifest", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const installedBinaryPath = join(
        home,
        ".openmeld",
        "versions",
        packageJson.version,
        "openmeld"
      );
      const currentPointerPath = join(home, ".openmeld", "bin", "openmeld");
      const installedBytes = Buffer.from("working OpenMeld CLI\n", "utf8");
      await mkdir(dirname(installedBinaryPath), { recursive: true });
      await mkdir(dirname(currentPointerPath), { recursive: true });
      await writeFile(installedBinaryPath, installedBytes, { mode: 0o755 });
      await symlink(
        relative(dirname(currentPointerPath), installedBinaryPath),
        currentPointerPath
      );
      vi.stubEnv(
        "OPENMELD_INTERNAL_UPGRADE_BASE_BINARY_PATH",
        currentPointerPath
      );
      const expectedBytes = Buffer.from("expected openmeld binary\n", "utf8");
      const downloadedBytes = Buffer.from("tampered openmeld binary\n", "utf8");
      const manifest = buildBinaryManifest(expectedBytes, {
        sizeBytes: downloadedBytes.byteLength,
      });
      mockBinaryFetch(manifest, downloadedBytes);

      const { readVersionState, runUpgrade } = await loadUpgradeModules();
      await withCapturedStdio(async () => {
        await expect(
          runUpgrade({
            view: "agent",
            yes: true,
          })
        ).rejects.toThrow("binary download sha256 mismatch");
      });

      expect(spawn).not.toHaveBeenCalled();
      await expect(readFile(installedBinaryPath)).resolves.toEqual(
        installedBytes
      );
      await expect(readlink(currentPointerPath)).resolves.toBe(
        relative(dirname(currentPointerPath), installedBinaryPath)
      );
      await expect(readVersionState()).resolves.toMatchObject({
        last_version: packageJson.version,
      });
    });
  });

  it("stops before install-self when the compressed download sha256 does not match the manifest", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const artifactBytes = Buffer.from("expected openmeld binary\n", "utf8");
      const archiveBytes = gzipSync(artifactBytes);
      const manifest = buildBinaryManifest(artifactBytes, {
        archiveBytes,
        archiveSha256: "f".repeat(64),
      });
      mockBinaryFetch(manifest, archiveBytes);

      const { runUpgrade } = await loadUpgradeModules();
      await withCapturedStdio(async () => {
        await expect(runUpgrade({ view: "agent", yes: true })).rejects.toThrow(
          "binary archive sha256 mismatch"
        );
      });

      expect(spawn).not.toHaveBeenCalled();
    });
  });

  it("uses a small exact-base delta and verifies the reconstructed signed binary", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");

    await withTempHome(async (home) => {
      await seedVersionState(home);
      const baseBytes = Buffer.from(
        "OpenMeld CLI 0.3.19: old payload\n",
        "utf8"
      );
      const targetBytes = Buffer.from(
        "OpenMeld CLI 9.9.9: new signed payload\n",
        "utf8"
      );
      const basePath = join(home, "current-openmeld");
      await writeFile(basePath, baseBytes);
      vi.stubEnv("OPENMELD_INTERNAL_UPGRADE_BASE_BINARY_PATH", basePath);
      const patchPayload = buildDeltaPatchPayload(baseBytes, targetBytes);
      const patchBytes = gzipSync(Buffer.from(JSON.stringify(patchPayload)));
      const otherBaseBytes = Buffer.from(
        "OpenMeld CLI 0.3.19: another signed payload\n",
        "utf8"
      );
      const manifest = buildBinaryManifest(targetBytes, {
        archiveBytes: gzipSync(targetBytes),
        codeIdentifier: "sh.openmeld.cli",
        deltas: [
          {
            ...buildDeltaManifestEntry(otherBaseBytes, patchBytes),
            patchUrl: "https://dev.openmeld.test/cli/download/wrong-base.gz",
          },
          {
            ...buildDeltaManifestEntry(baseBytes, patchBytes),
            patchUrl: "https://dev.openmeld.test/cli/download/exact-base.gz",
          },
        ],
        teamIdentifier: "38FFHDPA3B",
      });
      const fetchMock = mockBinaryFetch(manifest, targetBytes, patchBytes);
      const managedBinaryPath = join(
        home,
        ".openmeld",
        "versions",
        BINARY_VERSION,
        "openmeld"
      );
      mockSpawnSequence([
        { code: 0 },
        {
          code: 0,
          stderr:
            "Identifier=sh.openmeld.cli\nTeamIdentifier=38FFHDPA3B\nAuthority=Developer ID Application: OpenMeld\nflags=0x10000(runtime)\nTimestamp=Aug 7, 2026\n",
        },
        {
          code: 0,
          stdout: `${JSON.stringify({
            schemaVersion: 1,
            type: "cli.install_self",
            result: "installed",
            version: BINARY_VERSION,
            platform: currentPlatformToken(),
            managedBinaryPath,
            currentPointerPath: join(home, ".openmeld", "bin", "openmeld"),
            previousVersion: packageJson.version,
            forced: true,
          })}\n`,
        },
        {
          code: 0,
          stdout:
            '{"type":"data","code":"upgrade.reconcile.completed","payload":{"ok":true}}\n',
        },
      ]);

      const { runUpgrade } = await loadUpgradeModules();
      const { stdout } = await withCapturedStdio(async () => {
        await runUpgrade({ view: "agent", yes: true });
      });

      const release =
        manifest.channels.stable.platforms[currentPlatformToken()];
      expect(fetchMock).toHaveBeenCalledWith(
        release?.deltas?.[1]?.patchUrl,
        expect.objectContaining({ method: "GET" })
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        release?.deltas?.[0]?.patchUrl,
        expect.anything()
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        release?.archiveUrl,
        expect.anything()
      );
      expect(stdout).toContain(`"downloadSizeBytes":${patchBytes.byteLength}`);
      expect(stdout).toContain('"preferredTransport":"delta"');
      expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe("/usr/bin/codesign");
      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain(
        `-R=${OPENMELD_MACOS_CLI_SIGNING_REQUIREMENT}`
      );
      expect(vi.mocked(spawn).mock.calls[1]?.[0]).toBe("/usr/bin/codesign");
      expect(vi.mocked(spawn).mock.calls[2]?.[1]).toEqual([
        "install-self",
        "--force",
        "--json",
      ]);
    });
  });

  it("refuses to bypass signed binary verification outside macOS", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const artifactBytes = Buffer.from("signed OpenMeld binary\n", "utf8");
    const manifest = buildBinaryManifest(artifactBytes, {
      codeIdentifier: "sh.openmeld.cli",
      teamIdentifier: "38FFHDPA3B",
    });
    const platform = currentPlatformToken();
    const platformRelease = manifest.channels.stable.platforms[platform];
    if (!platformRelease) {
      throw new Error("expected current platform release");
    }
    const runCommand = vi.fn();

    await expect(
      verifyCliBinaryCodeSignature({
        artifactPath: "/tmp/openmeld",
        release: platformRelease,
        runCommand,
      })
    ).rejects.toThrow("signed OpenMeld CLI verification requires macOS");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("requires the trusted macOS publisher even when a manifest claims another identity", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const bytes = Buffer.from("downloaded binary");
    const unsigned =
      buildBinaryManifest(bytes).channels.stable.platforms[
        currentPlatformToken()
      ];
    const wrongPublisher = buildBinaryManifest(bytes, {
      codeIdentifier: "sh.openmeld.cli.fake",
      teamIdentifier: "OTHERTEAM",
    }).channels.stable.platforms[currentPlatformToken()];
    if (!(unsigned && wrongPublisher)) {
      throw new Error("expected macOS release fixtures");
    }
    const runCommand = vi.fn();
    await expect(
      verifyCliBinaryCodeSignature({
        artifactPath: "/tmp/openmeld",
        release: unsigned,
        runCommand,
      })
    ).rejects.toThrow("missing a verified signing identity");
    await expect(
      verifyCliBinaryCodeSignature({
        artifactPath: "/tmp/openmeld",
        release: wrongPublisher,
        runCommand,
      })
    ).rejects.toThrow("unexpected signing identity");
    expect(runCommand).not.toHaveBeenCalled();

    await expect(
      verifyCliBinaryCodeSignature({
        allowUnsignedForDevelopment: true,
        artifactPath: "/tmp/openmeld",
        release: unsigned,
        runCommand,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects a signature whose displayed identifier only starts with the trusted one", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const release = buildBinaryManifest(Buffer.from("downloaded binary"), {
      codeIdentifier: "sh.openmeld.cli",
      teamIdentifier: "38FFHDPA3B",
    }).channels.stable.platforms[currentPlatformToken()];
    if (!release) {
      throw new Error("expected macOS release fixture");
    }
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        code: 0,
        stdout: "",
        stderr: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: "",
        stderr:
          "Identifier=sh.openmeld.cli.fake\nTeamIdentifier=38FFHDPA3B\nAuthority=Developer ID Application: OpenMeld\nflags=0x10000(runtime)\nTimestamp=Aug 7, 2026\n",
      });
    await expect(
      verifyCliBinaryCodeSignature({
        artifactPath: "/tmp/openmeld",
        release,
        runCommand,
      })
    ).rejects.toThrow("wrong identity");
  });

  it("reports an unreadable base before falling back to the full archive", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const expectedBaseBytes = Buffer.from("official old binary\n", "utf8");
      const targetBytes = Buffer.from("official new binary\n", "utf8");
      const archiveBytes = gzipSync(targetBytes);
      const basePath = join(home, "missing-current-openmeld");
      vi.stubEnv("OPENMELD_INTERNAL_UPGRADE_BASE_BINARY_PATH", basePath);
      const patchPayload = buildDeltaPatchPayload(
        expectedBaseBytes,
        targetBytes
      );
      const patchBytes = gzipSync(Buffer.from(JSON.stringify(patchPayload)));
      const manifest = buildBinaryManifest(targetBytes, {
        archiveBytes,
        deltas: [buildDeltaManifestEntry(expectedBaseBytes, patchBytes)],
      });
      const fetchMock = mockBinaryFetch(manifest, archiveBytes, patchBytes);
      const managedBinaryPath = join(
        home,
        ".openmeld",
        "versions",
        BINARY_VERSION,
        "openmeld"
      );
      mockSpawnSequence([
        {
          code: 0,
          stdout: `${JSON.stringify({
            schemaVersion: 1,
            type: "cli.install_self",
            result: "installed",
            version: BINARY_VERSION,
            platform: currentPlatformToken(),
            managedBinaryPath,
            currentPointerPath: join(home, ".openmeld", "bin", "openmeld"),
            previousVersion: packageJson.version,
            forced: true,
          })}\n`,
        },
        {
          code: 0,
          stdout:
            '{"type":"data","code":"upgrade.reconcile.completed","payload":{"ok":true}}\n',
        },
      ]);

      const { runUpgrade } = await loadUpgradeModules();
      const { stderr, stdout } = await withCapturedStdio(async () => {
        await runUpgrade({ view: "agent", yes: true });
      });

      const release =
        manifest.channels.stable.platforms[currentPlatformToken()];
      expect(fetchMock).not.toHaveBeenCalledWith(
        release?.deltas?.[0]?.patchUrl,
        expect.anything()
      );
      expect(fetchMock).toHaveBeenCalledWith(
        release?.archiveUrl,
        expect.objectContaining({ method: "GET" })
      );
      expect(stdout).toContain(
        `"downloadSizeBytes":${archiveBytes.byteLength}`
      );
      expect(stdout).toContain('"preferredTransport":"archive"');
      expect(stderr).toContain(
        "Small update could not inspect the current CLI; downloading the full update instead."
      );
      expect(stderr).toContain("ENOENT");
    });
  });

  it("selects the full archive without an error when readable bytes do not match", async () => {
    await withTempHome(async (home) => {
      const expectedBaseBytes = Buffer.from("official old binary\n", "utf8");
      const localBaseBytes = Buffer.from("modified old binary\n", "utf8");
      const targetBytes = Buffer.from("official new binary\n", "utf8");
      const archiveBytes = gzipSync(targetBytes);
      const patchBytes = gzipSync(
        Buffer.from(
          JSON.stringify(buildDeltaPatchPayload(expectedBaseBytes, targetBytes))
        )
      );
      const manifest = buildBinaryManifest(targetBytes, {
        archiveBytes,
        deltas: [buildDeltaManifestEntry(expectedBaseBytes, patchBytes)],
      });
      const basePath = join(home, "current-openmeld");
      await writeFile(basePath, localBaseBytes);
      const onDeltaFallback = vi.fn();
      const platform = currentPlatformToken();
      const platformRelease = manifest.channels.stable.platforms[platform];
      if (!platformRelease) {
        throw new Error("expected current platform release");
      }
      const release = {
        ...platformRelease,
        minRequiredCliVersion: manifest.channels.stable.minRequiredCliVersion,
        platform,
        version: manifest.channels.stable.version,
      };

      await expect(
        resolveCliBinaryUpdatePlan({
          baseBinaryPath: basePath,
          currentVersion: packageJson.version,
          onDeltaFallback,
          release,
        })
      ).resolves.toMatchObject({ transport: "archive" });
      expect(onDeltaFallback).not.toHaveBeenCalled();
    });
  });

  it.each([
    false,
    true,
  ])("uses the selected Service target in binary alignment (independent=%s)", async (independent) => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const manifest = buildBinaryManifest(
        Buffer.from("selected Service artifact")
      );
      const service = independent
        ? {
            version: "0.0.1",
            platforms: manifest.channels.stable.platforms,
          }
        : undefined;
      vi.mocked(fetch).mockResolvedValue(
        Response.json({
          ...manifest,
          channels: {
            stable: {
              ...manifest.channels.stable,
              ...(service ? { service } : {}),
            },
          },
        })
      );
      resolveDaemonServiceAlignmentDecisionMock.mockReturnValueOnce({
        status: "needs_full_alignment",
        reasonCodes: ["bundle_strategy_legacy"],
      });
      const originalArgvEntry = process.argv[1];
      process.argv[1] = "/tmp/not-a-node-script-in-binary-mode.js";

      try {
        const { runUpgrade } = await loadUpgradeModules();
        await withCapturedStdio(async () => {
          await runUpgrade({
            view: "agent",
            internalAlignService: true,
          });
        });

        expect(scheduleDaemonServiceUpdateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            targetCliVersion: packageJson.version,
            targetServiceVersion: service?.version ?? packageJson.version,
            targetVersion: service?.version ?? packageJson.version,
            urgency: "available",
          })
        );
        const scheduleInput =
          scheduleDaemonServiceUpdateMock.mock.calls[0]?.[0];
        expect(scheduleInput).not.toHaveProperty("cliScriptPath");
        if (service) {
          expect(scheduleInput.binaryRelease.version).toBe(service.version);
        } else {
          expect(scheduleInput).not.toHaveProperty("binaryRelease");
        }
        expect(runDaemonServiceFullAlignmentMock).not.toHaveBeenCalled();
      } finally {
        process.argv[1] = originalArgvEntry ?? process.execPath;
      }
    });
  });

  it("enriches a legacy update handoff with the CLI and selected Service targets", async () => {
    await withTempHome(async (home) => {
      await seedVersionState(home);
      const manifest = buildBinaryManifest(
        Buffer.from("legacy handoff Service artifact")
      );
      const selectedServiceVersion = "0.0.1";
      vi.mocked(fetch).mockResolvedValue(
        Response.json({
          ...manifest,
          channels: {
            stable: {
              ...manifest.channels.stable,
              service: {
                version: selectedServiceVersion,
                platforms: manifest.channels.stable.platforms,
              },
            },
          },
        })
      );
      vi.stubEnv(
        "OPENMELD_INTERNAL_TOOLS_UPDATE_OPERATION_ID",
        "legacy-update-1"
      );
      vi.stubEnv(
        "OPENMELD_INTERNAL_TOOLS_UPDATE_REQUESTED_AT",
        "2026-09-17T00:00:00.000Z"
      );
      vi.stubEnv("OPENMELD_INTERNAL_TOOLS_UPDATE_REQUEST_SOURCE", "automatic");
      vi.stubEnv("OPENMELD_INTERNAL_TOOLS_UPDATE_TARGET_CLI_VERSION", "");
      vi.stubEnv("OPENMELD_INTERNAL_TOOLS_UPDATE_TARGET_SERVICE_VERSION", "");
      resolveDaemonServiceAlignmentDecisionMock.mockReturnValueOnce({
        status: "needs_full_alignment",
        reasonCodes: ["bundle_strategy_legacy"],
      });

      const actualCoordinator = await vi.importActual<
        typeof import("../src/local-service/lifecycle/daemon-service-update-coordinator")
      >("../src/local-service/lifecycle/daemon-service-update-coordinator");
      const persistedJobs: DaemonServiceUpdateJob[] = [];
      scheduleDaemonServiceUpdateMock.mockImplementationOnce(
        async (request) =>
          await actualCoordinator.scheduleDaemonServiceUpdate(request, {
            createJobId: () => "unexpected-new-operation-id",
            installWorker: async () => undefined,
            now: () => "2026-09-17T00:00:02.000Z",
            persistPendingJob: (job) => {
              persistedJobs.push(job);
              return Promise.resolve();
            },
            prepareBundle: async ({ daemonVersion }) => ({
              v: 2,
              schema: "openmeld-daemon-active-bundle-v2",
              bundleId: `${daemonVersion}-legacy-handoff`,
              daemonVersion,
              entryScriptRelativePath: "openmeld",
              bundleFormat: "binary_v1",
              sourceEntryScriptPath: `/tmp/openmeld/${daemonVersion}/openmeld`,
              sourcePackageRootPath: `/tmp/openmeld/${daemonVersion}`,
              sourceDistRootPath: `/tmp/openmeld/${daemonVersion}`,
              sourceDistFingerprint: "legacy-handoff",
              sourceKind: "package_install",
              createdAt: "2026-09-17T00:00:01.000Z",
              updatedAt: "2026-09-17T00:00:01.000Z",
            }),
            prepareWorkerCarrier: async () => undefined,
            pruneWorkerVersions: async () => undefined,
            readPendingJob: async () => null,
            resolveDesiredState: async () => "background",
            startWorker: async () => undefined,
            withManagedInstallTransaction: async (run) => await run(),
          })
      );

      const { runUpgrade } = await loadUpgradeModules();
      await withCapturedStdio(async () => {
        await runUpgrade({
          view: "agent",
          internalAlignService: true,
        });
      });

      const persistedJob = persistedJobs[0];
      expect(persistedJob).toMatchObject({
        jobId: "legacy-update-1",
        requestedAt: "2026-09-17T00:00:00.000Z",
        requestSource: "automatic",
        targetCliVersion: packageJson.version,
        targetServiceVersion: selectedServiceVersion,
        targetVersion: selectedServiceVersion,
      });
      if (!persistedJob) {
        throw new Error("expected the legacy handoff job to be persisted");
      }
      expect(resolveOpenMeldToolsUpdateTargetVersions(persistedJob)).toEqual({
        cliVersion: packageJson.version,
        serviceVersion: selectedServiceVersion,
      });
    });
  });
});

async function loadUpgradeModules(): Promise<{
  runUpgrade: typeof import("../src/commands/upgrade").runUpgrade;
  UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG: typeof import("../src/commands/upgrade").UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG;
  resolveBinaryUpgradeRecoveryUrl: typeof import("../src/commands/upgrade").resolveBinaryUpgradeRecoveryUrl;
  readVersionState: typeof import("../src/config/version-state").readVersionState;
}> {
  const [upgrade, versionState] = await Promise.all([
    import("../src/commands/upgrade"),
    import("../src/config/version-state"),
  ]);
  return {
    runUpgrade: upgrade.runUpgrade,
    UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG:
      upgrade.UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG,
    resolveBinaryUpgradeRecoveryUrl: upgrade.resolveBinaryUpgradeRecoveryUrl,
    readVersionState: versionState.readVersionState,
  };
}

function buildBinaryManifest(
  artifactBytes: Buffer,
  override?: {
    archiveBytes?: Buffer;
    archiveSha256?: string;
    codeIdentifier?: string;
    deltas?: ReturnType<typeof buildDeltaManifestEntry>[];
    sha256?: string;
    sizeBytes?: number;
    teamIdentifier?: string;
  }
): {
  schemaVersion: 1;
  channels: {
    stable: {
      version: string;
      minRequiredCliVersion: string;
      platforms: Record<
        string,
        {
          archiveFormat?: "gzip";
          archiveUrl?: string;
          archiveSha256?: string;
          archiveSizeBytes?: number;
          codeIdentifier?: string;
          deltas?: ReturnType<typeof buildDeltaManifestEntry>[];
          teamIdentifier?: string;
          url: string;
          sha256: string;
          sizeBytes: number;
        }
      >;
    };
  };
} {
  const platform = currentPlatformToken();
  return {
    schemaVersion: 1,
    channels: {
      stable: {
        version: BINARY_VERSION,
        minRequiredCliVersion: "0.1.3",
        platforms: {
          [platform]: {
            url: `https://dev.openmeld.test/cli/download/openmeld-cli-${platform}-${BINARY_VERSION}`,
            sha256:
              override?.sha256 ??
              createHash("sha256").update(artifactBytes).digest("hex"),
            sizeBytes: override?.sizeBytes ?? artifactBytes.byteLength,
            ...(override?.codeIdentifier
              ? { codeIdentifier: override.codeIdentifier }
              : {}),
            ...(override?.teamIdentifier
              ? { teamIdentifier: override.teamIdentifier }
              : {}),
            ...(override?.deltas ? { deltas: override.deltas } : {}),
            ...(override?.archiveBytes
              ? {
                  archiveFormat: "gzip" as const,
                  archiveUrl: `https://dev.openmeld.test/cli/download/openmeld-cli-${platform}-${BINARY_VERSION}.gz`,
                  archiveSha256:
                    override.archiveSha256 ??
                    createHash("sha256")
                      .update(override.archiveBytes)
                      .digest("hex"),
                  archiveSizeBytes: override.archiveBytes.byteLength,
                }
              : {}),
          },
        },
      },
    },
  };
}

function mockBinaryFetch(
  manifest: ReturnType<typeof buildBinaryManifest>,
  artifactBytes: Buffer,
  patchBytes?: Buffer
) {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url === BINARY_MANIFEST_URL) {
      return Promise.resolve(
        new Response(JSON.stringify(manifest), { status: 200 })
      );
    }
    const release = manifest.channels.stable.platforms[currentPlatformToken()];
    if (
      release?.deltas?.some((candidate) => candidate.patchUrl === url) &&
      patchBytes
    ) {
      return Promise.resolve(new Response(patchBytes, { status: 200 }));
    }
    if (url === release?.archiveUrl || url === release?.url) {
      return Promise.resolve(new Response(artifactBytes, { status: 200 }));
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
  return fetchMock;
}

function buildDeltaManifestEntry(baseBytes: Buffer, patchBytes: Buffer) {
  return {
    fromSha256: createHash("sha256").update(baseBytes).digest("hex"),
    fromSizeBytes: baseBytes.byteLength,
    fromVersion: packageJson.version,
    patchCompression: "gzip" as const,
    patchFormat: "block-ranges-v1" as const,
    patchPayloadSizeBytes: gunzipSync(patchBytes).byteLength,
    patchSha256: createHash("sha256").update(patchBytes).digest("hex"),
    patchSizeBytes: patchBytes.byteLength,
    patchUrl: `https://dev.openmeld.test/cli/download/openmeld-cli-${currentPlatformToken()}-${BINARY_VERSION}-delta-from-${packageJson.version}.gz`,
  };
}

function buildDeltaPatchPayload(baseBytes: Buffer, targetBytes: Buffer) {
  return {
    baseSha256: createHash("sha256").update(baseBytes).digest("hex"),
    baseSizeBytes: baseBytes.byteLength,
    blockSizeBytes: 4096,
    patchFormat: "block-ranges-v1" as const,
    schemaVersion: 1 as const,
    segments: [{ dataBase64: targetBytes.toString("base64"), offset: 0 }],
    targetSha256: createHash("sha256").update(targetBytes).digest("hex"),
    targetSizeBytes: targetBytes.byteLength,
  };
}

function currentPlatformToken(): string {
  return `${process.platform}-${process.arch}`;
}

function mockSpawnSequence(
  steps: {
    code: number;
    stdout?: string;
    stderr?: string;
  }[]
): void {
  const remainingSteps = [...steps];
  vi.mocked(spawn).mockImplementation(() => {
    const step = remainingSteps.shift();
    if (!step) {
      throw new Error("Unexpected extra spawn invocation.");
    }
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (step.stdout) {
        child.stdout.emit("data", Buffer.from(step.stdout));
      }
      if (step.stderr) {
        child.stderr.emit("data", Buffer.from(step.stderr));
      }
      child.emit("close", step.code);
    });
    return child as never;
  });
}
