import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { finalCandidateEvidenceSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import { assertEvidenceMatchesExecution } from "./final-candidate-publisher.mjs";
import { runFinalCandidateReleasePolicy } from "./final-candidate-release-policy.mjs";

const PREMATURE_RELEASE_STAMP_PATTERN = /must match the PR base/u;
const PUBLISHER_FAILURE_PATTERN = /Candidate job concluded failure/u;

test("a premature release stamp fails early with canonical exact evidence and a command log", async () => {
  const fixture = await createCandidateFixture();
  try {
    await stampRelease(fixture, "0.3.154");
    const evidencePath = path.join(fixture.root, "evidence/final.json");

    assert.throws(
      () =>
        runFinalCandidateReleasePolicy({
          baseSha: fixture.baseSha,
          branchName: "codex/product-change",
          candidateRoot: fixture.root,
          confidence: "standard",
          evidencePath,
          headSha: fixture.git("rev-parse", "HEAD"),
          pullRequestNumber: 629,
          repository: "amplifthq/openmeld",
          serverUrl: "https://github.com",
          treeSha: fixture.git("rev-parse", "HEAD^{tree}"),
        }),
      PREMATURE_RELEASE_STAMP_PATTERN
    );

    const evidence = finalCandidateEvidenceSchema.parse(
      JSON.parse(readFileSync(evidencePath, "utf8"))
    );
    assert.equal(evidence.conclusion, "failure");
    assert.equal(evidence.baseSha, fixture.baseSha);
    assert.equal(evidence.headSha, fixture.git("rev-parse", "HEAD"));
    assert.equal(evidence.treeSha, fixture.git("rev-parse", "HEAD^{tree}"));
    assert.equal(evidence.results.length, 1);
    assert.equal(evidence.results[0]?.status, "failed");
    assert.match(
      evidence.results[0]?.stderrTail ?? "",
      PREMATURE_RELEASE_STAMP_PATTERN
    );
    assert.equal(
      existsSync(`${evidencePath}.logs/release-branch-policy.log`),
      true
    );
    assert.match(
      readFileSync(`${evidencePath}.logs/release-branch-policy.log`, "utf8"),
      PREMATURE_RELEASE_STAMP_PATTERN
    );
    assert.throws(
      () =>
        assertEvidenceMatchesExecution({
          candidateJobResult: "failure",
          evidence,
        }),
      PUBLISHER_FAILURE_PATTERN
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("an ordinary source change passes without creating failure evidence", async () => {
  const fixture = await createCandidateFixture();
  try {
    await writeFile(path.join(fixture.root, "feature.mjs"), "export {};\n");
    fixture.git("add", "feature.mjs");
    fixture.git("commit", "-m", "add feature");
    const evidencePath = path.join(fixture.root, "evidence/final.json");

    assert.doesNotThrow(() =>
      runFinalCandidateReleasePolicy({
        baseSha: fixture.baseSha,
        branchName: "codex/product-change",
        candidateRoot: fixture.root,
        confidence: "standard",
        evidencePath,
        headSha: fixture.git("rev-parse", "HEAD"),
        pullRequestNumber: 629,
        repository: "amplifthq/openmeld",
        serverUrl: "https://github.com",
        treeSha: fixture.git("rev-parse", "HEAD^{tree}"),
      })
    );
    assert.equal(existsSync(evidencePath), false);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

async function createCandidateFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "openmeld-fc-policy-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "test@openmeld.local",
        GIT_AUTHOR_NAME: "OpenMeld Test",
        GIT_COMMITTER_EMAIL: "test@openmeld.local",
        GIT_COMMITTER_NAME: "OpenMeld Test",
      },
    }).trim();
  await mkdir(path.join(root, "clients/openmeld-cli"), { recursive: true });
  await mkdir(path.join(root, "release"), { recursive: true });
  await writeFile(
    path.join(root, "clients/openmeld-cli/package.json"),
    `${JSON.stringify({ name: "openmeld", version: "0.3.153" }, null, 2)}\n`
  );
  await writeFile(
    path.join(root, "release/local-components.json"),
    `${JSON.stringify(buildManifest("0.3.153"), null, 2)}\n`
  );
  git("init", "--quiet");
  git("add", ".");
  git("commit", "-m", "seed release state");
  return { baseSha: git("rev-parse", "HEAD"), git, root };
}

async function stampRelease(fixture, version) {
  await writeFile(
    path.join(fixture.root, "clients/openmeld-cli/package.json"),
    `${JSON.stringify({ name: "openmeld", version }, null, 2)}\n`
  );
  await writeFile(
    path.join(fixture.root, "release/local-components.json"),
    `${JSON.stringify(buildManifest(version), null, 2)}\n`
  );
  fixture.git(
    "add",
    "clients/openmeld-cli/package.json",
    "release/local-components.json"
  );
  fixture.git("commit", "-m", "stamp release");
}

function buildManifest(version) {
  return {
    components: {
      cli: { packageVersion: version },
      service: { bundleVersion: version },
    },
    schemaVersion: 1,
  };
}
