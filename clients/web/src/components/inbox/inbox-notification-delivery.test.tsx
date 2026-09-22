import type { InboxItem } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readInboxNotificationSettings,
	readPendingInboxNotificationItemIds,
} from "#/lib/inbox/client-notifications";
import { InboxNotificationListener } from "./inbox-notification-listener";

const network = vi.hoisted(() => ({
	observe: vi.fn(),
	get: vi.fn(),
	preferences: vi.fn(),
	sound: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("#/desktop/platform", () => ({ getDesktopPlatform: () => null }));
vi.mock("#/desktop/updater", () => ({ useDesktopUpdater: () => null }));
vi.mock("#/components/app/current-computer", () => ({
	useCurrentComputer: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => network.navigate,
	useLocation: () => ({ pathname: "/o/test/inbox" }),
}));
vi.mock("#/lib/organizations/inbox", () => ({
	observeCurrentInboxNotifications: network.observe,
	getCurrentInboxItem: network.get,
	getCurrentInboxMessageNotificationPreferences: network.preferences,
}));
vi.mock("#/lib/inbox/browser-notification-sound", () => ({
	queueInboxBrowserNotificationSound: network.sound,
	readInboxBrowserNotificationSoundEnabled: () => true,
	writeInboxBrowserNotificationSoundEnabled: vi.fn(),
}));

const identity = { organizationId: "org", userId: "user" };
const queryKey = ["inbox", "org", "notification-observations"];
let rows: InboxItem[];
let notifications: BrowserNotification[];
let autoShow: boolean;
let client: QueryClient;
class BrowserNotification {
	static permission = "granted";
	onshow: ((event: Event) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onclose: ((event: Event) => void) | null = null;
	onclick: (() => void) | null = null;
	closed = false;
	readonly title: string;
	constructor(title: string, _options?: NotificationOptions) {
		this.title = title;
		notifications.push(this);
		if (autoShow) {
			queueMicrotask(() => this.onshow?.(new Event("show")));
		}
	}
	close() {
		this.closed = true;
	}
}
function item(id: string): InboxItem {
	return {
		id,
		organizationId: "org",
		recipientUserId: "user",
		kind: "space_mention",
		attention: "update",
		importance: "normal",
		readAt: null,
		resolutionStatus: "not_applicable",
		title: id,
		preview: "Hello",
		contextLabel: null,
		createdAt: "2026-09-22T00:00:00Z",
		occurredAt: "2026-09-22T00:00:00Z",
		updatedAt: "2026-09-22T00:00:00Z",
		sourceTarget: { kind: "space", spaceId: "space", signalId: id },
	};
}
async function mount() {
	const view = render(
		<QueryClientProvider client={client}>
			<InboxNotificationListener {...identity} organizationSlug="test" />
		</QueryClientProvider>
	);
	await waitFor(() =>
		expect(client.getQueryData([...queryKey, "user", true])).toBeTruthy()
	);
	return view;
}
async function refresh() {
	await act(async () => {
		await client.refetchQueries({ queryKey });
	});
}

describe("Notification observation to browser delivery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rows = [];
		notifications = [];
		autoShow = true;
		window.localStorage.clear();
		Object.defineProperty(window, "Notification", {
			configurable: true,
			value: BrowserNotification,
		});
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		network.get.mockImplementation(async ({ itemId }: { itemId: string }) => ({
			item: rows.find((value) => value.id === itemId),
		}));
		network.preferences.mockResolvedValue({
			effectiveMode: "mentions_and_replies",
		});
		network.observe.mockImplementation(
			({ cursor, limit }: { cursor?: string; limit: number }) => {
				if (cursor === undefined) {
					return Promise.resolve({
						organizationId: "org",
						items: [],
						cursor: String(rows.length),
						hasMore: false,
					});
				}
				const offset = Number(cursor);
				const next = Math.min(rows.length, offset + limit);
				return Promise.resolve({
					organizationId: "org",
					items: rows.slice(offset, next),
					cursor: String(next),
					hasMore: next < rows.length,
				});
			}
		);
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	});
	afterEach(() => {
		cleanup();
		client.clear();
		vi.restoreAllMocks();
		window.localStorage.clear();
	});

	it("delivers all 51 new items through the real query/listener and never notifies initial history", async () => {
		rows = [item("historical")];
		await mount();
		expect(notifications).toHaveLength(0);
		rows.push(
			...Array.from({ length: 51 }, (_, index) => item(`new-${index}`))
		);
		await refresh();
		await waitFor(() => expect(notifications).toHaveLength(50));
		await refresh();
		await waitFor(() => expect(notifications).toHaveLength(51));
		await waitFor(() =>
			expect(readPendingInboxNotificationItemIds(identity).size).toBe(0)
		);
		expect(
			new Set(notifications.map((notification) => notification.title))
		).toEqual(new Set(rows.slice(1).map((value) => value.id)));
		expect(network.get).toHaveBeenCalled();
		expect(rows.every((value) => value.readAt === null)).toBe(true);
	});

	it("keeps a partially retained page recoverable while write-failure feedback updates the mounted listener", async () => {
		const preferenceKey = "openmeld.inbox.browser-notifications.enabled:user";
		window.localStorage.setItem(preferenceKey, "enabled");
		await mount();
		rows.push(item("retained"), item("write-failed"));
		const originalSet = Storage.prototype.setItem;
		let remainingWrites = 1;
		const write = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(function (this: Storage, key, value) {
				if (this.getItem(key) !== value && remainingWrites-- <= 0) {
					throw new DOMException("Storage full", "QuotaExceededError");
				}
				originalSet.call(this, key, value);
			});
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			await refresh();
			expect(readInboxNotificationSettings(identity).unavailableReason).toBe(
				"storage_unavailable"
			);
			expect(readPendingInboxNotificationItemIds(identity)).toEqual(
				new Set(["retained"])
			);
			expect(notifications).toHaveLength(0);
			fireEvent.focus(window);
			await refresh();
			expect(readInboxNotificationSettings(identity).unavailableReason).toBe(
				"storage_unavailable"
			);
			expect(notifications).toHaveLength(0);
			expect(
				network.observe.mock.calls
					.slice(1)
					.every(([input]) => input.cursor === "0")
			).toBe(true);
			write.mockRestore();
			await refresh();
			await waitFor(() => expect(notifications).toHaveLength(2));
			await waitFor(() =>
				expect(readPendingInboxNotificationItemIds(identity).size).toBe(0)
			);
			expect(
				notifications.map((notification) => notification.title).sort()
			).toEqual(["retained", "write-failed"]);
			expect(readInboxNotificationSettings(identity)).toMatchObject({
				enabled: true,
				permission: "granted",
			});
			expect(
				readInboxNotificationSettings(identity).unavailableReason
			).toBeUndefined();
			expect(window.localStorage.getItem(preferenceKey)).toBe("enabled");
			await refresh();
			expect(notifications).toHaveLength(2);
		} finally {
			write.mockRestore();
			fireEvent.focus(window);
		}
	});

	it("retains an asynchronous display failure for retry and aborts an unacknowledged display on unmount", async () => {
		autoShow = false;
		const view = await mount();
		rows.push(item("new"));
		await refresh();
		await waitFor(() => expect(notifications).toHaveLength(1));
		await act(() => {
			notifications[0].onerror?.(new Event("error"));
		});
		expect(readPendingInboxNotificationItemIds(identity)).toEqual(
			new Set(["new"])
		);
		expect(network.sound).not.toHaveBeenCalled();
		fireEvent.blur(window);
		await waitFor(() => expect(notifications).toHaveLength(2));
		await act(() => {
			view.unmount();
		});
		expect(notifications[1].closed).toBe(true);
		expect(readPendingInboxNotificationItemIds(identity)).toEqual(
			new Set(["new"])
		);
		expect(
			window.localStorage.getItem(
				"openmeld.inbox.browser-notifications.delivered-item-ids"
			)
		).toBeNull();
	});
});
