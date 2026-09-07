import type { CenterAgentTaskDetail } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CenterAgentTaskDetailPage } from "./center-agent-task-detail-page";

const continueCurrentCenterAgentTaskMock = vi.hoisted(() => vi.fn());
const getCurrentCenterAgentTaskMock = vi.hoisted(() => vi.fn());
const retryCurrentCenterAgentTaskMock = vi.hoisted(() => vi.fn());
const stopCurrentCenterAgentTaskMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/center-agent-tasks", async (importOriginal) => ({
	...(await importOriginal()),
	continueCurrentCenterAgentTask: continueCurrentCenterAgentTaskMock,
	getCurrentCenterAgentTask: getCurrentCenterAgentTaskMock,
	retryCurrentCenterAgentTask: retryCurrentCenterAgentTaskMock,
	stopCurrentCenterAgentTask: stopCurrentCenterAgentTaskMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Amplift",
			slug: "amplift",
		},
	}),
}));

const NEEDS_ATTENTION_DETAIL: CenterAgentTaskDetail = {
	attempts: [],
	events: [
		{
			actor: "requester",
			attemptGeneration: 1,
			id: "event-request",
			kind: "requester_message",
			occurredAt: "2026-08-08T01:01:00.000Z",
			taskId: "task-1",
			text: "Compare the current onboarding entry points.",
		},
		{
			actor: "center_agent",
			attemptGeneration: 1,
			id: "event-update",
			kind: "center_agent_update",
			occurredAt: "2026-08-08T01:02:00.000Z",
			taskId: "task-1",
			text: "I compared the current onboarding entry points.",
		},
		{
			actor: "center_agent",
			attemptGeneration: 1,
			id: "event-question",
			kind: "needs_attention",
			occurredAt: "2026-08-08T01:03:00.000Z",
			taskId: "task-1",
			text: "Should I include the Slack onboarding flow?",
		},
		{
			actor: "requester",
			attemptGeneration: 1,
			id: "event-stop",
			kind: "stop_requested",
			occurredAt: "2026-08-08T01:04:00.000Z",
			taskId: "task-1",
			text: "Stop requested. Waiting to confirm the current work has stopped.",
		},
	],
	task: {
		outcome: null,
		phase: "waiting",
		state: "needs_action",
		activeAttemptGeneration: 1,
		createdAt: "2026-08-08T01:00:00.000Z",
		finishedAt: null,
		goal: "Compare the current onboarding flow with three competitors.",
		id: "task-1",
		organizationId: "organization-1",
		origin: {
			destination: {
				channelId: "C07CENTER",
				connectionId: "connection-slack",
				provider: "slack",
				rootMessageId: "1786123456.000100",
				teamId: "T07OPENMELD",
			},
			kind: "message_channel",
			requestedBy: {
				displayName: "Mira",
				profileId: "human-1",
				userId: "user-1",
			},
		},
		requesterUserId: "user-1",
		status: "needs_attention",
		title: "Research onboarding flows",
		updatedAt: "2026-08-08T01:03:00.000Z",
		version: 2,
	},
};

describe("CenterAgentTaskDetailPage", () => {
	beforeEach(() => {
		getCurrentCenterAgentTaskMock
			.mockReset()
			.mockResolvedValue(NEEDS_ATTENTION_DETAIL);
		continueCurrentCenterAgentTaskMock.mockReset().mockResolvedValue({
			...NEEDS_ATTENTION_DETAIL,
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				outcome: null,
				phase: "working",
				state: "active",
				status: "running",
				version: 3,
			},
		});
		retryCurrentCenterAgentTaskMock.mockReset();
		stopCurrentCenterAgentTaskMock.mockReset();
	});

	afterEach(cleanup);

	it("keeps Task activity conversational and lets the requester answer in context", async () => {
		renderDetail();

		expect(
			await screen.findByRole("heading", { name: "Research onboarding flows" })
		).toBeTruthy();
		expect(screen.getByText("Needs action")).toBeTruthy();
		expect(
			screen.getByText("Requested by Mira · Started from Slack")
		).toBeTruthy();
		expect(
			screen.getByText(
				"Replies from this Task also return to this exact Slack destination."
			)
		).toBeTruthy();
		expect(screen.getByText("C07CENTER")).toBeTruthy();
		expect(screen.getByText("1786123456.000100")).toBeTruthy();
		expect(
			screen.getByText("I compared the current onboarding entry points.")
		).toBeTruthy();
		expect(
			screen.getByText("Should I include the Slack onboarding flow?")
		).toBeTruthy();
		const requesterMessage = screen
			.getByText("Compare the current onboarding entry points.")
			.closest('[data-slot="message"]');
		expect(requesterMessage?.getAttribute("data-align")).toBe("end");
		const centerAgentMessage = screen
			.getByText("I compared the current onboarding entry points.")
			.closest('[data-slot="message"]');
		expect(centerAgentMessage?.getAttribute("data-align")).toBe("start");
		expect(
			screen
				.getByText(
					"Stop requested. Waiting to confirm the current work has stopped."
				)
				.closest('[data-slot="task-status-event"]')
		).toBeTruthy();
		expect(
			document.querySelector(
				'[data-slot="task-conversation"] [data-slot="card"]'
			)
		).toBeNull();

		fireEvent.change(
			screen.getByRole("textbox", { name: "Message this Task" }),
			{
				target: { value: "Yes, include Slack and Lark." },
			}
		);
		expect(screen.getByText("Continue in this Task context.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(continueCurrentCenterAgentTaskMock).toHaveBeenCalledWith({
				expectedVersion: 2,
				idempotencyKey: expect.any(String),
				organizationId: "organization-1",
				taskId: "task-1",
				text: "Yes, include Slack and Lark.",
			});
		});
	});

	it("keeps the shared conversation composer after success and renders agent Markdown", async () => {
		const succeededDetail: CenterAgentTaskDetail = {
			...NEEDS_ATTENTION_DETAIL,
			events: [
				...NEEDS_ATTENTION_DETAIL.events,
				{
					actor: "center_agent",
					attemptGeneration: 1,
					id: "event-success",
					kind: "task_succeeded",
					occurredAt: "2026-08-08T01:05:00.000Z",
					taskId: "task-1",
					text: "**Finished** the comparison.",
				},
			],
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				finishedAt: "2026-08-08T01:05:00.000Z",
				outcome: "completed",
				phase: null,
				state: "finished",
				status: "succeeded",
				version: 4,
			},
		};
		getCurrentCenterAgentTaskMock.mockResolvedValue(succeededDetail);
		renderDetail();

		const finished = await screen.findByText("Finished");
		expect(finished.tagName).toBe("STRONG");
		const composer = screen.getByRole("textbox", {
			name: "Message this Task",
		});
		fireEvent.change(composer, {
			target: { value: "Turn this into a launch plan." },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(continueCurrentCenterAgentTaskMock).toHaveBeenCalledWith({
				expectedVersion: 4,
				idempotencyKey: expect.any(String),
				organizationId: "organization-1",
				taskId: "task-1",
				text: "Turn this into a launch plan.",
			});
		});
	});

	it.each([
		"queued",
		"running",
	] as const)("confirms before a %s Task replaces its current instruction", async (status) => {
		const activeDetail: CenterAgentTaskDetail = {
			...NEEDS_ATTENTION_DETAIL,
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				activeAttemptGeneration: status === "queued" ? null : 1,
				status,
			},
		};
		getCurrentCenterAgentTaskMock.mockResolvedValue(activeDetail);
		renderDetail();

		fireEvent.change(
			await screen.findByRole("textbox", {
				name: "Message this Task",
			}),
			{
				target: { value: "Focus on enterprise onboarding instead." },
			}
		);
		expect(
			screen.getByText("A new instruction replaces the work in progress.")
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		expect(continueCurrentCenterAgentTaskMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("alertdialog", {
				name: "Replace the current instruction?",
			})
		).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", {
				name: "Stop work and start new attempt",
			})
		);

		await waitFor(() => {
			expect(continueCurrentCenterAgentTaskMock).toHaveBeenCalledWith({
				expectedVersion: 2,
				idempotencyKey: expect.any(String),
				organizationId: "organization-1",
				taskId: "task-1",
				text: "Focus on enterprise onboarding instead.",
			});
		});
	});

	it("asks before stopping active work and sends the current Task version", async () => {
		stopCurrentCenterAgentTaskMock.mockResolvedValue({
			...NEEDS_ATTENTION_DETAIL,
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				finishedAt: "2026-08-08T01:05:00.000Z",
				outcome: "stopped",
				phase: null,
				state: "finished",
				status: "stopped",
				version: 3,
			},
		});
		renderDetail();

		fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
		expect(stopCurrentCenterAgentTaskMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("alertdialog", { name: "Stop this Task?" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Stop Task" }));

		await waitFor(() => {
			expect(stopCurrentCenterAgentTaskMock).toHaveBeenCalledWith({
				expectedVersion: 2,
				organizationId: "organization-1",
				taskId: "task-1",
			});
		});
	});

	it("shows an honest stopping state without accepting another command", async () => {
		getCurrentCenterAgentTaskMock.mockResolvedValue({
			...NEEDS_ATTENTION_DETAIL,
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				phase: "stopping",
				state: "active",
				status: "stopping",
				version: 3,
			},
		});
		renderDetail();

		expect(await screen.findByText("Stopping")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
	});

	it("offers Retry instead of a composer after a failed attempt", async () => {
		const failedDetail: CenterAgentTaskDetail = {
			...NEEDS_ATTENTION_DETAIL,
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				finishedAt: "2026-08-08T01:05:00.000Z",
				outcome: "failed",
				phase: null,
				state: "finished",
				status: "failed",
				version: 4,
			},
		};
		getCurrentCenterAgentTaskMock.mockResolvedValue(failedDetail);
		retryCurrentCenterAgentTaskMock.mockResolvedValue({
			...failedDetail,
			task: {
				...failedDetail.task,
				finishedAt: null,
				outcome: null,
				phase: "working",
				state: "active",
				status: "running",
				version: 5,
			},
		});
		renderDetail();

		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		expect(
			screen.queryByRole("textbox", { name: "Message this Task" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
		await waitFor(() => {
			expect(retryCurrentCenterAgentTaskMock).toHaveBeenCalledWith({
				expectedVersion: 4,
				idempotencyKey: expect.any(String),
				organizationId: "organization-1",
				taskId: "task-1",
			});
		});
	});

	it("starts a new Task instead of retrying a Task Context that reached its history limit", async () => {
		const failedDetail: CenterAgentTaskDetail = {
			...NEEDS_ATTENTION_DETAIL,
			attempts: [
				{
					createdAt: "2026-08-08T01:00:00.000Z",
					failureCode: "remote_agent.conversation_history_limit_exceeded",
					finishedAt: "2026-08-08T01:05:00.000Z",
					generation: 1,
					id: "attempt-1",
					startedAt: "2026-08-08T01:00:01.000Z",
					status: "failed",
					taskHandle: {
						deliveryId: "delivery-1",
						kind: "native_delivery",
						v: 1,
					},
					taskId: "task-1",
				},
			],
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				finishedAt: "2026-08-08T01:05:00.000Z",
				outcome: "failed",
				phase: null,
				state: "finished",
				status: "failed",
				version: 4,
			},
		};
		getCurrentCenterAgentTaskMock.mockResolvedValue(failedDetail);
		renderDetail();

		const action = await screen.findByRole("link", {
			name: "Start a new Task",
		});
		expect(action.getAttribute("href")).toBe("/o/amplift/chats/center-agent");
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(retryCurrentCenterAgentTaskMock).not.toHaveBeenCalled();
	});

	it("offers Retry after the requester stops a Task", async () => {
		const stoppedDetail: CenterAgentTaskDetail = {
			...NEEDS_ATTENTION_DETAIL,
			task: {
				...NEEDS_ATTENTION_DETAIL.task,
				finishedAt: "2026-08-08T01:05:00.000Z",
				outcome: "stopped",
				phase: null,
				state: "finished",
				status: "stopped",
				version: 4,
			},
		};
		getCurrentCenterAgentTaskMock.mockResolvedValue(stoppedDetail);
		retryCurrentCenterAgentTaskMock.mockResolvedValue({
			...stoppedDetail,
			task: {
				...stoppedDetail.task,
				finishedAt: null,
				outcome: null,
				phase: "working",
				state: "active",
				status: "running",
				version: 5,
			},
		});
		renderDetail();

		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await waitFor(() => {
			expect(retryCurrentCenterAgentTaskMock).toHaveBeenCalledWith({
				expectedVersion: 4,
				idempotencyKey: expect.any(String),
				organizationId: "organization-1",
				taskId: "task-1",
			});
		});
	});
});

function renderDetail() {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<CenterAgentTaskDetailPage taskId="task-1" />
		</QueryClientProvider>
	);
}
