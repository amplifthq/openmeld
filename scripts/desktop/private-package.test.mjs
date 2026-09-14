import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { stageDesktopRenderer } from "./private-package.mjs";
import { desktopWebBuildIdentity } from "./web-build-identity.mjs";

const unavailable = /missing, incomplete, or stale/u;
const symbolicLinks = /symbolic links/u;

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
