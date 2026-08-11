import type { InboxItem, InboxView } from "@openmeld/schemas/types";
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
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { OrganizationHomeInbox } from "./organization-home-inbox";

const getCurrentInboxSummaryMock = vi.hoisted(() => vi.fn());
const listCurrentInboxItemsMock = vi.hoisted(() => vi.fn());

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

vi.mock("#/components/inbox/inbox-list", () => ({
	InboxItemsList: (input: { items: readonly InboxItem[] }) => (
		<ul>
			{input.items.map((item) => (
				<li key={item.id}>{item.title}</li>
			))}
		</ul>
	),
}));

vi.mock("#/components/inbox/use-inbox-item-read-mutation", () => ({
	useInboxItemReadMutation: () => ({ setRead: vi.fn() }),
}));

vi.mock("#/lib/organizations/inbox", async (importOriginal) => ({
	...(await importOriginal()),
	getCurrentInboxSummary: getCurrentInboxSummaryMock,
	listCurrentInboxItems: listCurrentInboxItemsMock,
}));

describe("OrganizationHomeInbox list refresh", () => {
	beforeEach(() => {
		getCurrentInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "organization-1",
			totalUnreadCount: 1,
			unresolvedActionCount: 1,
		});
		listCurrentInboxItemsMock
			.mockReset()
			.mockImplementation(
				(input: { organizationId: string; view: InboxView }) =>
					Promise.resolve({
						items: input.view === "needs_action" ? [createInboxItem()] : [],
						nextCursor: null,
						organizationId: input.organizationId,
					})
			);
	});

	afterEach(cleanup);

	it("keeps cached rows but surfaces and retries a failed list refresh", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={queryClient}>
				<OrganizationHomeInbox
					currentOrganization={{
						id: "organization-1",
						name: "Amplift",
						slug: "amplift",
					}}
				/>
			</QueryClientProvider>
		);

		expect(await screen.findByText("Approve the launch brief")).toBeTruthy();
		expect(screen.getByText("1 need action")).toBeTruthy();

		listCurrentInboxItemsMock.mockRejectedValue(
			Object.assign(new Error("Inbox list unavailable."), {
				code: "gateway.invalid_response",
			})
		);
		await queryClient.refetchQueries({
			queryKey: inboxQueryKeys.lists("organization-1"),
		});

		expect(await screen.findByText("Inbox may be out of date.")).toBeTruthy();
		expect(screen.getByText("Approve the launch brief")).toBeTruthy();
		expect(screen.queryByText("You’re all caught up")).toBeNull();

		listCurrentInboxItemsMock.mockImplementation(
			(input: { organizationId: string; view: InboxView }) =>
				Promise.resolve({
					items: input.view === "needs_action" ? [createInboxItem()] : [],
					nextCursor: null,
					organizationId: input.organizationId,
				})
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() =>
			expect(screen.queryByText("Inbox may be out of date.")).toBeNull()
		);
	});
});

function createInboxItem(): InboxItem {
	return {
		attention: "action_required",
		contextLabel: "Launch",
		createdAt: "2026-08-10T00:00:00.000Z",
		id: "inbox-item-1",
		importance: "normal",
		kind: "center_agent_task",
		occurredAt: "2026-08-10T00:00:00.000Z",
		organizationId: "organization-1",
		preview: "The launch brief needs approval.",
		readAt: null,
		recipientUserId: "user-1",
		resolutionStatus: "open",
		sourceTarget: {
			kind: "center_agent_task",
			taskId: "task-1",
		},
		title: "Approve the launch brief",
		updatedAt: "2026-08-10T00:00:00.000Z",
	};
}
