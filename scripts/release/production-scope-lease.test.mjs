import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireProductionScopeLease,
  inspectProductionScopeLease,
  inspectProductionScopeLeaseRecovery,
  recoverExpiredProductionScopeLease,
  releaseProductionScopeLease,
} from "./production-scope-lease.mjs";

const HELD_LEASE_PATTERN = /already held/u;
const AGENT_A_PATTERN = /local:agent-a/u;
const EXPIRY_FACT_PATTERN = /Expires:/u;
const STALE_RELEASE_PATTERN = /Refusing to release stale lease/u;
const ACTIVE_LEASE_PATTERN = /still active/u;

test("serializes one production scope across clones while unrelated scopes proceed", () => {
  const fixture = createLeaseFixture();
  try {
    const webA = acquireProductionScopeLease({
      cwd: fixture.agentA,
      now: "2026-08-26T00:00:00.000Z",
      owner: "local:agent-a",
      scope: "web",
      sourceSha: fixture.sourceSha,
    });
    const visibleFromB = inspectProductionScopeLease({
      cwd: fixture.agentB,
      now: "2026-08-26T00:01:00.000Z",
      scope: "web",
    });

    assert.equal(visibleFromB.leaseSha, webA.leaseSha);
    assert.equal(visibleFromB.metadata.owner, "local:agent-a");
    assert.throws(
      () =>
        acquireProductionScopeLease({
          cwd: fixture.agentB,
          now: "2026-08-26T00:01:00.000Z",
          owner: "github:amplifthq/openmeld/actions/runs/123",
          scope: "web",
          sourceSha: fixture.sourceSha,
        }),
      (error) => {
        assert.match(error.message, HELD_LEASE_PATTERN);
        assert.match(error.message, AGENT_A_PATTERN);
        assert.match(error.message, new RegExp(fixture.sourceSha, "u"));
        assert.match(error.message, EXPIRY_FACT_PATTERN);
        return true;
      }
    );

    const authB = acquireProductionScopeLease({
      cwd: fixture.agentB,
      now: "2026-08-26T00:01:00.000Z",
      owner: "github:amplifthq/openmeld/actions/runs/123",
      scope: "auth",
      sourceSha: fixture.sourceSha,
    });
    assert.equal(authB.metadata.scope, "auth");

    releaseProductionScopeLease({
      cwd: fixture.agentA,
      leaseSha: webA.leaseSha,
      scope: "web",
    });
    const webB = acquireProductionScopeLease({
      cwd: fixture.agentB,
      now: "2026-08-26T00:02:00.000Z",
      owner: "local:agent-b",
      scope: "web",
      sourceSha: fixture.sourceSha,
    });

    assert.throws(
      () =>
        releaseProductionScopeLease({
          cwd: fixture.agentA,
          leaseSha: webA.leaseSha,
          scope: "web",
        }),
      STALE_RELEASE_PATTERN
    );
    assert.equal(
      inspectProductionScopeLease({ cwd: fixture.agentA, scope: "web" })
        .leaseSha,
      webB.leaseSha
    );

    releaseProductionScopeLease({
      cwd: fixture.agentB,
      leaseSha: webB.leaseSha,
      scope: "web",
    });
    releaseProductionScopeLease({
      cwd: fixture.agentB,
      leaseSha: authB.leaseSha,
      scope: "auth",
    });
  } finally {
    fixture.cleanup();
  }
});

test("recovers only one explicitly identified expired lease with a reason", () => {
  const fixture = createLeaseFixture();
  try {
    const lease = acquireProductionScopeLease({
      cwd: fixture.agentA,
      now: "2026-08-26T00:00:00.000Z",
      owner: "local:expired-agent",
      scope: "core",
      sourceSha: fixture.sourceSha,
      ttlSeconds: 300,
    });

    assert.throws(
      () =>
        recoverExpiredProductionScopeLease({
          cwd: fixture.agentB,
          leaseSha: lease.leaseSha,
          now: "2026-08-26T00:04:59.000Z",
          reason: "The owning process was verified stopped.",
          scope: "core",
        }),
      ACTIVE_LEASE_PATTERN
    );
    const recovery = recoverExpiredProductionScopeLease({
      cwd: fixture.agentB,
      leaseSha: lease.leaseSha,
      now: "2026-08-26T00:05:01.000Z",
      reason: "The owning process was verified stopped before recovery.",
      scope: "core",
    });

    assert.equal(recovery.recovered.metadata.owner, "local:expired-agent");
    const durableRecovery = inspectProductionScopeLeaseRecovery({
      cwd: fixture.agentA,
      leaseSha: lease.leaseSha,
      scope: "core",
    });
    assert.equal(durableRecovery.recoveredLeaseSha, lease.leaseSha);
    assert.equal(
      durableRecovery.metadata.reason,
      "The owning process was verified stopped before recovery."
    );
    assert.equal(durableRecovery.metadata.recoveredBy.includes(":"), true);
    assert.equal(
      durableRecovery.metadata.recoveredLease.owner,
      "local:expired-agent"
    );
    assert.equal(durableRecovery.metadata.recoveredLease.scope, "core");
    assert.equal(durableRecovery.ref, recovery.recoveryRef);
    assert.equal(
      inspectProductionScopeLease({ cwd: fixture.agentA, scope: "core" }),
      null
    );
  } finally {
    fixture.cleanup();
  }
});

function createLeaseFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-scope-lease-"));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const agentA = path.join(root, "agent-a");
  const agentB = path.join(root, "agent-b");
  const environment = isolatedGitEnvironment(process.env);
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", remote);
  git(root, "init", "--initial-branch=main", "--quiet", seed);
  git(seed, "config", "user.email", "lease-test@openmeld.ai");
  git(seed, "config", "user.name", "OpenMeld Lease Test");
  writeFileSync(path.join(seed, "README.md"), "lease fixture\n");
  git(seed, "add", "README.md");
  git(seed, "commit", "--quiet", "-m", "seed main");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "--quiet", "-u", "origin", "main");
  const sourceSha = git(seed, "rev-parse", "HEAD");
  git(root, "clone", "--quiet", remote, agentA);
  git(root, "clone", "--quiet", remote, agentB);

  return {
    agentA,
    agentB,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    sourceSha,
  };
}

function isolatedGitEnvironment(environment) {
  const isolated = { ...environment };
  for (const name of [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_CONFIG",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
    "GIT_DIR",
    "GIT_GRAFT_FILE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PREFIX",
    "GIT_WORK_TREE",
  ]) {
    delete isolated[name];
  }
  return isolated;
}
