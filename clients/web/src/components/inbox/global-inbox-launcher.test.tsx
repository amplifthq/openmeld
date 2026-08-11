import type { InboxItem } from "@openmeld/schemas/types";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type {
	AnchorHTMLAttributes,
	ComponentProps,
	MouseEvent as ReactMouseEvent,
	ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalInboxLauncher } from "./global-inbox-launcher";

const getCurrentInboxSummaryMock = vi.hoisted(() => vi.fn());
const listCurrentInboxItemsMock = vi.hoisted(() => vi.fn());
const markCurrentInboxItemReadMock = vi.hoisted(() => vi.fn());
const useOptionalAppOrganizationMock = vi.hoisted(() => vi.fn());
const NEW_SPACE_MESSAGE_NAME_PATTERN = /New Space message/;
const OPEN_INBOX_PREVIEW_NAME_PATTERN = /^Open Inbox preview/;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		onClick,
		to,
		...props
	}: {
		children: ReactNode;
		onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a
			href={to}
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
	useAppOrganization: () => {
		const value = useOptionalAppOrganizationMock();
		if (!value) {
			throw new Error("Organization context is unavailable.");
		}
		return value;
	},
	useOptionalAppOrganization: useOptionalAppOrganizationMock,
}));

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentInboxItem: vi.fn(),
	getCurrentInboxNotificationPreferences: vi.fn(),
	getCurrentInboxSummary: getCurrentInboxSummaryMock,
	listCurrentInboxItems: listCurrentInboxItemsMock,
	markCurrentInboxItemRead: markCurrentInboxItemReadMock,
}));

describe("GlobalInboxLauncher", () => {
	beforeEach(() => {
		useOptionalAppOrganizationMock.mockReset().mockReturnValue({
			currentOrganization: {
				id: "organization-123",
				name: "Amplift",
				slug: "amplift",
			},
		});
		getCurrentInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "organization-123",
			totalUnreadCount: 3,
			unresolvedActionCount: 2,
		});
		listCurrentInboxItemsMock.mockReset().mockImplementation(async (input) => ({
			items: [
				input.view === "needs_action"
					? {
							...createInboxItem(),
							attention: "action_required",
							id: "action-123",
							resolutionStatus: "open",
							title: "Approval needed",
						}
					: createInboxItem(),
			],
			nextCursor: null,
			organizationId: "organization-123",
		}));
		markCurrentInboxItemReadMock.mockReset().mockResolvedValue({
			item: {
				...createInboxItem(),
				readAt: "2026-08-04T03:00:00.000Z",
			},
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("stays hidden before the organization app shell is available", () => {
		useOptionalAppOrganizationMock.mockReturnValue(null);

		const rendered = renderLauncher();

		expect(rendered.container.childElementCount).toBe(0);
		expect(getCurrentInboxSummaryMock).not.toHaveBeenCalled();
	});

	it("opens a compact Inbox preview and exposes the full Inbox", async () => {
		renderLauncher();

		const trigger = await screen.findByRole("button", {
			name: "Open Inbox preview, 2 items need your attention",
		});
		const attentionIndicator = trigger.querySelector(
			'span[aria-hidden="true"]'
		);
		expect(trigger.className).toContain("border-0");
		expect(trigger.className).toContain("bg-transparent");
		expect(trigger.className).toContain("hover:bg-muted");
		expect(trigger.className).toContain("motion-reduce:transition-none");
		expect(trigger.className).not.toContain("bg-[var(--app-canvas)]");
		expect(attentionIndicator?.textContent).toBe("2");
		expect(attentionIndicator?.className).not.toContain("border");
		expect(attentionIndicator?.className).not.toContain("bg-");
		expect(screen.queryByRole("link", { name: "Inbox" })).toBeNull();
		fireEvent.click(trigger);

		expect(
			await screen.findByRole("dialog", { name: "Inbox preview" })
		).toBeTruthy();
		expect(screen.getByRole("status").textContent).toBe(
			"2 items need your attention"
		);
		expect(
			screen.getByRole("link", { name: "Open full Inbox" }).getAttribute("href")
		).toBe("/o/amplift/inbox");
		expect(
			await screen.findByRole("link", {
				name: NEW_SPACE_MESSAGE_NAME_PATTERN,
			})
		).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Needs action" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Recent updates" })
		).toBeTruthy();
		expect(listCurrentInboxItemsMock).toHaveBeenCalledWith(
			expect.objectContaining({ view: "needs_action" })
		);
		expect(listCurrentInboxItemsMock).toHaveBeenCalledWith(
			expect.objectContaining({ view: "unread" })
		);
	});

	it("shows unresolved actions once and keeps Recent updates limited to unread updates", async () => {
		const actionItem: InboxItem = {
			...createInboxItem(),
			attention: "action_required",
			id: "action-123",
			resolutionStatus: "open",
			title: "Approval needed",
		};
		listCurrentInboxItemsMock.mockImplementation(async (input) => ({
			items:
				input.view === "needs_action"
					? [actionItem]
					: [actionItem, createInboxItem()],
			nextCursor: null,
			organizationId: "organization-123",
		}));
		renderLauncher();

		fireEvent.click(
			await screen.findByRole("button", {
				name: "Open Inbox preview, 2 items need your attention",
			})
		);

		expect(await screen.findAllByText("Approval needed")).toHaveLength(1);
		expect(
			screen.getByRole("link", { name: NEW_SPACE_MESSAGE_NAME_PATTERN })
		).toBeTruthy();
		expect(listCurrentInboxItemsMock).toHaveBeenCalledWith(
			expect.objectContaining({ view: "unread" })
		);
	});

	it("accepts a controlled open state for the shared global toolbar", async () => {
		const onOpenChange = vi.fn();
		renderLauncher({ onOpenChange, open: true });

		expect(
			await screen.findByRole("dialog", { name: "Inbox preview" })
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: OPEN_INBOX_PREVIEW_NAME_PATTERN,
			})
		);
		expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
	});

	it("shows unresolved actions instead of claiming the Inbox is caught up", async () => {
		getCurrentInboxSummaryMock.mockResolvedValue({
			organizationId: "organization-123",
			totalUnreadCount: 0,
			unresolvedActionCount: 6,
		});
		listCurrentInboxItemsMock.mockResolvedValue({
			items: [
				{
					...createInboxItem(),
					attention: "action_required",
					resolutionStatus: "open",
					title: "Review requested",
				},
			],
			nextCursor: null,
			organizationId: "organization-123",
		});
		renderLauncher();

		fireEvent.click(
			await screen.findByRole("button", {
				name: "Open Inbox preview, 6 items need your attention",
			})
		);

		expect((await screen.findByRole("status")).textContent).toBe(
			"6 items need your attention"
		);
		expect(screen.queryByText("All caught up")).toBeNull();
		await waitFor(() => {
			expect(listCurrentInboxItemsMock).toHaveBeenCalledWith(
				expect.objectContaining({ view: "needs_action" })
			);
		});
	});

	it("keeps attention status explicitly unknown when the summary fails", async () => {
		getCurrentInboxSummaryMock.mockRejectedValue(
			new Error("Summary unavailable")
		);
		renderLauncher();

		const trigger = await screen.findByRole("button", {
			name: "Open Inbox preview, attention status unavailable",
		});
		fireEvent.click(trigger);

		expect((await screen.findByRole("status")).textContent).toBe(
			"Couldn’t check for updates"
		);
		expect(screen.queryByText("All caught up")).toBeNull();
	});

	it("announces a preview loading failure", async () => {
		listCurrentInboxItemsMock.mockRejectedValue(new Error("Items unavailable"));
		renderLauncher();
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Open Inbox preview, 2 items need your attention",
			})
		);

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Couldn’t load your Inbox."
		);
	});

	it("does not hide a failed Needs action section behind successful updates", async () => {
		listCurrentInboxItemsMock.mockImplementation((input) => {
			if (input.view === "needs_action") {
				return Promise.reject(new Error("Actions unavailable"));
			}
			return Promise.resolve({
				items: [createInboxItem()],
				nextCursor: null,
				organizationId: "organization-123",
			});
		});
		renderLauncher();
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Open Inbox preview, 2 items need your attention",
			})
		);

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Couldn’t load your Inbox."
		);
		expect(screen.queryByText("Recent updates")).toBeNull();
	});

	it("marks an unread preview item as read when its source opens", async () => {
		renderLauncher();
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Open Inbox preview, 2 items need your attention",
			})
		);

		fireEvent.click(
			await screen.findByRole("link", {
				name: NEW_SPACE_MESSAGE_NAME_PATTERN,
			})
		);

		await waitFor(() => {
			expect(markCurrentInboxItemReadMock).toHaveBeenCalledWith({
				itemId: "item-123",
				organizationId: "organization-123",
				read: true,
			});
		});
	});
});

function renderLauncher(
	props: ComponentProps<typeof GlobalInboxLauncher> = {}
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false, retryDelay: 1 },
		},
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<GlobalInboxLauncher {...props} />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

function createInboxItem(): InboxItem {
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
	};
}
