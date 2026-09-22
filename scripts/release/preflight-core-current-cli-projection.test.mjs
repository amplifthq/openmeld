import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveOwnedCommandInvocation } from "../dev/owned-command.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const entrypoint = path.join(
  scriptDirectory,
  "preflight-core-current-cli-projection.mjs"
);
const repositoryManifest = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
);
const preflightScript =
  repositoryManifest.scripts["release:preflight:core-current-cli-projection"];

test("the script passes its checked-out commit to the Core current-CLI preflight", () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "openmeld-core-current-cli-preflight-")
  );
  const fixtureScripts = path.join(root, "scripts", "release");
  const capturePath = path.join(root, "captured-input.json");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  try {
    mkdirSync(fixtureScripts, { recursive: true });
    cpSync(
      entrypoint,
      path.join(fixtureScripts, "preflight-core-current-cli-projection.mjs")
    );
    writeFileSync(
      path.join(fixtureScripts, "production-release.mjs"),
      [
        'import { writeFileSync } from "node:fs";',
        "export function runCoreCurrentCliProjectionPreflight(input) {",
        "  writeFileSync(process.env.OPENMELD_PREFLIGHT_CAPTURE, JSON.stringify(input));",
        "}",
        "",
      ].join("\n")
    );
    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          packageManager: repositoryManifest.packageManager,
          private: true,
          scripts: {
            "release:preflight:core-current-cli-projection": preflightScript,
          },
        },
        null,
        2
      )}\n`
    );
    writeFileSync(path.join(root, "product.txt"), "fixture\n");
    git("init", "--initial-branch=main", "--quiet");
    git("config", "user.email", "preflight@test.openmeld.ai");
    git("config", "user.name", "OpenMeld Preflight Test");
    git("add", ".");
    git("commit", "--quiet", "-m", "fixture");
    const expectedSha = git("rev-parse", "HEAD");

    const invocation = resolveOwnedCommandInvocation("pnpm", [
      "run",
      "release:preflight:core-current-cli-projection",
    ]);
    const result = spawnSync(invocation.command, invocation.args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENMELD_PREFLIGHT_CAPTURE: capturePath,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(capturePath, "utf8")), {
      releaseSha: expectedSha,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
