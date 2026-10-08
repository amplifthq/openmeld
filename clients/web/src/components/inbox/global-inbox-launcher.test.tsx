import type {
	InboxFeedResponse,
	InboxFeedRow,
	InboxItem,
} from "@openmeld/schemas/types";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import { GlobalInboxLauncher } from "./global-inbox-launcher";
import { OrganizationInboxRecentItems } from "./organization-inbox-recent-items";

const mocks = vi.hoisted(() => ({
	summary: vi.fn(),
	feed: vi.fn(),
	items: vi.fn(),
	read: vi.fn(),
	selection: vi.fn(),
	navigate: vi.fn(),
	organization: vi.fn(),
}));
const organization = {
	id: "organization-123",
	name: "Amplift",
	slug: "amplift",
};
const OPEN_INBOX = /^Open Inbox/u;
const MESSAGE = /New Space message/u;
const SYSTEM = /^System updates 20 updates/u;
const clients: QueryClient[] = [];
let intersection: IntersectionObserverCallback | undefined;
let sentinel: Element | undefined;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		...props
	}: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props} />
	),
	useNavigate: () => mocks.navigate,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: mocks.organization,
	useAppOrganization: mocks.organization,
}));
vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentInboxItem: vi.fn(),
	getCurrentInboxNotificationPreferences: vi.fn(),
	getCurrentInboxSummary: mocks.summary,
	listCurrentInboxItems: mocks.items,
	listCurrentInboxFeed: mocks.feed,
	markCurrentInboxItemRead: mocks.read,
	mutateCurrentInboxFeed: mocks.selection,
}));

beforeEach(() => {
	vi.resetAllMocks();
	localStorage.clear();
	intersection = undefined;
	sentinel = undefined;
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: IntersectionObserverCallback) {
				intersection = callback;
			}
			observe(element: Element) {
				sentinel = element;
			}
			disconnect() {
				/* Each test explicitly delivers the intersection event. */
			}
			unobserve() {
				/* No browser layout in this boundary test. */
			}
		}
	);
	mocks.organization.mockReturnValue({
		currentOrganization: organization,
		currentUserId: "user-123",
	});
	mocks.summary.mockResolvedValue({
		organizationId: organization.id,
		ordinaryUnreadCount: 1,
		totalUnreadCount: 1,
		unreadMentionCount: 0,
		unresolvedActionCount: 0,
		unreadUrgentUpdateCount: 0,
	});
	mocks.feed.mockResolvedValue(page([row(item())]));
	mocks.items.mockResolvedValue({
		organizationId: organization.id,
		items: [item()],
		nextCursor: null,
	});
	mocks.read.mockImplementation(async ({ read }) => ({
		item: { ...item(), readAt: read ? new Date().toISOString() : null },
	}));
	mocks.selection.mockResolvedValue({ changedCount: 20 });
	mocks.navigate.mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) {
		client.clear();
	}
	vi.unstubAllGlobals();
});

describe("GlobalInboxLauncher", () => {
	it("does not fetch the feed before opening and stays hidden outside an organization", async () => {
		const rendered = renderLauncher();
		await screen.findByLabelText("Open Inbox, 1 unread");
		expect(mocks.feed).not.toHaveBeenCalled();
		mocks.organization.mockReturnValue(null);
		rendered.rerender(<GlobalInboxLauncher />);
		expect(rendered.container.childElementCount).toBe(0);
	});

	it("uses canonical groups, expands without reading, and marks only the selected snapshot group read", async () => {
		const system = row(
			item({ kind: "system_issue", title: "Connection restored" }),
			{
				groupKey: "system",
				group: { kind: "system", conversationCount: 0 },
				itemCount: 20,
				unreadCount: 20,
			}
		);
		mocks.feed.mockImplementation(async (query) =>
			query.groupKey ? page([row(system.item)]) : page([system])
		);
		renderLauncher({ open: true });
		const toggle = await screen.findByRole("button", { name: SYSTEM });
		expect(screen.queryByText("Connection restored")).toBeNull();
		fireEvent.click(toggle);
		expect(await screen.findByText("Connection restored")).toBeTruthy();
		expect(mocks.read).not.toHaveBeenCalled();
		expect(mocks.selection).not.toHaveBeenCalled();
		fireEvent.click(screen.getByLabelText("Mark System updates as read"));
		await waitFor(() =>
			expect(mocks.selection).toHaveBeenCalledWith({
				organizationId: organization.id,
				snapshotId: "snapshot",
				groupKey: "system",
				operation: "read",
			})
		);
		expect(
			screen.getByRole("link", { name: "Open full Inbox" }).getAttribute("href")
		).toBe("/o/amplift/inbox");
	});

	it("continues beyond six rows and preserves loaded content when the next page fails before retry", async () => {
		const first = Array.from({ length: 12 }, (_, index) =>
			row(item({ id: `item-${index}`, title: `Update ${index}` }))
		);
		let failed = true;
		mocks.feed.mockImplementation((query) => {
			if (!query.cursor) {
				return Promise.resolve(page(first, "next-page"));
			}
			if (failed) {
				return Promise.reject(new Error("Network interrupted"));
			}
			return Promise.resolve(
				page([row(item({ id: "older", title: "Older update" }))])
			);
		});
		renderLauncher({ open: true });
		await screen.findByText("Update 11");
		await act(async () =>
			intersection?.(
				[
					{
						isIntersecting: true,
						target: sentinel,
					} as IntersectionObserverEntry,
				],
				{} as IntersectionObserver
			)
		);
		expect(
			await screen.findByText("Couldn’t load older Inbox items.")
		).toBeTruthy();
		expect(screen.getByText("Update 11")).toBeTruthy();
		failed = false;
		fireEvent.click(screen.getByText("Try again"));
		expect(await screen.findByText("Older update")).toBeTruthy();
		expect(screen.getByText("Update 0")).toBeTruthy();
	});

	it("retains read open requests and does not resolve them when marking read", async () => {
		const request = item({
			attention: "action_required",
			resolutionStatus: "open",
			title: "Review requested",
			readAt: new Date().toISOString(),
		});
		mocks.feed.mockResolvedValue(
			page([
				row(request, {
					section: "open",
					requestCategory: "review",
					unreadCount: 0,
					dot: null,
				}),
			])
		);
		mocks.summary.mockResolvedValue({
			organizationId: organization.id,
			ordinaryUnreadCount: 0,
			totalUnreadCount: 0,
			unreadMentionCount: 0,
			unresolvedActionCount: 1,
			unreadUrgentUpdateCount: 0,
		});
		renderLauncher({ open: true });
		expect(await screen.findByText("Review requested")).toBeTruthy();
		expect(screen.getByText("Needs your attention")).toBeTruthy();
		expect(screen.queryByText("All caught up")).toBeNull();
		expect(mocks.feed).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "all",
				grouping: "space",
				unreadOnly: "false",
			})
		);
	});

	it("marks an opened source read, navigates to the exact message, and closes the preview", async () => {
		renderLauncher();
		fireEvent.click(await screen.findByLabelText("Open Inbox, 1 unread"));
		fireEvent.click(await screen.findByRole("link", { name: MESSAGE }));
		await waitFor(() =>
			expect(mocks.read).toHaveBeenCalledWith({
				organizationId: organization.id,
				itemId: "item-123",
				read: true,
			})
		);
		expect(mocks.navigate).toHaveBeenCalledWith({
			state: requestInboxSourceFocus,
			to: "/o/amplift/spaces/space-123?focusSignalId=signal-123",
		});
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("shows loading, an initial error, and successful retry without losing the full Inbox exit", async () => {
		let rejectRequest: (reason: Error) => void = () => undefined;
		mocks.feed.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectRequest = reject;
				})
		);
		renderLauncher({ open: true });
		expect(await screen.findByText("Loading Inbox")).toBeTruthy();
		await act(async () => rejectRequest(new Error("Unavailable")));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open full Inbox" })).toBeTruthy();
		fireEvent.click(screen.getByText("Try again"));
		expect(await screen.findByRole("link", { name: MESSAGE })).toBeTruthy();
	});

	it("shows an empty feed without inventing a successful attention check", async () => {
		mocks.feed.mockResolvedValue(page([]));
		mocks.summary.mockRejectedValue(new Error("Unavailable"));
		renderLauncher({ open: true });
		expect(await screen.findByText("No updates yet")).toBeTruthy();
		expect(await screen.findByText("Couldn’t check for updates")).toBeTruthy();
		expect(screen.queryByText("All caught up")).toBeNull();
	});

	it("keeps a stale snapshot visible but disables group mutations until refreshed", async () => {
		const system = row(item(), {
			groupKey: "system",
			group: { kind: "system", conversationCount: 0 },
			itemCount: 20,
			unreadCount: 20,
		});
		mocks.feed.mockResolvedValue({
			...page([system]),
			snapshotExpiresAt: new Date(Date.now() - 1).toISOString(),
		});
		renderLauncher({ open: true });
		expect(
			await screen.findByText(
				"Couldn’t refresh. Showing the latest Inbox view available."
			)
		).toBeTruthy();
		expect(
			(
				screen.getByLabelText(
					"Mark System updates as read"
				) as HTMLButtonElement
			).disabled
		).toBe(true);
		mocks.feed.mockResolvedValue(page([system]));
		fireEvent.click(screen.getByText("Retry"));
		await waitFor(() =>
			expect(
				(
					screen.getByLabelText(
						"Mark System updates as read"
					) as HTMLButtonElement
				).disabled
			).toBe(false)
		);
	});

	it.each([
		{ actions: 0, urgent: 1, label: "1 unread urgent update" },
		{
			actions: 2,
			urgent: 3,
			label: "2 pending items, 3 unread urgent updates",
		},
	])("preserves the summary breakdown: $label", async ({
		actions,
		urgent,
		label,
	}) => {
		mocks.summary.mockResolvedValue({
			organizationId: organization.id,
			ordinaryUnreadCount: 3,
			totalUnreadCount: 8,
			unreadMentionCount: 0,
			unresolvedActionCount: actions,
			unreadUrgentUpdateCount: urgent,
		});
		renderLauncher();
		expect(await screen.findByLabelText(`Open Inbox, ${label}`)).toBeTruthy();
	});

	it("supports controlled closing from the toolbar and the explicit close button", async () => {
		const onOpenChange = vi.fn();
		renderLauncher({ open: true, onOpenChange });
		fireEvent.click(await screen.findByLabelText("Close Inbox"));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		fireEvent.click(screen.getByRole("button", { name: OPEN_INBOX }));
		expect(onOpenChange.mock.calls.at(-1)?.[0]).toBe(false);
	});

	it("keeps read history in the separate Desk recent-items widget", async () => {
		mocks.items.mockResolvedValue({
			organizationId: organization.id,
			items: [item({ readAt: new Date().toISOString() })],
			nextCursor: null,
		});
		const client = createClient();
		render(
			<QueryClientProvider client={client}>
				<TooltipProvider>
					<OrganizationInboxRecentItems currentOrganization={organization} />
				</TooltipProvider>
			</QueryClientProvider>
		);
		expect(await screen.findByRole("link", { name: MESSAGE })).toBeTruthy();
		expect(mocks.read).not.toHaveBeenCalled();
	});
});

function createClient() {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, retryDelay: 1 },
			mutations: { retry: false },
		},
	});
	clients.push(client);
	return client;
}
function renderLauncher(
	props: ComponentProps<typeof GlobalInboxLauncher> = {}
) {
	return render(
		<QueryClientProvider client={createClient()}>
			<TooltipProvider>
				<GlobalInboxLauncher {...props} />
			</TooltipProvider>
		</QueryClientProvider>
	);
}
function item(changes: Partial<InboxItem> = {}): InboxItem {
	const now = new Date().toISOString();
	return {
		id: "item-123",
		organizationId: organization.id,
		recipientUserId: "user-123",
		kind: "space_message",
		attention: "update",
		importance: "normal",
		title: "New Space message",
		preview: "Review the latest message.",
		contextLabel: "Design Room",
		readAt: null,
		resolutionStatus: "not_applicable",
		sourceTarget: {
			kind: "space",
			spaceId: "space-123",
			signalId: "signal-123",
		},
		occurredAt: now,
		createdAt: now,
		updatedAt: now,
		...changes,
	};
}
function row(
	source: InboxItem,
	changes: Partial<InboxFeedRow> = {}
): InboxFeedRow {
	return {
		item: source,
		groupKey: source.id,
		itemCount: 1,
		unreadCount: source.readAt ? 0 : 1,
		latestOccurredAt: source.occurredAt,
		section: "activity",
		requestCategory: null,
		dot: source.readAt ? null : "blue",
		...changes,
	};
}
function page(
	rows: InboxFeedRow[],
	nextCursor: string | null = null
): InboxFeedResponse {
	return {
		organizationId: organization.id,
		snapshotId: "snapshot",
		snapshotExpiresAt: new Date(Date.now() + 900_000).toISOString(),
		rows,
		nextCursor,
		counts: {
			all: rows.length,
			mentions: 0,
			needsAction: 0,
			needsReview: 0,
			unread: rows.length,
			priority: 0,
		},
	};
}
