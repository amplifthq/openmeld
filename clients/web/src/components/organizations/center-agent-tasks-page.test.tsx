import { resolveCenterAgentTaskPresentation } from "@openmeld/schemas";
import type {
	CenterAgentTask,
	CenterAgentTaskStatus,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CenterAgentTasksPage } from "./center-agent-tasks-page";

const listCurrentCenterAgentTasksMock = vi.hoisted(() => vi.fn());
const PAUSE_COMPETITIVE_RESEARCH_PATTERN = /Pause competitive research/;
const PREPARE_LAUNCH_BRIEF_PATTERN = /Prepare launch brief/;
const RESEARCH_SCOPE_PATTERN = /Choose the research scope/;
const REVIEW_ONBOARDING_PATTERN = /Review onboarding flow/;

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
	listCurrentCenterAgentTasks: listCurrentCenterAgentTasksMock,
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

describe("CenterAgentTasksPage", () => {
	beforeEach(() => {
		listCurrentCenterAgentTasksMock.mockReset().mockResolvedValue({
			nextCursor: null,
			organizationId: "organization-1",
			tasks: [
				createTask("queued", "Prepare launch brief", "task-queued"),
				createTask("stopping", "Pause competitive research", "task-stopping"),
				createTask(
					"needs_attention",
					"Choose the research scope",
					"task-attention"
				),
				createTask("failed", "Review onboarding flow", "task-failed"),
			],
		});
	});

	afterEach(cleanup);

	it("groups canonical Task states into three calm, read-only columns", async () => {
		renderPage();

		expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
		expect(await screen.findByRole("heading", { name: "Active" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Needs action" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Finished" })).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: PREPARE_LAUNCH_BRIEF_PATTERN })
				.getAttribute("href")
		).toBe("/o/amplift/center-agent/tasks/task-queued");
		expect(
			screen.getByRole("link", { name: PREPARE_LAUNCH_BRIEF_PATTERN })
				.textContent
		).toContain("Requested by Mira · Started in OpenMeld via Codex");
		expect(
			screen.getByRole("link", {
				name: PAUSE_COMPETITIVE_RESEARCH_PATTERN,
			}).textContent
		).toContain("Stopping");
		expect(
			screen.getByRole("link", { name: RESEARCH_SCOPE_PATTERN }).textContent
		).toContain("Needs action");
		expect(
			screen.getByRole("link", { name: REVIEW_ONBOARDING_PATTERN }).textContent
		).toContain("Failed");
		expect(
			document.querySelectorAll('[data-slot="shared-layout-group"]')
		).toHaveLength(3);
		const taskCard = screen
			.getByRole("link", { name: PREPARE_LAUNCH_BRIEF_PATTERN })
			.querySelector('[data-slot="card"]');
		expect(taskCard?.className).toContain("border");
		expect(taskCard?.className).toContain("ring-0");
		expect(screen.queryByText("Drag")).toBeNull();
	});
});

function renderPage() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<CenterAgentTasksPage />
		</QueryClientProvider>
	);
}

function createTask(
	status: CenterAgentTaskStatus,
	title: string,
	id: string
): CenterAgentTask {
	const terminal =
		status === "failed" || status === "stopped" || status === "succeeded";
	return {
		...resolveCenterAgentTaskPresentation(status),
		activeAttemptGeneration: status === "queued" ? null : 1,
		createdAt: "2026-08-08T01:00:00.000Z",
		finishedAt: terminal ? "2026-08-08T01:05:00.000Z" : null,
		goal: `${title} and return a concise result.`,
		id,
		organizationId: "organization-1",
		origin: {
			kind: "open_meld",
			localAgent: { client: "codex", kind: "local_agent" },
			requestedBy: {
				displayName: "Mira",
				profileId: "human-1",
				userId: "user-1",
			},
		},
		requesterUserId: "user-1",
		status,
		title,
		updatedAt: "2026-08-08T01:03:00.000Z",
		version: 1,
	};
}
