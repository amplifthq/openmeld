import {
  MAX_INBOX_GITHUB_ISSUES,
  pluginRuntimeResponseSchema,
} from "@openmeld/schemas";
import type {
  ConnectorConnectionName,
  InboxGitHubIssue,
  InboxGitHubIssuesQuery,
  InboxGitHubIssuesResponse,
} from "@openmeld/schemas/types";
import { z } from "zod/v4";
import type { RemoteAgentWorkerBindingRpc } from "../../lib/bindings";

const githubLogin = z.string().regex(/^[A-Za-z0-9-]{1,39}$/u);
const positiveInt = z.number().int().positive();
const identity = z.object({ id: positiveInt, login: githubLogin });
const issuePath =
  /^\/([A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100})\/issues\/([1-9][0-9]*)$/u;
const issueSchema = z.object({
  assignees: z.array(identity),
  created_at: z.iso.datetime({ offset: true }),
  html_url: z.string(),
  id: positiveInt,
  number: positiveInt,
  pull_request: z.unknown().optional(),
  state: z.enum(["open", "closed"]),
  title: z.string(),
  updated_at: z.iso.datetime({ offset: true }),
});
const searchSchema = z.object({
  incomplete_results: z.boolean(),
  items: z.array(z.unknown()).max(MAX_INBOX_GITHUB_ISSUES),
  total_count: z.number().int().nonnegative(),
});

type Result = InboxGitHubIssuesResponse["result"];
type PluginRuntime = NonNullable<RemoteAgentWorkerBindingRpc["pluginRuntime"]>;
type Issue = z.infer<typeof issueSchema>;

// Read directly as the member requesting the view. Never persist or fan out a
// personal repository's metadata through the workspace Inbox projection.
export async function readInboxGitHubIssues(input: {
  connectionName: ConnectorConnectionName;
  runtime?: PluginRuntime;
  query: InboxGitHubIssuesQuery;
}): Promise<Result> {
  const { runtime, connectionName, query } = input;
  if (!runtime) {
    return { status: "unavailable" };
  }
  const read = async (
    actionId:
      | "github.get_current_user"
      | "github.search_issues_and_pull_requests",
    args: Record<string, unknown>
  ) => {
    const response = pluginRuntimeResponseSchema.parse(
      await runtime({
        operation: "execute",
        service: "github",
        actionId,
        authorizedEffect: "read",
        connectionName,
        idempotencyKey: crypto.randomUUID(),
        input: args,
      })
    );
    if (response.status !== "completed") {
      throw new Error("GitHub read did not complete");
    }
    return response.data;
  };

  try {
    const viewer = query.repository
      ? null
      : identity.parse(await read("github.get_current_user", {}));
    const qualifiers = buildIssueSearch(query, viewer);
    const response = searchSchema.parse(
      await read("github.search_issues_and_pull_requests", {
        query: qualifiers,
        perPage: MAX_INBOX_GITHUB_ISSUES,
        page: 1,
      })
    );
    return {
      status: "ready",
      issues: response.items.flatMap((item) => {
        const parsed = issueSchema.safeParse(item);
        const issue = parsed.success
          ? projectIssue(parsed.data, query, viewer)
          : null;
        return issue ? [issue] : [];
      }),
      partial:
        response.incomplete_results ||
        response.total_count > response.items.length,
    };
  } catch {
    return { status: "unavailable" };
  }
}

function buildIssueSearch(
  query: InboxGitHubIssuesQuery,
  viewer: z.infer<typeof identity> | null
) {
  const filters = ["is:issue"];
  if (query.repository) {
    filters.push(`repo:${query.repository}`);
  }
  const state = viewer ? "open" : query.state;
  if (state && state !== "all") {
    filters.push(`is:${state}`);
  }
  const assignee = viewer?.login ?? query.assignee;
  if (assignee) {
    filters.push(`assignee:${assignee}`);
  }
  return filters.join(" ");
}

function projectIssue(
  issue: Issue,
  query: InboxGitHubIssuesQuery,
  viewer: z.infer<typeof identity> | null
): InboxGitHubIssue | null {
  if (issue.pull_request || !matchesFilters(issue, query, viewer)) {
    return null;
  }
  const url = URL.parse(issue.html_url);
  const path = url?.pathname.match(issuePath);
  const repository = path?.[1];
  if (
    url?.origin !== "https://github.com" ||
    !repository ||
    Number(path?.[2]) !== issue.number ||
    (query.repository &&
      query.repository.toLowerCase() !== repository.toLowerCase())
  ) {
    return null;
  }
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title.trim().slice(0, 256) || `Issue #${issue.number}`,
    repository,
    url: `${url.origin}${url.pathname}`,
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    assignees: issue.assignees.map(({ login }) => login).slice(0, 10),
  };
}

function matchesFilters(
  issue: Issue,
  query: InboxGitHubIssuesQuery,
  viewer: z.infer<typeof identity> | null
) {
  if (viewer) {
    return (
      issue.state === "open" &&
      issue.assignees.some(({ id }) => id === viewer.id)
    );
  }
  return (
    (!query.state || query.state === "all" || query.state === issue.state) &&
    (!query.assignee ||
      issue.assignees.some(
        ({ login }) => login.toLowerCase() === query.assignee?.toLowerCase()
      ))
  );
}
