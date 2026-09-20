import { describe, expect, it, vi } from "vitest";
import {
  assertMacProductionBundleIdentity,
  MAC_PRODUCTION_APP_BUNDLE_NAME,
  readMacAppBundlePath,
  resolveMacUpdateInstallPlan,
} from "../src/main/update/mac-bundle-path";
import {
  assertMacBundleRenameInstall,
  installRenamedMacBundle,
  MAC_BUNDLE_RENAME_INSTALL_SCRIPT,
} from "../src/main/update/mac-update-install";

const VERIFIED_SHA512 = "a".repeat(128);

function validInstall() {
  return {
    zipPath: "/tmp/cache/desktop.zip",
    currentBundle: "/Applications/OpenMeld Desktop.app",
    targetBundle: `/Applications/${MAC_PRODUCTION_APP_BUNDLE_NAME}`,
    pid: 12,
    sourceVersion: "0.1.3",
    expectedVersion: "0.1.4",
    expectedSha512Hex: VERIFIED_SHA512,
    receiptPath: "/tmp/openmeld-update-receipt.txt",
  };
}

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

  it("fails closed when the current macOS application folder cannot be identified", () => {
    expect(() =>
      resolveMacUpdateInstallPlan({
        currentBundle: null,
      })
    ).toThrow("cannot determine");
  });

  it("refuses an unknown application folder instead of renaming it", () => {
    expect(() =>
      resolveMacUpdateInstallPlan({
        currentBundle: "/Applications/OpenMeld Preview.app",
      })
    ).toThrow("application folder name");
  });

  it("pins the production package identity that existing update clients depend on", () => {
    expect(() =>
      assertMacProductionBundleIdentity({
        appId: "sh.openmeld.desktop",
        productName: "OpenMeld",
      })
    ).not.toThrow();
    expect(() =>
      assertMacProductionBundleIdentity({
        appId: "sh.openmeld.desktop",
        productName: "OpenMeld Desktop",
      })
    ).toThrow("identity changed");
  });

  it("refuses an archive, destination, receipt, or digest that the installer would have to guess", () => {
    const valid = validInstall();
    expect(assertMacBundleRenameInstall(valid)).toEqual(valid);
    for (const override of [
      { zipPath: "/tmp/cache/../desktop.zip" },
      { targetBundle: "/Applications/Other.app" },
      { receiptPath: "relative/receipt.txt" },
      { expectedSha512Hex: "invalid" },
    ]) {
      expect(() =>
        assertMacBundleRenameInstall({ ...valid, ...override })
      ).toThrow();
    }
    expect(() =>
      assertMacBundleRenameInstall({
        ...valid,
        currentBundle: "/Applications/OpenMeld.app",
      })
    ).toThrow("does not need");
  });

  it("verifies the exact signed candidate before touching the legacy app", () => {
    const verifyIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      "codesign --verify --deep --strict"
    );
    const teamIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      "TeamIdentifier=38FFHDPA3B"
    );
    const versionIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      "CFBundleShortVersionString"
    );
    const moveTargetIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      '/bin/mv "$new" "$target"'
    );
    const removeLegacyIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      '/bin/rm -rf "$current"'
    );

    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).toContain(
      '/usr/bin/shasum -a 512 "$zip"'
    );
    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).toContain(
      "Identifier=sh.openmeld.desktop"
    );
    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).toContain(
      "/usr/sbin/spctl --assess --type execute"
    );
    expect(verifyIndex).toBeGreaterThan(0);
    expect(teamIndex).toBeGreaterThan(verifyIndex);
    expect(versionIndex).toBeGreaterThan(verifyIndex);
    expect(moveTargetIndex).toBeGreaterThan(versionIndex);
    expect(removeLegacyIndex).toBeGreaterThan(moveTargetIndex);
  });

  it("keeps the legacy app until the new app has actually launched", () => {
    const launchIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      '/usr/bin/open "$target"'
    );
    const confirmIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      'write_receipt "launch_confirmed"'
    );
    const removeLegacyIndex = MAC_BUNDLE_RENAME_INSTALL_SCRIPT.indexOf(
      '/bin/rm -rf "$current"'
    );

    expect(launchIndex).toBeGreaterThan(0);
    expect(confirmIndex).toBeGreaterThan(launchIndex);
    expect(removeLegacyIndex).toBeGreaterThan(confirmIndex);
    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).toContain("restore_target");
    expect(MAC_BUNDLE_RENAME_INSTALL_SCRIPT).toContain('write_receipt "failed:$step"');
  });

  it("starts the fixed installer with bounded evidence and leaves Squirrel unused", () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }));
    const writeFile = vi.fn();
    const install = { ...validInstall(), pid: 99 };
    installRenamedMacBundle(install, {
      spawn: spawn as never,
      writeFile: writeFile as never,
      scriptPath: "/tmp/openmeld-mac-update.sh",
      platform: "darwin",
    });
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
        install.zipPath,
        install.currentBundle,
        install.targetBundle,
        install.sourceVersion,
        install.expectedVersion,
        install.expectedSha512Hex,
        install.receiptPath,
      ],
      { detached: true, stdio: "ignore" }
    );
  });
});
