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
const RESULT_UNFINISHED = /result publication has not finished/u;
const RESULT_INCOMPLETE =
  /Cannot establish complete Final Candidate result state/u;

const splitSource = {
  ...run,
  created_at: "2026-10-15T00:00:00Z",
  display_title: `Final Candidate PR #${input.pullRequestNumber} @ ${input.headSha} [standard]`,
};
const resultRun = (source, event, status = "completed") => ({
  id: source.id + 100,
  display_title: `Final Candidate Result ${source.id}:${source.run_attempt} ${event}`,
  status,
});

test("local takeover waits through delayed completed events and their last status write", async () => {
  const publications = [];
  const responses = [
    page([]), // source finished, but GitHub has not delivered workflow_run yet
    page([resultRun(splitSource, "in_progress")]),
    page([resultRun(splitSource, "completed", "queued")]),
    page([resultRun(splitSource, "completed", "in_progress")]),
    page([resultRun(splitSource, "completed")]),
  ];
  let waits = 0;
  await settleHostedCandidateRuns(input, {
    read: (args) => {
      if (!args.at(-1).includes("final-candidate-result.yml")) {
        return page([splitSource]);
      }
      assert.ok(args.at(-1).includes("created=%3E%3D2026-10-15"));
      const response = responses.shift();
      assert.ok(
        response,
        "handoff must terminate when the publisher completes"
      );
      if (responses.length === 0) {
        publications.push("old hosted failure");
      }
      return response;
    },
    cancel: () => assert.fail("completed source must not be cancelled"),
    wait: () => waits++,
    report: ignore,
  });
  publications.push("new local success");
  assert.equal(waits, 4);
  assert.deepEqual(publications, ["old hosted failure", "new local success"]);
});

test("another source or old attempt cannot acknowledge the latest publisher", async () => {
  for (const results of [
    [],
    [resultRun({ ...splitSource, id: splitSource.id - 1 }, "completed")],
    [resultRun({ ...splitSource, run_attempt: 0 }, "completed")],
    [resultRun(splitSource, "in_progress")],
    [
      resultRun(splitSource, "completed"),
      resultRun(splitSource, "in_progress", "queued"),
    ],
  ]) {
    let time = 0;
    await assert.rejects(
      settleHostedCandidateRuns(input, {
        read: (args) =>
          args.at(-1).includes("final-candidate-result.yml")
            ? page(results)
            : page([splitSource]),
        cancel: ignore,
        wait: () => {
          time += 1_200_000;
        },
        now: () => time,
        report: ignore,
      }),
      RESULT_UNFINISHED
    );
  }
});

test("a newly queued source is cancelled and its own result must finish too", async () => {
  const newer = { ...splitSource, id: splitSource.id + 1 };
  let iteration = 0;
  const cancelled = [];
  await settleHostedCandidateRuns(input, {
    read: (args) => {
      if (args.at(-1).includes("final-candidate-result.yml")) {
        return page([
          resultRun(iteration < 3 ? splitSource : newer, "completed"),
        ]);
      }
      iteration++;
      if (iteration === 1) {
        return page([{ ...splitSource, status: "in_progress" }]);
      }
      if (iteration === 2) {
        return page([{ ...newer, status: "queued" }, splitSource]);
      }
      return page([newer, splitSource]);
    },
    cancel: (args) => cancelled.push(args.at(-1)),
    wait: ignore,
    report: ignore,
  });
  assert.equal(cancelled.length, 2);
  assert.equal(iteration, 3);
});

test("missing or incomplete result API evidence fails closed", async () => {
  for (const results of [{}, [{ total_count: 2, workflow_runs: [] }]]) {
    await assert.rejects(
      settleHostedCandidateRuns(input, {
        read: (args) =>
          args.at(-1).includes("final-candidate-result.yml")
            ? results
            : page([splitSource]),
        cancel: ignore,
        report: ignore,
      }),
      RESULT_INCOMPLETE
    );
  }
});

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
      {
        ...splitSource,
        display_title: `Final Candidate PR #9999 @ ${input.headSha} [standard]`,
      },
    ]),
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
