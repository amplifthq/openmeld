import type { SpaceTask, SpaceTaskActor } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { applyGitHubIssueProviderObservation } from "../src/space/application/space-task-workflow";

const requester: SpaceTaskActor = {
  ownerUserId: "user-avery",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human",
  profileName: "Avery",
};

const githubIssue = {
  lastObservedAt: "2026-09-20T00:00:00.000Z",
  lastObservedState: "open" as const,
  number: 1143,
  owner: "amplifthq",
  provider: "github" as const,
  repo: "openmeld",
  url: "https://github.com/amplifthq/openmeld/issues/1143",
};

const task = (overrides: Partial<SpaceTask> = {}): SpaceTask => ({
  assignee: null,
  automaticReworkRounds: 0,
  completionConditions: [],
  createdAt: "2026-09-20T00:00:00.000Z",
  createdBy: requester,
  description: null,
  externalWorkItems: [githubIssue],
  needsHumanDecision: false,
  phase: "in_progress",
  requestedBy: requester,
  result: null,
  review: null,
  reviewer: null,
  revision: 1,
  sourceSignalId: null,
  spaceId: "space-1",
  taskId: "tsk_55555555-5555-4555-8555-555555555555",
  threadId: null,
  title: "Follow GitHub issue #1143",
  updatedAt: "2026-09-20T00:00:00.000Z",
  ...overrides,
});

describe("GitHub issue provider observation", () => {
  it("cancels an active linked Task on close and does not reopen Done on reopen", () => {
    const closed = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T03:00:00.000Z",
      observedState: "closed",
      task: task(),
    });
    expect(closed.skipReason).toBeNull();
    expect(closed.observe?.task.externalWorkItems[0]).toMatchObject({
      lastObservedAt: "2026-09-20T03:00:00.000Z",
      lastObservedState: "closed",
    });
    expect(closed.cancel?.task.phase).toBe("canceled");

    expect(
      applyGitHubIssueProviderObservation({
        identity: githubIssue,
        observedAt: "2026-09-20T02:00:00.000Z",
        observedState: "closed",
        task: closed.observe?.task ?? task(),
      })
    ).toMatchObject({ cancel: null, skipReason: "stale" });

    const equalTimestampStillCancels = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T03:00:00.000Z",
      observedState: "closed",
      task: {
        ...(closed.observe?.task ?? task()),
        phase: "in_progress",
      },
    });
    expect(equalTimestampStillCancels.observe).toBeNull();
    expect(equalTimestampStillCancels.cancel?.task.phase).toBe("canceled");

    const reopenedDone = applyGitHubIssueProviderObservation({
      identity: githubIssue,
      observedAt: "2026-09-20T04:00:00.000Z",
      observedState: "open",
      task: task({
        externalWorkItems: [
          {
            ...githubIssue,
            lastObservedAt: "2026-09-20T03:00:00.000Z",
            lastObservedState: "closed",
          },
        ],
        phase: "done",
      }),
    });
    expect(reopenedDone.cancel).toBeNull();
    expect(reopenedDone.observe?.task.phase).toBe("done");
    expect(
      reopenedDone.observe?.task.externalWorkItems[0]?.lastObservedState
    ).toBe("open");

    expect(
      applyGitHubIssueProviderObservation({
        identity: githubIssue,
        observedAt: "2026-09-20T03:00:00.000Z",
        observedState: "closed",
        task: task({ externalWorkItems: [] }),
      }).skipReason
    ).toBe("not_linked");
  });
});
