import type { SpaceTask, SpaceTaskActor } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  mutateSpaceTask,
  type SpaceTaskMutationContext,
  SpaceTaskWorkflowError,
} from "../src/space/application/space-task-workflow";

function buildActor(id: string, kind: "human" | "agent"): SpaceTaskActor {
  return {
    profileId: id,
    profileKind: kind,
    profileName: kind === "human" ? "Human" : "Agent",
    ownerUserId: kind === "human" ? `user-${id}` : null,
  };
}

function buildContext(actor: SpaceTaskActor): SpaceTaskMutationContext {
  return {
    actor,
    isSpaceOwner: true,
    resolveMember: (profileId) =>
      [
        actor,
        buildActor("assignee", "agent"),
        buildActor("reviewer", "agent"),
      ].find((m) => m.profileId === profileId) ?? null,
  };
}

describe("commit-bound review on linked pull request", () => {
  it("requires expectedPullRequestHeadSha and binds review to the commit", () => {
    const requester = buildActor("requester", "human");
    const assignee = buildActor("assignee", "agent");
    const reviewer = buildActor("reviewer", "agent");
    const now = new Date().toISOString();
    const base: SpaceTask = {
      taskId: "tsk_00000000-0000-4000-8000-000000000000",
      spaceId: "spc:test",
      title: "Implement feature",
      description: null,
      completionConditions: [],
      sourceSignalId: null,
      threadId: null,
      requestedBy: requester,
      createdBy: requester,
      assignee,
      reviewer,
      phase: "in_progress",
      result: null,
      review: null,
      pullRequest: null,
      automaticReworkRounds: 0,
      needsHumanDecision: false,
      externalWorkItems: [],
      projectIds: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const submit = mutateSpaceTask({
      task: base,
      command: {
        action: "submit_result",
        operationId: "op:submit",
        expectedRevision: 1,
        summary: "Open a draft PR for review",
        pullRequest: {
          owner: "acme",
          repo: "web",
          number: 42,
          url: "https://github.com/acme/web/pull/42",
          headRef: "feature/xyz",
          headSha: "abcdef1234567890",
        },
      },
      context: buildContext(assignee),
    });
    expect(submit.task.phase).toBe("in_review");
    expect(submit.task.pullRequest?.number).toBe(42);
    // Missing expectedPullRequestHeadSha is rejected when a PR is linked
    expect(() =>
      mutateSpaceTask({
        task: submit.task,
        command: {
          action: "review",
          operationId: "op:review-missing-sha",
          expectedRevision: submit.task.revision,
          expectedResultRevision: submit.task.result?.resultRevision ?? 0,
          decision: "accepted",
        },
        context: buildContext(reviewer),
      })
    ).toThrowError(SpaceTaskWorkflowError);
    // Wrong SHA is rejected
    expect(() =>
      mutateSpaceTask({
        task: submit.task,
        command: {
          action: "review",
          operationId: "op:review-wrong-sha",
          expectedRevision: submit.task.revision,
          expectedResultRevision: submit.task.result?.resultRevision ?? 0,
          decision: "accepted",
          expectedPullRequestHeadSha: "deadbeef",
        },
        context: buildContext(reviewer),
      })
    ).toThrowError(SpaceTaskWorkflowError);
    // Correct SHA succeeds and records the bound head
    const reviewed = mutateSpaceTask({
      task: submit.task,
      command: {
        action: "review",
        operationId: "op:review-correct-sha",
        expectedRevision: submit.task.revision,
        expectedResultRevision: submit.task.result?.resultRevision ?? 0,
        decision: "accepted",
        expectedPullRequestHeadSha: "abcdef1234567890",
      },
      context: buildContext(reviewer),
    });
    expect(reviewed.task.phase).toBe("done");
    expect(reviewed.task.review?.pullRequestHeadSha).toBe("abcdef1234567890");
  });
});
