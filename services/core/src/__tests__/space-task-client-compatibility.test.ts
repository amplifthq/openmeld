import { spaceTaskSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  projectSpaceTaskDetailForClient,
  projectSpaceTasksForClient,
} from "../space/application/space-task-client-compatibility";

const actor = {
  ownerUserId: "user-1",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human" as const,
  profileName: "Avery",
};
const task = spaceTaskSchema.parse({
  taskId: "tsk_55555555-5555-4555-8555-555555555555",
  spaceId: "space-1",
  title: "Track the fix",
  description: null,
  completionConditions: [],
  sourceSignalId: null,
  threadId: null,
  requestedBy: actor,
  createdBy: actor,
  assignee: null,
  reviewer: null,
  phase: "to_do",
  result: null,
  review: null,
  automaticReworkRounds: 0,
  needsHumanDecision: false,
  externalWorkItems: [],
  projectIds: [],
  revision: 1,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
});

describe("Space Task client compatibility", () => {
  it("keeps legacy Tasks readable without emitting a new field to strict old clients", () => {
    const legacy = projectSpaceTasksForClient(
      { tasks: [task], truncated: false },
      undefined
    );
    expect(legacy.tasks[0]).not.toHaveProperty("projectIds");
    expect(
      projectSpaceTasksForClient({ tasks: [task], truncated: false }, 2)
        .tasks[0]?.projectIds
    ).toEqual([]);
  });

  it("rejects Project and Linear facts for old clients instead of flattening them", () => {
    expect(() =>
      projectSpaceTasksForClient(
        {
          tasks: [{ ...task, projectIds: ["project-payments"] }],
          truncated: false,
        },
        undefined
      )
    ).toThrow("Update this OpenMeld client");
    expect(() =>
      projectSpaceTasksForClient(
        {
          tasks: [
            {
              ...task,
              externalWorkItems: [
                {
                  id: "73c7947f-5bba-4e67-a668-9392b70cd424",
                  identifier: "PAY-82",
                  teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
                  provider: "linear",
                  url: "https://linear.app/acme/issue/PAY-82/fix-payment",
                  lastObservedAt: null,
                  lastObservedState: null,
                },
              ],
            },
          ],
          truncated: false,
        },
        undefined
      )
    ).toThrow("Update this OpenMeld client");
  });

  it("rejects a Task whose Project set was later cleared when old detail events cannot parse it", () => {
    expect(() =>
      projectSpaceTaskDetailForClient(
        {
          task,
          events: [
            {
              eventId: "tse_55555555-5555-4555-8555-555555555555",
              taskId: task.taskId,
              operationId: "set-projects",
              type: "projects_set",
              actor,
              fromPhase: "to_do",
              toPhase: "to_do",
              taskRevision: 2,
              detail: null,
              createdAt: "2026-09-20T00:01:00.000Z",
            },
          ],
        },
        undefined
      )
    ).toThrow("Update this OpenMeld client");
  });
});
