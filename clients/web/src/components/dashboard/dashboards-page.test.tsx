import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardsPage } from "./dashboards-page";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	mutate: vi.fn(),
	issues: vi.fn(),
}));
vi.mock("#/lib/organizations/dashboards", () => ({
	listCurrentDashboards: mocks.list,
	mutateCurrentDashboards: mocks.mutate,
}));
vi.mock("#/lib/organizations/inbox-github-issues", () => ({
	listCurrentGitHubInboxIssues: mocks.issues,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Link: ({ children }: { children: React.ReactNode }) => (
		<a href="/dashboard">{children}</a>
	),
}));

const time = "2026-11-25T12:00:00.000Z";
const item = {
	canManage: false,
	createdAt: time,
	artifact: null,
	hasArtifact: false,
	id: "dash-1",
	kind: "github_issues",
	name: "Engineering",
	repository: "example/project",
	updatedAt: time,
};

function renderDashboard(
	props: Partial<React.ComponentProps<typeof DashboardsPage>> = {}
) {
	const client = new QueryClient();
	return {
		client,
		...render(
			<QueryClientProvider client={client}>
				<DashboardsPage
					accountId="reader"
					organizationId="org-1"
					orgSlug="example"
					{...props}
				/>
			</QueryClientProvider>
		),
	};
}

describe("workspace Dashboards", () => {
	beforeEach(() => {
		mocks.list.mockReset();
		mocks.mutate.mockReset();
		mocks.issues.mockReset();
	});
	afterEach(cleanup);

	it("opens a Center Agent draft without saving it until explicit submission", async () => {
		mocks.list.mockResolvedValue({ dashboards: [], organizationId: "org-1" });
		mocks.mutate.mockResolvedValue({ dashboards: [], organizationId: "org-1" });
		renderDashboard({ prefill: { kind: "traffic", name: "Traffic overview" } });
		const create = await screen.findByRole("button", {
			name: "Create dashboard",
		});
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Traffic overview"
		);
		expect(mocks.mutate).not.toHaveBeenCalled();
		fireEvent.click(create);
		await waitFor(() =>
			expect(mocks.mutate).toHaveBeenCalledWith({
				mutation: {
					kind: "traffic",
					name: "Traffic overview",
					operation: "create",
					artifact: null,
				},
				organizationId: "org-1",
			})
		);
	});

	it.each([
		false,
		true,
	])("preserves a dashboard draft on a background refresh error (editing existing: %s)", async (existing) => {
		const editable = {
			...item,
			canManage: true,
			kind: "traffic",
			repository: null,
		};
		const snapshot = {
			dashboards: existing ? [editable] : [],
			organizationId: "org-1",
		};
		mocks.list.mockResolvedValue(snapshot);
		const { client } = renderDashboard({ id: existing ? item.id : undefined });
		fireEvent.click(
			await screen.findByRole("button", {
				name: existing ? "Edit dashboard" : "New dashboard",
			})
		);
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Unsubmitted changes" },
		});
		mocks.list.mockRejectedValueOnce(new Error("Temporary transport error"));
		await act(async () => {
			await client.invalidateQueries({ queryKey: ["organization-dashboards"] });
		});
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Dashboards couldn’t be loaded"
		);
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Unsubmitted changes"
		);
		expect(
			(
				screen.getByRole("button", {
					name: existing ? "Save changes" : "Create dashboard",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Unsubmitted changes"
		);
	});

	it("reads the selected repository, filters by status and assignee, and never writes to GitHub", async () => {
		mocks.list.mockResolvedValue({
			dashboards: [item],
			organizationId: "org-1",
		});
		mocks.issues.mockResolvedValue({
			result: {
				status: "ready",
				partial: false,
				issues: [
					{
						id: 94,
						number: 5,
						title: "Review release",
						repository: item.repository,
						url: "https://github.com/example/project/issues/5",
						state: "open",
						createdAt: time,
						updatedAt: time,
						assignees: ["reviewer"],
					},
				],
			},
		});
		renderDashboard({ id: item.id });
		const sourceLink = await screen.findByRole("link", {
			name: "Open in GitHub",
		});
		expect(sourceLink.getAttribute("href")).toBe(
			"https://github.com/example/project/issues/5"
		);
		expect(screen.queryByRole("button", { name: "Edit dashboard" })).toBeNull();
		fireEvent.change(screen.getByLabelText("Status"), {
			target: { value: "closed" },
		});
		fireEvent.change(screen.getByLabelText("Assignee"), {
			target: { value: "reviewer" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
		await waitFor(() =>
			expect(mocks.issues).toHaveBeenLastCalledWith(
				expect.objectContaining({
					assignee: "reviewer",
					repository: item.repository,
					state: "closed",
				})
			)
		);
		expect(mocks.mutate).not.toHaveBeenCalled();
	});
});
