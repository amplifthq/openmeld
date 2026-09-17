import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settleHostedCandidateRuns } from "./final-candidate-handoff.mjs";

const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/github-final-candidate-runs.json", import.meta.url),
    "utf8"
  )
).response;
const run = captured.workflow_runs[0];
const input = {
  repository: "amplifthq/openmeld",
  headSha: run.head_sha,
  branchName: run.head_branch,
  pullRequestNumber: run.pull_requests[0].number,
};
const page = (runs) => [{ total_count: runs.length, workflow_runs: runs }];
const active = { ...run, status: "in_progress" };
const ignore = () => undefined;
const CANCEL_FAILED = /cancel failed/u;
const CANCEL_UNFINISHED = /has not finished cancellation/u;

test("cancel acceptance is not completion; wait through publishers and newly queued attempts", async () => {
  const reads = [
    page([active]),
    page([active]),
    page([run, { ...active, id: run.id + 1, status: "queued" }]),
    page([run, { ...run, id: run.id + 1 }]),
  ];
  const cancelled = [];
  let waits = 0;
  await settleHostedCandidateRuns(input, {
    read: () => reads.shift(),
    cancel: (args) => cancelled.push(args.at(-1)),
    wait: () => {
      waits++;
    },
    report: ignore,
  });
  assert.equal(waits, 3);
  assert.deepEqual(cancelled, [
    `repos/amplifthq/openmeld/actions/runs/${run.id}/cancel`,
    `repos/amplifthq/openmeld/actions/runs/${run.id + 1}/cancel`,
  ]);
});

test("completion racing cancellation is accepted only with a matching completed run", async () => {
  for (const status of ["completed", "in_progress"]) {
    let lists = 0;
    const handoff = settleHostedCandidateRuns(input, {
      read: (args) =>
        args.includes("--paginate")
          ? page([lists++ === 0 ? active : run])
          : { ...run, status },
      cancel: () => {
        throw new Error("cancel failed");
      },
      wait: ignore,
      report: ignore,
    });
    if (status === "completed") {
      await handoff;
    } else {
      await assert.rejects(handoff, CANCEL_FAILED);
    }
  }
});

test("unknown ownership, incomplete results and stuck cancellation fail closed", async () => {
  for (const response of [
    page([
      { ...active, pull_requests: [{ number: input.pullRequestNumber + 1 }] },
    ]),
    page([{ ...active, head_branch: "another-branch" }]),
    page([{ ...active, pull_requests: [] }]),
    [{ total_count: 1000, workflow_runs: [run] }],
    {},
  ]) {
    await assert.rejects(
      settleHostedCandidateRuns(input, {
        read: () => response,
        cancel: () => assert.fail("must not cancel unknown work"),
        report: ignore,
      })
    );
  }
  let time = 0;
  await assert.rejects(
    settleHostedCandidateRuns(input, {
      read: () => page([active]),
      cancel: ignore,
      now: () => time,
      wait: () => {
        time += 180_000;
      },
      report: ignore,
    }),
    CANCEL_UNFINISHED
  );
});
