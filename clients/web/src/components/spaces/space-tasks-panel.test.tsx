import { spaceTaskSchema } from "@openmeld/schemas/schemas";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SpaceTaskDetailDrawer,
	type SpaceTaskDetailDrawerProps,
} from "./space-task-detail-drawer";
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

const detailProps: SpaceTaskDetailDrawerProps = {
	busy: false,
	commonAgentIds: new Set(),
	outsideCommonAgents: [],
	onAddAndAssign: vi.fn(),
	spaceName: "Engineering",
	detail: { task, events: [], allowedActions: ["assign"] },
	error: false,
	loading: false,
	members: [],
	onMutate: vi.fn(),
	onOpenChange: vi.fn(),
	onRefresh: vi.fn(),
	open: true,
	projects: [],
	selfProfileId: requester.profileId,
	task,
};

describe("SpaceTasksPanel", () => {
	afterEach(() => {
		cleanup();
		vi.mocked(useSpaceTasksPanelController).mockReset();
	});

	it.each([
		false,
		true,
	])("removes unavailable Task Projects even with no active choices (replacement=%s)", async (replacement) => {
		const onMutate = vi.fn(async () => true);
		const associatedTask = { ...task, projectIds: ["project-archived"] };
		render(
			<SpaceTaskDetailDrawer
				{...detailProps}
				detail={{
					task: associatedTask,
					events: [],
					allowedActions: ["set_projects"],
				}}
				onMutate={onMutate}
				projects={
					replacement
						? [
								{
									id: "project-active",
									name: "Active Project",
									slug: "active",
									organizationId: "org-acme",
									createdByUserId: "user-ming",
									createdAtMs: 1,
									updatedAtMs: 1,
									archivedAtMs: null,
									repositoryUrl: null,
									repositoryFingerprint: null,
									canManage: true,
									canArchive: true,
								},
							]
						: []
				}
				task={associatedTask}
			/>
		);
		fireEvent.click(screen.getByText("Edit Projects"));
		fireEvent.click(
			screen.getByRole("button", { name: "Remove unavailable Project" })
		);
		if (replacement) {
			fireEvent.click(screen.getByLabelText("Active Project"));
		}
		fireEvent.click(screen.getByText("Save Projects"));
		await waitFor(() =>
			expect(onMutate).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "set_projects",
					projectIds: replacement ? ["project-active"] : [],
				})
			)
		);
	});

	it.each([
		false,
		true,
	])("preserves partial Add and assign feedback when the last candidate disappears (refresh before receipt=%s)", async (refreshBeforeReceipt) => {
		let finish!: (
			result: Awaited<ReturnType<SpaceTaskDetailDrawerProps["onAddAndAssign"]>>
		) => void;
		const onAddAndAssign = vi.fn(
			() =>
				new Promise<
					Awaited<ReturnType<SpaceTaskDetailDrawerProps["onAddAndAssign"]>>
				>((resolve) => {
					finish = resolve;
				})
		);
		const unassignedTask = { ...task, assignee: null };
		const props = {
			...detailProps,
			task: unassignedTask,
			detail: {
				task: unassignedTask,
				events: [],
				allowedActions: ["assign" as const],
			},
			onAddAndAssign,
			outsideCommonAgents: [
				{
					profileId: assignee.profileId,
					profileName: assignee.profileName,
					ownerName: requester.profileName,
				},
			],
		};
		const view = render(<SpaceTaskDetailDrawer {...props} />);
		fireEvent.click(screen.getByText("Add and assign"));
		if (refreshBeforeReceipt) {
			view.rerender(
				<SpaceTaskDetailDrawer {...props} outsideCommonAgents={[]} />
			);
		}
		const message =
			"Space membership was updated, but the Task assignment did not complete. Refresh the Task and try assignment again.";
		await act(async () =>
			finish({ membership: "confirmed", assigned: false, message })
		);
		expect(screen.getByText(message)).toBeTruthy();
		expect(screen.queryByText("Common Agents outside this Space")).toBeNull();
		view.rerender(
			<SpaceTaskDetailDrawer {...props} outsideCommonAgents={[]} />
		);
		expect(screen.getByText(message)).toBeTruthy();
		const otherTask = {
			...unassignedTask,
			taskId: "tsk_66666666-6666-4666-8666-666666666666",
		};
		view.rerender(
			<SpaceTaskDetailDrawer
				{...props}
				detail={{ ...props.detail, task: otherTask }}
				outsideCommonAgents={[]}
				task={otherTask}
			/>
		);
		expect(screen.queryByText(message)).toBeNull();
	});

	it("keeps board cards compact until a card is opened for details", () => {
		vi.mocked(useSpaceTasksPanelController).mockReturnValue({
			addAndAssignTask: vi.fn(),
			commonAgentIds: new Set(),
			outsideCommonAgents: [],
			projects: [],
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
		expect(
			screen.getByText("Waiting for Amplifth Center Agent to start")
		).toBeTruthy();
		expect(screen.getByText("amplifthq/openmeld#1143")).toBeTruthy();
		expect(
			screen.queryByText(
				"This long brief should stay in the detail drawer until the card is opened."
			)
		).toBeNull();
		expect(screen.queryByText("Done when")).toBeNull();
		expect(screen.queryByRole("button", { name: "Cancel Task" })).toBeNull();

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
		expect(screen.getByRole("button", { name: "Cancel Task" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Close task details" }));
		expect(screen.queryByText("Done when")).toBeNull();
		expect(screen.queryByRole("button", { name: "Cancel Task" })).toBeNull();
	});

	it("filters this Space's Tasks by their explicit Project association", () => {
		const payments = spaceTaskSchema.parse({
			...task,
			projectIds: ["project-payments"],
			title: "Review Payments",
		});
		const platform = spaceTaskSchema.parse({
			...task,
			projectIds: ["project-platform"],
			taskId: "tsk_66666666-6666-4666-8666-666666666666",
			title: "Review Platform",
		});
		vi.mocked(useSpaceTasksPanelController).mockReturnValue({
			addAndAssignTask: vi.fn(),
			commonAgentIds: new Set(),
			outsideCommonAgents: [],
			projects: [
				{ id: "project-payments", name: "Payments" },
				{ id: "project-platform", name: "Platform" },
			],
			members: [],
			mutateTask: vi.fn(async () => true),
			pendingTaskId: null,
			detailQuery: {
				data: null,
				isError: false,
				isPending: false,
				refetch: vi.fn(),
			},
			tasksQuery: {
				data: { tasks: [payments, platform], truncated: false },
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
		fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
			target: { value: "project-platform" },
		});
		expect(screen.getByText("Review Platform")).toBeTruthy();
		expect(screen.queryByText("Review Payments")).toBeNull();
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
			addAndAssignTask: vi.fn(),
			commonAgentIds: new Set(),
			outsideCommonAgents: [],
			projects: [],
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
			screen
				.getByRole("link", { name: "Open source message" })
				.getAttribute("href")
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
