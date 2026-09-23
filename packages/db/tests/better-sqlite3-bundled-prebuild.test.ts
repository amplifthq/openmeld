import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TRAILING_COMMA_PATTERN = /,$/u;
const SQLITE_13_PATCH_MAPPING_PATTERN =
  /^ {2}better-sqlite3@13\.0\.3: patches\/better-sqlite3@13\.0\.3\.patch$/m;
const NODE_GYP_PATTERN = /node-gyp/u;
const MISSING_PREBUILD_PATTERN = /no bundled prebuild/u;
const INSTALL_LINE_PREFIX = '+    "install": "node -e \\';
const NODE_EVAL_PREFIX = "node -e ";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);
const patchPath = path.join(repoRoot, "patches/better-sqlite3@13.0.3.patch");
const workspacePath = path.join(repoRoot, "pnpm-workspace.yaml");
const rootManifestPath = path.join(repoRoot, "package.json");

describe("better-sqlite3 13 Windows install", () => {
  it("uses the bundled prebuild and refuses to compile from source", () => {
    expect(readFileSync(workspacePath, "utf8")).toMatch(
      SQLITE_13_PATCH_MAPPING_PATTERN
    );
    const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8")) as {
      sherif?: { ignoreDependency?: string[] };
    };
    expect(rootManifest.sherif?.ignoreDependency ?? []).toContain(
      "better-sqlite3"
    );

    const installLine = readFileSync(patchPath, "utf8")
      .split("\n")
      .find((line) => line.startsWith(INSTALL_LINE_PREFIX));
    expect(installLine).toBeDefined();
    const scriptJson = installLine
      ?.slice(1)
      .replace(TRAILING_COMMA_PATTERN, "");
    const installCommand = JSON.parse(`{${scriptJson}}`).install as string;
    expect(installCommand).not.toMatch(NODE_GYP_PATTERN);
    expect(installCommand).toContain("prebuilds");
    expect(installCommand).toContain("refusing to compile from source");
    expect(installCommand.startsWith(NODE_EVAL_PREFIX)).toBe(true);

    const fixtureDir = mkdtempSync(
      path.join(os.tmpdir(), "better-sqlite3-prebuild-")
    );
    try {
      const missing = spawnSync(installCommand, {
        cwd: fixtureDir,
        encoding: "utf8",
        shell: true,
      });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toMatch(MISSING_PREBUILD_PATTERN);

      const report = process.report?.getReport?.() as
        | { header?: { glibcVersionRuntime?: string } }
        | undefined;
      const musl =
        process.platform === "linux" && !report?.header?.glibcVersionRuntime;
      const target = `${musl ? "linuxmusl" : process.platform}-${process.arch}`;
      mkdirSync(path.join(fixtureDir, "prebuilds"));
      writeFileSync(path.join(fixtureDir, "prebuilds", `${target}.node`), "");
      const present = spawnSync(installCommand, {
        cwd: fixtureDir,
        encoding: "utf8",
        shell: true,
      });
      expect(present.status).toBe(0);
    } finally {
      rmSync(fixtureDir, { force: true, recursive: true });
    }
  });
});
