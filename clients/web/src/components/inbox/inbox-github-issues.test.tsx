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
import {
	InboxGitHubTodoRow,
	useInboxGitHubIssues,
} from "./inbox-github-issues";

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
	return (
		<>
			<button onClick={() => query.refetch()} type="button">
				Refetch
			</button>
			<ul>
				{query.visibleIssues.map((issue) => (
					<InboxGitHubTodoRow issue={issue} key={issue.id} query={query} />
				))}
			</ul>
		</>
	);
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
			name: `Open: ${assignment.title}`,
		});
		expect(handoff.getAttribute("href")).toBe(assignment.url);
		expect(screen.getByText(sourceLabel)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Refetch" }));
		await waitFor(() =>
			expect(screen.queryByText(assignment.title)).toBeNull()
		);
		expect(mocks.list).toHaveBeenCalledTimes(2);
	});

	it("keeps unrelated issue revisions hidden past 200 dismissals", async () => {
		const storageKey = "openmeld.inbox.completed:github:test-user:test-org";
		const oldRevision = `${assignment.id}:${assignment.updatedAt}`;
		localStorage.setItem(
			storageKey,
			JSON.stringify([
				...Array.from(
					{ length: 199 },
					(_, i) => `${1000 + i}:${assignment.updatedAt}`
				),
				oldRevision,
				`95:${assignment.createdAt}`,
			])
		);
		const newAssignment = {
			...assignment,
			id: 95,
			title: "Review another issue",
		};
		mocks.list.mockResolvedValue(githubResult([assignment, newAssignment]));
		const first = renderPanel();
		await screen.findByText(newAssignment.title);
		fireEvent.click(
			screen.getByRole("button", { name: `Done: ${newAssignment.title}` })
		);
		first.unmount();
		renderPanel();
		await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
		expect(screen.queryByText(assignment.title)).toBeNull();
		expect(screen.queryByText(newAssignment.title)).toBeNull();
		const persisted = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
		expect(persisted).toContain(oldRevision);
		expect(persisted).toContain(`95:${assignment.updatedAt}`);
		expect(persisted).not.toContain(`95:${assignment.createdAt}`);
	});

	it.each([
		"Done",
		"Ignore",
	])("%s hides only the visible revision, without a provider call", async (action) => {
		mocks.list.mockResolvedValue(githubResult([assignment]));
		const first = renderPanel();
		await screen.findByText(assignment.title);
		fireEvent.click(
			screen.getByRole("button", { name: `${action}: ${assignment.title}` })
		);
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
