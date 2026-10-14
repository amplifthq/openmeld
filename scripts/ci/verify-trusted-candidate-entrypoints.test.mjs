import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
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

import { projectFinalCandidateControl } from "./final-candidate-control-projection.mjs";
import {
  HOSTED_CONTROL_REFUSE_DISPOSITION,
  HOSTED_CONTROL_REFUSE_SUMMARY,
  HOSTED_CONTROL_REFUSE_TITLE,
  HOSTED_RUN_DISPOSITION,
  resolveHostedFinalCandidateDisposition,
} from "./final-candidate-hosted-disposition.mjs";
import { verifyTrustedCandidateEntrypoints } from "./verify-trusted-candidate-entrypoints.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

const SELF_REWRITE_PATTERN =
  /cannot let the candidate rewrite its own test-control entrypoints/u;
const PROTECTED_BOOTSTRAP_PATTERN = /protected local bootstrap/u;
const DELIVERY_DOCUMENT_PATTERN = /agent-native-delivery\.md/u;

test("inspects immutable candidate objects without replacing trusted working-tree files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "candidate-object-data-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    }).trim();
  try {
    git("init", "--template=");
    writeFileSync(
      path.join(root, "package.json"),
      '{"scripts":{"check":"trusted-check"}}'
    );
    const largePatch = "x".repeat(2 * 1024 * 1024);
    writeFileSync(path.join(root, "dependency.patch"), largePatch);
    writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      "patchedDependencies:\n  dependency@1.0.0: dependency.patch\n"
    );
    git("add", "package.json", "dependency.patch", "pnpm-workspace.yaml");
    git("commit", "-m", "trusted");
    const base = git("rev-parse", "HEAD");
    writeFileSync(
      path.join(root, "package.json"),
      '{"scripts":{"check":"forged-check"}}'
    );
    git("commit", "-am", "candidate");
    const head = git("rev-parse", "HEAD");
    git("checkout", "--detach", base);
    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          trustedRoot: root,
          candidateRoot: root,
          candidateRef: head,
        }),
      SELF_REWRITE_PATTERN
    );
    verifyTrustedCandidateEntrypoints({
      trustedRoot: root,
      candidateRoot: root,
      candidateRef: base,
    });
    writeFileSync(path.join(root, "dependency.patch"), `${largePatch}changed`);
    git("commit", "-am", "change patch beyond the default buffer limit");
    const patchedHead = git("rev-parse", "HEAD");
    git("checkout", "--detach", base);
    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          trustedRoot: root,
          candidateRoot: root,
          candidateRef: patchedHead,
        }),
      SELF_REWRITE_PATTERN
    );
    assert.equal(git("rev-parse", "HEAD"), base);
    assert.equal(
      readFileSync(path.join(root, "package.json"), "utf8"),
      '{"scripts":{"check":"trusted-check"}}'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a candidate that rewrites the package script used to validate itself", () => {
  const fixture = createFixture();
  try {
    writeManifest(fixture.candidateRoot, {
      candidate: "node scripts/ci/forged-runner.mjs",
      "verify:pr": "true",
    });

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["package.json"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

test("rejects a candidate that rewrites the trusted Final Candidate runner", () => {
  const fixture = createFixture();
  try {
    const trustedRunner = path.join(
      fixture.trustedRoot,
      "scripts",
      "ci",
      "final-candidate.mjs"
    );
    const candidateRunner = path.join(
      fixture.candidateRoot,
      "scripts",
      "ci",
      "final-candidate.mjs"
    );
    mkdirSync(path.dirname(trustedRunner), { recursive: true });
    mkdirSync(path.dirname(candidateRunner), { recursive: true });
    writeFileSync(trustedRunner, "runTrusted();\n");
    writeFileSync(candidateRunner, "publishForgedGreen();\n");

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["scripts/ci/final-candidate.mjs"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

test("skips hosted validation with actionable copy when trusted control changes", () => {
  const fixture = createFixture();
  try {
    writeManifest(fixture.candidateRoot, {
      candidate: "node scripts/ci/forged-runner.mjs",
      "verify:pr": "node scripts/dev/turbo-affected.mjs check test",
    });

    const result = resolveHostedFinalCandidateDisposition({
      candidateRoot: fixture.candidateRoot,
      paths: ["package.json"],
      trustedRoot: fixture.trustedRoot,
    });

    assert.equal(result.disposition, HOSTED_CONTROL_REFUSE_DISPOSITION);
    assert.equal(result.runCandidate, false);
    assert.equal(result.conclusion, "skipped");
    assert.equal(result.title, HOSTED_CONTROL_REFUSE_TITLE);
    assert.equal(result.summary, HOSTED_CONTROL_REFUSE_SUMMARY);
    assert.match(result.summary, PROTECTED_BOOTSTRAP_PATTERN);
    assert.match(result.summary, DELIVERY_DOCUMENT_PATTERN);
    assert.deepEqual(result.driftedPaths, ["package.json"]);
  } finally {
    fixture.cleanup();
  }
});

test("runs hosted validation when trusted control is unchanged", () => {
  const fixture = createFixture();
  try {
    const result = resolveHostedFinalCandidateDisposition({
      candidateRoot: fixture.candidateRoot,
      paths: ["package.json"],
      trustedRoot: fixture.trustedRoot,
    });

    assert.equal(result.disposition, HOSTED_RUN_DISPOSITION);
    assert.equal(result.runCandidate, true);
    assert.deepEqual(result.driftedPaths, []);
  } finally {
    fixture.cleanup();
  }
});

test("accepts product source changes when validation entrypoints are unchanged", () => {
  const fixture = createFixture();
  try {
    const result = verifyTrustedCandidateEntrypoints({
      candidateRoot: fixture.candidateRoot,
      paths: ["package.json", "turbo.json", "pnpm-workspace.yaml"],
      trustedRoot: fixture.trustedRoot,
    });

    assert.deepEqual(result.checkedPaths, [
      "package.json",
      "turbo.json",
      "pnpm-workspace.yaml",
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("a lockfile-only candidate remains hosted-certifiable", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      path.join(fixture.trustedRoot, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters: {}\n"
    );
    writeFileSync(
      path.join(fixture.candidateRoot, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"
    );

    assert.doesNotThrow(() =>
      verifyTrustedCandidateEntrypoints({
        candidateRoot: fixture.candidateRoot,
        paths: ["pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml"],
        trustedRoot: fixture.trustedRoot,
      })
    );
  } finally {
    fixture.cleanup();
  }
});

test("a catalog-only workspace change is not control drift", () => {
  const fixture = createFixture();
  try {
    writeWorkspace(fixture.trustedRoot, {
      allowBuilds: { "better-sqlite3": true, esbuild: true },
      catalog: { zod: "4.6.5" },
      patchedDependencies: {
        "better-sqlite3@13.0.3": "patches/better-sqlite3@13.0.3.patch",
      },
    });
    writeWorkspace(fixture.candidateRoot, {
      allowBuilds: { "better-sqlite3": true, esbuild: true },
      catalog: { zod: "4.7.0" },
      overrides: { wrangler: "4.130.0" },
      patchedDependencies: {
        "better-sqlite3@13.0.3": "patches/better-sqlite3@13.0.3.patch",
      },
    });
    writePatch(fixture.trustedRoot, "same patch\n");
    writePatch(fixture.candidateRoot, "same patch\n");

    assert.doesNotThrow(() =>
      verifyTrustedCandidateEntrypoints({
        candidateRoot: fixture.candidateRoot,
        paths: ["pnpm-workspace.yaml"],
        trustedRoot: fixture.trustedRoot,
      })
    );
  } finally {
    fixture.cleanup();
  }
});

test("allowBuilds drift still refuses hosted certification", () => {
  const fixture = createFixture();
  try {
    writeWorkspace(fixture.trustedRoot, {
      allowBuilds: { "better-sqlite3": true, esbuild: true },
      catalog: { zod: "4.6.5" },
    });
    writeWorkspace(fixture.candidateRoot, {
      allowBuilds: {
        "better-sqlite3": true,
        esbuild: true,
        "evil-native": true,
      },
      catalog: { zod: "4.6.5" },
    });

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["pnpm-workspace.yaml"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

test("an .npmrc-only script-shell candidate fails the control gate", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      path.join(fixture.candidateRoot, "package.json"),
      readFileSync(path.join(fixture.trustedRoot, "package.json"), "utf8")
    );
    writeFileSync(
      path.join(fixture.candidateRoot, ".npmrc"),
      "script-shell=./candidate-shell.sh\n"
    );
    writeFileSync(
      path.join(fixture.candidateRoot, "candidate-shell.sh"),
      "#!/bin/sh\nexit 0\n"
    );
    writeManifest(fixture.candidateRoot, {
      candidate: "node scripts/ci/final-candidate.mjs",
      prove: 'node -e "process.exit(37)"',
      "verify:pr": "node scripts/dev/turbo-affected.mjs check test",
    });
    writeManifest(fixture.trustedRoot, {
      candidate: "node scripts/ci/final-candidate.mjs",
      prove: 'node -e "process.exit(37)"',
      "verify:pr": "node scripts/dev/turbo-affected.mjs check test",
    });

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: [".npmrc"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

test("flow-style allowBuilds still refuses hosted certification", () => {
  const fixture = createFixture();
  try {
    writeWorkspace(fixture.trustedRoot, {
      allowBuilds: { "better-sqlite3": true },
    });
    writeFileSync(
      path.join(fixture.candidateRoot, "pnpm-workspace.yaml"),
      [
        "packages: []",
        "allowBuilds: { better-sqlite3: true, evil-native: true }",
        "",
      ].join("\n")
    );

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["pnpm-workspace.yaml"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

test("flow-style onlyBuiltDependencies still refuses hosted certification", () => {
  const fixture = createFixture();
  try {
    writeWorkspace(fixture.trustedRoot, {
      allowBuilds: { "better-sqlite3": true },
    });
    writeFileSync(
      path.join(fixture.candidateRoot, "pnpm-workspace.yaml"),
      [
        "packages: []",
        "allowBuilds:",
        "  better-sqlite3: true",
        "onlyBuiltDependencies: [other-native]",
        "",
      ].join("\n")
    );

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["pnpm-workspace.yaml"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

const HIDDEN_QUOTED_OR_TAGGED_ONLY_BUILT_DEPENDENCY_FORMS = [
  [
    "double-quoted complex key",
    ['? "onlyBuiltDependencies"', ":", "  - evil-native"].join("\n"),
  ],
  [
    "single-quoted complex key",
    ["? 'onlyBuiltDependencies'", ":", "  - evil-native"].join("\n"),
  ],
  [
    "tagged !!str complex key",
    ["? !!str onlyBuiltDependencies", ":", "  - evil-native"].join("\n"),
  ],
  [
    "tagged !!str quoted complex key",
    ['? !!str "onlyBuiltDependencies"', ":", "  - evil-native"].join("\n"),
  ],
];

for (const [
  label,
  hiddenYaml,
] of HIDDEN_QUOTED_OR_TAGGED_ONLY_BUILT_DEPENDENCY_FORMS) {
  test(`quoted or tagged complex-key ${label} still refuses hosted certification`, () => {
    const fixture = createFixture();
    try {
      writeWorkspace(fixture.trustedRoot, {
        allowBuilds: { "better-sqlite3": true },
      });
      writeWorkspace(fixture.candidateRoot, {
        allowBuilds: { "better-sqlite3": true },
      });
      writeFileSync(
        path.join(fixture.candidateRoot, "pnpm-workspace.yaml"),
        `${readFileSync(path.join(fixture.candidateRoot, "pnpm-workspace.yaml"), "utf8").trimEnd()}\n${hiddenYaml}\n`
      );

      assert.throws(
        () =>
          verifyTrustedCandidateEntrypoints({
            candidateRoot: fixture.candidateRoot,
            paths: ["pnpm-workspace.yaml"],
            trustedRoot: fixture.trustedRoot,
          }),
        SELF_REWRITE_PATTERN
      );
    } finally {
      fixture.cleanup();
    }
  });
}

test("complex-key patchedDependencies still refuses hosted certification", () => {
  const fixture = createFixture();
  try {
    writeWorkspace(fixture.trustedRoot, {
      allowBuilds: { "better-sqlite3": true },
      patchedDependencies: {
        "foo@1.0.0": "patches/foo.patch",
      },
    });
    writeFileSync(
      path.join(fixture.candidateRoot, "pnpm-workspace.yaml"),
      [
        "packages: []",
        "allowBuilds:",
        "  better-sqlite3: true",
        "patchedDependencies:",
        "  foo@1.0.0: patches/foo.patch",
        "  ? sherif@1.13.0",
        "  : patches/sherif.patch",
        "",
      ].join("\n")
    );
    writeNamedPatch(fixture.trustedRoot, "foo.patch", "same patch\n");
    writeNamedPatch(fixture.candidateRoot, "foo.patch", "same patch\n");
    writeNamedPatch(
      fixture.candidateRoot,
      "sherif.patch",
      "hidden native patch\n"
    );

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["pnpm-workspace.yaml"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

test("equivalent flow-style onlyBuiltDependencies is not control drift", () => {
  const fixture = createFixture();
  try {
    writeFileSync(
      path.join(fixture.trustedRoot, "pnpm-workspace.yaml"),
      [
        "packages: []",
        "allowBuilds:",
        "  better-sqlite3: true",
        "onlyBuiltDependencies:",
        "  - other-native",
        "",
      ].join("\n")
    );
    writeFileSync(
      path.join(fixture.candidateRoot, "pnpm-workspace.yaml"),
      [
        "packages: []",
        "allowBuilds:",
        "  better-sqlite3: true",
        "onlyBuiltDependencies: [other-native]",
        "",
      ].join("\n")
    );

    assert.doesNotThrow(() =>
      verifyTrustedCandidateEntrypoints({
        candidateRoot: fixture.candidateRoot,
        paths: ["pnpm-workspace.yaml"],
        trustedRoot: fixture.trustedRoot,
      })
    );
  } finally {
    fixture.cleanup();
  }
});

test("current-main workspace YAML still projects native-trust fields", () => {
  const contents = readFileSync(
    path.join(REPO_ROOT, "pnpm-workspace.yaml"),
    "utf8"
  );

  const projection = projectFinalCandidateControl(
    "pnpm-workspace.yaml",
    contents,
    () => "patch-bytes"
  );
  const parsed = JSON.parse(projection);

  assert.equal(parsed.allowBuilds["better-sqlite3"], true);
  assert.equal(
    parsed.patchedDependencies["better-sqlite3@13.0.3"],
    "patches/better-sqlite3@13.0.3.patch"
  );
  assert.equal(parsed.patchContents["better-sqlite3@13.0.3"], "patch-bytes");
});

test("a native patch change still refuses hosted certification", () => {
  const fixture = createFixture();
  try {
    writeWorkspace(fixture.trustedRoot, {
      allowBuilds: { "better-sqlite3": true },
      patchedDependencies: {
        "better-sqlite3@13.0.3": "patches/better-sqlite3@13.0.3.patch",
      },
    });
    writeWorkspace(fixture.candidateRoot, {
      allowBuilds: { "better-sqlite3": true },
      patchedDependencies: {
        "better-sqlite3@13.0.3": "patches/better-sqlite3@13.0.3.patch",
      },
    });
    writePatch(fixture.trustedRoot, "trusted native patch\n");
    writePatch(fixture.candidateRoot, "candidate native patch\n");

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["pnpm-workspace.yaml"],
          trustedRoot: fixture.trustedRoot,
        }),
      SELF_REWRITE_PATTERN
    );
  } finally {
    fixture.cleanup();
  }
});

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-trusted-candidate-"));
  const trustedRoot = path.join(root, "trusted");
  const candidateRoot = path.join(root, "candidate");
  mkdirSync(trustedRoot);
  mkdirSync(candidateRoot);
  for (const repoRoot of [trustedRoot, candidateRoot]) {
    writeManifest(repoRoot, {
      candidate: "node scripts/ci/final-candidate.mjs",
      "verify:pr": "node scripts/dev/turbo-affected.mjs check test",
    });
    writeFileSync(path.join(repoRoot, "turbo.json"), '{"tasks":{}}\n');
    writeFileSync(
      path.join(repoRoot, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n"
    );
    writeWorkspace(repoRoot, {
      allowBuilds: { "better-sqlite3": true },
      catalog: { zod: "4.6.5" },
    });
  }
  return {
    candidateRoot,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    trustedRoot,
  };
}

function writeWorkspace(root, fields) {
  const lines = ["packages: []", ""];
  for (const key of [
    "allowBuilds",
    "catalog",
    "overrides",
    "onlyBuiltDependencies",
    "patchedDependencies",
  ]) {
    if (fields[key] === undefined) {
      continue;
    }
    lines.push(`${key}:`);
    if (Array.isArray(fields[key])) {
      for (const item of fields[key]) {
        lines.push(`  - ${item}`);
      }
      continue;
    }
    for (const [name, value] of Object.entries(fields[key])) {
      const renderedKey =
        name.includes("@") || name.includes("/") ? `'${name}'` : name;
      lines.push(`  ${renderedKey}: ${String(value)}`);
    }
    lines.push("");
  }
  writeFileSync(
    path.join(root, "pnpm-workspace.yaml"),
    `${lines.join("\n")}\n`
  );
}

function writePatch(root, contents) {
  writeNamedPatch(root, "better-sqlite3@13.0.3.patch", contents);
}

function writeNamedPatch(root, fileName, contents) {
  mkdirSync(path.join(root, "patches"), { recursive: true });
  writeFileSync(path.join(root, "patches", fileName), contents);
}

function writeManifest(root, scripts) {
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ packageManager: "pnpm@10.30.0", scripts })}\n`
  );
}
