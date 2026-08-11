import type { CenterAgentTaskDetail } from "@openmeld/schemas/types";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalCenterAgentLauncher } from "./global-center-agent-launcher";

const getCurrentCenterAgentTaskMock = vi.hoisted(() => vi.fn());
const prefetchCenterAgentConversationMock = vi.hoisted(() => vi.fn());

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

vi.mock("./center-agent-compact-conversation", () => ({
	CenterAgentCompactConversation: ({
		organizationId,
	}: {
		organizationId: string;
	}) => (
		<section aria-label="Compact Center Agent conversation">
			Canonical conversation for {organizationId}
		</section>
	),
}));

vi.mock("./use-center-agent-conversation-intent-prefetch", () => ({
	useCenterAgentConversationIntentPrefetch: () =>
		prefetchCenterAgentConversationMock,
}));

vi.mock("#/lib/organizations/center-agent-tasks", async (importOriginal) => ({
	...(await importOriginal()),
	getCurrentCenterAgentTask: getCurrentCenterAgentTaskMock,
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

const TASK_DETAIL: CenterAgentTaskDetail = {
	attempts: [],
	events: [
		{
			actor: "center_agent",
			attemptGeneration: 1,
			id: "event-1",
			kind: "center_agent_update",
			occurredAt: "2026-08-08T01:02:00.000Z",
			taskId: "task-1",
			text: "I finished the first comparison.",
		},
	],
	task: {
		outcome: null,
		phase: "working",
		state: "active",
		activeAttemptGeneration: 1,
		createdAt: "2026-08-08T01:00:00.000Z",
		finishedAt: null,
		goal: "Compare onboarding flows.",
		id: "task-1",
		organizationId: "organization-1",
		origin: { kind: "open_meld" },
		requesterUserId: "user-1",
		status: "running",
		title: "Research onboarding flows",
		updatedAt: "2026-08-08T01:02:00.000Z",
		version: 1,
	},
};

describe("GlobalCenterAgentLauncher", () => {
	beforeEach(() => {
		getCurrentCenterAgentTaskMock.mockReset().mockResolvedValue(TASK_DETAIL);
		prefetchCenterAgentConversationMock.mockReset();
	});

	afterEach(cleanup);

	it("opens the canonical Center Agent conversation in a compact view", async () => {
		renderLauncher();

		fireEvent.click(screen.getByRole("button", { name: "Open Center Agent" }));

		expect(
			(
				await screen.findByRole("region", {
					name: "Compact Center Agent conversation",
				})
			).textContent
		).toContain("Canonical conversation for organization-1");
		expect(
			screen
				.getByRole("link", { name: "Open full Center Agent Chat" })
				.getAttribute("href")
		).toBe("/o/amplift/center-agent/chat");
		expect(
			screen.queryByRole("button", { name: "Continue in Chat" })
		).toBeNull();
	});

	it("warms the existing conversation when the launcher receives intent", () => {
		renderLauncher();

		fireEvent.pointerEnter(
			screen.getByRole("button", { name: "Open Center Agent" })
		);

		expect(prefetchCenterAgentConversationMock).toHaveBeenCalledOnce();
	});

	it("keeps the Center Agent shortcut available from a Task", async () => {
		renderLauncher("/o/amplift/center-agent/tasks/task-1");

		fireEvent.click(screen.getByRole("button", { name: "Open Center Agent" }));

		expect(
			await screen.findByRole("region", {
				name: "Compact Center Agent conversation",
			})
		).toBeTruthy();
	});

	it("hides the redundant shortcut while the full Chat is already open", () => {
		renderLauncher("/o/amplift/center-agent/chat");

		expect(
			screen.queryByRole("button", { name: "Open Center Agent" })
		).toBeNull();
	});
});

function renderLauncher(currentPathname = "/o/amplift/projects") {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	return {
		...render(
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<GlobalCenterAgentLauncher currentPathname={currentPathname} />
				</TooltipProvider>
			</QueryClientProvider>
		),
		queryClient,
	};
}
