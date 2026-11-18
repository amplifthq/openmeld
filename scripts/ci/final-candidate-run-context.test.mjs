import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { resolveRunContext } from "./final-candidate-run-context.mjs";

const TITLE_BASE_SUFFIX = / on [0-9a-f]{40}$/u;

const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/github-fork-final-candidate.json", import.meta.url),
    "utf8"
  )
);

function candidateRun() {
  const input = structuredClone(captured);
  // Keep the actual pull_request API identity intact. Only construct the
  // documented workflow_run envelope consumed by this boundary.
  input.event = {
    action: "completed",
    repository: input.run.repository,
    workflow_run: { id: input.run.id, run_attempt: input.run.run_attempt },
  };
  input.run.display_title = `Final Candidate PR #${input.pr.number} @ ${input.pr.head.sha} [standard] on ${input.main.sha}`;
  input.baseComparison = { ahead_by: 0, behind_by: 0, status: "identical" };
  return input;
}

test("binds a fork result to the exact GitHub run, attempt, PR and current base", () => {
  const input = candidateRun();
  assert.notEqual(input.pr.head.repo.id, input.pr.base.repo.id);
  assert.deepEqual(resolveRunContext(input), {
    base: input.main.sha,
    branch: input.pr.head.ref,
    confidence: "standard",
    head: input.pr.head.sha,
    job_result: "skipped",
    pr: String(input.pr.number),
    tree: input.tree.sha,
  });
  for (const mutate of [
    (x) => {
      x.run.event = "pull_request_target";
    },
    (x) => {
      x.run.workflow_id += 1;
    },
    (x) => {
      x.run.path = ".github/workflows/untrusted.yml";
    },
    (x) => {
      x.event.workflow_run.run_attempt += 1;
    },
    (x) => {
      x.event.workflow_run.id += 1;
    },
    (x) => {
      x.run.head_sha = "a".repeat(40);
    },
    (x) => {
      x.pr.head.sha = "a".repeat(40);
    },
    (x) => {
      x.run.head_repository.id += 1;
    },
    (x) => {
      x.pr.base.repo.id += 1;
    },
    (x) => {
      x.event.action = "in_progress";
    },
    (x) => {
      x.run.status = "in_progress";
    },
    (x) => {
      x.baseComparison.status = "diverged";
    },
    (x) => {
      x.baseComparison.status = "behind";
    },
    (x) => {
      x.baseComparison = { ahead_by: 1, behind_by: 1, status: "ahead" };
    },
    (x) => {
      x.run.display_title = x.run.display_title.replace(TITLE_BASE_SUFFIX, "");
    },
    (x) => {
      x.pr.state = "closed";
    },
    (x) => {
      x.pr.draft = true;
    },
    (x) => {
      x.jobs = [];
    },
    (x) => {
      x.jobs.push(x.jobs.find((job) => job.name === "Final Candidate Runner"));
    },
  ]) {
    const changed = candidateRun();
    mutate(changed);
    assert.throws(() => resolveRunContext(changed));
  }
});

test("keeps a result bound to its exact base after main advances past it", () => {
  const input = candidateRun();
  const base = input.main.sha;
  input.main.sha = "b".repeat(40);
  input.baseComparison = { ahead_by: 3, behind_by: 0, status: "ahead" };
  assert.equal(resolveRunContext(input).base, base);
});

test("preserves failed, canceled and skipped outcomes for the evidence verifier", () => {
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    const input = candidateRun();
    input.jobs.find((job) => job.name === "Final Candidate Runner").conclusion =
      conclusion;
    assert.equal(resolveRunContext(input).job_result, conclusion);
  }
});

test(
  "the actual status-writer shell rejects old runs and attempts and fails closed",
  { skip: process.platform === "win32" },
  () => {
    const workflow = parse(
      readFileSync(
        new URL(
          "../../.github/workflows/final-candidate-result.yml",
          import.meta.url
        ),
        "utf8"
      )
    );
    const script = workflow.jobs.publish.steps[0].run;
    for (const scenario of [
      "success",
      "old-run",
      "old-attempt",
      "failed-verifier",
      "missing-evidence",
      "newer-request",
      "equal-second-request",
      "different-confidence",
      "matching-request",
      "masked-full-request",
      "fulfilled-full-request",
      "legacy-fulfilled-full-request",
      "racing-request",
      "later-terminal",
      "deleted-legacy-source",
      "forbidden-legacy-source",
      "transient-post-read",
      "retry-masked-request",
      "fulfilled-foreign-request",
      "outstanding-foreign-request",
    ]) {
      const root = mkdtempSync(path.join(tmpdir(), "candidate-status-writer-"));
      try {
        const input = candidateRun();
        const latest = structuredClone(input.run);
        latest.created_at = "2026-10-15T00:01:00Z";
        if (["old-run", "retry-masked-request"].includes(scenario)) {
          latest.id += 1;
        }
        const run = structuredClone(input.run);
        run.created_at = "2026-10-15T00:00:00Z";
        const marker = writerMarker(scenario, input, run);
        if (scenario === "old-attempt") {
          run.run_attempt += 1;
        }
        writeFileSync(
          path.join(root, "facts.json"),
          JSON.stringify({
            ...input,
            latest,
            run,
            marker,
            scenario,
            runs: ["old-run", "retry-masked-request"].includes(scenario)
              ? [run, latest]
              : [latest, { ...run, id: run.id - 1 }],
          })
        );
        const bin = path.join(root, "bin");
        mkdirSync(bin);
        const gh = path.join(bin, "gh");
        writeFileSync(
          gh,
          `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const facts = JSON.parse(fs.readFileSync(process.env.FACTS));
if (a.includes('--method')) { fs.appendFileSync(process.env.POSTS, JSON.stringify(a) + '\\n'); console.log('301'); process.exit(0); }
const endpoint = a[1];
if (a.some(s => s.endsWith('/statuses?per_page=100'))) {
  const wrote = fs.existsSync(process.env.POSTS);
  const visible = ['newer-request','equal-second-request','different-confidence','matching-request','masked-full-request','fulfilled-full-request','legacy-fulfilled-full-request','deleted-legacy-source','forbidden-legacy-source','retry-masked-request','fulfilled-foreign-request','outstanding-foreign-request'].includes(facts.scenario);
  const duringWrite = wrote && ['racing-request','later-terminal','transient-post-read'].includes(facts.scenario);
  if (wrote && facts.scenario==='transient-post-read' && !fs.existsSync(process.env.POSTS+'.failed-read')) {
    fs.writeFileSync(process.env.POSTS+'.failed-read','1'); process.exit(1);
  }
  const rows = visible || duringWrite ? [facts.marker] : [];
  if (['legacy-fulfilled-full-request','deleted-legacy-source','forbidden-legacy-source'].includes(facts.scenario)) {
    rows.unshift({context: facts.marker.context, id:249, state:'success', created_at:'2026-10-15T00:05:00Z',
      target_url: 'https://github.com/'+facts.pr.base.repo.full_name+'/actions/runs/42',
      description:'Passed full @ '+facts.pr.head.sha.slice(0,12)+' on '+facts.main.sha.slice(0,12)});
  }
  if (['deleted-legacy-source','forbidden-legacy-source'].includes(facts.scenario)) {
    rows.unshift({...rows[0],id:250,target_url:'https://github.com/'+facts.pr.base.repo.full_name+'/actions/runs/43'});
  }
  if (['masked-full-request','fulfilled-full-request','fulfilled-foreign-request'].includes(facts.scenario)) {
    rows.unshift({context: facts.marker.context, id:250, state:'success',
      target_url: 'https://github.com/'+facts.pr.base.repo.full_name+'/actions/runs/'+(facts.run.id-1)+'/attempts/1',
      description: 'Passed '+(facts.scenario==='masked-full-request'?'standard':'full')+' @ '+facts.pr.head.sha.slice(0,12)+' on '+facts.main.sha.slice(0,12)+(facts.scenario==='masked-full-request'?'':'; request 201')});
  }
  if (wrote || facts.scenario==='retry-masked-request') rows.unshift({context:facts.marker.context, id:301, state:'success',description:'Verified',target_url:'https://github.com/'+facts.pr.base.repo.full_name+'/actions/runs/'+facts.run.id+'/attempts/'+facts.run.run_attempt});
  if (wrote && facts.scenario === 'later-terminal') rows.unshift({context: facts.marker.context, id:302, state:'success'});
  console.log(JSON.stringify([rows]));
} else if (endpoint.includes('/pulls/')) console.log(JSON.stringify(facts.pr));
else if (endpoint.endsWith('/commits/main')) console.log(facts.main.sha);
else if (endpoint.includes('/actions/workflows/')) console.log(JSON.stringify({workflow_runs: facts.runs}));
else if (endpoint.endsWith('/actions/runs/43')) { console.log('HTTP/2.0 '+(facts.scenario==='forbidden-legacy-source'?'403 Forbidden':'404 Not Found')+'\\r\\n\\r\\n{}'); process.exit(1); }
else if (endpoint.endsWith('/actions/runs/42')) console.log('HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify({...facts.run, id:42, run_attempt:2, run_started_at:'2026-10-15T00:02:00Z', display_title:facts.run.display_title.replace('[standard]','[full]')}));
else if (endpoint.includes('/actions/runs/')) console.log(JSON.stringify(facts.run));
else process.exit(1);
`
        );
        chmodSync(gh, 0o755);
        const posts = path.join(root, "posts");
        const result = spawnSync("bash", ["-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            GH_TOKEN: "test-only",
            FACTS: path.join(root, "facts.json"),
            POSTS: posts,
            CANDIDATE_REPOSITORY: input.pr.base.repo.full_name,
            CANDIDATE_HEAD_SHA: input.pr.head.sha,
            CANDIDATE_PR_NUMBER: String(input.pr.number),
            CANDIDATE_CONFIDENCE: "standard",
            CANDIDATE_RUN_ID: String(input.run.id),
            CANDIDATE_RUN_ATTEMPT: String(input.run.run_attempt),
            CANDIDATE_SERVER_URL: "https://github.com",
            VERIFIED_DESCRIPTION:
              scenario === "matching-request" ? "X".repeat(140) : "Verified",
            VERIFIED_STATE: scenario === "missing-evidence" ? "" : "success",
            VERIFIER_RESULT:
              scenario === "failed-verifier" ? "failure" : "success",
          },
        });
        assert.equal(
          result.status,
          scenario === "forbidden-legacy-source" ? 1 : 0,
          result.stderr
        );
        assert.deepEqual(
          recordedWriterPosts(posts),
          expectedWriterPosts(scenario, input),
          scenario
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
);
function writerMarker(scenario, input, run) {
  let createdAt = "2026-10-15T00:00:01Z";
  if (scenario === "equal-second-request") {
    createdAt = run.created_at;
  } else if (
    [
      "different-confidence",
      "matching-request",
      "masked-full-request",
      "fulfilled-full-request",
      "legacy-fulfilled-full-request",
      "deleted-legacy-source",
      "forbidden-legacy-source",
    ].includes(scenario)
  ) {
    createdAt = "2026-10-14T23:59:59Z";
  }
  return {
    context: "OpenMeld Final Candidate",
    state: "pending",
    id: 201,
    created_at: createdAt,
    description: `Requested ${["different-confidence", "masked-full-request", "fulfilled-full-request", "legacy-fulfilled-full-request", "deleted-legacy-source", "forbidden-legacy-source", "fulfilled-foreign-request", "outstanding-foreign-request"].includes(scenario) ? "full" : "standard"} Final Candidate @ ${input.pr.head.sha.slice(0, 12)}; waiting for its result`,
    target_url: `https://github.com/${input.pr.base.repo.full_name}/pull/${scenario.endsWith("foreign-request") ? input.pr.number + 1 : input.pr.number}`,
  };
}

function expectedWriterPosts(scenario, input) {
  if (
    [
      "old-run",
      "old-attempt",
      "newer-request",
      "equal-second-request",
      "different-confidence",
      "masked-full-request",
      "forbidden-legacy-source",
      "outstanding-foreign-request",
    ].includes(scenario)
  ) {
    return [];
  }
  const failure = ["failed-verifier", "missing-evidence"].includes(scenario);
  let description = failure
    ? "Final Candidate result validation failed"
    : "Verified";
  if (scenario === "matching-request") {
    const suffix = "; request 201";
    description = "X".repeat(140 - suffix.length) + suffix;
  }
  const baseUrl = `https://github.com/${input.pr.base.repo.full_name}`;
  const posts = [
    {
      state: failure ? "failure" : "success",
      description,
      target_url: `${baseUrl}/actions/runs/${input.run.id}/attempts/${input.run.run_attempt}`,
    },
  ];
  if (scenario === "retry-masked-request") {
    posts.pop();
  }
  if (
    ["racing-request", "transient-post-read", "retry-masked-request"].includes(
      scenario
    )
  ) {
    posts.push({
      state: "pending",
      description: "Waiting for the current Final Candidate request",
      target_url: `${baseUrl}/pull/${input.pr.number}`,
    });
  }
  return posts;
}
function recordedWriterPosts(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const args = JSON.parse(line);
      return Object.fromEntries(
        ["state", "description", "target_url"].map((key) => {
          const field = args.find((arg) => arg.startsWith(`${key}=`));
          return [key, field?.slice(key.length + 1)];
        })
      );
    });
}
