import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstalledPlatformPlan,
  readInstalledDesktopPlatform,
} from "./installed-platform.ts";
import { readInstalledDesktopTarget } from "./installed-target.ts";
import { readDesktopSignedPackageMode } from "./signed-package.ts";

const production = readInstalledDesktopTarget({
  OPENMELD_DESKTOP_TARGET: "production",
});
const disposable = readInstalledDesktopTarget({
  OPENMELD_DESKTOP_TARGET: "disposable",
  OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "http://127.0.0.1:3899",
});
const publisherName = "CN=Fixture Publisher, O=Fixture Organization, C=US";
const env = {
  OPENMELD_DESKTOP_WINDOWS_PUBLISHER: publisherName,
  OPENMELD_DESKTOP_WINDOWS_CERTIFICATE_SHA1: "a".repeat(40),
};

for (const arch of ["x64", "arm64"]) {
  test(`builds a signed per-user ${arch} NSIS with an exact platform update feed`, () => {
    const plan = buildInstalledPlatformPlan({
      env,
      target: production,
      signedMode: "production-preview",
      platform: "win32",
      arch,
    });
    assert.deepEqual(plan.args, ["--win", "nsis", `--${arch}`]);
    assert.equal(plan.generateMacIcons, false);
    assert.equal(plan.forceCodeSigning, true);
    assert.deepEqual(plan.windows, {
      platform: `windows-${arch}`,
      publisherName,
    });
    assert.deepEqual(plan.win.target, [{ target: "nsis", arch: [arch] }]);
    assert.equal(plan.win.requestedExecutionLevel, "asInvoker");
    assert.equal(plan.win.verifyUpdateCodeSignature, true);
    assert.deepEqual(plan.win.signtoolOptions.publisherName, [publisherName]);
    assert.equal(plan.nsis.oneClick, true);
    assert.equal(plan.nsis.perMachine, false);
    assert.equal(plan.nsis.allowElevation, false);
    assert.equal(plan.nsis.packElevateHelper, false);
    assert.equal(plan.nsis.deleteAppDataOnUninstall, false);
    assert.equal(plan.nsis.buildUniversalInstaller, false);
    assert.equal(plan.nsis.differentialPackage, false);
    assert.deepEqual(plan.publish, {
      provider: "generic",
      url: `https://openmeld.ai/desktop/updates/windows-${arch}`,
    });
  });
  test(`permits disposable unsigned ${arch} acceptance without enabling publication or updates`, () => {
    const plan = buildInstalledPlatformPlan({
      env: {},
      target: disposable,
      signedMode: null,
      platform: "win32",
      arch,
    });
    assert.equal(plan.forceCodeSigning, false);
    assert.equal(plan.win.signExecutable, false);
    assert.equal(plan.windows, null);
    assert.equal(plan.publish, null);
    assert(plan.nsis.artifactName.includes("-unsigned"));
  });
}
test("packages a production-account unsigned Windows preview without production updates", () => {
  const selected = readDesktopSignedPackageMode(
    {
      OPENMELD_DESKTOP_INTERNAL_PREVIEW: "1",
      OPENMELD_DESKTOP_TARGET: "production",
    },
    "win32"
  );
  assert.equal(selected, "internal-preview");
  const plan = buildInstalledPlatformPlan({
    env: {},
    target: production,
    signedMode: selected,
    platform: "win32",
    arch: "x64",
  });
  assert.equal(plan.forceCodeSigning, false);
  assert.equal(plan.win.signExecutable, false);
  assert.equal(plan.publish, null);
  assert.equal(plan.windows, null);
  assert(plan.nsis.artifactName.includes("-internal-preview"));
  assert.throws(() =>
    readDesktopSignedPackageMode(
      {
        OPENMELD_DESKTOP_INTERNAL_PREVIEW: "1",
        OPENMELD_DESKTOP_TARGET: "production",
      },
      "darwin"
    )
  );
});
test("refuses an unsigned production Windows package and missing/ambiguous signing identity", () => {
  assert.throws(() =>
    buildInstalledPlatformPlan({
      env: {},
      target: production,
      signedMode: null,
      platform: "win32",
      arch: "x64",
    })
  );
  assert.throws(() =>
    buildInstalledPlatformPlan({
      env: {},
      target: production,
      signedMode: "production-preview",
      platform: "win32",
      arch: "x64",
    })
  );
  assert.throws(() =>
    buildInstalledPlatformPlan({
      env: {
        ...env,
        OPENMELD_DESKTOP_WINDOWS_CERTIFICATE_SHA1: "not-a-certificate",
      },
      target: production,
      signedMode: "production-preview",
      platform: "win32",
      arch: "x64",
    })
  );
});
test("keeps the Mac signing lane, targets and feed unchanged", () => {
  const plan = buildInstalledPlatformPlan({
    env: {},
    target: production,
    signedMode: "production-preview",
    platform: "darwin",
    arch: "arm64",
  });
  assert.deepEqual(plan.args, ["--mac", "dmg", "zip", "--arm64"]);
  assert.equal(plan.windows, null);
  assert.equal(plan.win, undefined);
  assert.equal(plan.generateMacIcons, true);
  assert.equal(plan.publish.url, "https://openmeld.ai/desktop/updates");
  assert.throws(() =>
    readDesktopSignedPackageMode(
      {
        OPENMELD_DESKTOP_PRODUCTION_PREVIEW: "1",
        OPENMELD_DESKTOP_TARGET: "production",
        CSC_LINK: "unreviewed.pfx",
      },
      "darwin"
    )
  );
  assert.equal(
    readDesktopSignedPackageMode(
      {
        OPENMELD_DESKTOP_PRODUCTION_PREVIEW: "1",
        OPENMELD_DESKTOP_TARGET: "production",
        CSC_LINK: "operator-owned.pfx",
      },
      "win32"
    ),
    "production-preview"
  );
});
test("never substitutes a different OS or unsupported architecture", () => {
  for (const [platform, arch] of [
    ["win32", "ia32"],
    ["linux", "x64"],
    ["darwin", "x64"],
  ]) {
    assert.throws(() => readInstalledDesktopPlatform({}, platform, arch));
  }
  assert.deepEqual(
    readInstalledDesktopPlatform(
      { OPENMELD_DESKTOP_ARCH: "arm64" },
      "win32",
      "x64"
    ),
    { platform: "windows-arm64", arch: "arm64" }
  );
});
