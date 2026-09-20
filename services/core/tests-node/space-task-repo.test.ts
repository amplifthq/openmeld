import { spaceTaskSchema } from "@openmeld/schemas";
import type { SpaceTask } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { SpaceTaskWorkflowError } from "../src/space/application/space-task-workflow";
import { SpaceTaskRepository } from "../src/space/infrastructure/sql/space-task-repo";

const TASK_ID = "tsk_55555555-5555-4555-8555-555555555555";
const UPDATE_TASK_QUERY = /UPDATE space_tasks/i;
const READ_TASK_QUERY = /SELECT task_json FROM space_tasks WHERE task_id = \?/i;

const storedTask = (revision: number): SpaceTask =>
  spaceTaskSchema.parse({
    assignee: {
      ownerUserId: "user-avery",
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileKind: "agent",
      profileName: "Builder",
    },
    automaticReworkRounds: 0,
    completionConditions: [],
    createdAt: "2026-09-15T00:00:00.000Z",
    createdBy: {
      ownerUserId: "user-avery",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human",
      profileName: "Avery",
    },
    description: "Updated acceptance criteria.",
    needsHumanDecision: false,
    phase: "to_do",
    requestedBy: {
      ownerUserId: "user-avery",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human",
      profileName: "Avery",
    },
    result: null,
    review: null,
    reviewer: null,
    revision,
    sourceSignalId: null,
    spaceId: "space-1",
    taskId: TASK_ID,
    threadId: null,
    title: "Ship Tasks",
    updatedAt: "2026-09-15T01:00:00.000Z",
  });

class FakeSqlCursor<T extends Record<string, unknown>> {
  readonly rowsWritten: number;
  private readonly rows: T[];

  constructor(rows: T[], rowsWritten = 0) {
    this.rows = rows;
    this.rowsWritten = rowsWritten;
  }

  toArray(): T[] {
    return [...this.rows];
  }
}

class FakeSqlStorage {
  private readonly matchers: {
    pattern: RegExp;
    rows?: Record<string, unknown>[];
    rowsWritten?: number;
  }[];

  constructor(
    matchers: {
      pattern: RegExp;
      rows?: Record<string, unknown>[];
      rowsWritten?: number;
    }[]
  ) {
    this.matchers = matchers;
  }

  exec<T extends Record<string, unknown>>(
    sql: string,
    ..._params: unknown[]
  ): FakeSqlCursor<T> {
    for (const matcher of this.matchers) {
      if (!matcher.pattern.test(sql)) {
        continue;
      }
      return new FakeSqlCursor<T>(
        (matcher.rows ?? []) as T[],
        matcher.rowsWritten ?? 0
      );
    }
    return new FakeSqlCursor<T>([]);
  }
}

describe("Space Task repository updates", () => {
  it("applies a matching brief update when SQLite reports more than one row written", () => {
    const repository = new SpaceTaskRepository(
      new FakeSqlStorage([
        { pattern: UPDATE_TASK_QUERY, rowsWritten: 2 },
      ]) as unknown as SqlStorage
    );

    expect(() => repository.updateTask(storedTask(2), 1)).not.toThrow();
  });

  it("returns a typed revision conflict when no row is written", () => {
    const current = storedTask(2);
    const repository = new SpaceTaskRepository(
      new FakeSqlStorage([
        { pattern: UPDATE_TASK_QUERY, rowsWritten: 0 },
        {
          pattern: READ_TASK_QUERY,
          rows: [{ task_json: JSON.stringify(current) }],
        },
      ]) as unknown as SqlStorage
    );

    expect(() => repository.updateTask(storedTask(3), 1)).toThrowError(
      expect.objectContaining<Partial<SpaceTaskWorkflowError>>({
        code: "space_task.revision_conflict",
        message:
          "This Task changed from revision 1 to 2. Refresh it and try again.",
        name: "SpaceTaskWorkflowError",
        status: 409,
      })
    );
  });
});
