import { describe, expect, it, vi } from "vitest";
import {
  MAC_PRODUCTION_APP_BUNDLE_NAME,
  readMacAppBundlePath,
  resolveMacUpdateInstallPlan,
} from "../src/main/update/mac-bundle-path";
import {
  assertMacBundleRenameInstall,
  installRenamedMacBundle,
  MAC_BUNDLE_RENAME_INSTALL_SCRIPT,
} from "../src/main/update/mac-update-install";

describe("macOS Desktop bundle rename", () => {
  it("reads the application folder from the packaged executable", () => {
    expect(
      readMacAppBundlePath(
        "/Applications/OpenMeld Desktop.app/Contents/MacOS/OpenMeld"
      )
    ).toBe("/Applications/OpenMeld Desktop.app");
  });

  it.each([
    {
      currentBundle: "/Applications/OpenMeld.app",
      kind: "squirrel",
    },
    {
      currentBundle: null,
      kind: "squirrel",
    },
    {
      currentBundle: "/Applications/OpenMeld Desktop.app",
      kind: "rename",
      targetBundle: "/Applications/OpenMeld.app",
    },
  ])("keeps Squirrel only when the folder name is unchanged: $currentBundle", ({
    currentBundle,
    kind,
    targetBundle,
  }) => {
    expect(resolveMacUpdateInstallPlan({ currentBundle })).toEqual(
      kind === "rename"
        ? {
            kind,
            currentBundle,
            targetBundle,
          }
        : { kind: "squirrel" }
    );
  });

  it("refuses an unknown application folder instead of renaming it", () => {
    expect(() =>
      resolveMacUpdateInstallPlan({
        currentBundle: "/Applications/OpenMeld Preview.app",
      })
    ).toThrow("application folder name");
  });

  it("refuses a ZIP or destination that Squirrel would have to guess", () => {
    const valid = {
      zipPath: "/tmp/cache/desktop.zip",
      currentBundle: "/Applications/OpenMeld Desktop.app",
      targetBundle: `/Applications/${MAC_PRODUCTION_APP_BUNDLE_NAME}`,
      pid: 12,
    };
    expect(assertMacBundleRenameInstall(valid)).toEqual(valid);
    expect(() =>
      assertMacBundleRenameInstall({
        ...valid,
        zipPath: "/tmp/cache/../desktop.zip",
      })
    ).toThrow("not trusted");
    expect(() =>
      assertMacBundleRenameInstall({
        ...valid,
        targetBundle: "/Applications/Other.app",
      })
    ).toThrow("OpenMeld.app");
    expect(() =>
      assertMacBundleRenameInstall({
        ...valid,
        currentBundle: "/Applications/OpenMeld.app",
      })
    ).toThrow("does not need");
  });

  it("starts the fixed installer with positional paths and leaves Squirrel unused", () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const writeFile = vi.fn();
    installRenamedMacBundle(
      {
        zipPath: "/tmp/cache/desktop.zip",
        currentBundle: "/Applications/OpenMeld Desktop.app",
        targetBundle: "/Applications/OpenMeld.app",
        pid: 99,
      },
      {
        spawn: spawn as never,
        writeFile: writeFile as never,
        scriptPath: "/tmp/openmeld-mac-update.sh",
        platform: "darwin",
      }
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/openmeld-mac-update.sh",
      MAC_BUNDLE_RENAME_INSTALL_SCRIPT,
      { mode: 0o700 }
    );
    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).toContain("/usr/bin/ditto -x -k");
    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).toContain("/usr/bin/open");
    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).not.toContain("ShipIt");
    expect(spawn).toHaveBeenCalledWith(
      "/bin/bash",
      [
        "/tmp/openmeld-mac-update.sh",
        "99",
        "/tmp/cache/desktop.zip",
        "/Applications/OpenMeld Desktop.app",
        "/Applications/OpenMeld.app",
      ],
      { detached: true, stdio: "ignore" }
    );
  });
});
