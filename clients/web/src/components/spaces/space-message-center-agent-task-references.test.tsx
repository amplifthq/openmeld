import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceMessageCenterAgentTaskReferences } from "./space-message-center-agent-task-references";

const useQueriesMock = vi.hoisted(() => vi.fn());
const OPEN_TASK_LINK_NAME_PATTERN = /Open Task/i;

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);
	return {
		...actual,
		useQueries: useQueriesMock,
	};
});

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: {
			id: "org-1",
			slug: "acme",
		},
	}),
}));

describe("SpaceMessageCenterAgentTaskReferences", () => {
	afterEach(() => {
		cleanup();
		useQueriesMock.mockReset();
	});

	it("renders canonical Task status and links to the conversation-first detail", () => {
		useQueriesMock.mockReturnValue([
			{
				data: {
					task: {
						goal: "Compare the three research approaches.",
						id: "task-1",
						outcome: null,
						phase: "waiting",
						state: "needs_action",
						status: "needs_attention",
						title: "Research competitor workflows",
						origin: {
							kind: "open_meld",
							localAgent: { client: "codex", kind: "local_agent" },
							requestedBy: {
								displayName: "Mira",
								profileId: "human-1",
								userId: "user-1",
							},
						},
					},
				},
				isPending: false,
			},
		]);

		render(
			<SpaceMessageCenterAgentTaskReferences
				references={[{ taskId: "task-1" }]}
			/>
		);

		expect(screen.getByText("Research competitor workflows")).toBeTruthy();
		expect(screen.getByText("Needs action")).toBeTruthy();
		expect(
			screen.getByText("Requested by Mira · Started in OpenMeld via Codex")
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: OPEN_TASK_LINK_NAME_PATTERN })
				.getAttribute("href")
		).toBe("/o/acme/center-agent/tasks/task-1");
		const card = screen
			.getByRole("link", { name: OPEN_TASK_LINK_NAME_PATTERN })
			.querySelector('[data-slot="card"]');
		expect(card?.className).toContain("border");
		expect(card?.className).toContain("ring-0");
		expect(
			document.querySelector('[data-slot="shared-layout-item"]')?.className
		).toContain("bg-card");
		expect(
			document.querySelector('[data-slot="shared-layout-group"]')
		).toBeTruthy();
	});
});
