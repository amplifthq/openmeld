import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readInstalledComputerEnvironment } from "./installed-computer-environment.ts";
import { stageDesktopRenderer } from "./private-package.mjs";
import { readDesktopSignedPackageMode } from "./signed-package.ts";
import { desktopWebBuildIdentity } from "./web-build-identity.mjs";

const unavailable = /missing, incomplete, or stale/u;
const symbolicLinks = /symbolic links/u;
const requiredComputerLane =
  /Desktop acceptance requires OPENMELD_DESKTOP_TEST_COMPUTER_HOME/u;
const requiredReleaseSha = /Set OPENMELD_DESKTOP_RELEASE_SHA/u;

test("production package entry refuses to build without an approved release SHA", () => {
  const result = spawnSync(
    process.execPath,
    [new URL("./installed-package.mjs", import.meta.url).pathname],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        OPENMELD_DESKTOP_TARGET: "production",
        OPENMELD_DESKTOP_PRODUCTION_PREVIEW: "1",
      },
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, requiredReleaseSha);
});

test("production signing rejects test targets, mixed modes, and credential overrides", () => {
  const env = {
    OPENMELD_DESKTOP_PRODUCTION_PREVIEW: "1",
    OPENMELD_DESKTOP_TARGET: "production",
  };
  assert.equal(readDesktopSignedPackageMode(env), "production-preview");
  assert.equal(readDesktopSignedPackageMode({}), null);
  for (const invalid of [
    {
      OPENMELD_DESKTOP_TARGET: "disposable",
      OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "http://test.localhost:3000",
    },
    { OPENMELD_DESKTOP_ACCEPTANCE: "1" },
    { OPENMELD_DESKTOP_TEST_COMPUTER_HOME: "/test" },
    { OPENMELD_DESKTOP_TEST_AUTH_ORIGIN: "http://test.localhost:3001" },
    { APPLE_ID: "test@example.invalid" },
    { CSC_LINK: "test.p12" },
  ]) {
    assert.throws(() => readDesktopSignedPackageMode({ ...env, ...invalid }));
  }
});

test("acceptance packaging rejects a missing Computer lane before staging or signing", () => {
  const env = {
    ...process.env,
    OPENMELD_DESKTOP_ACCEPTANCE: "1",
    OPENMELD_DESKTOP_TARGET: "disposable",
    OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "http://wt-test.localhost:28290",
    OPENMELD_DESKTOP_TEST_COMPUTER_HOME: "",
    OPENMELD_DESKTOP_TEST_AUTH_ORIGIN: "",
    OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN: "",
  };
  for (const entry of [
    "./installed-package.mjs",
    "../../clients/desktop/electron-builder.installed.config.mjs",
  ]) {
    const result = spawnSync(
      process.execPath,
      [new URL(entry, import.meta.url).pathname],
      {
        env,
        encoding: "utf8",
      }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, requiredComputerLane);
  }
  assert.equal(
    readInstalledComputerEnvironment({ OPENMELD_DESKTOP_TARGET: "disposable" }),
    null
  );
  const configured = {
    ...env,
    OPENMELD_DESKTOP_TEST_COMPUTER_HOME: join(
      tmpdir(),
      "desktop-existing-lane"
    ),
    OPENMELD_DESKTOP_TEST_AUTH_ORIGIN: "http://wt-test.localhost:28291",
    OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN: "http://wt-test.localhost:28292",
  };
  assert.deepEqual(readInstalledComputerEnvironment(configured), {
    home: configured.OPENMELD_DESKTOP_TEST_COMPUTER_HOME,
    auth: configured.OPENMELD_DESKTOP_TEST_AUTH_ORIGIN,
    gateway: configured.OPENMELD_DESKTOP_TEST_GATEWAY_ORIGIN,
  });
  assert.throws(() =>
    readInstalledComputerEnvironment({
      ...configured,
      OPENMELD_DESKTOP_TEST_AUTH_ORIGIN: "",
    })
  );
});

test("private staging rejects missing/stale Web builds and copies only local renderer output", () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-package-stage-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), "dist/\n");
    const source = join(root, "clients/web/dist/client");
    assert.throws(() => stageDesktopRenderer(root), unavailable);
    mkdirSync(join(source, "assets"), { recursive: true });
    const marker = join(source, "desktop-build.json");
    writeFileSync(marker, JSON.stringify({ webBuild: "0".repeat(64) }));
    writeFileSync(
      join(source, "_shell.html"),
      '<script src="/assets/index.js"></script>'
    );
    assert.throws(() => stageDesktopRenderer(root), unavailable);
    writeFileSync(
      marker,
      JSON.stringify({ webBuild: desktopWebBuildIdentity(root) })
    );
    writeFileSync(
      join(source, "assets/index.js"),
      "export const shared = true;"
    );
    writeFileSync(
      join(source, "assets/index.js.map"),
      "private diagnostic map"
    );
    writeFileSync(join(source, ".private"), "must not ship");
    const { destination } = stageDesktopRenderer(root);
    assert.equal(
      readFileSync(join(destination, "assets/index.js"), "utf8"),
      "export const shared = true;"
    );
    assert.equal(existsSync(join(destination, "assets/index.js.map")), false);
    assert.equal(existsSync(join(destination, ".private")), false);
    writeFileSync(join(destination, "obsolete.js"), "old build");
    stageDesktopRenderer(root);
    assert.equal(existsSync(join(destination, "obsolete.js")), false);
    symlinkSync(join(root, ".gitignore"), join(source, "outside"));
    assert.throws(() => stageDesktopRenderer(root), symbolicLinks);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
