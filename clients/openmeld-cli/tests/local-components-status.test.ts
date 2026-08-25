import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LIVE_SKILLS_BUNDLE_HASH = "b".repeat(64);
const STALE_SKILLS_BUNDLE_HASH = "a".repeat(64);

describe("local components status", () => {
  beforeEach(() => {
    vi.doMock(
      "../src/local-service/maintenance/openmeld-tools-maintenance-policy",
      () => ({
        resolveOpenMeldToolsMaintenanceProjection: vi.fn(async () => ({
          automaticUpdatesEnabled: true,
          status: "ready",
        })),
      })
    );
    vi.doMock(
      "../src/local-service/maintenance/openmeld-tools-update-operation",
      () => ({
        resolveOpenMeldToolsUpdateOperation: vi.fn(async () => null),
      })
    );
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../src/commands/skills");
    vi.doUnmock("../src/config/paths");
    vi.doUnmock("../src/local-service/lifecycle/current-daemon-version");
    vi.doUnmock("../src/local-service/lifecycle/daemon-service-bundle");
    vi.doUnmock("../src/local-service/lifecycle/daemon-service-inventory");
    vi.doUnmock(
      "../src/local-service/maintenance/openmeld-tools-maintenance-policy"
    );
    vi.doUnmock(
      "../src/local-service/maintenance/openmeld-tools-update-operation"
    );
    vi.doUnmock("../src/skills/bundled");
    vi.doUnmock("../src/skills/bundled-assets");
    vi.doUnmock("../src/skills/content-hash");
    vi.doUnmock("../src/system/local-service-participation-gate");
  });

  it("reports live OpenMeld skills status instead of a stale setup snapshot", async () => {
    const openMeldHome = await mkdtemp(
      join(tmpdir(), "openmeld-local-components-")
    );
    vi.doMock("../src/config/paths", () => ({
      openMeldRootDir: () => openMeldHome,
    }));
    vi.doMock("../src/skills/bundled-assets", () => ({
      loadBundledSkillAssets: vi.fn(async () => [
        {
          content: Buffer.from("skill"),
          relativePath: "openmeld-cli/SKILL.md",
        },
      ]),
      hashBundledSkillAssets: vi.fn(() => LIVE_SKILLS_BUNDLE_HASH),
    }));
    vi.doMock("../src/skills/content-hash", () => ({
      computeDirectoryContentHash: vi.fn(async () => LIVE_SKILLS_BUNDLE_HASH),
    }));
    vi.doMock("../src/commands/skills", () => ({
      collectSkillsReadinessSnapshot: vi.fn(async () => ({
        status: "up_to_date",
        targetCount: 1,
        summary: {
          externalConflict: 0,
          missing: 0,
          outdated: 0,
          upToDate: 1,
        },
      })),
    }));
    vi.doMock("../src/local-service/lifecycle/current-daemon-version", () => ({
      resolveCurrentDaemonExpectedVersion: () => "0.0.0-test",
    }));
    vi.doMock("../src/system/local-service-participation-gate", () => ({
      resolveDaemonServiceParticipationStatus: vi.fn(async () => ({
        kind: "missing",
      })),
    }));
    vi.doMock(
      "../src/local-service/lifecycle/daemon-service-inventory",
      () => ({
        inspectDaemonServiceInventory: vi.fn(async () => ({
          anomalies: [],
        })),
      })
    );
    vi.doMock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
      readDaemonActiveBundleState: vi.fn(async () => null),
    }));

    const {
      localComponentsSnapshotPath,
      resolveLocalComponentsStatus,
      writeInstalledLocalComponentsSnapshot,
    } = await import("../src/local-components/manifest");

    await writeInstalledLocalComponentsSnapshot({ source: "setup" });
    const snapshotPath = localComponentsSnapshotPath();
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as {
      manifest: { skills: { bundleHash: string } };
    };
    snapshot.manifest.skills.bundleHash = STALE_SKILLS_BUNDLE_HASH;
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    const status = await resolveLocalComponentsStatus();

    expect(status.skills).toMatchObject({
      expectedBundleHash: LIVE_SKILLS_BUNDLE_HASH,
      installedBundleHash: LIVE_SKILLS_BUNDLE_HASH,
      status: "ok",
      targetCount: 1,
    });
  });

  it("reports active bundle source package skills hash from a self-contained Service bundle", async () => {
    const openMeldHome = await mkdtemp(
      join(tmpdir(), "openmeld-local-components-")
    );
    const sourcePackageRoot = join(openMeldHome, "source-package");
    const sourceSkillsRoot = join(sourcePackageRoot, "skills");
    await mkdir(sourceSkillsRoot, { recursive: true });

    vi.doMock("../src/config/paths", () => ({
      openMeldRootDir: () => openMeldHome,
    }));
    vi.doMock("../src/skills/bundled-assets", () => ({
      loadBundledSkillAssets: vi.fn(async () => []),
      hashBundledSkillAssets: vi.fn(() => null),
    }));
    vi.doMock("../src/skills/content-hash", () => ({
      computeDirectoryContentHash: vi.fn((input: { rootDir: string }) => {
        expect(input.rootDir).toBe(sourceSkillsRoot);
        return Promise.resolve(LIVE_SKILLS_BUNDLE_HASH);
      }),
    }));
    vi.doMock("../src/commands/skills", () => ({
      collectSkillsReadinessSnapshot: vi.fn(async () => ({
        status: "up_to_date",
        targetCount: 36,
        summary: {
          externalConflict: 0,
          missing: 0,
          outdated: 0,
          upToDate: 36,
        },
      })),
    }));
    vi.doMock("../src/local-service/lifecycle/current-daemon-version", () => ({
      resolveCurrentDaemonExpectedVersion: () => "0.0.0-test",
    }));
    vi.doMock("../src/system/local-service-participation-gate", () => ({
      resolveDaemonServiceParticipationStatus: vi.fn(async () => ({
        kind: "missing",
      })),
    }));
    vi.doMock(
      "../src/local-service/lifecycle/daemon-service-inventory",
      () => ({
        inspectDaemonServiceInventory: vi.fn(async () => ({
          anomalies: [],
        })),
      })
    );
    vi.doMock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
      readDaemonActiveBundleState: vi.fn(async () => ({
        sourcePackageRootPath: sourcePackageRoot,
      })),
    }));

    const { resolveLocalComponentsStatus } = await import(
      "../src/local-components/manifest"
    );

    const status = await resolveLocalComponentsStatus();

    expect(status.skills).toMatchObject({
      expectedBundleHash: null,
      installedBundleHash: LIVE_SKILLS_BUNDLE_HASH,
      reasonCodes: [],
      status: "ok",
      targetCount: 36,
    });
  });

  it("does not report the binary artifact sha as the Service bundle hash", async () => {
    const openMeldHome = await mkdtemp(
      join(tmpdir(), "openmeld-local-components-")
    );

    vi.doMock("../src/config/paths", () => ({
      openMeldRootDir: () => openMeldHome,
    }));
    vi.doMock("../src/skills/bundled-assets", () => ({
      loadBundledSkillAssets: vi.fn(async () => [
        {
          content: Buffer.from("skill"),
          relativePath: "openmeld-cli/SKILL.md",
        },
      ]),
      hashBundledSkillAssets: vi.fn(() => LIVE_SKILLS_BUNDLE_HASH),
    }));
    vi.doMock("../src/skills/content-hash", () => ({
      computeDirectoryContentHash: vi.fn(async () => LIVE_SKILLS_BUNDLE_HASH),
    }));
    vi.doMock("../src/commands/skills", () => ({
      collectSkillsReadinessSnapshot: vi.fn(async () => ({
        status: "up_to_date",
        targetCount: 1,
        summary: {
          externalConflict: 0,
          missing: 0,
          outdated: 0,
          upToDate: 1,
        },
      })),
    }));
    vi.doMock("../src/local-service/lifecycle/current-daemon-version", () => ({
      resolveCurrentDaemonExpectedVersion: () => "0.0.0-test",
    }));
    vi.doMock("../src/system/local-service-participation-gate", () => ({
      resolveDaemonServiceParticipationStatus: vi.fn(async () => ({
        expectedVersion: "0.0.0-test",
        installedVersion: "0.0.0-test",
        kind: "ready",
        runtimeStatus: "running",
      })),
    }));
    vi.doMock(
      "../src/local-service/lifecycle/daemon-service-inventory",
      () => ({
        inspectDaemonServiceInventory: vi.fn(async () => ({
          anomalies: [],
        })),
      })
    );
    vi.doMock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
      readDaemonActiveBundleState: vi.fn(async () => ({
        bundleFormat: "binary_v1",
        sourceDistFingerprint: "c".repeat(64),
      })),
    }));

    const { resolveLocalComponentsStatus } = await import(
      "../src/local-components/manifest"
    );

    const status = await resolveLocalComponentsStatus();

    expect(status.service).toMatchObject({
      expectedBundleHash: null,
      installedBundleHash: null,
      installedBundleVersion: "0.0.0-test",
      reasonCodes: [],
      status: "ok",
    });
  });
});
