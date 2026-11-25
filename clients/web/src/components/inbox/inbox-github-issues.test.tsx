import type {
	InboxGitHubIssue,
	InboxGitHubIssuesResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxGitHubIssues, useInboxGitHubIssues } from "./inbox-github-issues";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("#/lib/organizations/inbox-github-issues", () => ({
	listCurrentGitHubInboxIssues: mocks.list,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "test-org", slug: "test" },
		currentUserId: "test-user",
	}),
}));
vi.mock("./inbox-list", () => ({
	InboxTimestamp: ({ occurredAt }: { occurredAt: string }) => (
		<time>{occurredAt}</time>
	),
}));

const assignment: InboxGitHubIssue = {
	assignees: ["current-reviewer"],
	createdAt: "2026-11-19T16:01:34Z",
	id: 94,
	number: 12,
	repository: "example/creator",
	state: "open",
	title: "Verify the creator flow",
	updatedAt: "2026-11-19T18:55:00Z",
	url: "https://github.com/example/creator/issues/12",
};
const sourceLabel = /example\/creator #12/u;

function githubResult(issues: InboxGitHubIssue[]): InboxGitHubIssuesResponse {
	return {
		organizationId: "test-org",
		result: { status: "ready", issues, partial: false },
	};
}

function TodoGitHubPanel() {
	const query = useInboxGitHubIssues({ enabled: true });
	return <InboxGitHubIssues query={query} />;
}

function renderPanel() {
	const client = new QueryClient();
	return render(
		<QueryClientProvider client={client}>
			<TodoGitHubPanel />
		</QueryClientProvider>
	);
}

afterEach(() => {
	cleanup();
	mocks.list.mockReset();
	localStorage.clear();
});

describe("GitHub assignments in To do", () => {
	it("opens the GitHub source for handoff; refresh removes the item after reassignment", async () => {
		mocks.list
			.mockResolvedValueOnce(githubResult([assignment]))
			.mockResolvedValueOnce(githubResult([]));
		renderPanel();
		const handoff = await screen.findByRole("link", {
			name: "Reassign or close in GitHub",
		});
		expect(handoff.getAttribute("href")).toBe(assignment.url);
		expect(screen.getByText(sourceLabel)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Refresh GitHub" }));
		await waitFor(() =>
			expect(screen.queryByText(assignment.title)).toBeNull()
		);
		expect(mocks.list).toHaveBeenCalledTimes(2);
	});

	it("ignores only the visible revision, without a provider call", async () => {
		mocks.list.mockResolvedValue(githubResult([assignment]));
		const first = renderPanel();
		await screen.findByText(assignment.title);
		fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
		expect(screen.queryByText(assignment.title)).toBeNull();
		expect(mocks.list).toHaveBeenCalledOnce();
		first.unmount();
		mocks.list.mockResolvedValue(
			githubResult([{ ...assignment, updatedAt: "2026-11-20T18:55:00Z" }])
		);
		renderPanel();
		expect(await screen.findByText(assignment.title)).toBeTruthy();
	});
});
