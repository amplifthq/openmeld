import { spaceTaskSchema } from "@openmeld/schemas/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spaceTaskQueryKeys } from "#/query/spaces/space-tasks";
import {
	SpaceMessageTaskReference,
	SpaceTaskReferencesProvider,
} from "./space-task-references";
import { SpaceTasksPanel } from "./space-tasks-panel";
import { useSpaceTasksPanelController } from "./use-space-tasks-panel-controller";

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
	profileName: "Amplifth Center Agent",
};

const task = spaceTaskSchema.parse({
	assignee,
	automaticReworkRounds: 0,
	completionConditions: [
		"The issue is assessed on the product side",
		"MingYoo confirms the flow in the Space",
	],
	createdAt: "2026-09-15T00:00:00.000Z",
	createdBy: requester,
	description:
		"This long brief should stay in the detail drawer until the card is opened.",
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
	threadId: "thread-1",
	title: "Follow the GitHub issue linkage",
	updatedAt: "2026-09-15T00:00:00.000Z",
	externalWorkItems: [
		{
			lastObservedAt: "2026-09-15T00:00:00.000Z",
			lastObservedState: "open",
			number: 1143,
			owner: "amplifthq",
			provider: "github",
			repo: "openmeld",
			url: "https://github.com/amplifthq/openmeld/issues/1143",
		},
	],
});

vi.mock("./use-space-tasks-panel-controller", () => ({
	useSpaceTasksPanelController: vi.fn(),
}));

describe("SpaceTasksPanel", () => {
	afterEach(() => {
		cleanup();
		vi.mocked(useSpaceTasksPanelController).mockReset();
	});

	it("preserves every task on one message and opens the exact selected task", () => {
		const client = new QueryClient();
		const second = {
			...task,
			taskId: "tsk_66666666-6666-4666-8666-666666666666",
			title: "Finished follow-up",
			phase: "done" as const,
		};
		client.setQueryData(spaceTaskQueryKeys.list("space-1"), {
			tasks: [task, second],
			truncated: false,
		});
		const onOpen = vi.fn();
		render(
			<QueryClientProvider client={client}>
				<SpaceTaskReferencesProvider
					disabled={false}
					onOpen={onOpen}
					profileId={requester.profileId}
					spaceId="space-1"
				>
					<SpaceMessageTaskReference signalId="signal-1" />
				</SpaceTaskReferencesProvider>
			</QueryClientProvider>
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Open task: Follow the GitHub issue linkage",
			})
		);
		expect(onOpen).toHaveBeenLastCalledWith(task.taskId);
		fireEvent.click(
			screen.getByRole("button", { name: "Open task: Finished follow-up" })
		);
		expect(onOpen).toHaveBeenLastCalledWith(second.taskId);
		expect(screen.getByText("Task · To do")).toBeTruthy();
		expect(screen.getByText("Task · Done")).toBeTruthy();
	});

	it.each([
		false,
		true,
	])("gates creation by active membership (%s), while opening a task outside the board list", (isMember) => {
		vi.mocked(useSpaceTasksPanelController).mockReturnValue({
			members: isMember ? [requester] : [],
			mutateTask: vi.fn(),
			pendingTaskId: null,
			detailQuery: {
				data: { task, events: [], allowedActions: [] },
				isPending: false,
			},
			tasksQuery: { data: { tasks: [], truncated: false }, isPending: false },
		} as unknown as ReturnType<typeof useSpaceTasksPanelController>);
		render(
			<SpaceTasksPanel
				membersSnapshot={null}
				onSelectTask={vi.fn()}
				openMeldProfileId={requester.profileId}
				selectedTaskId={task.taskId}
				spaceId="space-1"
			/>
		);
		expect(
			Boolean(screen.queryByRole("button", { name: "New task", hidden: true }))
		).toBe(isMember);
		expect(screen.getByTestId("space-task-detail-drawer")).toBeTruthy();
		expect(
			screen.getByText(task.description ?? "Missing description")
		).toBeTruthy();
	});

	it("keeps board cards compact until a card is opened for details", () => {
		vi.mocked(useSpaceTasksPanelController).mockReturnValue({
			members: [],
			mutateTask: vi.fn(async () => true),
			pendingTaskId: null,
			detailQuery: {
				data: {
					task,
					events: [],
					allowedActions: ["assign", "set_reviewer", "update_brief", "cancel"],
				},
				isError: false,
				isPending: false,
				refetch: vi.fn(),
			},
			tasksQuery: {
				data: { tasks: [task], truncated: false },
				isError: false,
				isPending: false,
				refetch: vi.fn(),
			},
		} as unknown as ReturnType<typeof useSpaceTasksPanelController>);

		render(
			<SpaceTasksPanel
				membersSnapshot={null}
				openMeldProfileId={requester.profileId}
				spaceId="space-1"
			/>
		);

		expect(
			screen.getByRole("button", {
				name: "Open details for Follow the GitHub issue linkage",
			})
		).toBeTruthy();
		expect(screen.getByText("Amplifth Center Agent")).toBeTruthy();
		expect(screen.getByText("amplifthq/openmeld#1143")).toBeTruthy();
		expect(
			screen.queryByText(
				"This long brief should stay in the detail drawer until the card is opened."
			)
		).toBeNull();
		expect(screen.queryByText("Done when")).toBeNull();
		expect(screen.queryByRole("button", { name: "Cancel task" })).toBeNull();

		fireEvent.click(
			screen.getByRole("button", {
				name: "Open details for Follow the GitHub issue linkage",
			})
		);

		expect(screen.getByTestId("space-task-detail-drawer")).toBeTruthy();
		expect(
			screen.getByText(
				"This long brief should stay in the detail drawer until the card is opened."
			)
		).toBeTruthy();
		expect(screen.getByText("Done when")).toBeTruthy();
		expect(
			screen.getByText("The issue is assessed on the product side")
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "amplifthq/openmeld#1143" })
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel task" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Close task details" }));
		expect(screen.queryByText("Done when")).toBeNull();
		expect(screen.queryByRole("button", { name: "Cancel task" })).toBeNull();
	});

	it("lets a Space owner resume an Agent-requested Task and reach its source message", () => {
		const ownerTask = spaceTaskSchema.parse({
			...task,
			requestedBy: assignee,
			threadId: null,
			phase: "in_review",
			needsHumanDecision: true,
			automaticReworkRounds: 2,
			reviewer: {
				ownerUserId: "user-qa",
				profileId: "agt_33333333-3333-4333-8333-333333333333",
				profileKind: "agent",
				profileName: "QA Agent",
			},
			result: {
				resultRevision: 8,
				summary: "A patch was submitted.",
				submittedAt: "2026-09-15T01:00:00.000Z",
				submittedBy: assignee,
			},
			review: {
				decision: "changes_requested",
				feedback: "The registration flow still fails on retry.",
				resultRevision: 8,
				reviewedAt: "2026-09-15T02:00:00.000Z",
				reviewedBy: {
					ownerUserId: "user-qa",
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					profileKind: "agent",
					profileName: "QA Agent",
				},
			},
		});
		const mutateTask = vi.fn(async () => true);
		vi.mocked(useSpaceTasksPanelController).mockReturnValue({
			members: [],
			mutateTask,
			pendingTaskId: null,
			detailQuery: {
				data: {
					task: ownerTask,
					events: [],
					allowedActions: ["continue_rework", "cancel"],
					pendingActions: [
						{
							kind: "handoff",
							state: "failed",
							error: "OpenMeld will retry automatically.",
						},
					],
				},
				isError: false,
				isPending: false,
				refetch: vi.fn(),
			},
			tasksQuery: {
				data: { tasks: [ownerTask], truncated: false },
				isError: false,
				isPending: false,
				refetch: vi.fn(),
			},
		} as unknown as ReturnType<typeof useSpaceTasksPanelController>);
		render(
			<SpaceTasksPanel
				membersSnapshot={null}
				openMeldProfileId={requester.profileId}
				spaceId="space-1"
			/>
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Open details for Follow the GitHub issue linkage",
			})
		);
		expect(
			screen.getByText("The registration flow still fails on retry.")
		).toBeTruthy();
		expect(screen.getByText("OpenMeld will retry automatically.")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "View message" }).getAttribute("href")
		).toContain("focusSignalId=signal-1");
		fireEvent.click(
			screen.getByRole("button", { name: "Authorize another correction" })
		);
		expect(mutateTask).toHaveBeenCalledWith(
			ownerTask.taskId,
			expect.objectContaining({
				action: "continue_rework",
				expectedRevision: ownerTask.revision,
			})
		);
	});
});
