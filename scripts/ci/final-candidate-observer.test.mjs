import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildFinalCandidateObservation,
  observationExitCode,
  readLatestCandidateRun,
  renderFinalCandidateObservation,
  runFinalCandidateObserver,
} from "./final-candidate-observer.mjs";
import { ResultListingChangedError } from "./final-candidate-run-context.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const BUDGET_FIXTURE = JSON.parse(
  readFileSync(
    path.join(
      SCRIPT_DIRECTORY,
      "fixtures",
      "github-actions-budget-final-candidate.json"
    ),
    "utf8"
  )
);

const PULL_REQUEST = {
  base: { sha: "dbddbfd609613848e6534a4091affa2781ed7550" },
  head: { sha: BUDGET_FIXTURE.run.head_sha },
  html_url: "https://github.com/amplifthq/openmeld/pull/429",
  number: 429,
};
const HOSTED_BUDGET_PATTERN = /Hosted lane: unavailable \(Actions budget\)/u;
const CHECKS_NOT_STARTED_PATTERN = /Candidate checks started: no/u;
const LOCAL_FALLBACK_PATTERN = /trusted local fallback/u;
const CANDIDATE_FAILURE_PATTERN = /candidate validation failed/iu;
const EXACT_SUCCESS_PATTERN = /Exact status: success/u;
const AVAILABLE_FALLBACK_PATTERN = /Available fallback/u;

test("selects this PR's run even when a newer PR shares its head and GitHub omits links", async () => {
  const { head } = PULL_REQUEST;
  const title = (number) =>
    `Final Candidate PR #${number} @ ${head.sha} [standard] on ${PULL_REQUEST.base.sha}`;
  const own = {
    ...BUDGET_FIXTURE.run,
    display_title: title(PULL_REQUEST.number),
    pull_requests: [],
  };
  const foreign = {
    ...own,
    id: own.id + 1,
    display_title: title(100),
    pull_requests: [{ number: 100 }],
  };
  const find = (runs) =>
    readLatestCandidateRun("owner/repo", head.sha, PULL_REQUEST.number, () => ({
      total_count: runs.length,
      workflow_runs: runs,
    }));
  assert.equal(find([foreign, own]), own);
  const code = await runFinalCandidateObserver({
    argv: [
      "status",
      "--pr",
      String(PULL_REQUEST.number),
      "--repo",
      "owner/repo",
    ],
    write: () => undefined,
    adapters: {
      readPullRequest: () => PULL_REQUEST,
      readLatestRun: (repo, sha, number) => {
        assert.equal(number, PULL_REQUEST.number);
        return readLatestCandidateRun(repo, sha, number, () => ({
          total_count: 1,
          workflow_runs: [foreign],
        }));
      },
      readJobs: () => assert.fail("must not inspect the other PR's jobs"),
      readCommitStatuses: () => [
        {
          context: "OpenMeld Final Candidate",
          state: "success",
          description: `Passed standard @ ${head.sha.slice(0, 12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
        },
      ],
    },
  });
  assert.equal(code, 0);
  assert.equal(find([{ ...foreign, pull_requests: [] }]), null);
  assert.equal(find([{ ...foreign, display_title: own.display_title }]), null);
  assert.equal(
    find([{ ...own, display_title: `${own.display_title} invalid` }]),
    null
  );
  assert.equal(
    find([{ ...own, display_title: `Ignored ${own.display_title}` }]),
    null
  );
  assert.equal(
    find([
      { ...own, display_title: "OpenMeld Final Candidate", pull_requests: [] },
    ]),
    null
  );
  assert.equal(
    find([
      {
        ...own,
        display_title: "OpenMeld Final Candidate",
        pull_requests: [{ number: 100 }, { number: PULL_REQUEST.number }],
      },
    ]),
    null
  );
  const pages = [new Array(100).fill(foreign), [own]];
  assert.equal(
    readLatestCandidateRun(
      "owner/repo",
      head.sha,
      PULL_REQUEST.number,
      ([, endpoint]) => {
        const page = Number(
          new URL(endpoint, "https://api.github.com/").searchParams.get("page")
        );
        return { total_count: 101, workflow_runs: pages[page - 1] };
      }
    ),
    own
  );
});

test("classifies a captured GitHub Actions budget refusal without blaming candidate code", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(
      Object.entries(BUDGET_FIXTURE.annotationsByCheckRunId).map(
        ([id, annotations]) => [Number(id), annotations]
      )
    ),
    commitStatuses: [],
    jobs: BUDGET_FIXTURE.jobs,
    pullRequest: PULL_REQUEST,
    run: BUDGET_FIXTURE.run,
  });

  assert.equal(observation.state, "hosted-unavailable");
  assert.equal(observation.reason, "actions-budget");
  assert.equal(observation.candidateChecksStarted, false);
  assert.equal(observationExitCode(observation), 3);
  const output = renderFinalCandidateObservation(observation);
  assert.match(output, HOSTED_BUDGET_PATTERN);
  assert.match(output, CHECKS_NOT_STARTED_PATTERN);
  assert.match(output, LOCAL_FALLBACK_PATTERN);
  assert.doesNotMatch(output, CANDIDATE_FAILURE_PATTERN);
});

test("requires the exact shared status before reporting hosted success", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed executable @ ${PULL_REQUEST.head.sha.slice(0, 12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
        state: "success",
        target_url: "https://github.com/amplifthq/openmeld/actions/runs/42",
      },
    ],
    jobs: [
      {
        conclusion: "success",
        id: 1,
        name: "Final Candidate Runner",
        status: "completed",
        steps: [{ conclusion: "success", name: "Validate" }],
      },
    ],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: "success",
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/42",
      id: 42,
      status: "completed",
    },
  });

  assert.equal(observation.state, "success");
  assert.equal(observation.reason, "exact-status-success");
  assert.equal(observationExitCode(observation), 0);
});

test("waits for a newer run on the same head instead of returning the earlier success", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed standard @ ${PULL_REQUEST.head.sha.slice(0, 12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
        state: "success",
      },
    ],
    jobs: [],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: null,
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/45",
      id: 45,
      status: "in_progress",
    },
  });

  assert.equal(observation.state, "waiting");
  assert.equal(observation.reason, "run-in-progress");
  assert.equal(observationExitCode(observation), null);
});

test("keeps an existing exact success truthful when a later hosted retry hits budget", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(
      Object.entries(BUDGET_FIXTURE.annotationsByCheckRunId).map(
        ([id, annotations]) => [Number(id), annotations]
      )
    ),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed executable @ ${PULL_REQUEST.head.sha.slice(0, 12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
        state: "success",
        target_url: "https://github.com/amplifthq/openmeld/pull/429",
      },
    ],
    jobs: BUDGET_FIXTURE.jobs,
    pullRequest: PULL_REQUEST,
    run: BUDGET_FIXTURE.run,
  });

  assert.equal(observation.state, "success");
  assert.equal(observation.hostedAvailability, "unavailable");
  assert.equal(observationExitCode(observation), 0);
  const output = renderFinalCandidateObservation(observation);
  assert.match(output, HOSTED_BUDGET_PATTERN);
  assert.match(output, EXACT_SUCCESS_PATTERN);
  assert.doesNotMatch(output, AVAILABLE_FALLBACK_PATTERN);
});

test("keeps a green status that was validated on an older base", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed executable @ ${PULL_REQUEST.head.sha.slice(0, 12)} on 111111111111`,
        state: "success",
      },
    ],
    jobs: [],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: "success",
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/44",
      id: 44,
      status: "completed",
    },
  });

  assert.equal(observation.state, "success");
  assert.equal(observation.exactStatus, "success");
  assert.equal(observation.reason, "exact-status-success");
});

test("rejects a green status that names a different head", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [
      {
        context: "OpenMeld Final Candidate",
        description: `Passed executable @ ${"c".repeat(12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
        state: "success",
      },
    ],
    jobs: [],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: "success",
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/44",
      id: 44,
      status: "completed",
    },
  });

  assert.equal(observation.state, "failure");
  assert.equal(observation.exactStatus, "stale-success");
  assert.equal(observation.reason, "exact-status-stale");
});

test("keeps a completed run without exact status visibly failed", () => {
  const observation = buildFinalCandidateObservation({
    annotationsByCheckRunId: new Map(),
    commitStatuses: [],
    jobs: [],
    pullRequest: PULL_REQUEST,
    run: {
      conclusion: "success",
      head_sha: PULL_REQUEST.head.sha,
      html_url: "https://github.com/amplifthq/openmeld/actions/runs/43",
      id: 43,
      status: "completed",
    },
  });

  assert.equal(observation.state, "failure");
  assert.equal(observation.reason, "exact-status-missing");
  assert.equal(observationExitCode(observation), 1);
});

test("waits through a successful source run until its pending status is published", async () => {
  let reads = 0;
  const output = [];
  const exitCode = await runFinalCandidateObserver({
    argv: ["wait", "--pr", String(PULL_REQUEST.number), "--repo", "owner/repo"],
    write: (message) => output.push(message),
    adapters: {
      readPullRequest: () => PULL_REQUEST,
      readLatestRun: () => ({
        ...BUDGET_FIXTURE.run,
        status: "completed",
        conclusion: "success",
      }),
      readJobs: () => [],
      readCommitStatuses: () => {
        const pending = ++reads === 1;
        const head = PULL_REQUEST.head.sha.slice(0, 12);
        return [
          {
            context: "OpenMeld Final Candidate",
            state: pending ? "pending" : "success",
            description: pending
              ? `Requested standard Final Candidate @ ${head}; waiting for its result`
              : `Passed standard @ ${head} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
          },
        ];
      },
      sleep: () => undefined,
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(reads, 2);
  assert.ok(output[0].includes("Hosted lane: waiting"));
});

test("reuses failed job annotations within one run attempt and reads a rerun afresh", async () => {
  let polls = 0;
  let reads = 0;
  const exitCode = await runFinalCandidateObserver({
    argv: [
      "wait",
      "--pr",
      String(PULL_REQUEST.number),
      "--repo",
      "owner/repo",
      "--timeout-seconds",
      "5",
    ],
    write: () => undefined,
    adapters: {
      now: () => polls * 1000,
      readPullRequest: () => PULL_REQUEST,
      readLatestRun: () => ({
        ...BUDGET_FIXTURE.run,
        status: "in_progress",
        run_attempt: ++polls < 4 ? 1 : 2,
      }),
      readJobs: (_repository, id, attempt) => {
        assert.equal(id, BUDGET_FIXTURE.run.id);
        assert.equal(attempt, polls < 4 ? 1 : 2);
        return [BUDGET_FIXTURE.jobs[0]];
      },
      readAnnotations: () => {
        reads++;
        return polls < 4
          ? []
          : BUDGET_FIXTURE.annotationsByCheckRunId[BUDGET_FIXTURE.jobs[0].id];
      },
      readCommitStatuses: () => [],
      sleep: () => undefined,
    },
  });
  assert.equal(exitCode, 3);
  assert.equal(polls, 4);
  assert.equal(reads, 2);
});

test("settles publication against the same PR head, source and attempt", async () => {
  const run = {
    ...BUDGET_FIXTURE.run,
    conclusion: "success",
    status: "completed",
    run_attempt: 1,
    created_at: "2026-11-18T10:00:01Z",
    display_title: `Final Candidate PR #${PULL_REQUEST.number} @ ${PULL_REQUEST.head.sha} [standard] on ${PULL_REQUEST.base.sha}`,
  };
  const pending = {
    context: "OpenMeld Final Candidate",
    state: "pending",
    description: `Requested standard Final Candidate @ ${PULL_REQUEST.head.sha.slice(0, 12)}; waiting for its result`,
    target_url: PULL_REQUEST.html_url,
    created_at: "2026-11-18T10:00:00Z",
  };
  const success = {
    ...pending,
    state: "success",
    description: `Passed standard @ ${PULL_REQUEST.head.sha.slice(0, 12)} on ${PULL_REQUEST.base.sha.slice(0, 12)}`,
  };
  const observe = async ({
    first,
    second = first,
    finished = true,
    latest = run,
    live = PULL_REQUEST,
  }) => {
    const output = [];
    let statusReads = 0;
    let prReads = 0;
    let runReads = 0;
    const code = await runFinalCandidateObserver({
      argv: [
        "status",
        "--pr",
        String(PULL_REQUEST.number),
        "--repo",
        "owner/repo",
      ],
      write: (message) => output.push(message),
      adapters: {
        readPullRequest: () => (++prReads === 1 ? PULL_REQUEST : live),
        readLatestRun: () => (++runReads === 1 ? run : latest),
        readJobs: () => [],
        readCommitStatuses: () => (++statusReads === 1 ? first : second),
        resultPublicationFinished: () => {
          if (finished instanceof Error) {
            throw finished;
          }
          return finished;
        },
      },
    });
    return { code, statusReads, output: output.join("") };
  };
  assert.equal((await observe({ first: [], finished: false })).code, 2);
  assert.equal((await observe({ first: [] })).code, 1);
  const published = await observe({ first: [], second: [success] });
  assert.equal(published.code, 0);
  assert.equal(published.statusReads, 2);
  assert.equal((await observe({ first: [pending] })).code, 1);
  for (const status of [
    { ...pending, created_at: run.created_at },
    { ...pending, created_at: "2026-11-18T10:05:00Z" },
    {
      ...pending,
      target_url: "https://github.com/amplifthq/openmeld/pull/123",
    },
    { ...pending, description: "Local validation in progress" },
  ]) {
    assert.equal((await observe({ first: [status] })).code, 2);
  }
  assert.equal(
    (
      await observe({
        first: [],
        second: [{ ...pending, created_at: run.created_at }],
      })
    ).code,
    2
  );
  assert.equal(
    (
      await observe({
        first: [],
        latest: { ...run, run_attempt: 2, status: "in_progress" },
      })
    ).code,
    2
  );
  assert.equal(
    (await observe({ first: [], latest: { ...run, id: run.id + 1 } })).code,
    2
  );
  assert.equal(
    (
      await observe({
        first: [],
        second: [success],
        live: { ...PULL_REQUEST, head: { sha: "a".repeat(40) } },
      })
    ).code,
    2
  );
  assert.equal(
    (await observe({ first: [], finished: new ResultListingChangedError() }))
      .code,
    2
  );
  const invalid = new Error("GitHub returned invalid result state");
  await assert.rejects(observe({ first: [], finished: invalid }), invalid);
});

test("binds terminal statuses to the newest explicit request, including overwritten pending statuses", () => {
  const pr = PULL_REQUEST;
  const head = pr.head.sha.slice(0, 12);
  const base = pr.base.sha.slice(0, 12);
  const requested = {
    context: "OpenMeld Final Candidate",
    id: 501,
    state: "pending",
    description: `Requested full Final Candidate @ ${head}; waiting for its result`,
    created_at: "2026-11-18T11:00:01Z",
    target_url: pr.html_url,
  };
  const run = (id, confidence, created_at) => ({
    id,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    created_at,
    display_title: `Final Candidate PR #${pr.number} @ ${pr.head.sha} [${confidence}] on ${pr.base.sha}`,
  });
  const old = run(42, "standard", "2026-11-18T11:00:00Z");
  const full = run(43, "full", "2026-11-18T11:00:02Z");
  const auto = run(44, "standard", "2026-11-18T12:00:00Z");
  const terminal = (source, confidence) => ({
    ...requested,
    state: "success",
    created_at: source.created_at,
    target_url: `https://github.com/amplifthq/openmeld/actions/runs/${source.id}/attempts/1`,
    description: `Passed ${confidence} @ ${head} on ${base}`,
  });
  const stale = terminal(old, "standard");
  const owned = terminal(full, "full");
  const receipt = {
    ...owned,
    description: `${owned.description}; request 501`,
  };
  const observe = (source, statuses, lookup) =>
    buildFinalCandidateObservation({
      pullRequest: pr,
      run: source,
      jobs: [],
      annotationsByCheckRunId: new Map(),
      commitStatuses: [...statuses, requested],
      readStatusSource: lookup,
    });
  assert.equal(observe(null, [stale]).state, "waiting");
  assert.equal(observe(old, [stale]).state, "waiting");
  const previousFailure = {
    pullRequest: pr,
    run: { ...old, conclusion: "failure" },
    jobs: BUDGET_FIXTURE.jobs,
    annotationsByCheckRunId: new Map(
      Object.entries(BUDGET_FIXTURE.annotationsByCheckRunId).map(
        ([id, annotations]) => [Number(id), annotations]
      )
    ),
  };
  const beforeTrigger = buildFinalCandidateObservation({
    ...previousFailure,
    commitStatuses: [requested],
  });
  assert.equal(beforeTrigger.state, "waiting");
  assert.equal(beforeTrigger.runId, null);
  assert.doesNotMatch(
    renderFinalCandidateObservation(beforeTrigger),
    HOSTED_BUDGET_PATTERN
  );
  assert.equal(
    buildFinalCandidateObservation({ ...previousFailure, commitStatuses: [] })
      .state,
    "hosted-unavailable"
  );
  assert.equal(
    buildFinalCandidateObservation({
      ...previousFailure,
      jobs: [],
      commitStatuses: [],
    }).state,
    "failure"
  );
  assert.equal(observe(full, [stale]).state, "waiting");
  assert.equal(observe(full, [receipt]).state, "success");
  const earlierReceipt = observe(
    { ...auto, html_url: terminal(auto, "standard").target_url },
    [receipt]
  );
  const rendered = renderFinalCandidateObservation(earlierReceipt);
  assert.ok(rendered.includes(`Run: ${auto.id} (completed/success)`));
  assert.ok(rendered.includes(`Evidence: ${receipt.target_url}\n`));
  const unbound = buildFinalCandidateObservation({
    pullRequest: pr,
    run: auto,
    jobs: [],
    annotationsByCheckRunId: new Map(),
    commitStatuses: [
      { ...owned, target_url: "https://example.invalid/other-evidence" },
    ],
  });
  assert.ok(!renderFinalCandidateObservation(unbound).includes("Evidence:"));
  assert.ok(!rendered.includes(`Evidence: ${earlierReceipt.runUrl}`));
  assert.equal(
    observe(full, [
      { ...receipt, description: `${owned.description}; request 500` },
    ]).state,
    "waiting"
  );
  assert.equal(
    observe({ ...full, run_attempt: 2 }, [receipt]).state,
    "waiting"
  );
  assert.equal(
    observe(auto, [terminal(auto, "standard"), receipt]).state,
    "success"
  );
  assert.equal(
    observe(auto, [terminal(auto, "standard"), owned], () => full).state,
    "success"
  );
  const missing = {
    ...owned,
    target_url: owned.target_url.replace("/43/", "/41/"),
  };
  const removedSource = Object.assign(new Error("run missing"), {
    status: 1,
    stderr: "gh: Not Found (HTTP 404)\n",
  });
  const legacyLookup = (target) => {
    if (target.id === 41) {
      throw removedSource;
    }
    return full;
  };
  assert.equal(observe(auto, [missing, owned], legacyLookup).state, "success");
  assert.equal(observe(auto, [missing], legacyLookup).state, "waiting");
  const forbidden = Object.assign(new Error("read denied"), {
    status: 1,
    stderr: "gh: Forbidden (HTTP 403)\n",
  });
  assert.throws(
    () =>
      observe(auto, [missing], () => {
        throw forbidden;
      }),
    forbidden
  );
  assert.equal(
    observe(
      full,
      [{ ...owned, target_url: owned.target_url.replace("/43/", "/42/") }],
      () => old
    ).state,
    "waiting"
  );
  const localPending = {
    ...requested,
    description: `Running tooling @ ${head} on ${base}`,
  };
  const localPassed = {
    ...localPending,
    state: "success",
    description: `Passed tooling @ ${head} on ${base}`,
  };
  assert.equal(observe(full, [localPassed, localPending]).state, "success");
});
