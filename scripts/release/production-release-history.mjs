import { setTimeout as delay } from "node:timers/promises";

// GitHub's documented REST collections are paged before any release selection.
// A safety bound is reported as incomplete, never treated as a complete history.
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const TRANSIENT_GITHUB_READ = /\bHTTP (?:500|502|503|504)\b/u;

async function readGithubPage(endpoint, readJson, wait) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readJson(endpoint);
    } catch (error) {
      if (
        attempt >= 2 ||
        !TRANSIENT_GITHUB_READ.test(
          error instanceof Error ? error.message : String(error)
        )
      ) {
        throw error;
      }
      await wait(1000 * (attempt + 1));
    }
  }
}
export const RELEASE_SCOPES = [
  "db",
  "web",
  "website",
  "docs",
  "gateway",
  "auth",
  "cli",
  "core",
  "remote-agent",
];

export function releaseWorkflowScopes(name) {
  if (String(name).includes("Scoped Production Release")) {
    return RELEASE_SCOPES;
  }
  if (String(name).includes("CLI Release")) {
    return ["db", "auth", "cli", "core"];
  }
  if (String(name).includes("Deploy Docs")) {
    return ["docs"];
  }
  if (String(name).includes("Deploy Website")) {
    return ["website"];
  }
  if (String(name).includes("Deploy Web")) {
    return ["web"];
  }
  for (const [label, scope] of [
    ["Auth", "auth"],
    ["Core", "core"],
    ["Gateway", "gateway"],
    ["Remote Agent", "remote-agent"],
  ]) {
    if (String(name).includes(`Deploy ${label} Worker`)) {
      return [scope];
    }
  }
  return [];
}

export async function readGithubCollection({
  endpoint,
  key,
  readJson,
  maxPages = MAX_PAGES,
  wait = delay,
}) {
  const items = new Map();
  let reportedCount = 0;
  let pagesRead = 0;
  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await readGithubPage(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=${PAGE_SIZE}&page=${page}`,
        readJson,
        wait
      );
      pagesRead += 1;
      if (
        !(
          Array.isArray(result?.[key]) &&
          Number.isSafeInteger(result.total_count)
        ) ||
        result.total_count < 0
      ) {
        throw new Error(`Malformed GitHub ${key} collection.`);
      }
      reportedCount = Math.max(reportedCount, result.total_count);
      appendGithubItems(items, result[key], key);
      if (items.size >= reportedCount) {
        return {
          items: [...items.values()],
          complete: true,
          pagesRead,
          reportedCount,
        };
      }
      if (result[key].length === 0) {
        throw new Error(`GitHub ${key} ended before its reported count.`);
      }
    }
    throw new Error(
      `GitHub ${key} history exceeded the ${maxPages}-page safety bound.`
    );
  } catch (error) {
    return {
      items: [...items.values()],
      complete: false,
      pagesRead,
      reportedCount,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function appendGithubItems(items, pageItems, key) {
  for (const item of pageItems) {
    if (!(item && Number.isSafeInteger(item.id)) || item.id <= 0) {
      throw new Error(`GitHub ${key} item lacks a stable id.`);
    }
    const prior = items.get(item.id);
    if (!prior || (item.run_attempt ?? 0) >= (prior.run_attempt ?? 0)) {
      items.set(item.id, item);
    }
  }
}

export async function readGithubReleaseRuns(repo, readJson, options = {}) {
  const workflows = await readGithubCollection({
    endpoint: `repos/${repo}/actions/workflows`,
    key: "workflows",
    readJson,
    ...options,
  });
  const runs = new Map();
  const issues = [];
  let pagesRead = workflows.pagesRead;
  if (!workflows.complete) {
    issues.push({ scopes: RELEASE_SCOPES, detail: workflows.reason });
  }
  for (const workflow of workflows.items) {
    const scopes = releaseWorkflowScopes(workflow.name);
    if (!scopes.length) {
      continue;
    }
    const history = await readGithubCollection({
      endpoint: `repos/${repo}/actions/workflows/${workflow.id}/runs`,
      key: "workflow_runs",
      readJson,
      ...options,
    });
    pagesRead += history.pagesRead;
    if (!history.complete) {
      issues.push({ scopes, detail: `${workflow.name}: ${history.reason}` });
    }
    for (const run of history.items) {
      runs.set(run.id, {
        databaseId: run.id,
        headSha: run.head_sha,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        status: run.status,
        workflowName: workflow.name,
        displayTitle: run.display_title,
        url: run.html_url,
        attempt: run.run_attempt,
        conclusion: run.conclusion,
      });
    }
  }
  return {
    runs: [...runs.values()],
    complete: issues.length === 0,
    issues,
    pagesRead,
    workflowCount: workflows.items.length,
  };
}

export async function readGithubReleaseJobs(
  runId,
  repo,
  readJson,
  options = {}
) {
  // Include successful jobs from earlier attempts when a rerun did not repeat them.
  const history = await readGithubCollection({
    endpoint: `repos/${repo}/actions/runs/${runId}/jobs?filter=all`,
    key: "jobs",
    readJson,
    ...options,
  });
  return {
    jobs: history.items,
    complete: history.complete,
    reason: history.reason,
    pagesRead: history.pagesRead,
  };
}
