import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyTrustedCandidateEntrypoints } from "./verify-trusted-candidate-entrypoints.mjs";

const SELF_REWRITE_PATTERN =
  /cannot let the candidate rewrite its own test-control entrypoints/u;

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
  mkdirSync(path.join(root, "patches"), { recursive: true });
  writeFileSync(
    path.join(root, "patches", "better-sqlite3@13.0.3.patch"),
    contents
  );
}

function writeManifest(root, scripts) {
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ packageManager: "pnpm@10.30.0", scripts })}\n`
  );
}
