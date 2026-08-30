import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";

const REFUSES_EVIDENCE_REGRESSION =
  /refusing to move it backward or across history/u;

test("publishes exact guarded local release sources for later status checks", () => {
  const fixture = createGitFixture();
  try {
    publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      remote: fixture.remote,
      scopes: ["cli", "core"],
      sourceSha: fixture.sourceSha,
    });

    assert.deepEqual(
      Object.fromEntries(
        readGuardedLocalReleaseSources({
          cwd: fixture.repository,
          remote: fixture.remote,
        })
      ),
      {
        cli: {
          sha: fixture.sourceSha,
          source: "guarded-local",
          url: undefined,
        },
        core: {
          sha: fixture.sourceSha,
          source: "guarded-local",
          url: undefined,
        },
      }
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

test("advances release evidence without allowing an older release to overwrite it", () => {
  const fixture = createGitFixture();
  try {
    const firstPublish = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    });
    const repeatedPublish = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: fixture.sourceSha,
    });
    const nextSourceSha = fixture.commit("next release evidence\n");
    const nextPublish = publishGuardedLocalReleaseEvidence({
      cwd: fixture.repository,
      remote: fixture.remote,
      scopes: ["web"],
      sourceSha: nextSourceSha,
    });

    assert.equal(firstPublish.published, true);
    assert.equal(repeatedPublish.published, false);
    assert.equal(nextPublish.published, true);
    assert.throws(
      () =>
        publishGuardedLocalReleaseEvidence({
          cwd: fixture.repository,
          remote: fixture.remote,
          scopes: ["web"],
          sourceSha: fixture.sourceSha,
        }),
      REFUSES_EVIDENCE_REGRESSION
    );
    assert.equal(
      readGuardedLocalReleaseSources({
        cwd: fixture.repository,
        remote: fixture.remote,
      }).get("web")?.sha,
      nextSourceSha
    );
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
});

function createGitFixture() {
  const root = mkdtempSync(
    path.join(tmpdir(), "openmeld-production-release-evidence-")
  );
  const repository = path.join(root, "repository");
  const remote = path.join(root, "remote.git");
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", remote);
  git(root, "init", "--initial-branch=main", "--quiet", repository);
  git(repository, "config", "user.email", "release-evidence@test.openmeld.ai");
  git(repository, "config", "user.name", "OpenMeld Release Evidence Test");
  writeFileSync(path.join(repository, "README.md"), "release evidence\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "--quiet", "-m", "seed release evidence");
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "--quiet", "-u", "origin", "main");

  return {
    commit(contents) {
      writeFileSync(path.join(repository, "README.md"), contents);
      git(repository, "add", "README.md");
      git(repository, "commit", "--quiet", "-m", "advance release evidence");
      git(repository, "push", "--quiet", "origin", "main");
      return git(repository, "rev-parse", "HEAD");
    },
    remote,
    repository,
    root,
    sourceSha: git(repository, "rev-parse", "HEAD"),
  };
}
