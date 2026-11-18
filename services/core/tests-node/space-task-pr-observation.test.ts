import type { SpaceTask, SpaceTaskActor } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type ApplyGitHubPullRequestObservationInput,
  SpaceTaskService,
} from "../src/space/application/space-task-service";
import { SpaceTaskRepository } from "../src/space/infrastructure/sql/space-task-repo";

function buildActor(id: string, kind: "human" | "agent"): SpaceTaskActor {
  return {
    profileId: id,
    profileKind: kind,
    profileName: kind === "human" ? "Human" : "Agent",
    ownerUserId: kind === "human" ? `user-${id}` : null,
  };
}

function inMemoryService(spaceId: string) {
  const sql = new (class implements SqlStorage {
    // Minimal SQLite-like API surface used by SpaceTaskRepository
    private tables = new Map<string, any[]>();
    exec<T = unknown>(
      _query: string,
      ..._args: unknown[]
    ): {
      toArray(): T[];
    } {
      // Dummy interface; repository doesn't exercise in tests below beyond basic usage.
      return { toArray: () => [] as T[] };
    }
    transactionSync<T>(callback: () => T): T {
      return callback();
    }
  })() as unknown as SqlStorage;
  const repository = new SpaceTaskRepository(sql);
  const recorded: unknown[] = [];
  const service = new SpaceTaskService({
    onMutation: (receipt) => recorded.push(receipt),
    repository,
    runTransaction: (cb) => cb(),
    spaceId,
  });
  return { repository, service, recorded };
}

describe("pull request head observation", () => {
  it("updates headSha and requests re-verification when an accepted review exists", () => {
    const { repository, service } = inMemoryService("spc:test");
    const requester = buildActor("requester", "human");
    const assignee = buildActor("assignee", "agent");
    const reviewer = buildActor("reviewer", "agent");
    const now = new Date().toISOString();
    const taskId = "tsk_00000000-0000-4000-8000-000000000001";
    const base: SpaceTask = {
      taskId,
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
      phase: "done",
      result: {
        resultRevision: 2,
        summary: "Result submitted",
        submittedAt: now,
        submittedBy: assignee,
      },
      review: {
        decision: "accepted",
        feedback: null,
        resultRevision: 2,
        reviewedAt: now,
        reviewedBy: reviewer,
        pullRequestHeadSha: "aaaaaaa",
      },
      pullRequest: {
        owner: "acme",
        repo: "web",
        number: 42,
        url: "https://github.com/acme/web/pull/42",
        headSha: "aaaaaaa",
        headRef: "feature/xyz",
      },
      automaticReworkRounds: 0,
      needsHumanDecision: false,
      externalWorkItems: [],
      projectIds: [],
      revision: 3,
      createdAt: now,
      updatedAt: now,
    };
    repository.insertTask(base);
    const input: Omit<ApplyGitHubPullRequestObservationInput, "spaceId"> = {
      identity: { number: 42, owner: "acme", repo: "web" },
      observeOperationId: "observe-pr",
      observedAt: new Date(Date.now() + 1000).toISOString(),
      headSha: "bbbbbbb",
      taskId,
    };
    const result = service.applyGitHubPullRequestObservation(input);
    expect(result.updated).toBe(true);
    expect(result.task?.pullRequest?.headSha).toBe("bbbbbbb");
    expect(result.task?.phase).toBe("in_review");
    expect(result.task?.review).toBeNull();
  });
});
