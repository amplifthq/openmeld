import type { InboxItem } from "@openmeld/schemas/types";

export type InboxBrowserNotificationPermission =
	| NotificationPermission
	| "unsupported";

export type InboxBrowserNotificationSettings = {
	enabled: boolean;
	permission: InboxBrowserNotificationPermission;
};

const ENABLED_VALUE = "enabled";
const DISABLED_VALUE = "disabled";
const BADGE_PATH = "/favicon-32x32.png";
const ICON_PATH = "/apple-touch-icon.png";
const PREFERENCE_CHANGE_EVENT = "openmeld:inbox-browser-notifications-changed";
const DELIVERED_ITEM_IDS_KEY =
	"openmeld.inbox.browser-notifications.delivered-item-ids";
const MAX_DELIVERED_ITEM_IDS = 200;

export function readInboxBrowserNotificationSettings(input: {
	userId: string;
}): InboxBrowserNotificationSettings {
	const permission = readInboxBrowserNotificationPermission();
	return {
		enabled:
			permission === "granted" && readInboxBrowserPreference(input) === true,
		permission,
	};
}

export async function enableInboxBrowserNotifications(input: {
	userId: string;
}): Promise<InboxBrowserNotificationSettings> {
	const permission = await requestInboxBrowserNotificationPermission();
	if (permission === "granted") {
		writeInboxBrowserPreference({ ...input, enabled: true });
	} else if (permission === "denied") {
		writeInboxBrowserPreference({ ...input, enabled: false });
	}
	return readInboxBrowserNotificationSettings(input);
}

export function disableInboxBrowserNotifications(input: {
	userId: string;
}): InboxBrowserNotificationSettings {
	writeInboxBrowserPreference({ ...input, enabled: false });
	return readInboxBrowserNotificationSettings(input);
}

export function readInboxBrowserNotificationPermission(): InboxBrowserNotificationPermission {
	if (typeof window === "undefined" || !("Notification" in window)) {
		return "unsupported";
	}
	return window.Notification.permission;
}

export function isInboxBrowserNotificationEligible(item: InboxItem): boolean {
	if (item.importance === "urgent") {
		return true;
	}
	if (
		item.attention === "action_required" &&
		item.resolutionStatus === "open"
	) {
		return true;
	}
	return isDirectlyAddressedInboxUpdate(item.kind);
}

function isDirectlyAddressedInboxUpdate(kind: InboxItem["kind"]): boolean {
	return (
		kind === "space_reference" ||
		kind === "agent_reply" ||
		kind === "wake_outcome"
	);
}

export async function showInboxBrowserNotification(input: {
	item: InboxItem;
	sourcePath: string;
	viewingSourceSession: boolean;
}): Promise<Notification | null> {
	if (
		typeof window === "undefined" ||
		typeof document === "undefined" ||
		readInboxBrowserNotificationPermission() !== "granted" ||
		!isInboxBrowserNotificationEligible(input.item) ||
		(document.visibilityState === "visible" && input.viewingSourceSession)
	) {
		return null;
	}
	return await withInboxBrowserNotificationClaim(input.item.id, () => {
		const body = input.item.contextLabel
			? `${input.item.contextLabel}: ${input.item.preview}`
			: input.item.preview;
		const notification = new window.Notification(input.item.title, {
			badge: BADGE_PATH,
			body,
			icon: ICON_PATH,
			requireInteraction:
				input.item.importance === "urgent" ||
				(input.item.attention === "action_required" &&
					input.item.resolutionStatus === "open"),
			tag: `openmeld-inbox:${input.item.id}`,
		});
		notification.onclick = () => {
			window.focus();
			window.location.assign(input.sourcePath);
			notification.close();
		};
		return notification;
	});
}

export function subscribeInboxBrowserNotificationSettings(
	onChange: () => void
): () => void {
	if (typeof window === "undefined") {
		return () => undefined;
	}
	const handleStorage = (event: StorageEvent) => {
		if (
			event.key?.startsWith("openmeld.inbox.browser-notifications.enabled:")
		) {
			onChange();
		}
	};
	const handleVisibilityChange = () => {
		if (document.visibilityState === "visible") {
			onChange();
		}
	};
	window.addEventListener("storage", handleStorage);
	window.addEventListener(PREFERENCE_CHANGE_EVENT, onChange);
	window.addEventListener("focus", onChange);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	return () => {
		window.removeEventListener("storage", handleStorage);
		window.removeEventListener(PREFERENCE_CHANGE_EVENT, onChange);
		window.removeEventListener("focus", onChange);
		document.removeEventListener("visibilitychange", handleVisibilityChange);
	};
}

async function requestInboxBrowserNotificationPermission(): Promise<InboxBrowserNotificationPermission> {
	if (typeof window === "undefined" || !("Notification" in window)) {
		return "unsupported";
	}
	return await window.Notification.requestPermission();
}

function readInboxBrowserPreference(input: { userId: string }): boolean | null {
	if (typeof window === "undefined") {
		return null;
	}
	const key = buildInboxBrowserPreferenceKey(input.userId);
	try {
		const value = window.localStorage.getItem(key);
		if (value === ENABLED_VALUE) {
			return true;
		}
		if (value === DISABLED_VALUE) {
			return false;
		}
		if (value !== null) {
			console.warn("[openmeld.web.inbox.browser_preference_invalid]", { key });
			window.localStorage.removeItem(key);
		}
		return null;
	} catch (error) {
		console.warn("[openmeld.web.inbox.browser_preference_read_failed]", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

function writeInboxBrowserPreference(input: {
	enabled: boolean;
	userId: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			buildInboxBrowserPreferenceKey(input.userId),
			input.enabled ? ENABLED_VALUE : DISABLED_VALUE
		);
		window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT));
	} catch (error) {
		console.warn("[openmeld.web.inbox.browser_preference_write_failed]", {
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

function claimInboxBrowserNotificationDelivery(itemId: string): boolean {
	try {
		const storedValue = window.localStorage.getItem(DELIVERED_ITEM_IDS_KEY);
		const deliveredItemIds = parseDeliveredItemIds(storedValue);
		if (deliveredItemIds.includes(itemId)) {
			return false;
		}
		const nextDeliveredItemIds = [
			...deliveredItemIds.slice(-(MAX_DELIVERED_ITEM_IDS - 1)),
			itemId,
		];
		window.localStorage.setItem(
			DELIVERED_ITEM_IDS_KEY,
			JSON.stringify(nextDeliveredItemIds)
		);
		return true;
	} catch (error) {
		console.warn("[openmeld.web.inbox.browser_notification_claim_failed]", {
			error: error instanceof Error ? error.message : String(error),
			itemId,
		});
		return false;
	}
}

async function withInboxBrowserNotificationClaim<T>(
	itemId: string,
	deliver: () => T
): Promise<T | null> {
	const claimAndDeliver = () => {
		if (!claimInboxBrowserNotificationDelivery(itemId)) {
			return null;
		}
		try {
			return deliver();
		} catch (error) {
			releaseInboxBrowserNotificationDelivery(itemId);
			throw error;
		}
	};
	if (typeof navigator !== "undefined" && navigator.locks) {
		return await navigator.locks.request(
			`openmeld-inbox-notification:${itemId}`,
			{ mode: "exclusive" },
			claimAndDeliver
		);
	}
	return claimAndDeliver();
}

function releaseInboxBrowserNotificationDelivery(itemId: string): void {
	try {
		const deliveredItemIds = parseDeliveredItemIds(
			window.localStorage.getItem(DELIVERED_ITEM_IDS_KEY)
		);
		if (!deliveredItemIds.includes(itemId)) {
			return;
		}
		window.localStorage.setItem(
			DELIVERED_ITEM_IDS_KEY,
			JSON.stringify(
				deliveredItemIds.filter((deliveredItemId) => deliveredItemId !== itemId)
			)
		);
	} catch (error) {
		console.warn("[openmeld.web.inbox.browser_notification_release_failed]", {
			error: error instanceof Error ? error.message : String(error),
			itemId,
		});
	}
}

function parseDeliveredItemIds(value: string | null): string[] {
	if (value === null) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			Array.isArray(parsed) &&
			parsed.every((itemId) => typeof itemId === "string")
		) {
			return parsed;
		}
	} catch {
		// Invalid delivery claims are replaced by the next valid write.
	}
	return [];
}

function buildInboxBrowserPreferenceKey(userId: string): string {
	const normalizedUserId = userId.trim();
	if (!normalizedUserId) {
		throw new Error("Inbox browser notifications require a user id.");
	}
	return `openmeld.inbox.browser-notifications.enabled:${normalizedUserId}`;
}
