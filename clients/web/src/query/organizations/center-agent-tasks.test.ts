import { describe, expect, it, vi } from "vitest";
import {
	CENTER_AGENT_TASK_ACTIVE_POLL_INTERVAL_MS,
	CENTER_AGENT_TASK_LIST_POLL_INTERVAL_MS,
	centerAgentTaskDetailQueryOptions,
	centerAgentTaskQueryKeys,
	centerAgentTasksInfiniteQueryOptions,
} from "./center-agent-tasks";

vi.mock("#/lib/organizations/center-agent-tasks", () => ({
	getCurrentCenterAgentTask: vi.fn(),
	listCurrentCenterAgentTasks: vi.fn(),
}));

const RUNNING_DETAIL = {
	attempts: [],
	events: [],
	task: {
		activeAttemptGeneration: 1,
		createdAt: "2026-08-08T01:00:00.000Z",
		finishedAt: null,
		goal: "Compare onboarding flows.",
		id: "task-1",
		organizationId: "organization-1",
		origin: { kind: "open_meld" as const },
		requesterUserId: "user-1",
		status: "running" as const,
		title: "Research onboarding",
		updatedAt: "2026-08-08T01:01:00.000Z",
		version: 2,
	},
};

describe("Center Agent Task queries", () => {
	it("keeps list and detail cache entries scoped to the current organization", () => {
		expect(centerAgentTaskQueryKeys.list("organization-1")).toEqual([
			"center-agent-tasks",
			"organization-1",
			"list",
		]);
		expect(centerAgentTaskQueryKeys.detail("organization-1", "task-1")).toEqual(
			["center-agent-tasks", "organization-1", "detail", "task-1"]
		);
		expect(
			centerAgentTaskQueryKeys.detail("organization-2", "task-1")
		).not.toEqual(centerAgentTaskQueryKeys.detail("organization-1", "task-1"));
		expect(
			centerAgentTaskQueryKeys.list("organization-1", "needs_attention")
		).toEqual([
			"center-agent-tasks",
			"organization-1",
			"list",
			{ status: "needs_attention" },
		]);
		expect(
			centerAgentTaskQueryKeys.list("organization-1", "needs_attention")
		).not.toEqual(centerAgentTaskQueryKeys.list("organization-1"));
	});

	it("refreshes the board while open and stops detail polling after a terminal outcome", () => {
		const list = centerAgentTasksInfiniteQueryOptions({
			enabled: true,
			organizationId: "organization-1",
		});
		const detail = centerAgentTaskDetailQueryOptions({
			enabled: true,
			organizationId: "organization-1",
			taskId: "task-1",
		});
		const resolveDetailInterval = detail.refetchInterval;
		if (typeof resolveDetailInterval !== "function") {
			throw new TypeError(
				"Expected the Task detail poll interval to be state-aware."
			);
		}

		expect(list.refetchInterval).toBe(CENTER_AGENT_TASK_LIST_POLL_INTERVAL_MS);
		expect(list.refetchOnWindowFocus).toBe(true);
		expect(
			resolveDetailInterval({ state: { data: RUNNING_DETAIL } } as never)
		).toBe(CENTER_AGENT_TASK_ACTIVE_POLL_INTERVAL_MS);
		expect(
			resolveDetailInterval({
				state: {
					data: {
						...RUNNING_DETAIL,
						task: {
							...RUNNING_DETAIL.task,
							finishedAt: "2026-08-08T01:05:00.000Z",
							status: "succeeded",
						},
					},
				},
			} as never)
		).toBe(false);
	});
});
