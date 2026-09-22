import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkCliSkill } from "./cli-skill-check.mjs";

const WRAPPER = fileURLToPath(
  new URL("./cli-skill-check.mjs", import.meta.url)
);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = "release/openmeld-cli-skill";
const PUBLIC = "clients/web/public/skills/openmeld-cli";
const VERIFICATION_FAILURE = /CLI Skill verification failed/u;
const CHECK_PASSED = /check passed/u;
const CONTENT_FAILURE =
  /Published revisions are immutable|Published Skill signature is invalid|Generated Skill file differs/u;
const NOT_APPLICABLE = /not applicable/u;
const HISTORICAL_NOT_APPLICABLE = /not applicable to this historical source/u;

test("propagates verifier failures without launching a package manager", () => {
  for (const status of [0, 1, null]) {
    const calls = [];
    const cwd = path.resolve("release source with spaces");
    const verify = () =>
      checkCliSkill({
        cwd,
        run: (command, args, options) => {
          calls.push({ command, args, options });
          return { status };
        },
      });
    if (status === 0) {
      assert.doesNotThrow(verify);
    } else {
      assert.throws(verify, VERIFICATION_FAILURE);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, [
      "--experimental-strip-types",
      fileURLToPath(new URL("./cli-skill.mjs", import.meta.url)),
      "check",
    ]);
    assert.equal(calls[0].options.cwd, cwd);
    assert.equal(calls[0].options.env.OPENMELD_VERIFICATION_ROOT, cwd);
    assert.notEqual(calls[0].options.shell, true);
  }
  const spawnError = new Error("cannot launch verifier");
  assert.throws(
    () => checkCliSkill({ run: () => ({ error: spawnError, status: null }) }),
    (error) => error === spawnError
  );
});

test("the real wrapper keeps control and source separate with no pnpm on PATH", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld skill process "));
  try {
    const control = path.join(root, "control with spaces");
    const source = path.join(root, "source with spaces");
    const wrapper = path.join(control, "scripts/release/cli-skill-check.mjs");
    mkdirSync(path.dirname(wrapper), { recursive: true });
    copyFileSync(WRAPPER, wrapper);
    // Probe only the executable/data boundary here. The tests below run the
    // real verifier and real signatures, without substituting either one.
    writeFixtureFile(
      control,
      "scripts/release/cli-skill.mjs",
      [
        'import { readFileSync } from "node:fs";',
        'import path from "node:path";',
        'if (process.argv[2] !== "check") throw new Error("not read-only");',
        'process.stdout.write(readFileSync(path.join(process.env.OPENMELD_VERIFICATION_ROOT, "product.txt"), "utf8"));',
      ].join("\n")
    );
    writeFixtureFile(source, "product.txt", "exact historical product\n");
    writeFixtureFile(
      source,
      "scripts/release/cli-skill.mjs",
      'throw new Error("historical executable must not run");\n'
    );
    const result = runWrapper(source, wrapper);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "exact historical product\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("current control verifies signed historical content without source-owned code", () => {
  const releases = readPublishedReleases();
  for (const release of [releases[0], releases.at(-1)]) {
    const root = mkdtempSync(path.join(tmpdir(), "openmeld signed skill "));
    try {
      populateSignedFixture(root, release);
      writeFixtureFile(
        root,
        "scripts/release/cli-skill.mjs",
        'throw new Error("historical verifier must not run");\n'
      );
      writeFixtureFile(
        root,
        "packages/schemas/src/official-cli-skill.ts",
        'throw new Error("historical schema must not load");\n'
      );
      const before = snapshotFiles(root);
      const result = runWrapper(root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, CHECK_PASSED);
      assert.deepEqual(snapshotFiles(root), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("real verification rejects stale source, invalid signatures and changed public files", () => {
  const release = readPublishedReleases().at(-1);
  for (const corruption of ["source", "signature", "public"]) {
    const root = mkdtempSync(path.join(tmpdir(), "openmeld corrupt skill "));
    try {
      populateSignedFixture(root, release);
      if (corruption === "signature") {
        writeFixtureFile(
          root,
          `${PUBLIC}/channel.json`,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              releases: [{ ...release, signature: `${"A".repeat(86)}==` }],
            },
            null,
            2
          )}\n`
        );
      } else {
        writeFixtureFile(
          root,
          `${corruption === "source" ? SOURCE : PUBLIC}/SKILL.md`,
          "Unsigned edit\n"
        );
      }
      const before = snapshotFiles(root);
      const result = runWrapper(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, CONTENT_FAILURE);
      assert.deepEqual(snapshotFiles(root), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("historical sources without Skill delivery are explicit, but partial artifacts fail closed", () => {
  for (const present of [null, SOURCE, PUBLIC]) {
    const root = mkdtempSync(path.join(tmpdir(), "openmeld before skill "));
    try {
      if (present) {
        mkdirSync(path.join(root, present), { recursive: true });
      }
      const before = snapshotFiles(root);
      const result = runWrapper(root);
      if (present) {
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stdout, NOT_APPLICABLE);
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, HISTORICAL_NOT_APPLICABLE);
      }
      assert.deepEqual(snapshotFiles(root), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function runWrapper(cwd, wrapper = WRAPPER) {
  return spawnSync(process.execPath, [wrapper], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: "",
      Path: "",
      npm_execpath: path.join(cwd, "unused pnpm.cmd"),
    },
  });
}

function readPublishedReleases() {
  return JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, PUBLIC, "channel.json"), "utf8")
  ).releases;
}

function populateSignedFixture(root, release) {
  const payload = JSON.parse(release.payload);
  for (const directory of ["playbooks", "references"]) {
    mkdirSync(path.join(root, SOURCE, directory), { recursive: true });
  }
  writeFixtureFile(
    root,
    `${SOURCE}/release.json`,
    JSON.stringify({
      revision: payload.revision,
      minimumCliVersion: payload.minimumCliVersion,
    })
  );
  writeFixtureFile(
    root,
    `${PUBLIC}/channel.json`,
    `${JSON.stringify({ schemaVersion: 1, releases: [release] }, null, 2)}\n`
  );
  for (const file of payload.files) {
    for (const directory of [
      SOURCE,
      PUBLIC,
      `${PUBLIC}/releases/${payload.revision}`,
    ]) {
      writeFixtureFile(root, `${directory}/${file.path}`, file.content);
    }
  }
}

function writeFixtureFile(root, relative, content) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function snapshotFiles(root, relative = "") {
  return readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const name = path.join(relative, entry.name);
      return entry.isDirectory()
        ? snapshotFiles(root, name)
        : [[name, readFileSync(path.join(root, name), "utf8")]];
    });
}
