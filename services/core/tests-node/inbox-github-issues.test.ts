import type {
  ConnectorConnectionName,
  PluginRuntimeRequest,
  PluginRuntimeResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readInboxGitHubIssues } from "../src/inbox/application/inbox-github-issues";

const connectionName =
  "org_fixture__user_fixture__github" as ConnectorConnectionName;
const viewer = { id: 339, login: "my-fixture" };
const nextOwner = { id: 451, login: "review-owner" };

// GitHub REST Search Issues returns issue records, including assignees with
// stable user IDs, and most fields from the Issues REST API. Fixtures use the
// documented simple-user and issue search result shape with synthetic values.
const issue = {
  assignees: [viewer],
  created_at: "2026-11-19T16:01:34Z",
  html_url: "https://github.com/example/repository/issues/12",
  id: 4201,
  number: 12,
  state: "open",
  title: "Verify the creator flow",
  updated_at: "2026-11-19T18:55:00Z",
};

function result(data: unknown): PluginRuntimeResponse {
  return {
    data,
    status: "completed",
    outputSchema: {},
    providerExecutionId: "fixture",
  };
}

function runtimeForIssues(items: unknown[], totalCount = items.length) {
  return vi.fn(async (request: PluginRuntimeRequest) =>
    request.operation === "execute" &&
    request.actionId === "github.get_current_user"
      ? result(viewer)
      : result({ items, incomplete_results: false, total_count: totalCount })
  );
}

describe("live GitHub Inbox issues", () => {
  it("reads only self-assigned open issues even when a caller supplies other filters", async () => {
    const runtime = runtimeForIssues([
      issue,
      { ...issue, id: 44, assignees: [nextOwner] },
      { ...issue, id: 45, state: "closed" },
      { ...issue, id: 46, pull_request: {} },
      {
        ...issue,
        id: 47,
        html_url:
          "https://github.com.example.test/example/repository/issues/12",
      },
    ]);
    await expect(
      readInboxGitHubIssues({
        connectionName,
        query: { assignee: "somebody-else", state: "all" },
        runtime,
      })
    ).resolves.toMatchObject({
      status: "ready",
      issues: [
        { id: issue.id, assignees: [viewer.login], url: issue.html_url },
      ],
    });
    expect(runtime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionId: "github.get_current_user",
        authorizedEffect: "read",
        connectionName,
      })
    );
    expect(runtime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionId: "github.search_issues_and_pull_requests",
        input: {
          query: "is:issue is:open assignee:my-fixture",
          page: 1,
          perPage: 30,
        },
        connectionName,
      })
    );
  });

  it("disappears from the old owner's list after GitHub reports a reassignment", async () => {
    await expect(
      readInboxGitHubIssues({
        connectionName,
        query: {},
        runtime: runtimeForIssues([{ ...issue, assignees: [nextOwner] }]),
      })
    ).resolves.toEqual({ status: "ready", issues: [], partial: false });
  });

  it("keeps Dashboard reads repository-scoped and flags incomplete results", async () => {
    const runtime = runtimeForIssues(
      [
        issue,
        { ...issue, id: 49, state: "closed" },
        {
          ...issue,
          id: 50,
          html_url: "https://github.com/example/another/issues/12",
        },
      ],
      55
    );
    await expect(
      readInboxGitHubIssues({
        connectionName,
        query: {
          repository: "Example/Repository",
          state: "open",
          assignee: viewer.login,
        },
        runtime,
      })
    ).resolves.toMatchObject({
      status: "ready",
      issues: [{ id: issue.id }],
      partial: true,
    });
    expect(runtime).toHaveBeenCalledOnce();
  });

  it("does not present provider errors as an empty assignment list", async () => {
    const runtime = vi.fn(
      async (): Promise<PluginRuntimeResponse> => ({
        status: "failed",
        error: "Synthetic private provider error",
        providerExecutionId: null,
      })
    );
    await expect(
      readInboxGitHubIssues({ connectionName, query: {}, runtime })
    ).resolves.toEqual({ status: "unavailable" });
    expect(runtime).toHaveBeenCalledOnce();
  });
});
