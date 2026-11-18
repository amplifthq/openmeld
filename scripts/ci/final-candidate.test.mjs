import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { requestConfidenceLabel } from "./final-candidate.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FINAL_CANDIDATE_SCRIPT = path.join(SCRIPT_DIR, "final-candidate.mjs");
const GITHUB_PULL_REQUEST_FIXTURE = path.join(
  SCRIPT_DIR,
  "fixtures",
  "github-pull-request-325.json"
);
const GITHUB_RUNS_FIXTURE = path.join(
  SCRIPT_DIR,
  "fixtures",
  "github-final-candidate-runs.json"
);
const REPOSITORY_LOCAL_GIT_ENV_VARS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
];
const CANDIDATE_EVIDENCE_PATTERN = /OpenMeld Final Candidate Evidence/u;
const COMMENT_ENDPOINT_PATTERN = /issues\/1\/comments/u;
const DOCUMENTATION_CHECK_PATTERN = /documentation-contracts/u;
const FAILURE_STATUS_PATTERN = /state=failure/u;
const MAIN_ADVANCED_PATTERN = /Main advanced/u;
const REMOTE_MODE_PATTERN = /Mode: remote/u;
const PAID_HOSTED_COST_PATTERN =
  /Cost: paid GitHub Actions for ready PRs and explicit retries; selected checks may be high latency\./u;
const FINAL_CERTIFICATION_PATTERN =
  /Use: final merge certification, not development, debugging, or review discovery\./u;
const PRACTICAL_TRIGGER_PATTERN =
  /Practical trigger: keep development and batch leaves in draft; ready PRs run automatically\. Observe an existing run before requesting a retry\./u;
const PENDING_STATUS_PATTERN = /state=pending/u;
const REQUEST_PENDING_PATTERN = /Head status: pending/u;
const SANDBOX_DENIED_PATTERN = /sandbox denied/u;
const SUCCESS_STATUS_PATTERN = /state=success/u;
const TOKEN_ABSENCE_PATTERN = /GH_TOKEN=absent GITHUB_TOKEN=absent/u;
const TRUSTED_CONTROL_CHECK_PATTERN = /trusted-control-entrypoints/u;
const BEHAVIOR_FAILURE_PATTERN = /behavior failed/u;
const SECRET_VALUE_PATTERN = /super-secret/u;
const CANDIDATE_VALIDATION_FAILURE_PATTERN = /Candidate validation failed/u;
const EVIDENCE_PUBLICATION_FAILURE_PATTERN = /Evidence publication failed/u;
const EXIT_CODE_SEVEN_PATTERN = /exit code 7/u;
const ORIGINAL_SELECTED_CHECK_PATTERN = /original selected-check/u;
const LARGE_STDOUT_LINE = "large-stdout-line";
const LARGE_STDERR_LINE = "large-stderr-line";
const FULL_COMMAND_LOGS_PATTERN = /Full command logs:/u;

test("dependency scope uses the real candidate diff and includes staged executable changes", () => {
  const fixture = createCandidateFixture();
  try {
    const readScope = (base = fixture.baseSha) =>
      spawnSync(
        process.execPath,
        [
          FINAL_CANDIDATE_SCRIPT,
          "dependency-scope",
          "--candidate-root",
          fixture.repositoryPath,
          "--base",
          base,
          "--head",
          fixture.headSha,
          "--mode",
          "remote",
        ],
        { encoding: "utf8", env: isolatedGitEnvironment(process.env) }
      );
    const documentation = readScope();
    assert.equal(documentation.status, 0, documentation.stderr);
    assert.equal(documentation.stdout, "root\n");
    writeFileSync(
      path.join(fixture.repositoryPath, "script.mjs"),
      "throw new Error('must not execute');\n"
    );
    execFileSync("git", ["add", "script.mjs"], {
      cwd: fixture.repositoryPath,
      env: isolatedGitEnvironment(process.env),
    });
    const executable = readScope();
    assert.equal(executable.status, 0, executable.stderr);
    assert.equal(executable.stdout, "workspace\n");
    assert.notEqual(readScope("0".repeat(40)).status, 0);
  } finally {
    fixture.cleanup();
  }
});

test("selected commands use the certified base instead of an inherited affected base", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      affectedBase: "0".repeat(40),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      readFileSync(fixture.candidateEnvironmentLogPath, "utf8").includes(
        `BASE=${fixture.baseSha}`
      )
    );
  } finally {
    fixture.cleanup();
  }
});

test(
  "an isolated selected command cannot rewrite trusted control or evidence",
  {
    skip: process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"),
  },
  () => {
    const fixture = createCandidateFixture();
    try {
      const requestedTrustedRoot = path.join(fixture.root, "trusted-control");
      mkdirSync(path.join(requestedTrustedRoot, "scripts", "release"), {
        recursive: true,
      });
      const trustedRoot = realpathSync(requestedTrustedRoot);
      const canonicalEvidencePath = path.join(
        realpathSync(fixture.root),
        "evidence.json"
      );
      mkdirSync(
        path.join(trustedRoot, "packages", "schemas", "src", "schemas"),
        {
          recursive: true,
        }
      );
      cpSync(path.join(SCRIPT_DIR), path.join(trustedRoot, "scripts", "ci"), {
        recursive: true,
      });
      cpSync(
        path.join(SCRIPT_DIR, "..", "dev"),
        path.join(trustedRoot, "scripts", "dev"),
        {
          recursive: true,
        }
      );
      cpSync(
        path.join(SCRIPT_DIR, "..", "release", "release-ready-paths.mjs"),
        path.join(trustedRoot, "scripts", "release", "release-ready-paths.mjs")
      );
      cpSync(
        path.join(SCRIPT_DIR, "..", "release", "cli-skill-check.mjs"),
        path.join(trustedRoot, "scripts", "release", "cli-skill-check.mjs")
      );
      cpSync(
        path.join(
          SCRIPT_DIR,
          "..",
          "..",
          "packages",
          "schemas",
          "src",
          "schemas",
          "ci"
        ),
        path.join(trustedRoot, "packages", "schemas", "src", "schemas", "ci"),
        { recursive: true }
      );
      symlinkSync(
        path.join(SCRIPT_DIR, "..", "..", "node_modules"),
        path.join(trustedRoot, "node_modules")
      );
      symlinkSync(
        path.join(
          SCRIPT_DIR,
          "..",
          "..",
          "packages",
          "schemas",
          "node_modules"
        ),
        path.join(trustedRoot, "packages", "schemas", "node_modules")
      );
      const trustedRunner = path.join(
        trustedRoot,
        "scripts",
        "ci",
        "final-candidate.mjs"
      );
      const originalTrustedRunner = readFileSync(trustedRunner, "utf8");
      const sandboxProfile = path.join(fixture.root, "candidate.sb");
      writeFileSync(
        sandboxProfile,
        [
          "(version 1)",
          "(allow default)",
          `(deny file-write* (subpath ${JSON.stringify(trustedRoot)}))`,
          `(deny file-write* (literal ${JSON.stringify(canonicalEvidencePath)}))`,
          "",
        ].join("\n")
      );

      const result = runCandidateFixture(fixture, {
        attackEvidencePath: canonicalEvidencePath,
        attackTrustedPath: trustedRunner,
        commandWrapper: path.join(
          trustedRoot,
          "scripts",
          "ci",
          "run-isolated-candidate-command.sh"
        ),
        finalCandidateScript: trustedRunner,
        sandboxProfile,
      });

      assert.equal(result.status, 1);
      assert.equal(readFileSync(trustedRunner, "utf8"), originalTrustedRunner);
      assert.ok(
        existsSync(fixture.evidencePath),
        `${result.stderr}\n${result.stdout}`
      );
      const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
      assert.equal(evidence.conclusion, "failure");
      assert.equal(evidence.results.at(-1).exitCode, 23);
      assert.match(evidence.results.at(-1).stderrTail, SANDBOX_DENIED_PATTERN);
      assert.doesNotMatch(
        readFileSync(fixture.ghLogPath, "utf8"),
        SUCCESS_STATUS_PATTERN
      );
    } finally {
      fixture.cleanup();
    }
  }
);

test("a hosted request prints the authoritative remote plan from current main", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runRequestFixture(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, REMOTE_MODE_PATTERN);
    assert.match(result.stdout, PAID_HOSTED_COST_PATTERN);
    assert.match(result.stdout, FINAL_CERTIFICATION_PATTERN);
    assert.match(result.stdout, PRACTICAL_TRIGGER_PATTERN);
    assert.match(
      result.stdout,
      new RegExp(`Plan source: ${fixture.baseSha}`, "u")
    );
    assert.match(result.stdout, TRUSTED_CONTROL_CHECK_PATTERN);
    assert.doesNotMatch(
      result.stdout,
      new RegExp(`Plan source: ${fixture.headSha}`, "u")
    );
    // The completed-only result workflow never publishes pending, so the
    // request marks the head pending before the hosted run starts.
    assert.match(
      readFileSync(fixture.ghLogPath, "utf8"),
      PENDING_STATUS_PATTERN
    );
    assert.match(result.stdout, REQUEST_PENDING_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

function requestClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: (ms) => {
      time += ms;
    },
  };
}

function fixtureRequestMarkers() {
  let latest;
  return async (input) =>
    requestConfidenceLabel({
      ...input,
      markPending: async () => {
        await input.markPending();
        latest = { id: (latest?.id ?? 0) + 1, label: input.requestedLabel };
        return latest;
      },
      readState: async () => ({
        labels: await input.readLabels(),
        marker: latest,
      }),
    });
}

test("competing confidence requests leave one trigger and preserve independent label edits", async () => {
  const labels = new Set(["triage"]);
  const triggers = [];
  const snapshot = () => [...labels].map((name) => ({ name }));
  const run = fixtureRequestMarkers();
  const request = (requestedLabel, markPending = () => undefined) =>
    run({
      ...requestClock(),
      requestedLabel,
      markPending,
      addLabel: (name) => {
        labels.add("reviewed");
        labels.delete("triage");
        if (!labels.has(name)) {
          triggers.push(name);
        }
        labels.add(name);
        return snapshot();
      },
      removeLabel: (name) => {
        labels.delete(name);
        return snapshot();
      },
      readLabels: snapshot,
    });
  const standard = "final-candidate";
  const full = "final-candidate-full";
  const results = await Promise.allSettled([request(standard), request(full)]);
  assert.deepEqual([...labels].sort(), [full, "reviewed"]);
  assert.equal(results[1].status, "fulfilled");
  assert.equal(results[0].status, "rejected");
  assert.ok(
    results[0].reason.message.includes("Concurrent Final Candidate request")
  );
  await request(full);
  assert.deepEqual(triggers, [full, full]);
  assert.deepEqual([...labels].sort(), [full, "reviewed"]);

  // The first standard run can finish while another standard request is
  // delayed writing pending. The later write must have a new run to settle it.
  const delayedPending = Promise.withResolvers();
  const lateRequest = request(standard, () => delayedPending.promise);
  await request(standard);
  const previousTriggers = triggers.length;
  delayedPending.resolve();
  await lateRequest;
  assert.deepEqual(triggers.slice(previousTriggers), [standard]);
  assert.deepEqual([...labels].sort(), [standard, "reviewed"]);
});

test("a hosted request pins label mutations to its admitted head and reports a failed post-pending read", () => {
  for (const [options, status, expectedTriggers, message] of [
    [{ failedPullReads: [2] }, 0, 1, ""],
    [
      { failedPullReads: [2, 3] },
      1,
      0,
      "No request-label trigger was attempted",
    ],
    [
      { failedPullReads: [3, 4] },
      1,
      1,
      "A request-label trigger was attempted",
    ],
    [{ driftAt: 2 }, 1, 0, "Pull request head changed"],
    [{ driftAt: 3 }, 1, 1, "Pull request head changed"],
    [{ driftAt: 3, rearm: true }, 1, 0, "Pull request head changed"],
    ...["closed", "draft", "retargeted"].map((ineligible) => [
      { ineligible },
      1,
      0,
      "must remain open",
    ]),
  ]) {
    const fixture = createCandidateFixture();
    try {
      if (options.rearm) {
        writeFileSync(
          `${fixture.ghLogPath}.labels`,
          JSON.stringify([{ name: "final-candidate" }])
        );
      }
      const result = runRequestFixture(fixture, options);
      assert.equal(result.status, status, result.stderr);
      const log = readFileSync(fixture.ghLogPath, "utf8");
      assert.match(log, PENDING_STATUS_PATTERN);
      const triggers = log
        .split("\n")
        .filter((line) =>
          line.includes("POST repos/amplifthq/openmeld/issues/1/labels")
        );
      assert.equal(triggers.length, expectedTriggers);
      if (message) {
        assert.ok(result.stderr.includes(message), result.stderr);
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test("a delayed mutation repairs the last effective run for the newest immutable request", async () => {
  for (const winner of ["final-candidate", "final-candidate-full"]) {
    const labels = new Set();
    const events = [];
    const markers = [];
    const snapshot = () => [...labels].map((name) => ({ name }));
    const clock = requestClock();
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    const request = (label, delayed) =>
      requestConfidenceLabel({
        ...clock,
        requestedLabel: label,
        markPending: () => {
          const marker = { id: markers.length + 1, label, at: clock.now() };
          markers.push(marker);
          return marker;
        },
        readState: () => ({ labels: snapshot(), marker: markers.at(-1) }),
        removeLabel: (name) => {
          labels.delete(name);
          return snapshot();
        },
        addLabel: async (name) => {
          if (delayed) {
            started.resolve();
            await release.promise;
          }
          if (!labels.has(name)) {
            events.push({ name, at: clock.now() });
          }
          labels.add(name);
          return snapshot();
        },
      });
    const older = request("final-candidate-full", true);
    await started.promise;
    await request(winner, false);
    release.resolve();
    await assert.rejects(older, (err) => err.message.includes("superseded"));
    assert.equal(markers.length, 2);
    assert.deepEqual([...labels], [winner]);
    assert.equal(events.at(-1).name, winner);
    assert.ok(events.at(-1).at >= markers.at(-1).at + 1000);
  }
});

test("re-arms the trigger if overlapping cleanups have removed both request labels", async () => {
  const standard = "final-candidate";
  const full = "final-candidate-full";
  const labels = new Set();
  let triggers = 0;
  const snapshot = () => [...labels].map((name) => ({ name }));
  const clock = requestClock();
  let pendingAt;
  await fixtureRequestMarkers()({
    ...clock,
    requestedLabel: full,
    markPending: () => {
      pendingAt = clock.now();
    },
    addLabel: (name) => {
      assert.ok(clock.now() >= pendingAt + 1000);
      if (++triggers === 1) {
        labels.add(standard);
      }
      labels.add(name);
      return snapshot();
    },
    removeLabel: (name) => {
      // The standard request removed full after our add and before our cleanup.
      labels.delete(full);
      labels.delete(name);
      return snapshot();
    },
    readLabels: snapshot,
  });
  assert.equal(triggers, 2);
  assert.deepEqual([...labels], [full]);
});

test("reconciles a failed label deletion without removing a replacement attachment", async () => {
  for (const failure of [
    "transient",
    "lost-response",
    "persistent",
    "replaced",
  ]) {
    const labels = new Set(["reviewed"]);
    if (failure === "replaced") {
      labels.add("final-candidate");
    }
    const snapshot = () => [...labels].map((name) => ({ name }));
    const error =
      failure === "transient" || failure === "persistent"
        ? Object.assign(new Error("spawnSync gh EAGAIN"), {
            code: "EAGAIN",
            syscall: "spawnSync gh",
          })
        : new Error("connection lost before receipt");
    let additions = 0;
    let removals = 0;
    const request = fixtureRequestMarkers()({
      ...requestClock(),
      requestedLabel: "final-candidate-full",
      readLabels: snapshot,
      markPending: () => undefined,
      addLabel: (name) => {
        additions++;
        labels.add("final-candidate");
        labels.add(name);
        return snapshot();
      },
      removeLabel: (name) => {
        removals++;
        if (failure === "lost-response" || failure === "replaced") {
          labels.delete(name);
          // Another request attached the same name after our deletion applied.
          if (failure === "replaced") {
            labels.add(name);
          }
        }
        if (removals === 1 || failure === "persistent") {
          throw error;
        }
        labels.delete(name);
        return snapshot();
      },
    });
    if (failure === "persistent") {
      await assert.rejects(request, error);
    } else if (failure === "replaced") {
      await assert.rejects(
        request,
        (failureError) => failureError.cause === error
      );
      assert.deepEqual([...labels].sort(), ["final-candidate", "reviewed"]);
    } else {
      await request;
      assert.deepEqual([...labels].sort(), [
        "final-candidate-full",
        "reviewed",
      ]);
    }
    assert.equal(additions, failure === "replaced" ? 0 : 1);
    assert.equal(
      removals,
      failure === "lost-response" || failure === "replaced" ? 1 : 2
    );
  }
});

test("output-only publication verifies local Git objects when the main remote is unavailable", () => {
  const fixture = createCandidateFixture();
  try {
    // A control-changing candidate is a valid verification result that withholds green.
    const output = path.join(fixture.root, "publisher-output");
    const tree = fixture.git(
      fixture.repositoryPath,
      "rev-parse",
      "HEAD^{tree}"
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(SCRIPT_DIR, "final-candidate-publisher.mjs"),
        "--output-only",
        "true",
        "--repository",
        "amplifthq/openmeld",
        "--pr",
        "1",
        "--branch",
        "codex/candidate",
        "--head",
        fixture.headSha,
        "--base",
        fixture.baseSha,
        "--tree",
        tree,
        "--candidate-root",
        fixture.repositoryPath,
        "--confidence",
        "standard",
        "--hosted-disposition",
        "protected-local-validation-required",
        "--job-result",
        "skipped",
        "--evidence",
        fixture.evidencePath,
        "--target-url",
        "https://github.com/amplifthq/openmeld/actions/runs/1",
      ],
      {
        cwd: fixture.repositoryPath,
        encoding: "utf8",
        env: {
          ...fixture.gitEnvironment,
          PATH: `${fixture.binPath}${path.delimiter}${process.env.PATH}`,
          OPENMELD_TRUSTED_GIT_LOCAL_REMOTE_URL: path.join(
            fixture.root,
            "missing-remote.git"
          ),
          GITHUB_OUTPUT: output,
          TEST_BASE_SHA: fixture.baseSha,
          TEST_HEAD_SHA: fixture.headSha,
          TEST_GITHUB_PULL_REQUEST_FIXTURE: GITHUB_PULL_REQUEST_FIXTURE,
          TEST_GH_LOG: fixture.ghLogPath,
          TEST_GH_OPERATION_COUNTS: fixture.ghOperationCountsPath,
        },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const published = readFileSync(output, "utf8");
    assert.ok(published.includes("state=failure"));
    assert.ok(published.includes("protected local validation required"));
    const request = runRequestFixture({
      ...fixture,
      remotePath: path.join(fixture.root, "missing-remote.git"),
    });
    assert.ifError(request.error);
    assert.equal(request.status, 1);
    assert.ok(
      request.stderr.includes(
        "Trusted Git could not refresh current main from the explicit local remote."
      )
    );
  } finally {
    fixture.cleanup();
  }
});

test("the local fallback publishes shared success for one exact candidate", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture);

    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "success");
    assert.equal(evidence.headSha, fixture.headSha);
    assert.equal(evidence.baseSha, fixture.baseSha);
    assert.equal(evidence.controlTrust, "current-main");
    assert.equal(evidence.planSourceSha, fixture.baseSha);
    assert.equal(evidence.bootstrapReason, null);
    assert.deepEqual(
      evidence.results.map((entry) => entry.status),
      ["passed", "passed"]
    );
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(ghLog, PENDING_STATUS_PATTERN);
    assert.match(ghLog, SUCCESS_STATUS_PATTERN);
    assert.match(ghLog, COMMENT_ENDPOINT_PATTERN);
    assert.match(result.stdout, CANDIDATE_EVIDENCE_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

test("local certification waits for the delayed separate publisher before writing status", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, { hostedRunActive: true });
    assert.equal(result.status, 0, result.stderr);
    const log = readFileSync(fixture.ghLogPath, "utf8");
    assert.ok(log.includes("/cancel"));
    assert.ok(log.includes("final-candidate-result.yml/runs"));
    assert.ok(
      log.indexOf("hosted-final-failure") < log.indexOf("state=pending")
    );
    assert.ok(log.indexOf("state=pending") < log.indexOf("state=success"));
    assert.equal(
      JSON.parse(readFileSync(fixture.evidencePath, "utf8")).conclusion,
      "success"
    );
  } finally {
    fixture.cleanup();
  }
});

test("a failed hosted handoff cannot execute checks or overwrite existing status", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      ghFailureOperations: ["hosted-read"],
    });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(fixture.pnpmLogPath, "utf8"), "");
    const log = readFileSync(fixture.ghLogPath, "utf8");
    assert.ok(!log.includes("/statuses/"));
    assert.equal(
      JSON.parse(readFileSync(fixture.evidencePath, "utf8")).conclusion,
      "failure"
    );
  } finally {
    fixture.cleanup();
  }
});

test("losing hosted state after checks prevents final publication", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      ghFailureOperationAttempts: ["hosted-read:2"],
    });
    assert.equal(result.status, 1);
    assert.notEqual(readFileSync(fixture.pnpmLogPath, "utf8"), "");
    const log = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(log, PENDING_STATUS_PATTERN);
    assert.doesNotMatch(log, SUCCESS_STATUS_PATTERN);
    assert.doesNotMatch(log, FAILURE_STATUS_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.publicationErrors[0].operation, "final-status");
  } finally {
    fixture.cleanup();
  }
});

test("successful commands keep the terminal compact and preserve complete redacted logs", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      pnpmStderr: `${`${LARGE_STDERR_LINE}\n`.repeat(8000)}token=super-secret-value\n`,
      pnpmStdout: `${LARGE_STDOUT_LINE}\n`.repeat(8000),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.stdout.length < 30_000,
      `stdout was ${result.stdout.length}`
    );
    assert.ok(
      result.stderr.length < 30_000,
      `stderr was ${result.stderr.length}`
    );
    assert.doesNotMatch(result.stdout, new RegExp(LARGE_STDOUT_LINE, "u"));
    assert.doesNotMatch(result.stderr, new RegExp(LARGE_STDERR_LINE, "u"));
    assert.match(result.stdout, FULL_COMMAND_LOGS_PATTERN);

    const commandLog = readFileSync(
      path.join(fixture.commandLogsPath, "documentation-contracts.log"),
      "utf8"
    );
    assert.match(commandLog, new RegExp(LARGE_STDOUT_LINE, "u"));
    assert.match(commandLog, new RegExp(LARGE_STDERR_LINE, "u"));
    assert.doesNotMatch(commandLog, SECRET_VALUE_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

test("a selected command failure publishes failure and blocks the candidate", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      pnpmExitCode: 9,
      pnpmStderr: "behavior failed with token=super-secret-value\n",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, DOCUMENTATION_CHECK_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.equal(evidence.results.at(-1).status, "failed");
    assert.equal(evidence.results.at(-1).exitCode, 9);
    assert.match(evidence.results.at(-1).stderrTail, BEHAVIOR_FAILURE_PATTERN);
    assert.doesNotMatch(
      evidence.results.at(-1).stderrTail,
      SECRET_VALUE_PATTERN
    );
    assert.match(
      readFileSync(fixture.candidateEnvironmentLogPath, "utf8"),
      TOKEN_ABSENCE_PATTERN
    );
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(ghLog, PENDING_STATUS_PATTERN);
    assert.match(ghLog, FAILURE_STATUS_PATTERN);
    assert.doesNotMatch(ghLog, SUCCESS_STATUS_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

test("publication failures preserve the original check failure and remain blocking", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      ghPublicationFailure: true,
      pnpmExitCode: 7,
      pnpmStderr: "original selected-check failure\n",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, CANDIDATE_VALIDATION_FAILURE_PATTERN);
    assert.match(result.stderr, EVIDENCE_PUBLICATION_FAILURE_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.match(evidence.error, EXIT_CODE_SEVEN_PATTERN);
    assert.match(
      evidence.results.at(-1).stderrTail,
      ORIGINAL_SELECTED_CHECK_PATTERN
    );
    assert.deepEqual(
      evidence.publicationErrors.map((entry) => entry.operation),
      [
        "pending-status",
        "pull-request-comment",
        "final-status",
        "pull-request-comment",
      ]
    );
  } finally {
    fixture.cleanup();
  }
});

test("local success status is the last fallible publication", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture);

    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "success");
    assert.deepEqual(evidence.publicationErrors, []);
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.match(ghLog, COMMENT_ENDPOINT_PATTERN);
    assert.ok(
      ghLog.indexOf("issues/1/comments") < ghLog.indexOf("state=success")
    );
  } finally {
    fixture.cleanup();
  }
});

test("a failed evidence comment and failed compensation cannot leave green", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      ghFailureOperations: ["pull-request-comment"],
      ghFailureOperationAttempts: ["final-status:2"],
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, EVIDENCE_PUBLICATION_FAILURE_PATTERN);
    const ghLog = readFileSync(fixture.ghLogPath, "utf8");
    assert.doesNotMatch(ghLog, SUCCESS_STATUS_PATTERN);
    assert.match(ghLog, FAILURE_STATUS_PATTERN);
  } finally {
    fixture.cleanup();
  }
});

test("current main drift rejects stale green before checks run", () => {
  const fixture = createCandidateFixture();
  try {
    advanceRemoteMain(fixture);
    const result = runCandidateFixture(fixture);

    assert.equal(result.status, 1);
    assert.match(result.stderr, MAIN_ADVANCED_PATTERN);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "failure");
    assert.deepEqual(evidence.results, []);
    assert.equal(readFileSync(fixture.pnpmLogPath, "utf8"), "");
  } finally {
    fixture.cleanup();
  }
});

test("main drift during a pull-request check preserves exact reusable evidence for merge queue", () => {
  const fixture = createCandidateFixture();
  try {
    const result = runCandidateFixture(fixture, {
      advanceMainDuringCheck: true,
    });

    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(fixture.evidencePath, "utf8"));
    assert.equal(evidence.conclusion, "success");
    assert.equal(evidence.baseSha, fixture.baseSha);
    assert.equal(evidence.candidateKind, "pull-request");
    assert.deepEqual(
      evidence.results.map((entry) => entry.status),
      ["passed", "passed"]
    );
    assert.notEqual(
      fixture.git(fixture.repositoryPath, "rev-parse", "origin/main"),
      fixture.baseSha
    );
  } finally {
    fixture.cleanup();
  }
});

function createCandidateFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-final-candidate-"));
  const remotePath = path.join(root, "remote.git");
  const repositoryPath = path.join(root, "repository");
  const binPath = path.join(root, "bin");
  const ghLogPath = path.join(root, "gh.log");
  const ghOperationCountsPath = path.join(root, "gh-operation-counts.json");
  const pnpmLogPath = path.join(root, "pnpm.log");
  const pnpmStderrPath = path.join(root, "pnpm-stderr.txt");
  const pnpmStdoutPath = path.join(root, "pnpm-stdout.txt");
  const candidateEnvironmentLogPath = path.join(root, "candidate-env.log");
  const evidencePath = path.join(root, "evidence.json");
  const commandLogsPath = `${evidencePath}.logs`;
  mkdirSync(repositoryPath);
  mkdirSync(binPath);
  writeFileSync(ghLogPath, "");
  writeFileSync(ghOperationCountsPath, "{}");
  writeFileSync(pnpmLogPath, "");
  writeFileSync(pnpmStderrPath, "");
  writeFileSync(pnpmStdoutPath, "");
  writeFileSync(candidateEnvironmentLogPath, "");
  const gitEnvironment = isolatedGitEnvironment(process.env);
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: gitEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  git(root, "init", "--bare", "--quiet", "--initial-branch=main", remotePath);
  git(repositoryPath, "init", "--initial-branch=main", "--quiet");
  git(repositoryPath, "config", "user.email", "candidate@test.openmeld.ai");
  git(repositoryPath, "config", "user.name", "OpenMeld Candidate Test");
  writeFileSync(path.join(repositoryPath, "AGENTS.md"), "# Baseline\n");
  git(repositoryPath, "add", "AGENTS.md");
  git(repositoryPath, "commit", "--quiet", "-m", "seed main");
  git(repositoryPath, "remote", "add", "origin", remotePath);
  git(repositoryPath, "push", "--quiet", "-u", "origin", "main");
  const baseSha = git(repositoryPath, "rev-parse", "HEAD");
  git(repositoryPath, "checkout", "--quiet", "-b", "codex/candidate");
  writeFileSync(
    path.join(repositoryPath, "AGENTS.md"),
    "# Candidate\n\nExact behavior.\n"
  );
  git(repositoryPath, "add", "AGENTS.md");
  git(repositoryPath, "commit", "--quiet", "-m", "update agent guidance");
  const headSha = git(repositoryPath, "rev-parse", "HEAD");

  writeExecutable(
    path.join(binPath, "gh"),
    `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_GH_LOG, args.join(" ") + "\\n");
const endpoint = args.find((arg) => arg.startsWith("repos/")) ?? "";
const operation = endpoint.includes("/actions/workflows/")
  ? "hosted-read"
  : endpoint.endsWith("/pulls/1")
  ? "pull-request-read"
  : endpoint.endsWith("/comments")
  ? "pull-request-comment"
  : endpoint.includes("/statuses/") && args.includes("state=pending")
    ? "pending-status"
    : endpoint.includes("/statuses/")
      ? "final-status"
      : "read";
const input = args.includes("--input") ? readFileSync(0, "utf8") : "";
const labelsFile = process.env.TEST_GH_LOG + ".labels";
const issueLabels = () => existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, "utf8")) : [];
if (input) {
  appendFileSync(process.env.TEST_GH_LOG, input + "\\n");
}
const failedOperations = new Set((process.env.TEST_GH_FAILURE_OPERATIONS ?? "").split(",").filter(Boolean));
const operationCounts = JSON.parse(readFileSync(process.env.TEST_GH_OPERATION_COUNTS, "utf8"));
operationCounts[operation] = (operationCounts[operation] ?? 0) + 1;
writeFileSync(process.env.TEST_GH_OPERATION_COUNTS, JSON.stringify(operationCounts));
const failedOperationAttempts = new Set((process.env.TEST_GH_FAILURE_OPERATION_ATTEMPTS ?? "").split(",").filter(Boolean));
if ((process.env.TEST_GH_PUBLICATION_FAILURE === "1" && (endpoint.includes("/statuses/") || endpoint.endsWith("/comments"))) || failedOperations.has(operation) || failedOperationAttempts.has(operation + ":" + operationCounts[operation])) {
  process.stderr.write("simulated GitHub publication failure\\n");
  process.exit(17);
}
if (endpoint.includes("/actions/workflows/")) {
  const captured = JSON.parse(readFileSync(process.env.TEST_GITHUB_RUNS_FIXTURE, "utf8")).response;
  const run = captured.workflow_runs[0];
  run.head_sha = process.env.TEST_HEAD_SHA;
  run.head_branch = "codex/candidate";
  run.pull_requests = [{ number: 1 }];
  if (endpoint.includes("final-candidate-result.yml")) {
    const count = (operationCounts["result-read"] ?? 0) + 1;
    operationCounts["result-read"] = count;
    writeFileSync(process.env.TEST_GH_OPERATION_COUNTS, JSON.stringify(operationCounts));
    run.display_title = "Final Candidate Result " + run.id + ":" + run.run_attempt + " completed";
    run.status = count < 3 ? "in_progress" : "completed";
    if (count >= 3) appendFileSync(process.env.TEST_GH_LOG, "hosted-final-failure\\n");
    process.stdout.write(JSON.stringify(count === 1 ? [{ total_count: 0, workflow_runs: [] }] : [captured]));
    process.exit(0);
  }
  const cancelling = process.env.TEST_HOSTED_RUN_ACTIVE === "1" && operationCounts["hosted-read"] === 1;
  run.status = cancelling ? "in_progress" : "completed";
  if (process.env.TEST_HOSTED_RUN_ACTIVE === "1") {
    run.display_title = "Final Candidate PR #1 @ " + run.head_sha + " [standard]";
    run.created_at = "2026-10-15T00:00:00Z";
  }
  process.stdout.write(JSON.stringify([captured]));
} else if (endpoint.includes("/commits/") && endpoint.includes("/statuses?")) {
  const statusFile = process.env.TEST_GH_LOG + ".status";
  process.stdout.write(existsSync(statusFile) ? "[" + readFileSync(statusFile, "utf8") + "]" : "[]");
} else if (endpoint.includes("/statuses/")) {
  const field = (name) => args.find(arg=>arg.startsWith(name+"="))?.slice(name.length+1);
  const status = JSON.stringify({id: operationCounts[operation], state: field("state"), context: field("context"), description: field("description"), target_url: field("target_url")});
  writeFileSync(process.env.TEST_GH_LOG + ".status", status);
  process.stdout.write(status);
} else if (endpoint.endsWith("/pulls/1")) {
  const captured = JSON.parse(readFileSync(process.env.TEST_GITHUB_PULL_REQUEST_FIXTURE, "utf8")).response;
  captured.base.sha = process.env.TEST_BASE_SHA;
  captured.head.ref = "codex/candidate";
  captured.head.sha = process.env.TEST_REQUEST_HEAD_DRIFT_AT && operationCounts[operation] >= Number(process.env.TEST_REQUEST_HEAD_DRIFT_AT)
    ? "1".repeat(40) : process.env.TEST_HEAD_SHA;
  if (operationCounts[operation] >= 2) {
    if (process.env.TEST_REQUEST_INELIGIBLE === "draft") captured.draft = true;
    if (process.env.TEST_REQUEST_INELIGIBLE === "closed") captured.state = "closed";
    if (process.env.TEST_REQUEST_INELIGIBLE === "retargeted") captured.base.ref = "other";
  }
  captured.html_url = "https://github.com/amplifthq/openmeld/pull/1";
  captured.number = 1;
  captured.labels = issueLabels();
  process.stdout.write(JSON.stringify(captured));
} else if (endpoint.endsWith("/issues/1/labels") || endpoint.includes("/issues/1/labels/")) {
  const names = new Set(issueLabels().map(label => label.name));
  if (args.includes("POST")) {
    for (const name of JSON.parse(input).labels) names.add(name);
  } else if (args.includes("DELETE")) {
    names.delete(endpoint.split("/").at(-1));
  }
  const response = JSON.stringify([...names].map(name=>({name})));
  writeFileSync(labelsFile, response);
  process.stdout.write(response);
} else if (endpoint.endsWith("/comments")) {
  process.stdout.write(JSON.stringify({ html_url: "https://github.com/amplifthq/openmeld/pull/1#issuecomment-1" }));
} else {
  process.stdout.write("{}");
}
`
  );
  writeExecutable(
    path.join(binPath, "pnpm"),
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
appendFileSync(process.env.TEST_PNPM_LOG, process.argv.slice(2).join(" ") + "\\n");
appendFileSync(process.env.TEST_CANDIDATE_ENV_LOG, "GH_TOKEN=" + (process.env.GH_TOKEN ? "present" : "absent") + " GITHUB_TOKEN=" + (process.env.GITHUB_TOKEN ? "present" : "absent") + " BASE=" + process.env.OPENMELD_AFFECTED_BASE + "\\n");
if (process.env.TEST_ADVANCE_MAIN_DURING_CHECK === "1" && !existsSync(process.env.TEST_MAIN_DRIFT_MARKER)) {
  const maintainer = process.env.TEST_MAINTAINER_PATH;
  execFileSync("git", ["clone", "--quiet", process.env.TEST_REMOTE_PATH, maintainer]);
  execFileSync("git", ["config", "user.email", "main-drift@test.openmeld.ai"], { cwd: maintainer });
  execFileSync("git", ["config", "user.name", "OpenMeld Main Drift Test"], { cwd: maintainer });
  writeFileSync(path.join(maintainer, "during-check.md"), "main changed during candidate\\n");
  execFileSync("git", ["add", "during-check.md"], { cwd: maintainer });
  execFileSync("git", ["commit", "--quiet", "-m", "advance main during check"], { cwd: maintainer });
  execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: maintainer });
  writeFileSync(process.env.TEST_MAIN_DRIFT_MARKER, "advanced\\n");
}
process.stderr.write(readFileSync(process.env.TEST_PNPM_STDERR_PATH, "utf8"));
process.stdout.write(readFileSync(process.env.TEST_PNPM_STDOUT_PATH, "utf8"));
if (process.env.TEST_ATTACK_TRUSTED_PATH && process.env.TEST_ATTACK_EVIDENCE_PATH) {
  let deniedWrites = 0;
  for (const target of [process.env.TEST_ATTACK_TRUSTED_PATH, process.env.TEST_ATTACK_EVIDENCE_PATH]) {
    try {
      writeFileSync(target, "forged green evidence\\n");
    } catch (error) {
      deniedWrites += 1;
      process.stderr.write("sandbox denied " + target + ": " + error.message + "\\n");
    }
  }
  process.exit(deniedWrites === 2 ? 23 : 0);
}
process.exit(Number(process.env.TEST_PNPM_EXIT_CODE ?? "0"));
`
  );

  return {
    baseSha,
    binPath,
    candidateEnvironmentLogPath,
    commandLogsPath,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    evidencePath,
    ghLogPath,
    ghOperationCountsPath,
    git,
    gitEnvironment,
    headSha,
    pnpmLogPath,
    pnpmStderrPath,
    pnpmStdoutPath,
    remotePath,
    repositoryPath,
    root,
  };
}

function runCandidateFixture(fixture, options = {}) {
  writeFileSync(fixture.pnpmStderrPath, options.pnpmStderr ?? "");
  writeFileSync(fixture.pnpmStdoutPath, options.pnpmStdout ?? "");
  return spawnSync(
    process.execPath,
    [
      options.finalCandidateScript ?? FINAL_CANDIDATE_SCRIPT,
      "run",
      "--",
      "--mode",
      "local",
      "--publish-status",
      "--repository",
      "amplifthq/openmeld",
      "--pr",
      "1",
      "--head",
      fixture.headSha,
      "--base",
      fixture.baseSha,
      "--evidence",
      fixture.evidencePath,
      ...(options.commandWrapper
        ? ["--command-wrapper", options.commandWrapper]
        : []),
    ],
    {
      cwd: fixture.repositoryPath,
      encoding: "utf8",
      env: {
        ...isolatedGitEnvironment(process.env),
        OPENMELD_AFFECTED_BASE: options.affectedBase ?? "",
        GH_TOKEN: "write-capable-token-must-not-reach-checks",
        GITHUB_TOKEN: "write-capable-token-must-not-reach-checks",
        PATH: `${fixture.binPath}${path.delimiter}${process.env.PATH}`,
        OPENMELD_CANDIDATE_SANDBOX_PROFILE: options.sandboxProfile ?? "",
        OPENMELD_TRUSTED_GIT_LOCAL_REMOTE_URL: fixture.remotePath,
        TEST_ATTACK_EVIDENCE_PATH: options.attackEvidencePath ?? "",
        TEST_ATTACK_TRUSTED_PATH: options.attackTrustedPath ?? "",
        TEST_ADVANCE_MAIN_DURING_CHECK: options.advanceMainDuringCheck
          ? "1"
          : "0",
        TEST_BASE_SHA: fixture.baseSha,
        TEST_CANDIDATE_ENV_LOG: fixture.candidateEnvironmentLogPath,
        TEST_GH_PUBLICATION_FAILURE: options.ghPublicationFailure ? "1" : "0",
        TEST_GH_FAILURE_OPERATIONS: (options.ghFailureOperations ?? []).join(
          ","
        ),
        TEST_GH_FAILURE_OPERATION_ATTEMPTS: (
          options.ghFailureOperationAttempts ?? []
        ).join(","),
        TEST_GH_LOG: fixture.ghLogPath,
        TEST_GH_OPERATION_COUNTS: fixture.ghOperationCountsPath,
        TEST_GITHUB_PULL_REQUEST_FIXTURE: GITHUB_PULL_REQUEST_FIXTURE,
        TEST_GITHUB_RUNS_FIXTURE: GITHUB_RUNS_FIXTURE,
        TEST_HOSTED_RUN_ACTIVE: options.hostedRunActive ? "1" : "0",
        TEST_HEAD_SHA: fixture.headSha,
        TEST_MAIN_DRIFT_MARKER: path.join(fixture.root, "main-drift.marker"),
        TEST_MAINTAINER_PATH: path.join(
          fixture.root,
          "during-check-maintainer"
        ),
        TEST_PNPM_EXIT_CODE: String(options.pnpmExitCode ?? 0),
        TEST_PNPM_LOG: fixture.pnpmLogPath,
        TEST_PNPM_STDERR_PATH: fixture.pnpmStderrPath,
        TEST_PNPM_STDOUT_PATH: fixture.pnpmStdoutPath,
        TEST_REMOTE_PATH: fixture.remotePath,
      },
    }
  );
}

function runRequestFixture(fixture, options = {}) {
  return spawnSync(
    process.execPath,
    [
      FINAL_CANDIDATE_SCRIPT,
      "request",
      "--",
      "--repository",
      "amplifthq/openmeld",
      "--pr",
      "1",
      "--head",
      fixture.headSha,
      "--base",
      fixture.baseSha,
    ],
    {
      cwd: fixture.repositoryPath,
      encoding: "utf8",
      env: {
        ...isolatedGitEnvironment(process.env),
        PATH: `${fixture.binPath}${path.delimiter}${process.env.PATH}`,
        OPENMELD_TRUSTED_GIT_LOCAL_REMOTE_URL: fixture.remotePath,
        TEST_BASE_SHA: fixture.baseSha,
        TEST_GH_FAILURE_OPERATION_ATTEMPTS: (options.failedPullReads ?? [])
          .map((attempt) => `pull-request-read:${attempt}`)
          .join(","),
        TEST_REQUEST_INELIGIBLE: options.ineligible ?? "",
        TEST_REQUEST_HEAD_DRIFT_AT: options.driftAt
          ? String(options.driftAt)
          : "",
        TEST_GH_FAILURE_OPERATIONS: "",
        TEST_GH_LOG: fixture.ghLogPath,
        TEST_GH_OPERATION_COUNTS: fixture.ghOperationCountsPath,
        TEST_GH_PUBLICATION_FAILURE: "0",
        TEST_GITHUB_PULL_REQUEST_FIXTURE: GITHUB_PULL_REQUEST_FIXTURE,
        TEST_HEAD_SHA: fixture.headSha,
      },
    }
  );
}

function advanceRemoteMain(fixture) {
  const maintainerPath = path.join(fixture.root, "maintainer");
  fixture.git(
    fixture.root,
    "clone",
    "--quiet",
    fixture.remotePath,
    maintainerPath
  );
  fixture.git(maintainerPath, "config", "user.email", "main@test.openmeld.ai");
  fixture.git(maintainerPath, "config", "user.name", "OpenMeld Main Test");
  writeFileSync(path.join(maintainerPath, "main.md"), "new main\n");
  fixture.git(maintainerPath, "add", "main.md");
  fixture.git(maintainerPath, "commit", "--quiet", "-m", "advance main");
  fixture.git(maintainerPath, "push", "--quiet", "origin", "main");
}

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function isolatedGitEnvironment(environment) {
  const isolated = { ...environment };
  for (const name of REPOSITORY_LOCAL_GIT_ENV_VARS) {
    delete isolated[name];
  }
  return isolated;
}
