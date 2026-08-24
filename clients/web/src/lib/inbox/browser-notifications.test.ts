import type { InboxItem } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearInboxBrowserNotificationItemPending,
	disableInboxBrowserNotifications,
	enableInboxBrowserNotifications,
	isInboxBrowserNotificationEligible,
	markInboxBrowserNotificationItemPending,
	readInboxBrowserNotificationSettings,
	readPendingInboxBrowserNotificationItemIds,
	showInboxBrowserNotification,
	subscribeInboxBrowserNotificationSettings,
} from "./browser-notifications";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const PREFERENCE_KEY = `openmeld.inbox.browser-notifications.enabled:${USER_ID}`;

describe("Inbox browser notifications", () => {
	let notificationConstructorMock: ReturnType<typeof vi.fn>;
	let requestPermissionMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		window.localStorage.clear();
		notificationConstructorMock = vi.fn();
		requestPermissionMock = vi.fn().mockResolvedValue("granted");
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "default",
			requestPermissionMock,
		});
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
	});

	afterEach(() => {
		window.localStorage.clear();
		Object.defineProperty(navigator, "locks", {
			configurable: true,
			value: undefined,
		});
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("requires an explicit user action before notifications are enabled", async () => {
		expect(readInboxBrowserNotificationSettings({ userId: USER_ID })).toEqual({
			enabled: false,
			permission: "default",
		});
		expect(requestPermissionMock).not.toHaveBeenCalled();

		const settings = await enableInboxBrowserNotifications({ userId: USER_ID });

		expect(requestPermissionMock).toHaveBeenCalledOnce();
		expect(settings).toEqual({ enabled: true, permission: "granted" });
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe("enabled");
	});

	it("does not save an opt-out when the permission prompt is dismissed", async () => {
		requestPermissionMock.mockResolvedValueOnce("default");

		const settings = await enableInboxBrowserNotifications({ userId: USER_ID });

		expect(settings).toEqual({ enabled: false, permission: "default" });
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBeNull();
	});

	it("surfaces a local preference write failure", async () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
			throw new Error("Storage is unavailable");
		});

		await expect(
			enableInboxBrowserNotifications({ userId: USER_ID })
		).rejects.toThrow("Storage is unavailable");
	});

	it("turns off the local preference without changing browser permission", async () => {
		await enableInboxBrowserNotifications({ userId: USER_ID });

		const settings = disableInboxBrowserNotifications({ userId: USER_ID });

		expect(settings).toEqual({ enabled: false, permission: "granted" });
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe("disabled");
	});

	it("refreshes settings after focus and every visibility change", () => {
		const onChange = vi.fn();
		const unsubscribe = subscribeInboxBrowserNotificationSettings(onChange);

		window.dispatchEvent(new Event("focus"));
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		document.dispatchEvent(new Event("visibilitychange"));
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		document.dispatchEvent(new Event("visibilitychange"));

		expect(onChange).toHaveBeenCalledTimes(3);
		unsubscribe();
		window.dispatchEvent(new Event("focus"));
		expect(onChange).toHaveBeenCalledTimes(3);
	});

	it("shows one hidden-tab notification across concurrent tab delivery attempts", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		const item = createInboxItem();

		const requestLock = installExclusiveLockMock();
		const [first, second] = await Promise.all([
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/spaces/space-123?focusSignalId=signal-123",
				viewingSourceSession: false,
			}),
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/spaces/space-123?focusSignalId=signal-123",
				viewingSourceSession: false,
			}),
		]);

		expect(first.status).toBe("delivered");
		expect(second).toEqual({ status: "already_delivered" });
		expect(requestLock).toHaveBeenCalledTimes(2);
		expect(notificationConstructorMock).toHaveBeenCalledOnce();
		expect(notificationConstructorMock).toHaveBeenCalledWith(
			"Agent approval required",
			expect.objectContaining({
				body: "Design Room: Review the proposed database migration.",
				requireInteraction: true,
				tag: `openmeld-inbox:${item.id}`,
			})
		);
	});

	it("releases a failed delivery claim so the notification can be retried", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		notificationConstructorMock
			.mockImplementationOnce(() => {
				throw new Error("Notification constructor failed");
			})
			.mockImplementationOnce(() => undefined);
		const item = createInboxItem();

		await expect(
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/inbox?item=retry-item",
				viewingSourceSession: false,
			})
		).rejects.toThrow("Notification constructor failed");
		await expect(
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/inbox?item=retry-item",
				viewingSourceSession: false,
			})
		).resolves.toMatchObject({ status: "delivered" });
		expect(notificationConstructorMock).toHaveBeenCalledTimes(2);
	});

	it("does not record delivery before the Notification constructor succeeds", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		notificationConstructorMock.mockImplementationOnce(() => {
			throw new Error("Notification constructor failed");
		});
		const deliveredKey =
			"openmeld.inbox.browser-notifications.delivered-item-ids";

		await expect(
			showInboxBrowserNotification({
				item: createInboxItem({ id: "constructor-crash-item" }),
				sourcePath: "/o/amplift/inbox?item=constructor-crash-item",
				viewingSourceSession: false,
			})
		).rejects.toThrow("Notification constructor failed");

		expect(window.localStorage.getItem(deliveredKey)).toBeNull();
	});

	it("revalidates the active feed after acquiring the cross-tab lock", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		let releaseLock: (() => void) | undefined;
		const lockGate = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});
		Object.defineProperty(navigator, "locks", {
			configurable: true,
			value: {
				request: vi.fn(
					async <T>(
						_name: string,
						_options: LockOptions,
						callback: () => PromiseLike<T> | T
					) => {
						await lockGate;
						return await callback();
					}
				),
			},
		});
		let readiness: "eligible" | "context_changed" = "eligible";
		const delivery = showInboxBrowserNotification({
			item: createInboxItem({ id: "queued-context-item" }),
			resolveCurrentReadiness: () => readiness,
			sourcePath: "/o/amplift/inbox?item=queued-context-item",
			viewingSourceSession: false,
		});

		readiness = "context_changed";
		releaseLock?.();

		await expect(delivery).resolves.toEqual({
			reason: "context_changed",
			status: "deferred",
		});
		expect(notificationConstructorMock).not.toHaveBeenCalled();
	});

	it("keeps pending retries scoped to the user and Organization", () => {
		markInboxBrowserNotificationItemPending({
			itemId: "pending-item",
			organizationId: "organization-a",
			userId: USER_ID,
		});

		expect(
			readPendingInboxBrowserNotificationItemIds({
				organizationId: "organization-a",
				userId: USER_ID,
			})
		).toEqual(new Set(["pending-item"]));
		expect(
			readPendingInboxBrowserNotificationItemIds({
				organizationId: "organization-b",
				userId: USER_ID,
			})
		).toEqual(new Set());

		clearInboxBrowserNotificationItemPending({
			itemId: "pending-item",
			organizationId: "organization-a",
			userId: USER_ID,
		});
		expect(
			readPendingInboxBrowserNotificationItemIds({
				organizationId: "organization-a",
				userId: USER_ID,
			})
		).toEqual(new Set());
	});

	it("defers a failed cross-tab claim without marking the item delivered", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		const storageRead = vi
			.spyOn(Storage.prototype, "getItem")
			.mockImplementationOnce(() => {
				throw new Error("Storage is unavailable");
			});
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const item = createInboxItem({ id: "claim-retry-item" });

		await expect(
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/inbox?item=claim-retry-item",
				viewingSourceSession: false,
			})
		).resolves.toEqual({ reason: "claim_failed", status: "deferred" });
		expect(notificationConstructorMock).not.toHaveBeenCalled();

		storageRead.mockRestore();
		await expect(
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/inbox?item=claim-retry-item",
				viewingSourceSession: false,
			})
		).resolves.toMatchObject({ status: "delivered" });
		expect(notificationConstructorMock).toHaveBeenCalledOnce();
	});

	it("suppresses only the viewed conversation on a visible tab and keeps other deliveries", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		const item = createInboxItem();

		await expect(
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/inbox",
				viewingSourceSession: true,
			})
		).resolves.toEqual({ reason: "source_visible", status: "deferred" });
		expect(notificationConstructorMock).not.toHaveBeenCalled();

		await expect(
			showInboxBrowserNotification({
				item,
				sourcePath: "/o/amplift/inbox",
				viewingSourceSession: false,
			})
		).resolves.toMatchObject({ status: "delivered" });
		expect(notificationConstructorMock).toHaveBeenCalledOnce();

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		await expect(
			showInboxBrowserNotification({
				item: createInboxItem({ id: "hidden-tab-item" }),
				sourcePath: "/o/amplift/inbox",
				viewingSourceSession: true,
			})
		).resolves.toMatchObject({ status: "delivered" });
	});

	it("delivers directly addressed updates but not ordinary space messages", () => {
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({
					importance: "normal",
					kind: "space_reference",
				})
			)
		).toBe(true);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({ importance: "normal", kind: "agent_reply" })
			)
		).toBe(true);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({ importance: "normal", kind: "wake_outcome" })
			)
		).toBe(true);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "update",
					kind: "center_agent_task",
				})
			)
		).toBe(true);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({ importance: "urgent" })
			)
		).toBe(true);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "action_required",
					resolutionStatus: "open",
				})
			)
		).toBe(true);

		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "update",
					resolutionStatus: "not_applicable",
				})
			)
		).toBe(false);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "action_required",
					resolutionStatus: "resolved",
				})
			)
		).toBe(false);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "update",
					kind: "agent_interaction",
				})
			)
		).toBe(false);
		expect(
			isInboxBrowserNotificationEligible(
				createInboxItem({
					attention: "action_required",
					importance: "urgent",
					kind: "center_agent_task",
					resolutionStatus: "resolved",
				})
			)
		).toBe(false);
	});
});

function createInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		attention: "action_required",
		contextLabel: "Design Room",
		createdAt: "2026-08-04T01:00:00.000Z",
		id: "22222222-2222-2222-2222-222222222222",
		importance: "urgent",
		kind: "agent_interaction",
		occurredAt: "2026-08-04T01:00:00.000Z",
		organizationId: "33333333-3333-3333-3333-333333333333",
		preview: "Review the proposed database migration.",
		readAt: null,
		recipientUserId: USER_ID,
		resolutionStatus: "open",
		sourceTarget: {
			interactionId: "44444444-4444-4444-4444-444444444444",
			kind: "agent_interaction",
			runtimeCoordinatorExecutionId: "55555555-5555-5555-5555-555555555555",
			spaceId: "66666666-6666-6666-6666-666666666666",
		},
		title: "Agent approval required",
		updatedAt: "2026-08-04T01:00:00.000Z",
		...overrides,
	};
}

function installNotificationMock(input: {
	constructorMock: ReturnType<typeof vi.fn>;
	permission: NotificationPermission;
	requestPermissionMock: ReturnType<typeof vi.fn>;
}) {
	const permissionRef = { value: input.permission };
	class TestNotification {
		static get permission(): NotificationPermission {
			return permissionRef.value;
		}

		static async requestPermission(): Promise<NotificationPermission> {
			const permission =
				(await input.requestPermissionMock()) as NotificationPermission;
			permissionRef.value = permission;
			return permission;
		}

		onclick: (() => void) | null = null;

		constructor(title: string, options?: NotificationOptions) {
			input.constructorMock(title, options);
		}

		close() {
			return;
		}
	}

	Object.defineProperty(window, "Notification", {
		configurable: true,
		value: TestNotification,
	});
	vi.stubGlobal("Notification", TestNotification);
}

function installExclusiveLockMock() {
	let previousRequest = Promise.resolve<unknown>(undefined);
	const request = vi.fn(
		<T>(
			_name: string,
			_options: LockOptions,
			callback: () => PromiseLike<T> | T
		): Promise<T> => {
			const currentRequest = previousRequest.then(callback);
			previousRequest = currentRequest.catch(() => undefined);
			return currentRequest;
		}
	);
	Object.defineProperty(navigator, "locks", {
		configurable: true,
		value: { request },
	});
	return request;
}
