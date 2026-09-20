import { spaceTaskSchema } from "@openmeld/schemas";
import type {
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskEvent,
  SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type SpaceTaskRepositoryPort,
  SpaceTaskService,
} from "../src/space/application/space-task-service";
import { SpaceTaskWorkflowError } from "../src/space/application/space-task-workflow";

const requester: SpaceTaskActor = {
  ownerUserId: "user-avery",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human",
  profileName: "Avery",
};
const agent: SpaceTaskActor = {
  ownerUserId: "user-avery",
  profileId: "agt_22222222-2222-4222-8222-222222222222",
  profileKind: "agent",
  profileName: "Builder",
};

const members = new Map(
  [requester, agent].map((member) => [member.profileId, member])
);

function createService() {
  const tasks = new Map<string, SpaceTask>();
  const events: SpaceTaskEvent[] = [];
  const operations = new Map<
    string,
    { requestJson: string; receipt: SpaceTaskMutationReceipt }
  >();
  const repository: SpaceTaskRepositoryPort = {
    appendEvent: (event) => events.push(event),
    insertTask: (inserted) => tasks.set(inserted.taskId, inserted),
    listEvents: (taskId) => events.filter((event) => event.taskId === taskId),
    listTasks: () => [...tasks.values()],
    readOperation: (operationId) => operations.get(operationId) ?? null,
    readTask: (taskId) => tasks.get(taskId) ?? null,
    recordOperation: (operation) => {
      operations.set(operation.operationId, operation);
    },
    updateTask: (updated, expectedRevision) => {
      const current = tasks.get(updated.taskId);
      if (!current || current.revision !== expectedRevision) {
        throw new SpaceTaskWorkflowError({
          code: "space_task.revision_conflict",
          message: `This Task changed from revision ${expectedRevision} to ${current?.revision ?? 0}. Refresh it and try again.`,
          status: 409,
        });
      }
      tasks.set(updated.taskId, updated);
    },
  };
  return {
    events,
    service: new SpaceTaskService({
      repository,
      runTransaction: (callback) => callback(),
      spaceId: "space-1",
    }),
    tasks,
  };
}

describe("Space Task service brief updates", () => {
  it("persists a matching brief update and rejects a stale revision as a typed 409", () => {
    const { events, service, tasks } = createService();
    const created = service.create(
      {
        assigneeProfileId: agent.profileId,
        operationId: "create-task-1",
        title: "Implement Space Tasks",
      },
      {
        actor: requester,
        isSpaceOwner: true,
        requestedBy: requester,
        resolveMember: (profileId) => members.get(profileId) ?? null,
      }
    );

    const updated = service.mutate(
      created.task.taskId,
      {
        action: "update_brief",
        description: "Updated acceptance criteria.",
        expectedRevision: created.task.revision,
        operationId: "update-brief-1",
      },
      {
        actor: requester,
        isSpaceOwner: true,
        resolveMember: (profileId) => members.get(profileId) ?? null,
      }
    );

    expect(updated.applied).toBe(true);
    expect(spaceTaskSchema.parse(updated.task)).toMatchObject({
      description: "Updated acceptance criteria.",
      revision: 2,
      taskId: created.task.taskId,
    });
    expect(tasks.get(created.task.taskId)?.revision).toBe(2);
    expect(events).toHaveLength(2);

    expect(() =>
      service.mutate(
        created.task.taskId,
        {
          action: "update_brief",
          description: "A later brief.",
          expectedRevision: created.task.revision,
          operationId: "update-brief-stale",
        },
        {
          actor: requester,
          isSpaceOwner: true,
          resolveMember: (profileId) => members.get(profileId) ?? null,
        }
      )
    ).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.revision_conflict",
        status: 409,
      })
    );
  });
});
