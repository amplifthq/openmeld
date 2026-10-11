import { describe, expect, it } from "vitest";
import { readGitHubAppWebhookIssueObservation } from "../../src/index";

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
