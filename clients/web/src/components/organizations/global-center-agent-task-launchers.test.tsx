import { resolveCenterAgentTaskPresentation } from "@openmeld/schemas";
import type {
	CenterAgentTask,
	CenterAgentTaskDetail,
} from "@openmeld/schemas/types";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
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
import { GlobalCenterAgentTaskLaunchers } from "./global-center-agent-launcher";

const getCurrentCenterAgentTaskMock = vi.hoisted(() => vi.fn());
const listCurrentCenterAgentTasksMock = vi.hoisted(() => vi.fn());
const continueCurrentCenterAgentTaskMock = vi.hoisted(() => vi.fn());

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
	useNavigate: () => vi.fn(),
}));

vi.mock("#/lib/organizations/center-agent-tasks", async (importOriginal) => ({
	...(await importOriginal()),
	continueCurrentCenterAgentTask: continueCurrentCenterAgentTaskMock,
	getCurrentCenterAgentTask: getCurrentCenterAgentTaskMock,
	listCurrentCenterAgentTasks: listCurrentCenterAgentTasksMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: {
			id: "organization-1",
			name: "Amplift",
			slug: "amplift",
		},
	}),
}));

const ACTIVE_TASK = createTask("running", "Research pricing", "task-active");
const ATTENTION_TASK = createTask(
	"needs_attention",
	"Choose launch market",
	"task-attention"
);

describe("GlobalCenterAgentTaskLaunchers", () => {
	beforeEach(() => {
		listCurrentCenterAgentTasksMock.mockReset().mockResolvedValue({
			nextCursor: null,
			organizationId: "organization-1",
			tasks: [ACTIVE_TASK, ATTENTION_TASK],
		});
		getCurrentCenterAgentTaskMock
			.mockReset()
			.mockImplementation(async ({ taskId }) =>
				createDetail(
					taskId === ATTENTION_TASK.id ? ATTENTION_TASK : ACTIVE_TASK
				)
			);
		continueCurrentCenterAgentTaskMock
			.mockReset()
			.mockImplementation(async ({ taskId }) =>
				createDetail(
					taskId === ATTENTION_TASK.id ? ATTENTION_TASK : ACTIVE_TASK
				)
			);
	});

	afterEach(cleanup);

	it("renders a horizontally scrollable Task strip with only a Needs action dot", async () => {
		renderLaunchers();

		const active = await screen.findByRole("button", {
			name: "Open Task Research pricing",
		});
		const attention = screen.getByRole("button", {
			name: "Open Task Choose launch market, Needs action",
		});
		expect(active.textContent).toBe("Research pricing");
		expect(attention.textContent).toBe("Choose launch market");
		expect(active.className).not.toContain("flex-1");
		expect(active.parentElement?.className).toContain("w-fit");
		expect(
			document.querySelectorAll('[data-slot="task-attention-indicator"]')
		).toHaveLength(1);
		expect(screen.queryByText("In progress")).toBeNull();

		const strip = screen.getByRole("group", { name: "Open Tasks" });
		expect(strip.className).toContain("overflow-x-auto");
		Object.defineProperty(strip, "clientWidth", {
			configurable: true,
			value: 160,
		});
		Object.defineProperty(strip, "scrollWidth", {
			configurable: true,
			value: 480,
		});
		fireEvent.wheel(strip, { deltaY: 80 });
		expect(strip.scrollLeft).toBe(80);
	});

	it("opens one canonical Task preview and can close its shortcut", async () => {
		renderLaunchers();

		fireEvent.click(
			await screen.findByRole("button", { name: "Open Task Research pricing" })
		);
		expect(
			await screen.findByRole("heading", { name: "Research pricing" })
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open full Task" }).getAttribute("href")
		).toBe("/o/amplift/center-agent/tasks/task-active");

		fireEvent.click(
			screen.getByRole("button", { name: "Close Research pricing shortcut" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: "Open Task Research pricing" })
			).toBeNull();
		});
	});

	it("uses the canonical Task conversation and sends from the compact window", async () => {
		renderLaunchers();

		fireEvent.click(
			await screen.findByRole("button", {
				name: "Open Task Choose launch market, Needs action",
			})
		);
		expect(
			await screen.findByRole("heading", { name: "Choose launch market" })
		).toBeTruthy();
		expect(screen.getByText("Latest canonical Task update.")).toBeTruthy();
		expect(screen.queryByText("Latest update")).toBeNull();
		expect(
			screen.queryByText("Refreshes automatically while this window is open.")
		).toBeNull();

		fireEvent.change(
			screen.getByRole("textbox", { name: "Message this Task" }),
			{ target: { value: "Choose Canada." } }
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() => {
			expect(continueCurrentCenterAgentTaskMock).toHaveBeenCalledWith({
				expectedVersion: 1,
				idempotencyKey: expect.any(String),
				organizationId: "organization-1",
				taskId: "task-attention",
				text: "Choose Canada.",
			});
		});
	});

	it("keeps a finished Task shortcut until the requester closes it", async () => {
		const finishedTask = {
			...createTask("succeeded", "Research pricing", "task-active"),
			finishedAt: "2026-08-08T01:05:00.000Z",
		};
		const { queryClient } = renderLaunchers();
		await screen.findByRole("button", { name: "Open Task Research pricing" });

		listCurrentCenterAgentTasksMock.mockResolvedValue({
			nextCursor: null,
			organizationId: "organization-1",
			tasks: [finishedTask, ATTENTION_TASK],
		});
		await queryClient.invalidateQueries({
			queryKey: ["center-agent-tasks", "organization-1", "list"],
		});

		expect(
			await screen.findByRole("button", { name: "Open Task Research pricing" })
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Close Research pricing shortcut" })
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: "Open Task Research pricing" })
			).toBeNull();
		});
	});

	it("hides the shortcut for the Task whose full detail is already open", async () => {
		renderLaunchers("/o/amplift/center-agent/tasks/task-active");

		await screen.findByRole("button", {
			name: "Open Task Choose launch market, Needs action",
		});
		expect(
			screen.queryByRole("button", { name: "Open Task Research pricing" })
		).toBeNull();
	});
});

function renderLaunchers(currentPathname = "/o/amplift/projects") {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	return {
		...render(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<GlobalCenterAgentTaskLaunchers currentPathname={currentPathname} />
				</TooltipProvider>
			</QueryClientProvider>
		),
		queryClient,
	};
}

function createTask(
	status: CenterAgentTask["status"],
	title: string,
	id: string
): CenterAgentTask {
	const presentation = resolveCenterAgentTaskPresentation(status);
	return {
		...presentation,
		activeAttemptGeneration: 1,
		createdAt: "2026-08-08T01:00:00.000Z",
		finishedAt: null,
		goal: `${title} and return a concise result.`,
		id,
		organizationId: "organization-1",
		origin: { kind: "open_meld" },
		requesterUserId: "user-1",
		status,
		title,
		updatedAt: "2026-08-08T01:03:00.000Z",
		version: 1,
	};
}

function createDetail(task: CenterAgentTask): CenterAgentTaskDetail {
	return {
		attempts: [],
		events: [
			{
				actor: "center_agent",
				attemptGeneration: 1,
				id: `event-${task.id}`,
				kind:
					task.state === "needs_action"
						? "needs_attention"
						: "center_agent_update",
				occurredAt: "2026-08-08T01:03:00.000Z",
				taskId: task.id,
				text: "Latest canonical Task update.",
			},
		],
		task,
	};
}
