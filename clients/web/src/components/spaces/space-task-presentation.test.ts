import {
	describeLinkedGitHubIssueClosePrompt,
	spaceTaskSchema,
} from "@openmeld/schemas/schemas";
import type { SpaceTask } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { describeSpaceTaskAttention } from "./space-task-presentation";

const requester = {
	ownerUserId: "user-ming",
	profileId: "11111111-1111-4111-8111-111111111111",
	profileKind: "human" as const,
	profileName: "MingYoo",
};
const assignee = {
	ownerUserId: "user-ming",
	profileId: "agt_22222222-2222-4222-8222-222222222222",
	profileKind: "agent" as const,
	profileName: "Builder",
};
const reviewer = {
	ownerUserId: "user-riley",
	profileId: "44444444-4444-4444-8444-444444444444",
	profileKind: "human" as const,
	profileName: "Riley",
};

function createTask(overrides: Partial<SpaceTask> = {}): SpaceTask {
	return spaceTaskSchema.parse({
		assignee,
		automaticReworkRounds: 0,
		completionConditions: ["The result is reviewable"],
		createdAt: "2026-09-15T00:00:00.000Z",
		createdBy: requester,
		description: null,
		needsHumanDecision: false,
		phase: "to_do",
		requestedBy: requester,
		result: null,
		review: null,
		reviewer: null,
		revision: 1,
		sourceSignalId: "signal-1",
		spaceId: "space-1",
		taskId: "tsk_55555555-5555-4555-8555-555555555555",
		threadId: null,
		title: "Ship Tasks",
		updatedAt: "2026-09-15T00:00:00.000Z",
		...overrides,
	});
}

describe("describeSpaceTaskAttention", () => {
	it.each([
		{
			expected: "Needs an assignee",
			name: "unassigned To do",
			selfProfileId: requester.profileId,
			task: createTask({ assignee: null }),
		},
		{
			expected: "Ready for you to start",
			name: "To do assigned to the viewer",
			selfProfileId: assignee.profileId,
			task: createTask(),
		},
		{
			expected: "Waiting for Builder to start",
			name: "To do assigned to someone else",
			selfProfileId: requester.profileId,
			task: createTask(),
		},
		{
			expected: "Submit the result when it's ready",
			name: "In progress assigned to the viewer",
			selfProfileId: assignee.profileId,
			task: createTask({ phase: "in_progress" }),
		},
		{
			expected: "Builder is advancing this",
			name: "In progress assigned to someone else",
			selfProfileId: requester.profileId,
			task: createTask({ phase: "in_progress" }),
		},
		{
			expected: "Ready for your review",
			name: "In review assigned to the viewer",
			selfProfileId: reviewer.profileId,
			task: createTask({ phase: "in_review", reviewer }),
		},
		{
			expected: "Ready for Riley's review",
			name: "In review assigned to someone else",
			selfProfileId: requester.profileId,
			task: createTask({ phase: "in_review", reviewer }),
		},
		{
			expected: "Needs a decision after two rework rounds",
			name: "blocked after automatic rework",
			selfProfileId: requester.profileId,
			task: createTask({
				needsHumanDecision: true,
				phase: "in_progress",
			}),
		},
		{
			expected: "Completed",
			name: "done",
			selfProfileId: requester.profileId,
			task: createTask({ phase: "done" }),
		},
	] as const)("$name", ({ expected, selfProfileId, task }) => {
		expect(describeSpaceTaskAttention({ selfProfileId, task })).toBe(expected);
	});
});

describe("describeLinkedGitHubIssueClosePrompt", () => {
	it("asks to close still-open GitHub issues after the Task is closed", () => {
		expect(
			describeLinkedGitHubIssueClosePrompt(
				createTask({
					externalWorkItems: [
						{
							lastObservedAt: "2026-09-20T00:00:00.000Z",
							lastObservedState: "open",
							number: 1143,
							owner: "amplifthq",
							provider: "github",
							repo: "openmeld",
							url: "https://github.com/amplifthq/openmeld/issues/1143",
						},
					],
					phase: "canceled",
				})
			)
		).toBe(
			"This Task is linked to GitHub issue amplifthq/openmeld#1143. Close that issue in GitHub if the work there is finished."
		);
	});
});
