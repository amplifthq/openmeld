import type {
  ListSpaceTasksResponse,
  SpaceTask,
  SpaceTaskMutationReceipt,
  SpaceTaskResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  formatSpaceTaskDetailOutput,
  formatSpaceTaskListOutput,
  formatSpaceTaskReceiptOutput,
} from "../src/space/tasks-output";

const human = {
  profileId: "usr_11111111-1111-4111-8111-111111111111",
  profileKind: "human" as const,
  profileName: "Monica",
  ownerUserId: "user-1",
};
const agent = {
  profileId: "agt_22222222-2222-4222-8222-222222222222",
  profileKind: "agent" as const,
  profileName: "Builder",
  ownerUserId: "user-1",
};

function task(overrides: Partial<SpaceTask>): SpaceTask {
  return {
    taskId: "tsk_33333333-3333-4333-8333-333333333333",
    spaceId: "space-1",
    title: "Ship the pricing page",
    description: null,
    completionConditions: [],
    sourceSignalId: null,
    threadId: null,
    requestedBy: human,
    createdBy: human,
    assignee: agent,
    reviewer: human,
    phase: "in_progress",
    result: null,
    review: null,
    automaticReworkRounds: 0,
    needsHumanDecision: false,
    externalWorkItems: [],
    projectIds: [],
    revision: 3,
    createdAt: "2026-11-20T01:00:00.000Z",
    updatedAt: "2026-11-21T01:00:00.000Z",
    ...overrides,
  };
}

describe("Space Tasks CLI output", () => {
  it("emits the canonical list response unchanged for --json", () => {
    const response: ListSpaceTasksResponse = {
      tasks: [task({})],
      truncated: false,
    };

    expect(formatSpaceTaskListOutput(response, { json: true })).toBe(
      JSON.stringify(response)
    );
  });

  it("groups Tasks by phase with review first and shows ID, revision, and owner", () => {
    const output = formatSpaceTaskListOutput(
      {
        tasks: [
          task({}),
          task({
            taskId: "tsk_44444444-4444-4444-8444-444444444444",
            title: "Review the launch copy",
            phase: "in_review",
            assignee: null,
            needsHumanDecision: true,
            revision: 7,
          }),
        ],
        truncated: true,
      },
      { json: false }
    );

    expect(output.split("\n")).toEqual([
      "## In review (1)",
      "- tsk_44444444-4444-4444-8444-444444444444 r7 Review the launch copy (unassigned) [needs a human decision]",
      "## In progress (1)",
      "- tsk_33333333-3333-4333-8333-333333333333 r3 Ship the pricing page (Builder)",
      "More Tasks exist than this list shows. Narrow it with --phase.",
    ]);
  });

  it("says so when a Space has no Tasks", () => {
    expect(
      formatSpaceTaskListOutput(
        { tasks: [], truncated: false },
        { json: false }
      )
    ).toBe("No Tasks in this Space.");
  });

  it("shows the revisions a reviewer needs in the Task detail", () => {
    const response: SpaceTaskResponse = {
      task: task({
        phase: "in_review",
        description: "New tiers and FAQ.",
        completionConditions: ["Page is live"],
        result: {
          resultRevision: 2,
          summary: "Deployed and checked on mobile.",
          submittedAt: "2026-11-21T01:00:00.000Z",
          submittedBy: agent,
        },
      }),
      events: [],
      allowedActions: ["review", "cancel"],
    };

    const output = formatSpaceTaskDetailOutput(response, { json: false });

    expect(output).toContain("Phase: In review");
    expect(output).toContain("Revision: 3");
    expect(output).toContain("## Result (result revision 2)");
    expect(output).toContain("- Page is live");
    expect(output).toContain("Allowed actions: review, cancel");
  });

  it("strips terminal control sequences from Task text", () => {
    const output = formatSpaceTaskListOutput(
      { tasks: [task({ title: "Safe\u001b[31m title" })], truncated: false },
      { json: false }
    );

    expect(output).not.toContain("\u001b");
  });

  it("distinguishes an applied change from a repeated one", () => {
    const receipt = {
      task: task({ phase: "done" }),
      applied: true,
    } as SpaceTaskMutationReceipt;

    expect(formatSpaceTaskReceiptOutput(receipt, { json: false })).toContain(
      "is now Done."
    );
    expect(
      formatSpaceTaskReceiptOutput(
        { ...receipt, applied: false },
        { json: false }
      )
    ).toContain("was already up to date (Done).");
  });
});
