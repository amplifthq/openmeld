import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function readConfig(name, env) {
  const entry = new URL(
    `../../clients/desktop/electron-builder.${name}.config.mjs`,
    import.meta.url
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      // Evaluate macOS configuration on any test host. This does not package,
      // sign, launch an application, or stand in for native macOS validation.
      `Object.defineProperty(process, "platform", { value: "darwin" });
       const { default: config } = await import(${JSON.stringify(entry)});
       console.log(JSON.stringify(config));`,
    ],
    { encoding: "utf8", env: { ...env, OPENMELD_DESKTOP_ARCH: "arm64" } }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertName(config, expected, appId) {
  assert.equal(config.appId, appId);
  assert.equal(config.productName, expected);
  assert.equal(config.extraMetadata.productName, expected);
  assert.equal(config.mac.extendInfo.CFBundleName, expected);
  assert.equal(config.mac.extendInfo.CFBundleDisplayName, expected);
  assert.deepEqual(config.protocols[0].schemes, [appId]);
}

test("installed production retains its updater-compatible application identity", () => {
  const config = readConfig("installed", {
    OPENMELD_DESKTOP_TARGET: "production",
  });
  assertName(config, "OpenMeld", "sh.openmeld.desktop");
  assert.equal(`${config.productName}.app`, "OpenMeld.app");
  assert.equal(config.publish, null);
});

test("unsigned disposable installation is visibly a test app", () => {
  const config = readConfig("installed", {
    OPENMELD_DESKTOP_TARGET: "disposable",
    OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "http://test.localhost:3200",
  });
  assertName(config, "OpenMeld Test", "sh.openmeld.desktop.test");
  assert.equal(config.publish, null);
});

test("signed acceptance preserves Test metadata through its macOS override", () => {
  const config = readConfig("installed", {
    OPENMELD_DESKTOP_TARGET: "disposable",
    OPENMELD_DESKTOP_ACCEPTANCE: "1",
    OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "http://test.localhost:3200",
    OPENMELD_DESKTOP_TEST_COMPUTER_HOME: join(tmpdir(), "openmeld-name-test"),
    OPENMELD_DESKTOP_TEST_AUTH_ORIGIN: "http://test.localhost:3201",
    OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN: "http://test.localhost:3202",
  });
  assertName(config, "OpenMeld Test", "sh.openmeld.desktop.test");
  assert.equal(config.mac.type, "distribution");
  assert.equal(config.mac.notarize, true);
  assert.equal(config.publish, null);
});

for (const laneId of ["wt-7574cf217e3a", "wt-012345abcdef"]) {
  test(`worktree builder labels every native surface with ${laneId}`, () => {
    const config = readConfig("development", {
      OPENMELD_DESKTOP_DEVELOPMENT_CONTEXT: JSON.stringify({
        version: 1,
        repoRoot: join(tmpdir(), laneId),
        laneId,
        openMeldHome: join(tmpdir(), laneId, "home"),
        preset: "dev-local",
        webOrigin: `http://${laneId}.localhost:3200`,
        authOrigin: `http://${laneId}.localhost:3201`,
        gatewayOrigin: `http://${laneId}.localhost:3202`,
      }),
    });
    assertName(
      config,
      `OpenMeld Dev ${laneId}`,
      `sh.openmeld.desktop.dev.${laneId}.p3200`
    );
    assert.equal(config.publish, null);
  });
}
