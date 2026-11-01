import type {
	InboxFeedResponse,
	InboxFeedRow,
	InboxItem,
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
import type { AnchorHTMLAttributes, ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ConversationNames,
	ConversationNamesContext,
} from "#/components/spaces/conversation-names";
import { resolveInboxItemIndicator } from "#/lib/inbox/attention";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import { organizationInboxFeedQueryOptions } from "#/query/organizations/inbox-feed";
import { InboxPage } from "./inbox-page";

const mocks = vi.hoisted(() => ({
	feed: vi.fn(),
	item: vi.fn(),
	read: vi.fn(),
	dismiss: vi.fn(),
	selection: vi.fn(),
	legacyReadAll: vi.fn(),
	navigate: vi.fn(),
}));
const testOrganization = {
	id: "organization-123",
	isPersonal: false,
	name: "Amplift",
	slug: "amplift",
};
const AGENT_REQUEST_LABEL = /Tali wants PR Reviewer in a Space/;
const EXACT_MESSAGE_LABEL = /Open exact message/u;
const SLACK_REPLY_LABEL = /Slack reply/u;
const OLD_REQUEST_LABEL = /Old request/u;
const UNAVAILABLE_LABEL = /This Inbox item isn’t available/u;
const INSTALLED_LABEL = /^OpenMeld installed/u;
const SOURCE_PRESERVED = /Original messages and documents won’t be deleted/u;
const FROZEN_SELECTION_DESCRIPTION =
	/New messages and items outside this selection stay unread/u;
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization: testOrganization,
		currentUserId: "user-123",
	}),
	useAppOrganization: () => ({
		currentOrganization: testOrganization,
		currentUserId: "user-123",
	}),
}));
vi.mock("#/lib/organizations/inbox", async () => ({
	...(await vi.importActual<typeof import("#/lib/organizations/inbox")>(
		"#/lib/organizations/inbox"
	)),
	listCurrentInboxFeed: mocks.feed,
	getCurrentInboxItem: mocks.item,
	markCurrentInboxItemRead: mocks.read,
	dismissCurrentInboxItem: mocks.dismiss,
	mutateCurrentInboxFeed: mocks.selection,
	markAllCurrentInboxItemsRead: mocks.legacyReadAll,
}));
vi.mock("@tanstack/react-router", async () => ({
	...(await vi.importActual<typeof import("@tanstack/react-router")>(
		"@tanstack/react-router"
	)),
	useNavigate: () => mocks.navigate,
	Link: ({
		children,
		to,
		...props
	}: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));
vi.mock("./invitation-review", () => ({
	InvitationReview: ({ requestId }: { requestId: string }) => (
		<div>Invitation {requestId}</div>
	),
}));

let intersectionCallback: IntersectionObserverCallback | null = null;
const observed = vi.fn();
class TestIntersectionObserver implements IntersectionObserver {
	readonly root = null;
	readonly rootMargin = "0px";
	readonly scrollMargin = "0px 0px 0px 0px";
	readonly thresholds = [0];
	constructor(callback: IntersectionObserverCallback) {
		intersectionCallback = callback;
	}
	observe(target: Element): void {
		observed(target);
	}
	unobserve(): void {
		/* The test retains only the current sentinel. */
	}
	disconnect(): void {
		intersectionCallback = null;
	}
	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}
}

beforeEach(() => {
	localStorage.clear();
	vi.clearAllMocks();
	intersectionCallback = null;
	vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	mocks.navigate.mockResolvedValue(undefined);
	mocks.selection.mockResolvedValue({ changedCount: 1 });
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("canonical Inbox attention page", () => {
	it("marks a single item read immediately from its visible quick action and restores a failed save", async () => {
		const message = item({ title: "Standalone update" });
		let rejectRead: (error: Error) => void = () => undefined;
		mocks.read.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectRead = reject;
				})
		);
		renderPage({ rows: [row(message)] });
		fireEvent.click(
			screen.getByRole("button", { name: "Mark Standalone update as read" })
		);
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Standalone update: Read" })
					.hasAttribute("disabled")
			).toBe(true)
		);
		expect(mocks.navigate).not.toHaveBeenCalled();
		act(() => {
			rejectRead(new Error("Save failed"));
		});
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Mark Standalone update as read" })
					.hasAttribute("disabled")
			).toBe(false)
		);
	});

	it("reads installed system updates in place without navigating to a selected update", async () => {
		const update = item({
			id: "installed",
			kind: "desktop_update",
			title: "OpenMeld installed",
			sourceTarget: {
				kind: "desktop_update",
				installationId: "local-installation",
				lane: "dev-local",
				deviceName: "Studio Mac",
				version: "0.1.16",
				platform: "darwin",
				state: "installed",
			},
		});
		renderPage({ rows: [row(update)] });
		mocks.read.mockResolvedValue({
			item: { ...update, readAt: "2026-09-18T01:00:00Z" },
		});
		fireEvent.click(screen.getByRole("button", { name: INSTALLED_LABEL }));
		await waitFor(() =>
			expect(mocks.read).toHaveBeenCalledWith(
				expect.objectContaining({ itemId: "installed", read: true })
			)
		);
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("region", { name: "Selected update" })
		).toBeNull();
	});
	it.each([
		"user-123",
		"another-account",
	])("uses the current recipient's chat name for grouped and expanded replies (%s)", async (userId) => {
		const original = item({
			kind: "agent_reply",
			title: "Center Agent replied in Original chat",
			contextLabel: "Center Agent",
			sourceTarget: {
				kind: "center_agent",
				spaceId: "space-123",
				signalId: "signal-123",
			},
		});
		const older = { ...original, id: "older", preview: "An earlier reply." };
		renderPage({
			rows: [
				row(original, {
					itemCount: 2,
					group: { kind: "space", conversationCount: 1 },
				}),
			],
			expandedRows: [row(older)],
			conversationNames: {
				organizationId: "organization-123",
				userId,
				names: new Map([
					[
						"space-123",
						{ name: "Issues + PR records", sourceName: "Original chat" },
					],
				]),
			},
		});
		const title =
			userId === "user-123"
				? "Center Agent replied in Issues + PR records"
				: original.title;
		const name = userId === "user-123" ? "Issues + PR records" : "Center Agent";
		fireEvent.click(
			screen.getByRole("button", { name: `${name} 1 conversation · 1 unread` })
		);
		await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
		const links = screen
			.getAllByRole("link")
			.filter((link) => link.textContent?.includes(title));
		expect(links[0]?.getAttribute("href")).toContain("session=space-123");
		expect(links[0]?.getAttribute("href")).toContain(
			"focusSignalId=signal-123"
		);
		expect(mocks.read).not.toHaveBeenCalled();
	});

	it("renders four categories and independent server-side filters without an Agent tab or administrator gate", () => {
		const onViewChange = vi.fn();
		const onUnreadOnlyChange = vi.fn();
		const onFiltersChange = vi.fn();
		renderPage({
			rows: [],
			onViewChange,
			onUnreadOnlyChange,
			onFiltersChange,
			peopleOnly: true,
		});
		expect(screen.getAllByRole("tab")).toHaveLength(4);
		for (const name of ["All", "Mentions", "Needs action", "Needs review"]) {
			expect(screen.getByRole("tab", { name })).toBeTruthy();
		}
		expect(screen.queryByRole("tab", { name: "Agents" })).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Mentions" }));
		fireEvent.click(screen.getByRole("switch", { name: "Unread only" }));
		fireEvent.click(screen.getByRole("button", { name: "Filter Inbox" }));
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Agents" }));
		expect(onViewChange).toHaveBeenCalledWith("mentions");
		expect(onUnreadOnlyChange).toHaveBeenCalledWith(true);
		expect(onFiltersChange).toHaveBeenCalledWith(
			expect.objectContaining({ agentsOnly: true, peopleOnly: false })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Clear filters" }));
		expect(onFiltersChange).toHaveBeenCalledWith({
			agentsOnly: false,
			peopleOnly: false,
			conversationType: "all",
		});
		expect(screen.queryByRole("button", { name: "All read" })).toBeNull();
	});

	it("keeps the page shell, categories and controls visible while only the feed is pending", () => {
		mocks.feed.mockImplementation(
			() =>
				new Promise(() => {
					/* Keep the feed pending while checking the page shell. */
				})
		);
		renderPage({ rows: [], prime: false, preserveFeedMock: true });
		expect(screen.getByRole("heading", { name: "Inbox" })).toBeTruthy();
		expect(screen.getAllByRole("tab")).toHaveLength(4);
		expect(screen.getByRole("switch", { name: "Unread only" })).toBeTruthy();
		expect(
			screen.getByText("Loading Inbox").parentElement?.getAttribute("aria-busy")
		).toBe("true");
		expect(screen.queryByText("Loading...")).toBeNull();
	});

	it("renders full-dataset server sections, with quiet pending copy instead of repeated urgency pills", () => {
		const priority = item({
			id: "priority",
			attention: "action_required",
			importance: "urgent",
			resolutionStatus: "open",
			title: "Reconnect the build computer",
			readAt: "2026-09-18T00:00:00Z",
		});
		const normal = item({
			id: "normal",
			attention: "action_required",
			resolutionStatus: "open",
			title: "Choose an output folder",
			readAt: "2026-09-18T00:00:00Z",
		});
		renderPage({
			rows: [
				row(priority, {
					section: "priority",
					dot: "yellow",
					requestCategory: "action",
				}),
				row(normal, { section: "open", dot: null, requestCategory: "action" }),
				row(item({ id: "update", title: "A new reply" })),
			],
		});
		expect(
			within(
				screen.getByRole("region", { name: "Needs your attention" })
			).getByText(priority.title)
		).toBeTruthy();
		expect(
			within(
				screen.getByRole("region", { name: "Needs your attention" })
			).getByText(normal.title)
		).toBeTruthy();
		expect(screen.getAllByText("Awaiting your action")).toHaveLength(2);
		expect(screen.queryByText("Urgent")).toBeNull();
		expect(
			screen
				.getByText(priority.title)
				.closest("li")
				?.querySelector("[data-inbox-status-dot]")
				?.getAttribute("data-inbox-status-dot")
		).toBe("warning");
		expect(
			screen
				.getByText(normal.title)
				.closest("li")
				?.querySelector("[data-inbox-status-dot]")
				?.getAttribute("data-inbox-status-dot")
		).toBe("warning");
		expect(
			screen.getByText(priority.title).querySelector("[data-inbox-status-dot]")
		).toBeNull();
	});

	it.each([
		{
			attention: "update",
			importance: "normal",
			resolutionStatus: "not_applicable",
			read: false,
			indicator: "unread",
		},
		{
			attention: "update",
			importance: "urgent",
			resolutionStatus: "not_applicable",
			read: false,
			indicator: "warning",
		},
		{
			attention: "update",
			importance: "urgent",
			resolutionStatus: "not_applicable",
			read: true,
			indicator: null,
		},
		{
			attention: "action_required",
			importance: "normal",
			resolutionStatus: "open",
			read: false,
			indicator: "warning",
		},
		{
			attention: "action_required",
			importance: "normal",
			resolutionStatus: "open",
			read: true,
			indicator: "warning",
		},
		{
			attention: "action_required",
			importance: "urgent",
			resolutionStatus: "open",
			read: true,
			indicator: "warning",
		},
		{
			attention: "action_required",
			importance: "urgent",
			resolutionStatus: "resolved",
			read: false,
			indicator: "unread",
		},
		{
			attention: "action_required",
			importance: "normal",
			resolutionStatus: "resolved",
			read: true,
			indicator: null,
		},
	] as const)("keeps $attention / $importance / $resolutionStatus / read=$read distinct", (state) => {
		const example = item({
			attention: state.attention,
			importance: state.importance,
			resolutionStatus: state.resolutionStatus,
			readAt: state.read ? "2026-09-18T00:00:00Z" : null,
		});
		expect(resolveInboxItemIndicator(example)).toBe(state.indicator);
	});

	it("shows first personal-Agent contact as unread information, not as a pending request", () => {
		const contact = item({
			sourceFacts: {
				version: 1,
				agentProfileIds: ["codex"],
				personalAgentProfileIds: ["codex"],
				firstContactAgentProfileIds: ["codex"],
				recipientReasons: ["agent_owner"],
			},
		});
		expect(resolveInboxItemIndicator(contact)).toBe("warning");
		expect(
			resolveInboxItemIndicator({ ...contact, readAt: "2026-09-18T00:00:00Z" })
		).toBeNull();
		renderPage({
			rows: [row(contact, { dot: "yellow", section: "priority" })],
		});
		expect(screen.queryByText("Awaiting your action")).toBeNull();
		expect(screen.queryByText("Urgent")).toBeNull();
	});

	it("keeps an ended request explicit and never makes it a persistent priority", () => {
		const ended = item({
			attention: "action_required",
			importance: "urgent",
			resolutionStatus: "resolved",
			title: "Connection restored",
		});
		renderPage({ rows: [row(ended)] });
		expect(
			within(screen.getByRole("region", { name: "Updates" })).getByText(
				"Connection restored"
			)
		).toBeTruthy();
		expect(screen.getByText("Ended")).toBeTruthy();
		expect(
			screen.queryByRole("region", { name: "Needs your attention" })
		).toBeNull();
	});

	it("passes every filter through paging instead of locally discarding an unrelated first page", async () => {
		const first = row(item({ id: "first", title: "Mention one" }));
		const next = row(item({ id: "next", title: "Older mention" }));
		renderPage({
			rows: [first],
			nextRows: [next],
			view: "mentions",
			unreadOnly: true,
			peopleOnly: true,
			conversationType: "direct_messages",
		});
		await waitFor(() => expect(observed).toHaveBeenCalled());
		intersect();
		expect(await screen.findByText("Older mention")).toBeTruthy();
		expect(mocks.feed).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "mentions",
				unreadOnly: "true",
				peopleOnly: "true",
				conversationType: "direct_messages",
				cursor: "next-page",
			})
		);
	});

	it("keeps visible rows and waits for background refresh before loading older items", async () => {
		const first = row(item({ id: "first", title: "Visible update" }));
		const next = row(item({ id: "next", title: "Older update" }));
		const { queryClient, queryKey } = renderPage({
			rows: [first],
			nextRows: [next],
		});
		await waitFor(() => expect(observed).toHaveBeenCalled());
		let finishRefresh!: (response: InboxFeedResponse) => void;
		mocks.feed.mockImplementationOnce(
			() =>
				new Promise<InboxFeedResponse>((resolve) => {
					finishRefresh = resolve;
				})
		);
		let refresh!: Promise<void>;
		act(() => {
			refresh = queryClient.invalidateQueries({ queryKey });
		});
		await waitFor(() => expect(mocks.feed).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(intersectionCallback).toBeNull());
		expect(screen.getByText("Visible update")).toBeTruthy();
		expect((observed.mock.calls.at(-1)?.[0] as Element).isConnected).toBe(
			false
		);
		expect(mocks.feed).toHaveBeenCalledTimes(1);
		await act(async () => {
			finishRefresh(page([first], "next-page"));
			await refresh;
		});
		await waitFor(() => expect(intersectionCallback).not.toBeNull());
		intersect();
		expect(await screen.findByText("Older update")).toBeTruthy();
	});

	it("shows an expired saved view but waits for a fresh snapshot before bulk actions", async () => {
		const original = row(item({ id: "saved", title: "Saved update" }));
		const { queryClient, queryKey } = renderPage({ rows: [original] });
		act(() =>
			queryClient.setQueryData(queryKey, {
				pageParams: [undefined],
				pages: [
					{
						...page([original]),
						snapshotExpiresAt: new Date(Date.now() - 1).toISOString(),
					},
				],
			})
		);
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Mark 1 item as read",
					}) as HTMLButtonElement
				).disabled
			).toBe(true)
		);
		expect(screen.getByText("Saved update")).toBeTruthy();
		expect(mocks.selection).not.toHaveBeenCalled();
		await act(async () => {
			await queryClient.invalidateQueries({ queryKey });
		});
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Mark 1 item as read",
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		);
	});

	it("keeps loaded rows and a retry action when the next page fails", async () => {
		const first = row(item({ id: "first", title: "Visible update" }));
		const next = row(item({ id: "next", title: "Recovered update" }));
		renderPage({
			rows: [first],
			nextRows: [next],
			nextPageError: new Error("Connection lost"),
		});
		await waitFor(() => expect(observed).toHaveBeenCalled());
		intersect();
		expect(
			await screen.findByText("Couldn’t load older Inbox items.")
		).toBeTruthy();
		expect(screen.getByText("Visible update")).toBeTruthy();
		mocks.feed.mockResolvedValue(page([next]));
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByText("Recovered update")).toBeTruthy();
	});

	it("expands a conversation without reading unseen messages and batches only its frozen server group", async () => {
		const first = item({ id: "first", title: "Monica contacted your Codex" });
		const second = item({ id: "second", title: "Codex replied" });
		renderPage({
			rows: [
				row(first, {
					itemCount: 12,
					unreadCount: 12,
					groupKey: "Y29udmVyc2F0aW9u",
					group: { kind: "space", conversationCount: 2 },
				}),
			],
			expandedRows: [row(first), row(second)],
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Design Room 2 conversations · 12 unread",
			})
		);
		expect(await screen.findByText("Codex replied")).toBeTruthy();
		expect(mocks.read).not.toHaveBeenCalled();
		expect(mocks.selection).not.toHaveBeenCalled();
		expect(mocks.feed).toHaveBeenCalledWith(
			expect.objectContaining({
				snapshotId: "snapshot",
				groupKey: "Y29udmVyc2F0aW9u",
			})
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Mark Design Room as read" })
		);
		await waitFor(() =>
			expect(mocks.selection).toHaveBeenCalledExactlyOnceWith({
				organizationId: "organization-123",
				snapshotId: "snapshot",
				groupKey: "Y29udmVyc2F0aW9u",
				operation: "read",
			})
		);
		expect(mocks.legacyReadAll).not.toHaveBeenCalled();
	});

	it("opens an exact Space source, marks only that item, and preserves same-route focus navigation", async () => {
		const source = item({ id: "source", title: "Open exact message" });
		renderPage({ rows: [row(source, { itemCount: 4, unreadCount: 4 })] });
		mocks.read.mockResolvedValue({
			item: { ...source, readAt: "2026-09-18T01:00:00Z" },
		});
		const link = screen.getByRole("link", { name: EXACT_MESSAGE_LABEL });
		expect(link.getAttribute("href")).toBe(
			"/o/amplift/spaces/space-123?focusSignalId=signal-123"
		);
		fireEvent.click(link);
		expect(mocks.navigate).toHaveBeenCalledWith({
			state: requestInboxSourceFocus,
			to: "/o/amplift/spaces/space-123?focusSignalId=signal-123",
		});
		await waitFor(() =>
			expect(mocks.read).toHaveBeenCalledWith({
				organizationId: "organization-123",
				itemId: "source",
				read: true,
			})
		);
		expect(mocks.selection).not.toHaveBeenCalled();
	});

	it("keeps the Needs action filter when an Agent request opens its Inbox detail", () => {
		window.history.replaceState(null, "", "/o/amplift/inbox?view=needs-action");
		try {
			const request = item({
				attention: "action_required",
				id: "access-1",
				kind: "agent_space_request",
				resolutionStatus: "open",
				sourceTarget: { kind: "agent_access_request", requestId: "aar_1" },
				title: "Tali wants PR Reviewer in a Space",
			});
			renderPage({ rows: [row(request)], view: "needs_action" });
			fireEvent.click(screen.getByRole("link", { name: AGENT_REQUEST_LABEL }));
			expect(mocks.navigate).toHaveBeenCalledWith({
				state: requestInboxSourceFocus,
				to: "/o/amplift/inbox?view=needs-action&item=access-1",
			});
		} finally {
			window.history.replaceState(null, "", "/");
		}
	});

	it("opens a Slack message in a separate tab without turning its permalink into an app route", async () => {
		const source = item({
			id: "slack",
			title: "Slack reply",
			sourceTarget: {
				kind: "message_channel",
				provider: "slack",
				teamId: "T0123",
				channelId: "C0123",
				messageId: "1720000000.000200",
				threadRootMessageId: "1720000000.000100",
				permalink: "https://amplift.slack.com/archives/C0123/p1720000000000200",
			},
		});
		renderPage({ rows: [row(source)] });
		mocks.read.mockResolvedValue({
			item: { ...source, readAt: "2026-09-18T01:00:00Z" },
		});
		const link = screen.getByRole("link", { name: SLACK_REPLY_LABEL });
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		fireEvent.click(link);
		await waitFor(() =>
			expect(mocks.read).toHaveBeenCalledWith(
				expect.objectContaining({ itemId: "slack" })
			)
		);
	});

	it("looks up an old exact deep link outside the active filter without scanning pages or hiding its conversation", async () => {
		const source = item({
			id: "old-priority",
			title: "Old request",
			attention: "action_required",
			resolutionStatus: "open",
		});
		renderPage({
			rows: [
				row(source, {
					itemCount: 3,
					unreadCount: 3,
					group: { kind: "space", conversationCount: 1 },
				}),
			],
			deepLinkedItem: source,
			itemId: source.id,
			view: "mentions",
		});
		mocks.read.mockResolvedValue({
			item: { ...source, readAt: "2026-09-18T01:00:00Z" },
		});
		const selected = await screen.findByRole("region", {
			name: "Selected update",
		});
		const link = within(selected).getByRole("link", {
			name: OLD_REQUEST_LABEL,
		});
		await waitFor(() => expect(document.activeElement).toBe(link));
		expect(
			screen.getByRole("button", {
				name: "Design Room 1 conversation · 3 unread",
			})
		).toBeTruthy();
		expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
			behavior: "auto",
			block: "nearest",
		});
		expect(mocks.item).toHaveBeenCalledWith(
			expect.objectContaining({
				itemId: source.id,
				organizationId: "organization-123",
			})
		);
		expect(mocks.feed).not.toHaveBeenCalledWith(
			expect.objectContaining({ cursor: expect.any(String) })
		);
		await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
	});

	it("does not rewrite an already-read deep link and explains an inaccessible one", async () => {
		const source = item({ id: "read", readAt: "2026-09-18T00:00:00Z" });
		const rendered = renderPage({
			rows: [],
			itemId: source.id,
			deepLinkedItem: source,
		});
		expect(
			await screen.findByRole("region", { name: "Selected update" })
		).toBeTruthy();
		expect(mocks.read).not.toHaveBeenCalled();
		rendered.unmount();
		renderPage({ rows: [], itemId: "missing" });
		expect(await screen.findByText(UNAVAILABLE_LABEL)).toBeTruthy();
		expect(mocks.read).not.toHaveBeenCalled();
	});

	it("freezes the selected view before confirmation and never invokes the legacy all-history mutation", async () => {
		const pending = item({
			id: "pending",
			attention: "action_required",
			resolutionStatus: "open",
			title: "Choose a folder",
		});
		const { queryClient, queryKey } = renderPage({
			rows: [row(pending, { section: "open", requestCategory: "action" })],
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Mark 1 item as read" })
		);
		const dialog = await screen.findByRole("alertdialog", {
			name: "Mark 1 item as read?",
		});
		expect(within(dialog).getByText(FROZEN_SELECTION_DESCRIPTION)).toBeTruthy();
		expect(mocks.selection).not.toHaveBeenCalled();
		act(() =>
			queryClient.setQueryData(queryKey, {
				pageParams: [undefined],
				pages: [
					{
						...page([row(pending)]),
						selectionUnreadCount: 7,
						snapshotId: "newer-snapshot",
					},
				],
			})
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Mark 1 item as read" })
		);
		await waitFor(() =>
			expect(mocks.selection).toHaveBeenCalledExactlyOnceWith({
				organizationId: "organization-123",
				snapshotId: "snapshot",
				operation: "read",
			})
		);
		expect(mocks.legacyReadAll).not.toHaveBeenCalled();
		expect(screen.getByText("Awaiting your action")).toBeTruthy();
	});

	it("dismisses an individual request without claiming the source was resolved", async () => {
		const pending = item({
			id: "pending",
			attention: "action_required",
			resolutionStatus: "open",
			title: "Pending request",
		});
		const onItemDismissed = vi.fn();
		renderPage({
			rows: [row(pending, { section: "open", requestCategory: "action" })],
			onItemDismissed,
		});
		mocks.dismiss.mockResolvedValue({ dismissedItemId: pending.id });
		mocks.feed.mockResolvedValue(page([]));
		fireEvent.click(
			screen.getByRole("button", { name: "Actions for Pending request" })
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Remove from Inbox" })
		);
		expect(mocks.dismiss).not.toHaveBeenCalled();
		const dialog = screen.getByRole("alertdialog");
		expect(within(dialog).getByText(SOURCE_PRESERVED)).toBeTruthy();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove from Inbox" })
		);
		await waitFor(() =>
			expect(mocks.dismiss).toHaveBeenCalledWith({
				organizationId: "organization-123",
				itemId: pending.id,
			})
		);
		expect(onItemDismissed).toHaveBeenCalledWith(pending.id);
		expect(pending.resolutionStatus).toBe("open");
		expect(screen.queryByText("Ended")).toBeNull();
	});

	it("allows cancelling group removal and freezes the confirmed group before live refresh", async () => {
		const first = item({ id: "first", title: "Conversation" });
		const original = row(first, {
			itemCount: 12,
			unreadCount: 12,
			groupKey: "frozen-group",
			group: { kind: "space", conversationCount: 1 },
		});
		const { queryClient, queryKey } = renderPage({ rows: [original] });
		fireEvent.click(
			screen.getByRole("button", { name: "More actions for Design Room" })
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Remove from Inbox" })
		);
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "Cancel",
			})
		);
		expect(mocks.selection).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		fireEvent.click(
			screen.getByRole("button", { name: "More actions for Design Room" })
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: "Remove from Inbox" })
		);
		act(() =>
			queryClient.setQueryData(queryKey, {
				pageParams: [undefined],
				pages: [{ ...page([original]), snapshotId: "newer-snapshot" }],
			})
		);
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "Remove from Inbox",
			})
		);
		await waitFor(() =>
			expect(mocks.selection).toHaveBeenCalledExactlyOnceWith({
				organizationId: "organization-123",
				snapshotId: "snapshot",
				groupKey: "frozen-group",
				operation: "dismiss",
			})
		);
		expect(mocks.read).not.toHaveBeenCalled();
	});

	it("shows one refresh warning when the Inbox and an open group both fail to refresh", async () => {
		const first = item({ id: "first", title: "Monica contacted your Codex" });
		const second = item({ id: "second", title: "Codex replied" });
		const { queryClient } = renderPage({
			rows: [
				row(first, {
					itemCount: 12,
					unreadCount: 12,
					groupKey: "Y29udmVyc2F0aW9u",
					group: { kind: "space", conversationCount: 2 },
				}),
			],
			expandedRows: [row(first), row(second)],
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Design Room 2 conversations · 12 unread",
			})
		);
		expect(await screen.findByText("Codex replied")).toBeTruthy();
		mocks.feed.mockRejectedValue(new Error("Connection lost"));
		await act(async () => {
			await queryClient.refetchQueries();
		});
		await waitFor(() =>
			expect(
				screen.getAllByText(
					"Couldn’t refresh. Showing the latest Inbox view available."
				)
			).toHaveLength(1)
		);
		expect(screen.getByText("Codex replied")).toBeTruthy();
	});

	it("tells an open group that failed its first load to try again", async () => {
		const first = item({ id: "first", title: "Monica contacted your Codex" });
		renderPage({
			rows: [
				row(first, {
					itemCount: 12,
					unreadCount: 12,
					groupKey: "Y29udmVyc2F0aW9u",
					group: { kind: "space", conversationCount: 2 },
				}),
			],
		});
		mocks.feed.mockImplementation((query: { groupKey?: string }) =>
			query.groupKey
				? Promise.reject(new Error("Connection lost"))
				: Promise.resolve(page([]))
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Design Room 2 conversations · 12 unread",
			})
		);
		expect(
			await screen.findByText("Couldn’t load the updates in this group.")
		).toBeTruthy();
		expect(
			screen.queryByText(
				"Couldn’t refresh. Showing the latest Inbox view available."
			)
		).toBeNull();
	});

	it("remembers expand-all and individual overrides without marking anything as read", async () => {
		const first = item({ id: "first", title: "Conversation" });
		const grouped = row(first, {
			itemCount: 12,
			unreadCount: 12,
			groupKey: "group",
			group: { kind: "space", conversationCount: 1 },
		});
		renderPage({ rows: [grouped], expandedRows: [row(first)] });
		fireEvent.click(screen.getByRole("button", { name: "Expand groups" }));
		expect(
			screen
				.getByRole("button", { name: "Design Room 1 conversation · 12 unread" })
				.getAttribute("aria-expanded")
		).toBe("true");
		cleanup();
		renderPage({ rows: [grouped], expandedRows: [row(first)] });
		expect(
			await screen.findByRole("button", {
				name: "Design Room 1 conversation · 12 unread",
			})
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Design Room 1 conversation · 12 unread",
			})
		);
		cleanup();
		renderPage({ rows: [grouped], expandedRows: [row(first)] });
		expect(
			screen
				.getByRole("button", { name: "Design Room 1 conversation · 12 unread" })
				.getAttribute("aria-expanded")
		).toBe("false");
		expect(mocks.read).not.toHaveBeenCalled();
		expect(mocks.selection).not.toHaveBeenCalled();
	});
});

function renderPage(
	input: Partial<ComponentProps<typeof InboxPage>> & {
		rows: InboxFeedRow[];
		conversationNames?: ConversationNames;
		nextRows?: InboxFeedRow[];
		nextPageError?: Error;
		expandedRows?: InboxFeedRow[];
		deepLinkedItem?: InboxItem;
		prime?: boolean;
		preserveFeedMock?: boolean;
	}
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const queryKey = organizationInboxFeedQueryOptions({
		organizationId: "organization-123",
		accountId: "user-123",
		category: input.view ?? "all",
		grouping: "space",
		unreadOnly: input.unreadOnly ?? false,
		agentsOnly: input.agentsOnly ?? false,
		peopleOnly: input.peopleOnly,
		conversationType: input.conversationType,
	}).queryKey;
	const first = page(input.rows, input.nextRows ? "next-page" : null);
	if (input.prime !== false) {
		queryClient.setQueryData(queryKey, {
			pageParams: [undefined],
			pages: [first],
		});
	}
	if (!input.preserveFeedMock) {
		mocks.feed.mockImplementation(
			(query: { cursor?: string; groupKey?: string }) => {
				if (query.groupKey) {
					return Promise.resolve(page(input.expandedRows ?? []));
				}
				if (query.cursor) {
					return input.nextPageError
						? Promise.reject(input.nextPageError)
						: Promise.resolve(page(input.nextRows ?? []));
				}
				return Promise.resolve(first);
			}
		);
	}
	mocks.item.mockImplementation(() =>
		input.deepLinkedItem
			? Promise.resolve({ item: input.deepLinkedItem })
			: Promise.reject(Object.assign(new Error("Not found"), { status: 404 }))
	);
	const rendered = render(
		<QueryClientProvider client={queryClient}>
			<ConversationNamesContext value={input.conversationNames ?? null}>
				<InboxPage
					agentsOnly={input.agentsOnly}
					conversationType={input.conversationType}
					itemId={input.itemId}
					onFiltersChange={input.onFiltersChange}
					onItemDismissed={input.onItemDismissed}
					onUnreadOnlyChange={input.onUnreadOnlyChange}
					onViewChange={input.onViewChange ?? vi.fn()}
					peopleOnly={input.peopleOnly}
					unreadOnly={input.unreadOnly}
					view={input.view ?? "all"}
				/>
			</ConversationNamesContext>
		</QueryClientProvider>
	);
	return { ...rendered, queryClient, queryKey };
}

function page(
	rows: InboxFeedRow[],
	nextCursor: string | null = null
): InboxFeedResponse {
	return {
		organizationId: "organization-123",
		snapshotId: "snapshot",
		snapshotExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
		nextCursor,
		selectionUnreadCount: rows.reduce(
			(n, current) => n + current.unreadCount,
			0
		),
		rows,
		counts: {
			all: rows.reduce((n, current) => n + current.itemCount, 0),
			mentions: rows.length,
			needsAction: rows.filter(
				(current) => current.requestCategory === "action"
			).length,
			needsReview: rows.filter(
				(current) => current.requestCategory === "review"
			).length,
			unread: rows.reduce((n, current) => n + current.unreadCount, 0),
			priority: rows.filter((current) => current.section === "priority").length,
		},
	};
}

function row(
	source: InboxItem,
	changes: Partial<InboxFeedRow> = {}
): InboxFeedRow {
	return {
		item: source,
		groupKey: btoa(source.id).replaceAll("=", ""),
		itemCount: 1,
		unreadCount: source.readAt ? 0 : 1,
		latestOccurredAt: source.occurredAt,
		section: "activity",
		requestCategory: null,
		dot: source.readAt ? null : "blue",
		...changes,
	};
}

function item(changes: Partial<InboxItem> = {}): InboxItem {
	return {
		attention: "update",
		contextLabel: "Design Room",
		createdAt: "2026-09-18T01:00:00Z",
		id: "item-123",
		importance: "normal",
		kind: "space_message",
		occurredAt: "2026-09-18T01:00:00Z",
		organizationId: "organization-123",
		preview: "Review the latest message.",
		readAt: null,
		recipientUserId: "user-123",
		resolutionStatus: "not_applicable",
		sourceTarget: {
			kind: "space",
			spaceId: "space-123",
			signalId: "signal-123",
		},
		title: "New Space message",
		updatedAt: "2026-09-18T01:00:00Z",
		...changes,
	};
}

function intersect(): void {
	const target = observed.mock.calls.at(-1)?.[0] as Element | undefined;
	if (!(target && intersectionCallback)) {
		throw new Error("The list sentinel was not observed");
	}
	act(() =>
		intersectionCallback?.(
			[{ isIntersecting: true, target } as IntersectionObserverEntry],
			{} as IntersectionObserver
		)
	);
}
