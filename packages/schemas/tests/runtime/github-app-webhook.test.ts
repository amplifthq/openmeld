import { describe, expect, it } from "vitest";
import {
  readGitHubAppWebhookIssueObservation,
  readGitHubAppWebhookPullRequestObservation,
} from "../../src/index";

const closedPayload = {
  action: "closed",
  issue: {
    html_url: "https://github.com/amplifthq/openmeld/issues/1143",
    number: 1143,
    state: "closed",
    state_reason: "completed",
    updated_at: "2026-09-20T12:00:00Z",
  },
  repository: {
    name: "openmeld",
    owner: { login: "amplifthq" },
  },
};

describe("GitHub App webhook issue observation", () => {
  it("reads closed and reopened issue events and ignores everything else", () => {
    expect(
      readGitHubAppWebhookIssueObservation({
        event: "issues",
        payload: closedPayload,
      })
    ).toEqual({
      number: 1143,
      owner: "amplifthq",
      repo: "openmeld",
      state: "closed",
      stateReason: "completed",
      updatedAt: "2026-09-20T12:00:00.000Z",
      url: "https://github.com/amplifthq/openmeld/issues/1143",
    });

    expect(
      readGitHubAppWebhookIssueObservation({
        event: "issues",
        payload: {
          ...closedPayload,
          action: "reopened",
          issue: {
            ...closedPayload.issue,
            state: "open",
            updated_at: "2026-09-20T13:00:00.000Z",
          },
        },
      })
    ).toMatchObject({
      state: "open",
      updatedAt: "2026-09-20T13:00:00.000Z",
    });

    expect(
      readGitHubAppWebhookIssueObservation({
        event: "ping",
        payload: { zen: "Design for failure." },
      })
    ).toBeNull();
    expect(
      readGitHubAppWebhookIssueObservation({
        event: "issues",
        payload: { ...closedPayload, action: "opened" },
      })
    ).toBeNull();
    expect(
      readGitHubAppWebhookIssueObservation({
        event: "issues",
        payload: {
          ...closedPayload,
          issue: { ...closedPayload.issue, state: "open" },
        },
      })
    ).toBeNull();
    expect(
      readGitHubAppWebhookIssueObservation({
        event: "issues",
        payload: {
          ...closedPayload,
          issue: { ...closedPayload.issue, updated_at: "not-a-date" },
        },
      })
    ).toBeNull();
    expect(
      readGitHubAppWebhookIssueObservation({
        event: "pull_request",
        payload: closedPayload,
      })
    ).toBeNull();
  });
});

it("reads the provider timestamp and full head SHA from a synchronize delivery", () => {
  // Relevant fields from octokit/webhooks' pull_request/synchronize example.
  const before = "f95f852bd8fca8fcc58a9a2d6c842781e32a215e";
  const after = "ec26c3e57ca3a959ca5aad62de7213c562f8c821";
  const payload = {
    action: "synchronize",
    number: 2,
    before,
    after,
    pull_request: {
      head: { sha: after },
      html_url: "https://github.com/Codertocat/Hello-World/pull/2",
      updated_at: "2019-05-15T15:20:33Z",
    },
    repository: { name: "Hello-World", owner: { login: "Codertocat" } },
  };
  const read = (value: typeof payload) =>
    readGitHubAppWebhookPullRequestObservation({
      event: "pull_request",
      payload: value,
    });
  expect(read(payload)).toMatchObject({
    beforeSha: before,
    headSha: after,
    observedAt: "2019-05-15T15:20:33.000Z",
  });
  expect(
    read({
      ...payload,
      pull_request: {
        ...payload.pull_request,
        head: { sha: after.slice(0, 7) },
      },
    })
  ).toBeNull();
});
