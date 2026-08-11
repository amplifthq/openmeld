import { describe, expect, it, vi } from "vitest";
import {
  compareSemver,
  type ReadDesktopUpdateStatusDeps,
  readDesktopUpdateStatus,
} from "../src/main/update/desktop-update";

type Manifest = {
  latestVersion?: string;
  minimumSupportedVersion?: string;
  downloadPageUrl?: string;
  message?: string;
  macosArm64?: {
    url?: string;
    version?: string;
    sha256?: string;
    sizeBytes?: number;
  };
};

function fetchManifest(
  manifest: Manifest,
  status = 200
): NonNullable<ReadDesktopUpdateStatusDeps["fetch"]> {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => manifest,
  }));
}

describe("Desktop update check", () => {
  it("reports idle when the current Desktop version is up to date", async () => {
    const view = await readDesktopUpdateStatus({
      currentVersion: "0.1.0-preview.0",
      env: {
        OPENMELD_DESKTOP_UPDATE_MANIFEST_URL:
          "https://openmeld.invalid/update.json",
      },
      fetch: fetchManifest({ latestVersion: "0.1.0-preview.0" }),
    });

    expect(view).toMatchObject({
      status: "idle",
      checked: true,
      latestVersion: "0.1.0-preview.0",
      problem: null,
    });
  });

  it("reports an available update for a newer preview build", async () => {
    const view = await readDesktopUpdateStatus({
      currentVersion: "0.1.0-preview.0",
      env: {
        OPENMELD_DESKTOP_UPDATE_MANIFEST_URL:
          "https://openmeld.invalid/update.json",
      },
      fetch: fetchManifest({
        latestVersion: "0.1.1-preview.0",
        downloadPageUrl: "https://openmeld.invalid/desktop",
        message: "A new OpenMeld Desktop preview is available.",
      }),
    });

    expect(view).toMatchObject({
      status: "available",
      currentVersion: "0.1.0-preview.0",
      latestVersion: "0.1.1-preview.0",
      downloadPageUrl: "https://openmeld.invalid/desktop",
      message: "A new OpenMeld Desktop preview is available.",
      problem: null,
    });
  });

  it("reports a required update when below the minimum supported version", async () => {
    const view = await readDesktopUpdateStatus({
      currentVersion: "0.1.0-preview.0",
      env: {
        OPENMELD_DESKTOP_UPDATE_MANIFEST_URL:
          "https://openmeld.invalid/update.json",
      },
      fetch: fetchManifest({
        latestVersion: "0.1.2-preview.0",
        minimumSupportedVersion: "0.1.1-preview.0",
      }),
    });

    expect(view).toMatchObject({
      status: "required",
      minimumSupportedVersion: "0.1.1-preview.0",
      problem: null,
    });
  });

  it("keeps optional macOS arm64 artifact metadata when present", async () => {
    const view = await readDesktopUpdateStatus({
      currentVersion: "0.1.0-preview.0",
      env: {
        OPENMELD_DESKTOP_UPDATE_MANIFEST_URL:
          "https://openmeld.invalid/update.json",
      },
      fetch: fetchManifest({
        latestVersion: "0.1.1-preview.0",
        macosArm64: {
          url: "https://downloads.openmeld.invalid/desktop/OpenMeld.dmg",
          version: "0.1.1-preview.0",
          sha256: "abc123",
          sizeBytes: 123,
        },
      }),
    });

    expect(view.macosArm64).toEqual({
      url: "https://downloads.openmeld.invalid/desktop/OpenMeld.dmg",
      version: "0.1.1-preview.0",
      sha256: "abc123",
      sizeBytes: 123,
    });
  });

  it("returns a non-blocking problem when the manifest request fails", async () => {
    const view = await readDesktopUpdateStatus({
      currentVersion: "0.1.0-preview.0",
      env: {
        OPENMELD_DESKTOP_UPDATE_MANIFEST_URL:
          "https://openmeld.invalid/update.json",
      },
      fetch: fetchManifest({}, 503),
    });

    expect(view).toMatchObject({
      status: "idle",
      checked: false,
      problem: { code: "desktop_update.request_failed" },
    });
  });

  it("returns a non-blocking problem when the manifest is invalid", async () => {
    const view = await readDesktopUpdateStatus({
      currentVersion: "0.1.0-preview.0",
      env: {
        OPENMELD_DESKTOP_UPDATE_MANIFEST_URL:
          "https://openmeld.invalid/update.json",
      },
      fetch: fetchManifest({}),
    });

    expect(view).toMatchObject({
      status: "idle",
      checked: false,
      problem: { code: "desktop_update.invalid_manifest" },
    });
  });

  it("compares stable and prerelease semver versions", () => {
    expect(compareSemver("0.1.0-preview.1", "0.1.0-preview.0")).toBe(1);
    expect(compareSemver("0.1.0", "0.1.0-preview.9")).toBe(1);
    expect(compareSemver("0.1.0-preview.0", "0.1.0")).toBe(-1);
  });
});
