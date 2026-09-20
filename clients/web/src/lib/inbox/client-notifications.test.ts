import { isInboxNotificationEligible } from "@openmeld/api-client";
import type { InboxItem } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queueSoundMock = vi.hoisted(() => vi.fn());
const desktopPlatformMock = vi.hoisted(() => vi.fn());
vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: desktopPlatformMock,
}));
const readSoundEnabledMock = vi.hoisted(() => vi.fn(() => true));
const writeSoundEnabledMock = vi.hoisted(() => vi.fn());

vi.mock("./browser-notification-sound", () => ({
	INBOX_BROWSER_NOTIFICATION_SOUND_PREFERENCE_KEY_PREFIX:
		"openmeld.inbox.browser-notification-sounds.enabled",
	queueInboxBrowserNotificationSound: queueSoundMock,
	readInboxBrowserNotificationSoundEnabled: readSoundEnabledMock,
	writeInboxBrowserNotificationSoundEnabled: writeSoundEnabledMock,
}));

import {
	clearInboxNotificationItemPending,
	disableInboxNotifications,
	dismissInboxBrowserNotificationPrompt,
	enableInboxNotifications,
	markInboxNotificationItemPending,
	readInboxBrowserNotificationPromptDismissed,
	readInboxNotificationSettings,
	readPendingInboxNotificationItemIds,
	setInboxNotificationSoundEnabled,
	showInboxBrowserNotificationExample,
	showInboxNotification,
	subscribeInboxNotificationSettings,
} from "./client-notifications";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const PREFERENCE_KEY = `openmeld.inbox.browser-notifications.enabled:${USER_ID}`;
const PROMPT_DISMISSED_KEY = `openmeld.inbox.browser-notifications.prompt-dismissed:${USER_ID}`;

describe("Inbox browser notifications", () => {
	it("notifies a Human reply from the recipient marker, not the title or thread membership", async () => {
		await enableInboxNotifications({ userId: USER_ID });
		const item = createInboxItem({
			kind: "space_message",
			attention: "update",
			importance: "normal",
			resolutionStatus: "not_applicable",
			title: "A neutral localized title",
			sourceTarget: {
				kind: "space",
				spaceId: "space-123",
				signalId: "human-reply",
				threadRootSignalId: "root",
				replyToRecipient: true,
			},
		});
		expect(isInboxNotificationEligible(item, "mentions_and_replies")).toBe(
			true
		);
		expect(isInboxNotificationEligible(item, "muted")).toBe(false);
		const { replyToRecipient: _reply, ...ordinaryTarget } =
			item.sourceTarget as Extract<
				InboxItem["sourceTarget"],
				{ kind: "space" }
			>;
		expect(
			isInboxNotificationEligible(
				{
					...item,
					title: "Someone replied to your thread",
					sourceTarget: ordinaryTarget,
				},
				"mentions_and_replies"
			)
		).toBe(false);
		expect(
			await showInboxNotification({
				item,
				userId: USER_ID,
				onActivate: vi.fn(),
				viewingSourceSession: false,
			})
		).toMatchObject({ status: "delivered" });
		expect(notificationConstructorMock).toHaveBeenCalledOnce();
	});
	it("creates an ordinary-message notification only after the saved policy revalidation allows it", async () => {
		await enableInboxNotifications({ userId: USER_ID });
		const item = createInboxItem({
			kind: "space_message",
			attention: "update",
			importance: "normal",
			resolutionStatus: "not_applicable",
			sourceTarget: {
				kind: "space",
				spaceId: "space-123",
				signalId: "message-123",
			},
		});
		const input = {
			item,
			userId: USER_ID,
			onActivate: vi.fn(),
			viewingSourceSession: false,
		};
		expect(
			await showInboxNotification({
				...input,
				resolveCurrentReadiness: () => ({ status: "ineligible" }),
			})
		).toEqual({ status: "ineligible" });
		expect(notificationConstructorMock).not.toHaveBeenCalled();
		const delivered = await showInboxNotification({
			...input,
			resolveCurrentReadiness: () => ({ status: "eligible", item }),
		});
		expect(delivered).toMatchObject({ status: "delivered" });
		vi.spyOn(window, "focus").mockImplementation(() => undefined);
		if (delivered.status === "delivered") {
			delivered.notification?.onclick?.(new MouseEvent("click"));
		}
		expect(input.onActivate).toHaveBeenCalledExactlyOnceWith(item);
		expect(notificationConstructorMock).toHaveBeenCalledOnce();
	});
	it.each([
		["all_messages", "space_message", "normal", true],
		["mentions_and_replies", "space_message", "normal", false],
		["mentions_and_replies", "space_mention", "normal", true],
		["mentions_and_replies", "agent_reply", "normal", true],
		["muted", "space_mention", "normal", false],
		["muted", "space_message", "urgent", false],
		["muted", "wake_outcome", "urgent", false],
	] as const)("applies %s to %s messages (%s)", (mode, kind, importance, expected) => {
		const item = createInboxItem({
			kind,
			importance,
			attention: "update",
			resolutionStatus: "not_applicable",
			sourceTarget: {
				kind: "space",
				spaceId: "conversation",
				signalId: "message",
			},
		});
		expect(isInboxNotificationEligible(item, mode)).toBe(expected);
	});

	it("keeps direct messages eligible and does not mute independent action requests", () => {
		const directMessage = createInboxItem({
			kind: "space_message",
			importance: "normal",
			attention: "update",
			resolutionStatus: "not_applicable",
			sourceTarget: {
				kind: "space",
				spaceId: "dm",
				signalId: "message",
				directMessage: true,
			},
		});
		expect(
			isInboxNotificationEligible(directMessage, "mentions_and_replies")
		).toBe(true);
		expect(isInboxNotificationEligible(directMessage, "muted")).toBe(false);
		expect(
			isInboxNotificationEligible(
				{
					...directMessage,
					attention: "action_required",
					resolutionStatus: "open",
				},
				"muted"
			)
		).toBe(true);
	});

	it("shows an example only when enabled without adding delivery or unread records", async () => {
		expect(() => showInboxBrowserNotificationExample(USER_ID)).toThrow(
			"Enable browser notifications"
		);
		await enableInboxNotifications({ userId: USER_ID });
		const before = Object.entries(window.localStorage);
		const notification = showInboxBrowserNotificationExample(USER_ID);
		expect(notificationConstructorMock).toHaveBeenCalledWith(
			"OpenMeld notification example",
			expect.objectContaining({ tag: "openmeld-notification-example" })
		);
		expect(Object.entries(window.localStorage)).toEqual(before);
		expect(queueSoundMock).not.toHaveBeenCalled();
		notification.onshow?.call(notification, new Event("show"));
		expect(queueSoundMock).toHaveBeenCalledOnce();
		disableInboxNotifications({ userId: USER_ID });
		expect(() => showInboxBrowserNotificationExample(USER_ID)).toThrow(
			"Enable browser notifications"
		);
		await enableInboxNotifications({ userId: USER_ID });
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "denied",
			requestPermissionMock,
		});
		expect(() => showInboxBrowserNotificationExample(USER_ID)).toThrow(
			"Enable browser notifications before showing an example."
		);
		expect(notificationConstructorMock).toHaveBeenCalledOnce();
	});
	it("keeps Desktop preferences independent and only settles acknowledged native delivery", async () => {
		window.localStorage.setItem(PREFERENCE_KEY, "disabled");
		const showNotification = vi
			.fn()
			.mockResolvedValueOnce("unavailable")
			.mockResolvedValue("delivered");
		desktopPlatformMock.mockReturnValue({
			showNotification,
			notificationFocused: async () => false,
		});
		expect(readInboxNotificationSettings({ userId: USER_ID })).toEqual({
			enabled: true,
			permission: "unknown",
			soundEnabled: true,
		});
		disableInboxNotifications({ userId: USER_ID });
		expect(readInboxNotificationSettings({ userId: USER_ID }).enabled).toBe(
			false
		);
		await enableInboxNotifications({ userId: USER_ID });
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe("disabled");
		const send = () =>
			showInboxNotification({
				item: createInboxItem(),
				userId: USER_ID,
				organizationSlug: "workspace",
				onActivate: vi.fn(),
				viewingSourceSession: false,
			});
		expect((await send()).status).toBe("deferred");
		expect((await send()).status).toBe("delivered");
		expect((await send()).status).toBe("already_delivered");
		expect(showNotification).toHaveBeenCalledTimes(2);
		expect(queueSoundMock).not.toHaveBeenCalled();
	});
	it.each([
		true,
		false,
	])("uses native focus %s to suppress only the conversation being read", async (focused) => {
		const showNotification = vi.fn().mockResolvedValue("delivered");
		desktopPlatformMock.mockReturnValue({
			showNotification,
			notificationFocused: async () => focused,
		});
		const result = await showInboxNotification({
			item: createInboxItem(),
			userId: USER_ID,
			organizationSlug: "workspace",
			onActivate: vi.fn(),
			viewingSourceSession: true,
		});
		expect(result.status).toBe(focused ? "deferred" : "delivered");
		expect(showNotification).toHaveBeenCalledTimes(focused ? 0 : 1);
	});
	it("keeps delayed legacy owner observations quiet without coalescing independent Human mentions", async () => {
		await enableInboxNotifications({ userId: USER_ID });
		const item = createInboxItem({
			kind: "space_message",
			attention: "update",
			resolutionStatus: "not_applicable",
			sourceTarget: {
				kind: "space",
				agentOwnerActivity: true,
				spaceId: "owner-chat",
				signalId: "one",
				directMessage: true,
			},
		});
		const send = (value: InboxItem) =>
			showInboxNotification({
				item: value,
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			});
		expect((await send(item)).status).toBe("ineligible");
		expect(
			(
				await send({
					...item,
					id: "later-owner-message",
					occurredAt: new Date(
						Date.parse(item.occurredAt) + 120_000
					).toISOString(),
				})
			).status
		).toBe("ineligible");
		expect(notificationConstructorMock).not.toHaveBeenCalled();
		expect(queueSoundMock).not.toHaveBeenCalled();
		const mention = {
			...item,
			id: "human-mention-one",
			kind: "space_mention" as const,
			importance: "normal" as const,
		};
		expect((await send(mention)).status).toBe("delivered");
		expect((await send({ ...mention, id: "human-mention-two" })).status).toBe(
			"delivered"
		);
		expect((await send(mention)).status).toBe("already_delivered");
		expect(notificationConstructorMock).toHaveBeenCalledTimes(2);
		expect(queueSoundMock).toHaveBeenCalledTimes(2);
	});
	let notificationConstructorMock: ReturnType<typeof vi.fn>;
	let requestPermissionMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		desktopPlatformMock.mockReset().mockReturnValue(null);
		window.localStorage.clear();
		notificationConstructorMock = vi.fn();
		requestPermissionMock = vi.fn().mockResolvedValue("granted");
		queueSoundMock.mockReset();
		readSoundEnabledMock.mockReset().mockReturnValue(true);
		writeSoundEnabledMock.mockReset();
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
		expect(readInboxNotificationSettings({ userId: USER_ID })).toEqual({
			enabled: false,
			permission: "default",
			soundEnabled: true,
		});
		expect(requestPermissionMock).not.toHaveBeenCalled();

		const settings = await enableInboxNotifications({ userId: USER_ID });

		expect(requestPermissionMock).toHaveBeenCalledOnce();
		expect(settings).toEqual({
			enabled: true,
			permission: "granted",
			soundEnabled: true,
		});
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe("enabled");
	});

	it("does not save an opt-out when the permission prompt is dismissed", async () => {
		requestPermissionMock.mockResolvedValueOnce("default");

		const settings = await enableInboxNotifications({ userId: USER_ID });

		expect(settings).toEqual({
			enabled: false,
			permission: "default",
			soundEnabled: true,
		});
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBeNull();
	});

	it("defaults notifications on after the browser has already granted permission", () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});

		expect(readInboxNotificationSettings({ userId: USER_ID })).toEqual({
			enabled: true,
			permission: "granted",
			soundEnabled: true,
		});
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBeNull();
	});

	it("does not introduce notifications after an explicit off choice", () => {
		disableInboxNotifications({ userId: USER_ID });
		expect(
			readInboxBrowserNotificationPromptDismissed({ userId: USER_ID })
		).toBe(true);
	});

	it("notifies ordinary direct messages without promoting group messages", () => {
		expect(
			isInboxNotificationEligible(
				createInboxItem({
					attention: "update",
					importance: "normal",
					resolutionStatus: "not_applicable",
					kind: "space_message",
					sourceTarget: { kind: "space", spaceId: "dm", directMessage: true },
				})
			)
		).toBe(true);
		expect(
			isInboxNotificationEligible(
				createInboxItem({
					attention: "update",
					importance: "normal",
					resolutionStatus: "not_applicable",
					kind: "space_message",
					sourceTarget: { kind: "space", spaceId: "group" },
				})
			)
		).toBe(false);
	});

	it("remembers when this browser's notification introduction is dismissed", () => {
		expect(
			readInboxBrowserNotificationPromptDismissed({ userId: USER_ID })
		).toBe(false);

		dismissInboxBrowserNotificationPrompt({ userId: USER_ID });

		expect(
			readInboxBrowserNotificationPromptDismissed({ userId: USER_ID })
		).toBe(true);
		expect(window.localStorage.getItem(PROMPT_DISMISSED_KEY)).toBe("dismissed");
	});

	it("surfaces a local preference write failure", async () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
			throw new Error("Storage is unavailable");
		});

		await expect(enableInboxNotifications({ userId: USER_ID })).rejects.toThrow(
			"Storage is unavailable"
		);
	});

	it("turns off the local preference without changing browser permission", async () => {
		await enableInboxNotifications({ userId: USER_ID });

		const settings = disableInboxNotifications({ userId: USER_ID });

		expect(settings).toEqual({
			enabled: false,
			permission: "granted",
			soundEnabled: true,
		});
		expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe("disabled");
	});

	it("updates the browser-local sound preference without changing notification permission", () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});

		const settings = setInboxNotificationSoundEnabled({
			enabled: false,
			userId: USER_ID,
		});

		expect(writeSoundEnabledMock).toHaveBeenCalledWith({
			enabled: false,
			userId: USER_ID,
		});
		expect(settings.permission).toBe("granted");
	});

	it("refreshes settings after focus and every visibility change", () => {
		const onChange = vi.fn();
		const unsubscribe = subscribeInboxNotificationSettings(onChange);

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
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			}),
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
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
		expect(queueSoundMock).toHaveBeenCalledOnce();
		expect(queueSoundMock).toHaveBeenCalledWith({ item, userId: USER_ID });
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
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			})
		).rejects.toThrow("Notification constructor failed");
		await expect(
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
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
			showInboxNotification({
				item: createInboxItem({ id: "constructor-crash-item" }),
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			})
		).rejects.toThrow("Notification constructor failed");

		expect(window.localStorage.getItem(deliveredKey)).toBeNull();
		expect(queueSoundMock).not.toHaveBeenCalled();
	});

	it("keeps a successful notification delivered when sound queuing fails", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		queueSoundMock.mockImplementationOnce(() => {
			throw new Error("Sound queue unavailable");
		});
		const warning = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);

		await expect(
			showInboxNotification({
				item: createInboxItem({ id: "sound-queue-failure-item" }),
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			})
		).resolves.toMatchObject({ status: "delivered" });
		expect(notificationConstructorMock).toHaveBeenCalledOnce();
		expect(warning).toHaveBeenCalledWith(
			"[openmeld.web.inbox.browser_notification_sound_queue_failed]",
			expect.objectContaining({
				error: "Sound queue unavailable",
				itemId: "sound-queue-failure-item",
			})
		);
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
		let contextChanged = false;
		const item = createInboxItem({ id: "queued-context-item" });
		const delivery = showInboxNotification({
			item,
			resolveCurrentReadiness: () =>
				contextChanged
					? { status: "context_changed" as const }
					: { item, status: "eligible" as const },
			onActivate: vi.fn(),
			userId: USER_ID,
			viewingSourceSession: false,
		});

		contextChanged = true;
		releaseLock?.();

		await expect(delivery).resolves.toEqual({
			reason: "context_changed",
			status: "deferred",
		});
		expect(notificationConstructorMock).not.toHaveBeenCalled();
	});

	it("awaits authoritative item revalidation before creating a notification", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});

		await expect(
			showInboxNotification({
				item: createInboxItem({ id: "resolved-while-queued" }),
				resolveCurrentReadiness: async () => ({
					status: "ineligible" as const,
				}),
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			})
		).resolves.toEqual({ status: "ineligible" });
		expect(notificationConstructorMock).not.toHaveBeenCalled();
	});

	it("uses the fresh authoritative item to render a queued notification", async () => {
		installNotificationMock({
			constructorMock: notificationConstructorMock,
			permission: "granted",
			requestPermissionMock,
		});
		const queuedItem = createInboxItem();
		const freshItem = createInboxItem({
			attention: "update",
			importance: "normal",
			kind: "agent_reply",
			preview: "The migration review is complete.",
			resolutionStatus: "not_applicable",
			title: "Agent finished the review",
		});

		await expect(
			showInboxNotification({
				item: queuedItem,
				resolveCurrentReadiness: async () => ({
					item: freshItem,
					status: "eligible" as const,
				}),
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			})
		).resolves.toMatchObject({ status: "delivered" });

		expect(notificationConstructorMock).toHaveBeenCalledWith(
			"Agent finished the review",
			expect.objectContaining({
				body: "Design Room: The migration review is complete.",
				requireInteraction: false,
			})
		);
		expect(queueSoundMock).toHaveBeenCalledWith({
			item: freshItem,
			userId: USER_ID,
		});
	});

	it("keeps pending retries scoped to the user and Organization", () => {
		markInboxNotificationItemPending({
			itemId: "pending-item",
			organizationId: "organization-a",
			userId: USER_ID,
		});

		expect(
			readPendingInboxNotificationItemIds({
				organizationId: "organization-a",
				userId: USER_ID,
			})
		).toEqual(new Set(["pending-item"]));
		expect(
			readPendingInboxNotificationItemIds({
				organizationId: "organization-b",
				userId: USER_ID,
			})
		).toEqual(new Set());

		clearInboxNotificationItemPending({
			itemId: "pending-item",
			organizationId: "organization-a",
			userId: USER_ID,
		});
		expect(
			readPendingInboxNotificationItemIds({
				organizationId: "organization-a",
				userId: USER_ID,
			})
		).toEqual(new Set());
	});

	it("stores pending items in independent cross-tab-safe records", () => {
		markInboxNotificationItemPending({
			itemId: "pending-item-a",
			organizationId: "organization-a",
			userId: USER_ID,
		});
		markInboxNotificationItemPending({
			itemId: "pending-item-b",
			organizationId: "organization-a",
			userId: USER_ID,
		});

		const pendingKeys = Array.from(
			{ length: window.localStorage.length },
			(_, index) => window.localStorage.key(index)
		).filter((key) =>
			key?.startsWith("openmeld.inbox.browser-notifications.pending-item:")
		);
		expect(pendingKeys).toHaveLength(2);
		expect(
			readPendingInboxNotificationItemIds({
				organizationId: "organization-a",
				userId: USER_ID,
			})
		).toEqual(new Set(["pending-item-a", "pending-item-b"]));
	});

	it("skips one malformed pending key without hiding valid retries", () => {
		markInboxNotificationItemPending({
			itemId: "valid-pending-item",
			organizationId: "organization-a",
			userId: USER_ID,
		});
		window.localStorage.setItem(
			`openmeld.inbox.browser-notifications.pending-item:${encodeURIComponent(USER_ID)}:${encodeURIComponent("organization-a")}:broken%encoding`,
			"pending"
		);
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		expect(
			readPendingInboxNotificationItemIds({
				organizationId: "organization-a",
				userId: USER_ID,
			})
		).toEqual(new Set(["valid-pending-item"]));
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
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			})
		).resolves.toEqual({ reason: "claim_failed", status: "deferred" });
		expect(notificationConstructorMock).not.toHaveBeenCalled();

		storageRead.mockRestore();
		await expect(
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
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
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: true,
			})
		).resolves.toEqual({ reason: "source_visible", status: "deferred" });
		expect(notificationConstructorMock).not.toHaveBeenCalled();

		await expect(
			showInboxNotification({
				item,
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: false,
			})
		).resolves.toMatchObject({ status: "delivered" });
		expect(notificationConstructorMock).toHaveBeenCalledOnce();

		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		await expect(
			showInboxNotification({
				item: createInboxItem({ id: "hidden-tab-item" }),
				onActivate: vi.fn(),
				userId: USER_ID,
				viewingSourceSession: true,
			})
		).resolves.toMatchObject({ status: "delivered" });
	});

	it("delivers directly addressed updates but not ordinary space messages", () => {
		expect(
			isInboxNotificationEligible(
				createInboxItem({
					importance: "normal",
					kind: "space_mention",
				})
			)
		).toBe(true);
		expect(
			isInboxNotificationEligible(
				createInboxItem({ importance: "normal", kind: "agent_reply" })
			)
		).toBe(true);
		expect(
			isInboxNotificationEligible(
				createInboxItem({ importance: "normal", kind: "wake_outcome" })
			)
		).toBe(true);
		expect(
			isInboxNotificationEligible(createInboxItem({ importance: "urgent" }))
		).toBe(true);
		expect(
			isInboxNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "action_required",
					resolutionStatus: "open",
				})
			)
		).toBe(true);

		expect(
			isInboxNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "update",
					resolutionStatus: "not_applicable",
				})
			)
		).toBe(false);
		expect(
			isInboxNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "action_required",
					resolutionStatus: "resolved",
				})
			)
		).toBe(false);
		expect(
			isInboxNotificationEligible(
				createInboxItem({
					importance: "normal",
					attention: "update",
					kind: "agent_interaction",
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
