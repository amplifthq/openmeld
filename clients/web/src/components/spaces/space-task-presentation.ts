import { formatSpaceTaskGitHubIssueLabel } from "@openmeld/schemas/schemas";
import type { SpaceMembersSnapshot, SpaceTask } from "@openmeld/schemas/types";

export type SpaceTaskMember =
	| SpaceMembersSnapshot["humans"][number]
	| SpaceMembersSnapshot["agents"][number];

export function formatSpaceTaskPhase(phase: SpaceTask["phase"]): string {
	switch (phase) {
		case "to_do":
			return "To do";
		case "in_progress":
			return "In progress";
		case "in_review":
			return "In review";
		case "done":
			return "Done";
		case "canceled":
			return "Canceled";
		default:
			return "Task";
	}
}

export function describeSpaceTaskAttention(input: {
	selfProfileId?: string;
	task: SpaceTask;
}): string {
	const task = input.task;
	if (task.needsHumanDecision) {
		return "Needs a decision after two rework rounds";
	}
	switch (task.phase) {
		case "done":
			return "Completed";
		case "canceled":
			return "Canceled";
		case "to_do": {
			if (!task.assignee) {
				return "Needs an assignee";
			}
			if (task.assignee.profileId === input.selfProfileId) {
				return "Ready for you to start";
			}
			return `Waiting for ${task.assignee.profileName} to start`;
		}
		case "in_progress": {
			if (task.assignee?.profileId === input.selfProfileId) {
				return "Submit the result when it's ready";
			}
			if (task.assignee) {
				return `${task.assignee.profileName} is advancing this`;
			}
			return "In progress";
		}
		case "in_review": {
			if (task.reviewer?.profileId === input.selfProfileId) {
				return "Ready for your review";
			}
			if (task.reviewer) {
				return `Ready for ${task.reviewer.profileName}'s review`;
			}
			return "Waiting for review";
		}
		default:
			return "Open for details";
	}
}

export function formatSpaceTaskGitHubIssueRefs(task: SpaceTask): string[] {
	return task.externalWorkItems
		.filter((item) => item.provider === "github")
		.map((item) => formatSpaceTaskGitHubIssueLabel(item));
}
