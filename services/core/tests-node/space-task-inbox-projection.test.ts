import type {
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskEvent,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { buildSpaceTaskInboxCandidate } from "../src/space/application/space-task-inbox-projection";

const actor: SpaceTaskActor = {
  ownerUserId: "human-1",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human",
  profileName: "Avery",
};
const createdAt = "2026-11-25T00:00:00.000Z";
const task: SpaceTask = {
  assignee: actor,
  automaticReworkRounds: 0,
  completionConditions: [],
  createdAt,
  createdBy: actor,
  description: null,
  externalWorkItems: [],
  needsHumanDecision: false,
  phase: "to_do",
  projectIds: [],
  requestedBy: actor,
  result: null,
  review: null,
  reviewer: null,
  revision: 1,
  sourceSignalId: "source",
  spaceId: "space-1",
  taskId: "tsk_55555555-5555-4555-8555-555555555555",
  threadId: null,
  title: "Verify signup",
  updatedAt: createdAt,
};
const event: SpaceTaskEvent = {
  actor,
  createdAt,
  detail: task.title,
  eventId: "tse_55555555-5555-4555-8555-555555555556",
  fromPhase: null,
  operationId: "created-1",
  taskId: task.taskId,
  taskRevision: 1,
  toPhase: "to_do",
  type: "created",
};
const input = {
  task,
  activeMembers: [actor],
  ownerUserIds: [],
  organizationId: "org-1",
  spaceName: "QA",
  events: [event],
};

describe("Space Task To do projection", () => {
  it("projects an open assignment only to its active human assignee", () => {
    expect(buildSpaceTaskInboxCandidate(input)).toMatchObject({
      recipientUserId: actor.ownerUserId,
      attention: "action_required",
      contextLabel: "QA",
      title: "Complete: Verify signup",
      occurredAtMs: Date.parse(createdAt),
      sourceFacts: { requestCategory: "action" },
      sourceTarget: { kind: "space", spaceId: "space-1", signalId: "source" },
    });
    expect(
      buildSpaceTaskInboxCandidate({ ...input, activeMembers: [] })
    ).toBeNull();
  });

  it("does not project completed or unassigned work", () => {
    expect(
      buildSpaceTaskInboxCandidate({
        ...input,
        task: { ...task, phase: "done" },
      })
    ).toBeNull();
    expect(
      buildSpaceTaskInboxCandidate({
        ...input,
        task: { ...task, assignee: null },
      })
    ).toBeNull();
  });
});
