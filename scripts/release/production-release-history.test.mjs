import assert from "node:assert/strict";
import test from "node:test";
import {
  readGithubCollection,
  readGithubReleaseJobs,
  readGithubReleaseRuns,
} from "./production-release-history.mjs";

// Envelopes and job timestamps follow GitHub REST Actions workflow/job schemas.
// Only the HTTP boundary is replaced; paging/filtering runs through the real reader.
test("finds an old deployment without spending its window on unrelated CI runs", async () => {
  const requested = [];
  const result = await readGithubReleaseRuns("test/repo", (endpoint) => {
    requested.push(endpoint);
    if (endpoint.includes("/workflows?")) {
      return {
        total_count: 2,
        workflows: [
          { id: 1, name: "CI" },
          { id: 2, name: "Scoped Production Release" },
        ],
      };
    }
    assert.ok(endpoint.includes("/workflows/2/runs?"));
    return {
      total_count: 1,
      workflow_runs: [
        {
          id: 3,
          head_sha: "a".repeat(40),
          created_at: "2025-01-01T00:00:00Z",
          run_attempt: 2,
          conclusion: "failure",
          display_title: "release",
          html_url: "https://github.com/test/repo/actions/runs/3",
        },
      ],
    };
  });
  assert.equal(result.complete, true);
  assert.equal(result.runs[0].databaseId, 3);
  assert.equal(result.runs[0].conclusion, "failure");
  assert.equal(result.runs[0].attempt, 2);
  assert.equal(requested.length, 2);
});

test("reads every job page and every attempt instead of losing a previously successful job", async () => {
  const jobs = Array.from({ length: 101 }, (_, index) => ({
    id: index + 1,
    name: index === 100 ? "Deploy Web" : "Prepare",
    conclusion: "success",
    completed_at: "2026-09-18T12:00:00Z",
  }));
  const pages = [];
  const result = await readGithubReleaseJobs(42, "test/repo", (endpoint) => {
    const url = new URL(endpoint, "https://api.github.com/");
    assert.equal(url.searchParams.get("filter"), "all");
    const page = Number(url.searchParams.get("page"));
    pages.push(page);
    return {
      total_count: jobs.length,
      jobs: jobs.slice((page - 1) * 100, page * 100),
    };
  });
  assert.equal(result.complete, true);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.jobs.at(-1).name, "Deploy Web");
});

test("reports bounded, denied and malformed history without fabricating completeness", async () => {
  for (const failure of ["bound", "denied", "malformed", "repeated-page"]) {
    let calls = 0;
    const result = await readGithubCollection({
      endpoint: "repos/test/repo/actions/workflows",
      key: "workflows",
      maxPages: failure === "bound" ? 1 : 2,
      readJson: () => {
        calls += 1;
        if (calls === 2 && failure === "denied") {
          throw new Error("API rate limit");
        }
        if (failure === "malformed") {
          return { workflows: [] };
        }
        return {
          total_count: 101,
          workflows: Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
          })),
        };
      },
    });
    assert.equal(result.complete, false, failure);
    assert.ok(result.reason, failure);
    assert.equal(result.items.length, failure === "malformed" ? 0 : 100);
  }
});

test("retries only a transient failed page and preserves incomplete evidence on exhaustion", async () => {
  for (const status of [500, 502, 503, 504, 403]) {
    for (const recovers of [true, false]) {
      const pages = [];
      const delays = [];
      let failedPageCalls = 0;
      const result = await readGithubCollection({
        endpoint: "repos/test/repo/actions/runs/42/jobs?filter=all",
        key: "jobs",
        wait: (milliseconds) => delays.push(milliseconds),
        readJson: (endpoint) => {
          const page = Number(
            new URL(endpoint, "https://api.github.com").searchParams.get("page")
          );
          pages.push(page);
          if (page === 1) {
            return {
              total_count: 101,
              jobs: Array.from({ length: 100 }, (_, index) => ({
                id: index + 1,
              })),
            };
          }
          failedPageCalls += 1;
          if (!recovers || failedPageCalls === 1) {
            // Sanitized gh stderr captured from the failed production status read.
            throw new Error(
              `Command failed: gh api ${endpoint}\ngh: Server Error (HTTP ${status})\n`
            );
          }
          return { total_count: 101, jobs: [{ id: 101 }] };
        },
      });
      const recovered = recovers && status !== 403;
      assert.equal(result.complete, recovered);
      assert.equal(result.items.length, recovered ? 101 : 100);
      assert.equal(result.pagesRead, recovered ? 2 : 1);
      assert.equal(pages.filter((page) => page === 1).length, 1);
      const transientCalls = recovers ? 2 : 3;
      assert.equal(failedPageCalls, status === 403 ? 1 : transientCalls);
      assert.equal(delays.length, failedPageCalls - 1);
      assert.ok(delays.every((delay) => delay > 0 && delay <= 2000));
    }
  }
});
