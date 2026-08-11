import type {
	InboxItem,
	ListInboxItemsResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type {
	AnchorHTMLAttributes,
	MouseEvent as ReactMouseEvent,
	ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { InboxPage } from "./inbox-page";

const listCurrentInboxItemsMock = vi.hoisted(() => vi.fn());
const getCurrentInboxItemMock = vi.hoisted(() => vi.fn());
const getCurrentInboxSummaryMock = vi.hoisted(() => vi.fn());
const markAllCurrentInboxItemsReadMock = vi.hoisted(() => vi.fn());
const markCurrentInboxItemReadMock = vi.hoisted(() => vi.fn());
const dismissCurrentInboxItemMock = vi.hoisted(() => vi.fn());
const DEEP_LINKED_APPROVAL_NAME_PATTERN = /Deep-linked approval/;
const INBOX_ITEM_UNAVAILABLE_NAME_PATTERN = /Inbox item isn't available/;
const NEEDS_ATTENTION_SUMMARY_NAME_PATTERN = /2 items need your attention/;
const NEW_SPACE_MESSAGE_LINK_NAME_PATTERN = /New Space message/;
const APPROVAL_COMMAND_LINK_NAME_PATTERN = /Approve the production command/;
const ALREADY_READ_UPDATE_LINK_NAME_PATTERN = /Already-read update/;
const APPROVAL_REQUIRED_LINK_NAME_PATTERN = /Approval required/;
const COULD_NOT_REFRESH_PATTERN = /Couldn’t refresh/;
const OLDER_INBOX_UPDATE_LINK_NAME_PATTERN = /Older Inbox update/;
const RECOVERED_INBOX_UPDATE_LINK_NAME_PATTERN = /Recovered Inbox update/;
const VISIBLE_INBOX_UPDATE_LINK_NAME_PATTERN = /Visible Inbox update/;
const observeIntersectionTargetMock = vi.fn();
let intersectionObserverCallback: IntersectionObserverCallback | null = null;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		onAuxClick,
		onClick,
		to,
		...props
	}: {
		children: ReactNode;
		onAuxClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
		onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a
			href={to}
			onAuxClick={onAuxClick}
			onClick={(event) => {
				event.preventDefault();
				onClick?.(event);
			}}
			{...props}
		>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "organization-123",
			isPersonal: false,
			name: "Amplift",
			slug: "amplift",
		},
	}),
}));

vi.mock("#/lib/organizations/inbox", () => ({
	dismissCurrentInboxItem: dismissCurrentInboxItemMock,
	getCurrentInboxItem: getCurrentInboxItemMock,
	getCurrentInboxNotificationPreferences: vi.fn(),
	getCurrentInboxSummary: getCurrentInboxSummaryMock,
	listCurrentInboxItems: listCurrentInboxItemsMock,
	markAllCurrentInboxItemsRead: markAllCurrentInboxItemsReadMock,
	markCurrentInboxItemRead: markCurrentInboxItemReadMock,
	updateCurrentInboxNotificationPreferences: vi.fn(),
}));

describe("InboxPage", () => {
	beforeEach(() => {
		HTMLElement.prototype.scrollIntoView = vi.fn();
		intersectionObserverCallback = null;
		observeIntersectionTargetMock.mockReset();
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				readonly root = null;
				readonly rootMargin = "0px";
				readonly thresholds = [0];

				constructor(callback: IntersectionObserverCallback) {
					intersectionObserverCallback = callback;
				}

				disconnect() {
					// No browser resources exist in this test double.
				}
				observe(target: Element) {
					observeIntersectionTargetMock(target);
				}
				takeRecords(): IntersectionObserverEntry[] {
					return [];
				}
				unobserve() {
					// No browser resources exist in this test double.
				}
			}
		);
		getCurrentInboxItemMock.mockReset();
		listCurrentInboxItemsMock.mockReset();
		getCurrentInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "organization-123",
			totalUnreadCount: 0,
			unresolvedActionCount: 0,
		});
		markAllCurrentInboxItemsReadMock.mockReset().mockResolvedValue({
			markedReadCount: 2,
		});
		markCurrentInboxItemReadMock.mockReset();
		dismissCurrentInboxItemMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("groups action items first and keeps unread state explicit", () => {
		const urgentItem = createInboxItem({
			attention: "action_required",
			id: "urgent-item",
			importance: "urgent",
			resolutionStatus: "open",
			title: "Approve the production command",
		});
		const updateItem = createInboxItem({
			id: "update-item",
			readAt: "2026-08-04T01:30:00.000Z",
			title: "Agent finished the review",
		});

		renderInboxPage({ items: [updateItem, urgentItem] });

		const attentionSection = screen
			.getByRole("heading", { name: "Needs your attention" })
			.closest("section");
		const updatesSection = screen
			.getByRole("heading", { name: "Updates" })
			.closest("section");
		expect(attentionSection).toBeInstanceOf(HTMLElement);
		expect(updatesSection).toBeInstanceOf(HTMLElement);
		expect(
			within(attentionSection as HTMLElement).getByText(
				"Approve the production command"
			)
		).toBeTruthy();
		expect(
			within(attentionSection as HTMLElement).getByText("Urgent")
		).toBeTruthy();
		expect(
			within(attentionSection as HTMLElement).getByText("Unread.")
		).toBeTruthy();
		expect(
			within(updatesSection as HTMLElement).getByText(
				"Agent finished the review"
			)
		).toBeTruthy();
		const urgentRow = screen
			.getByRole("link", { name: APPROVAL_COMMAND_LINK_NAME_PATTERN })
			.closest("li")
			?.querySelector('[class*="group/inbox-row"]');
		expect(urgentRow?.getAttribute("data-inbox-read-state")).toBe("unread");
		expect(urgentRow?.querySelector("[data-inbox-unread-dot]")).toBeNull();
		expect(urgentRow?.className).toContain("motion-reduce:transition-none");
		expect(
			screen.getByRole("button", {
				name: "Actions for Approve the production command",
			}).className
		).toContain("motion-reduce:transition-none");
	});

	it("does not keep a resolved action visually urgent", () => {
		const resolvedApproval = createInboxItem({
			attention: "action_required",
			id: "resolved-approval",
			importance: "urgent",
			resolutionStatus: "resolved",
			title: "Approval required",
		});

		renderInboxPage({ items: [resolvedApproval] });

		const updatesSection = screen
			.getByRole("heading", { name: "Updates" })
			.closest("section");
		expect(updatesSection).toBeInstanceOf(HTMLElement);
		expect(
			within(updatesSection as HTMLElement).getByText("Approval required")
		).toBeTruthy();
		expect(
			within(updatesSection as HTMLElement).queryByText("Urgent")
		).toBeNull();
	});

	it("marks an unread item as read when the user opens its exact source", async () => {
		const item = createInboxItem({ id: "source-item" });
		markCurrentInboxItemReadMock.mockResolvedValue({
			item: { ...item, readAt: "2026-08-04T02:00:00.000Z" },
		});

		renderInboxPage({ items: [item] });
		const itemLink = screen.getByRole("link", {
			name: NEW_SPACE_MESSAGE_LINK_NAME_PATTERN,
		});
		expect(itemLink.getAttribute("href")).toBe(
			"/o/amplift/spaces/space-123?focusSignalId=signal-123"
		);

		fireEvent.click(itemLink);

		await waitFor(() => {
			expect(markCurrentInboxItemReadMock).toHaveBeenCalledWith({
				itemId: "source-item",
				organizationId: "organization-123",
				read: true,
			});
		});
	});

	it("changes the URL-backed view from the tabs", () => {
		const onViewChange = vi.fn();
		renderInboxPage({ items: [], onViewChange });

		fireEvent.click(screen.getByRole("tab", { name: "Unread" }));

		expect(onViewChange).toHaveBeenCalledWith("unread");
	});

	it("loads the next page automatically when the list end enters view", async () => {
		const nextPageItem = createInboxItem({
			id: "next-page-item",
			title: "Older Inbox update",
		});
		renderInboxPage({
			items: [createInboxItem({ id: "first-page-item" })],
			nextPageItems: [nextPageItem],
		});

		await waitFor(() => {
			expect(observeIntersectionTargetMock).toHaveBeenCalledOnce();
		});
		expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();

		reportListEndIntersection(false);
		expect(listCurrentInboxItemsMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ cursor: "next-page" })
		);

		reportListEndIntersection(true);

		expect(
			await screen.findByRole("link", {
				name: OLDER_INBOX_UPDATE_LINK_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(listCurrentInboxItemsMock).toHaveBeenCalledWith(
			expect.objectContaining({ cursor: "next-page" })
		);
	});

	it("keeps loaded items visible and offers retry when automatic loading fails", async () => {
		const firstPageItem = createInboxItem({
			id: "kept-first-page-item",
			title: "Visible Inbox update",
		});
		const nextPageItem = createInboxItem({
			id: "recovered-next-page-item",
			title: "Recovered Inbox update",
		});
		renderInboxPage({
			items: [firstPageItem],
			nextPageError: Object.assign(
				new Error("Next Inbox page could not be loaded."),
				{ code: "gateway.invalid_response" }
			),
			nextPageItems: [nextPageItem],
		});
		await waitFor(() => {
			expect(observeIntersectionTargetMock).toHaveBeenCalledOnce();
		});
		reportListEndIntersection(true);

		expect(
			await screen.findByText("Couldn’t load older Inbox items.")
		).toBeTruthy();
		expect(screen.queryByText(COULD_NOT_REFRESH_PATTERN)).toBeNull();
		expect(
			screen.getByRole("link", {
				name: VISIBLE_INBOX_UPDATE_LINK_NAME_PATTERN,
			})
		).toBeTruthy();

		listCurrentInboxItemsMock.mockImplementation(
			(request: { cursor?: string }) =>
				request.cursor === "next-page"
					? Promise.resolve({
							items: [nextPageItem],
							nextCursor: null,
							organizationId: "organization-123",
						})
					: Promise.resolve({
							items: [firstPageItem],
							nextCursor: "next-page",
							organizationId: "organization-123",
						})
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		expect(
			await screen.findByRole("link", {
				name: RECOVERED_INBOX_UPDATE_LINK_NAME_PATTERN,
			})
		).toBeTruthy();
	});

	it("summarizes unresolved actions without promoting ordinary unread updates", () => {
		renderInboxPage({
			items: [],
			totalUnreadCount: 42,
			unresolvedActionCount: 2,
		});

		expect(
			screen.getByRole("status", {
				name: NEEDS_ATTENTION_SUMMARY_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(screen.queryByText("42")).toBeNull();
	});

	it("focuses an item even when it is more than 500 Inbox rows old", async () => {
		const targetItem = createInboxItem({
			id: "deep-linked-item",
			title: "Deep-linked approval",
		});
		markCurrentInboxItemReadMock.mockResolvedValue({
			item: { ...targetItem, readAt: "2026-08-04T02:00:00.000Z" },
		});

		renderInboxPage({
			deepLinkedItem: targetItem,
			itemId: targetItem.id,
			items: [createInboxItem({ id: "first-page-item" })],
		});

		const targetLink = await screen.findByRole("link", {
			name: DEEP_LINKED_APPROVAL_NAME_PATTERN,
		});
		await waitFor(() => {
			expect(targetLink.closest('[data-inbox-focused="true"]')).toBeTruthy();
		});
		expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
			block: "center",
		});
		expect(document.activeElement).toBe(targetLink);
		expect(getCurrentInboxItemMock).toHaveBeenCalledWith({
			itemId: targetItem.id,
			organizationId: "organization-123",
			signal: expect.any(AbortSignal),
		});
		expect(listCurrentInboxItemsMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ cursor: expect.anything() })
		);
		await waitFor(() => {
			expect(markCurrentInboxItemReadMock).toHaveBeenCalledWith({
				itemId: targetItem.id,
				organizationId: "organization-123",
				read: true,
			});
		});
		expect(markCurrentInboxItemReadMock).toHaveBeenCalledOnce();
	});

	it("does not rewrite an already-read deep-linked Inbox item", async () => {
		const targetItem = createInboxItem({
			id: "already-read-item",
			readAt: "2026-08-04T02:00:00.000Z",
			title: "Already-read update",
		});

		renderInboxPage({ itemId: targetItem.id, items: [targetItem] });

		await waitFor(() => {
			expect(
				screen
					.getByRole("link", { name: ALREADY_READ_UPDATE_LINK_NAME_PATTERN })
					.closest('[data-inbox-focused="true"]')
			).toBeTruthy();
		});
		expect(markCurrentInboxItemReadMock).not.toHaveBeenCalled();
	});

	it("explains when a deep-linked Inbox item is no longer available", async () => {
		renderInboxPage({
			deepLinkedItem: null,
			itemId: "missing-item",
			items: [],
		});

		expect(
			await screen.findByRole("status", {
				name: INBOX_ITEM_UNAVAILABLE_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(getCurrentInboxItemMock).toHaveBeenCalledWith({
			itemId: "missing-item",
			organizationId: "organization-123",
			signal: expect.any(AbortSignal),
		});
		expect(getCurrentInboxItemMock).toHaveBeenCalledOnce();
		expect(markCurrentInboxItemReadMock).not.toHaveBeenCalled();
	});

	it("marks all unread items read without resolving their action state", async () => {
		const item = createInboxItem({
			attention: "action_required",
			id: "action-item",
			resolutionStatus: "open",
		});
		const { queryClient } = renderInboxPage({
			items: [item],
			totalUnreadCount: 1,
			unresolvedActionCount: 1,
		});
		fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

		await waitFor(() => {
			expect(markAllCurrentInboxItemsReadMock).toHaveBeenCalledWith({
				organizationId: "organization-123",
			});
		});
		expect(
			queryClient.getQueryData(inboxQueryKeys.summary("organization-123"))
		).toMatchObject({ totalUnreadCount: 0, unresolvedActionCount: 1 });
	});

	it("dismisses an action from Inbox without presenting that as source resolution", async () => {
		const onItemDismissed = vi.fn();
		const item = createInboxItem({
			attention: "action_required",
			id: "dismiss-action-item",
			importance: "urgent",
			resolutionStatus: "open",
			title: "Approval required",
		});
		dismissCurrentInboxItemMock.mockResolvedValue({
			dismissedItemId: item.id,
		});
		const { queryClient } = renderInboxPage({
			items: [item],
			onItemDismissed,
			totalUnreadCount: 1,
			unresolvedActionCount: 1,
		});
		listCurrentInboxItemsMock.mockResolvedValue({
			items: [],
			nextCursor: null,
			organizationId: "organization-123",
		});
		getCurrentInboxSummaryMock.mockResolvedValue({
			organizationId: "organization-123",
			totalUnreadCount: 0,
			unresolvedActionCount: 0,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Actions for Approval required" })
		);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Dismiss" }));

		await waitFor(() => {
			expect(dismissCurrentInboxItemMock).toHaveBeenCalledWith({
				itemId: item.id,
				organizationId: "organization-123",
			});
		});
		expect(onItemDismissed).toHaveBeenCalledWith(item.id);
		await waitFor(() => {
			expect(
				queryClient.getQueryData<{ pages: ListInboxItemsResponse[] }>(
					inboxQueryKeys.list("organization-123", "all")
				)?.pages[0]?.items
			).toEqual([]);
		});
		await waitFor(() => {
			expect(
				screen.queryByRole("link", {
					name: APPROVAL_REQUIRED_LINK_NAME_PATTERN,
				})
			).toBeNull();
		});
		expect(
			queryClient.getQueryData(inboxQueryKeys.summary("organization-123"))
		).toEqual({
			organizationId: "organization-123",
			totalUnreadCount: 0,
			unresolvedActionCount: 0,
		});
	});
});

function reportListEndIntersection(isIntersecting: boolean): void {
	const target = observeIntersectionTargetMock.mock.calls.at(-1)?.[0] as
		| Element
		| undefined;
	if (!(target && intersectionObserverCallback)) {
		throw new Error("Inbox infinite-scroll sentinel was not observed.");
	}
	act(() => {
		intersectionObserverCallback?.(
			[{ isIntersecting, target } as IntersectionObserverEntry],
			{} as IntersectionObserver
		);
	});
}

function renderInboxPage(input: {
	deepLinkedItem?: InboxItem | null;
	itemId?: string;
	items: InboxItem[];
	nextPageError?: Error;
	nextPageItems?: InboxItem[];
	onViewChange?: (view: "all" | "needs_action" | "unread" | "updates") => void;
	onItemDismissed?: (itemId: string) => void;
	totalUnreadCount?: number;
	unresolvedActionCount?: number;
}) {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	const response: ListInboxItemsResponse = {
		items: input.items,
		nextCursor: input.nextPageItems ? "next-page" : null,
		organizationId: "organization-123",
	};
	queryClient.setQueryData(inboxQueryKeys.list("organization-123", "all"), {
		pageParams: [undefined],
		pages: [response],
	});
	queryClient.setQueryData(inboxQueryKeys.summary("organization-123"), {
		organizationId: "organization-123",
		totalUnreadCount:
			input.totalUnreadCount ??
			input.items.filter((item) => item.readAt === null).length,
		unresolvedActionCount: input.unresolvedActionCount ?? 0,
	});
	listCurrentInboxItemsMock.mockImplementation(
		(request: { cursor?: string }) => {
			if (request.cursor === "next-page") {
				if (input.nextPageError) {
					return Promise.reject(input.nextPageError);
				}
				return Promise.resolve({
					items: input.nextPageItems ?? [],
					nextCursor: null,
					organizationId: "organization-123",
				});
			}
			return Promise.resolve(response);
		}
	);
	getCurrentInboxSummaryMock.mockResolvedValue({
		organizationId: "organization-123",
		totalUnreadCount: 0,
		unresolvedActionCount: input.unresolvedActionCount ?? 0,
	});
	const deepLinkedItem =
		input.deepLinkedItem === undefined
			? [...input.items, ...(input.nextPageItems ?? [])].find(
					(item) => item.id === input.itemId
				)
			: input.deepLinkedItem;
	getCurrentInboxItemMock.mockImplementation(() => {
		if (deepLinkedItem) {
			return Promise.resolve({ item: deepLinkedItem });
		}
		return Promise.reject(
			Object.assign(new Error("Inbox item was not found."), {
				code: "gateway.http_error",
				requestId: "request-inbox-item",
				status: 404,
				upstreamCode: "inbox.item_not_found",
			})
		);
	});

	render(
		<QueryClientProvider client={queryClient}>
			<InboxPage
				itemId={input.itemId}
				onItemDismissed={input.onItemDismissed}
				onViewChange={input.onViewChange ?? vi.fn()}
				view="all"
			/>
		</QueryClientProvider>
	);
	return { queryClient };
}

function createInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		attention: "update",
		contextLabel: "Design Room",
		createdAt: "2026-08-04T01:00:00.000Z",
		id: "item-123",
		importance: "normal",
		kind: "space_message",
		occurredAt: "2026-08-04T01:00:00.000Z",
		organizationId: "organization-123",
		preview: "Review the latest message.",
		readAt: null,
		recipientUserId: "user-123",
		resolutionStatus: "not_applicable",
		sourceTarget: {
			kind: "space",
			signalId: "signal-123",
			spaceId: "space-123",
		},
		title: "New Space message",
		updatedAt: "2026-08-04T01:00:00.000Z",
		...overrides,
	};
}
