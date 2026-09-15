import { isInboxNotificationEligible } from "@openmeld/api-client";
import type { InboxItem } from "@openmeld/schemas/types";

import { getDesktopPlatform } from "#/desktop/platform";
import {
	queueInboxBrowserNotificationSound,
	readInboxBrowserNotificationSoundEnabled,
	writeInboxBrowserNotificationSoundEnabled,
} from "./browser-notification-sound";
import {
	DESKTOP_NOTIFICATION_SETTINGS_EVENT,
	isNotificationConversationVisible,
	readDesktopNotificationPreference,
	writeDesktopNotificationPreference,
} from "./desktop-notifications";

export type InboxNotificationPermission =
	| NotificationPermission
	| "unknown"
	| "unsupported";

export type InboxNotificationSettings = {
	enabled: boolean;
	permission: InboxNotificationPermission;
	soundEnabled: boolean;
};

export function resolveClientNotificationDescription(
	permission: InboxNotificationSettings["permission"]
): string {
	if (permission === "unknown") {
		return "Notify for directly addressed messages, actions, and urgent items while Desktop is running. Applies to every Space and Direct Message on this Mac.";
	}
	if (permission === "unsupported") {
		return "This browser does not support notifications. Your Inbox is still available in OpenMeld.";
	}
	if (permission === "denied") {
		return "Notifications are blocked. Allow them in your browser’s site settings, then return here.";
	}
	return "Notify for directly addressed messages, actions, and urgent items in this browser. Applies to every Space and Direct Message.";
}

export type InboxNotificationDeliveryResult =
	| { notification?: Notification; status: "delivered" }
	| { status: "already_delivered" }
	| { status: "ineligible" }
	| {
			reason:
				| "claim_failed"
				| "context_changed"
				| "permission_unavailable"
				| "revalidation_failed"
				| "source_visible";
			status: "deferred";
	  };

export type InboxNotificationDeliveryReadiness =
	| { item: InboxItem; status: "eligible" }
	| {
			status:
				| "context_changed"
				| "ineligible"
				| "revalidation_failed"
				| "source_visible";
	  };

const ENABLED_VALUE = "enabled";
const DISABLED_VALUE = "disabled";
const BADGE_PATH = "/favicon-32x32.png";
const ICON_PATH = "/apple-touch-icon.png";
const PREFERENCE_CHANGE_EVENT = "openmeld:inbox-browser-notifications-changed";
const PROMPT_DISMISSED_VALUE = "dismissed";
const PROMPT_DISMISSED_KEY_PREFIX =
	"openmeld.inbox.browser-notifications.prompt-dismissed";
const DELIVERED_ITEM_IDS_KEY =
	"openmeld.inbox.browser-notifications.delivered-item-ids";
const PENDING_ITEM_KEY_PREFIX =
	"openmeld.inbox.browser-notifications.pending-item";
const MAX_DELIVERED_ITEM_IDS = 200;

export function readInboxNotificationSettings(input: {
	userId: string;
}): InboxNotificationSettings {
	if (getDesktopPlatform()) {
		return {
			enabled: readDesktopNotificationPreference(input.userId, "enabled"),
			permission: "unknown",
			soundEnabled: readDesktopNotificationPreference(input.userId, "sound"),
		};
	}
	const permission = readInboxNotificationPermission();
	const preference = readInboxBrowserPreference(input);
	return {
		enabled: permission === "granted" && preference !== false,
		permission,
		soundEnabled: readInboxBrowserNotificationSoundEnabled(input),
	};
}

export function readInboxBrowserNotificationPromptDismissed(input: {
	userId: string;
}): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	if (readInboxBrowserPreference(input) !== null) {
		return true;
	}
	try {
		return (
			window.localStorage.getItem(
				buildInboxBrowserNotificationPromptKey(input)
			) === PROMPT_DISMISSED_VALUE
		);
	} catch (error) {
		console.warn(
			"[openmeld.web.inbox.browser_notification_prompt_read_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
			}
		);
		return false;
	}
}

export function dismissInboxBrowserNotificationPrompt(input: {
	userId: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			buildInboxBrowserNotificationPromptKey(input),
			PROMPT_DISMISSED_VALUE
		);
		window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT));
	} catch (error) {
		console.warn(
			"[openmeld.web.inbox.browser_notification_prompt_write_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
			}
		);
	}
}

export async function enableInboxNotifications(input: {
	userId: string;
}): Promise<InboxNotificationSettings> {
	if (getDesktopPlatform()) {
		writeDesktopNotificationPreference(input.userId, "enabled", true);
		return readInboxNotificationSettings(input);
	}
	const permission = await requestInboxNotificationPermission();
	if (permission === "granted") {
		writeInboxBrowserPreference({ ...input, enabled: true });
	} else if (permission === "denied") {
		writeInboxBrowserPreference({ ...input, enabled: false });
	}
	return readInboxNotificationSettings(input);
}

export function disableInboxNotifications(input: {
	userId: string;
}): InboxNotificationSettings {
	if (getDesktopPlatform()) {
		writeDesktopNotificationPreference(input.userId, "enabled", false);
		return readInboxNotificationSettings(input);
	}
	writeInboxBrowserPreference({ ...input, enabled: false });
	return readInboxNotificationSettings(input);
}

export function setInboxNotificationSoundEnabled(input: {
	enabled: boolean;
	userId: string;
}): InboxNotificationSettings {
	if (getDesktopPlatform()) {
		writeDesktopNotificationPreference(input.userId, "sound", input.enabled);
		return readInboxNotificationSettings(input);
	}
	writeInboxBrowserNotificationSoundEnabled(input);
	return readInboxNotificationSettings(input);
}

export function readInboxNotificationPermission(): InboxNotificationPermission {
	if (typeof window === "undefined" || !("Notification" in window)) {
		return "unsupported";
	}
	return window.Notification.permission;
}

export async function showInboxNotification(input: {
	item: InboxItem;
	resolveCurrentReadiness?: () =>
		| InboxNotificationDeliveryReadiness
		| Promise<InboxNotificationDeliveryReadiness>;
	sourcePath: string;
	organizationSlug?: string;
	userId: string;
	viewingSourceSession: boolean;
}): Promise<InboxNotificationDeliveryResult> {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return { reason: "permission_unavailable", status: "deferred" };
	}
	if (
		!getDesktopPlatform() &&
		readInboxNotificationPermission() !== "granted"
	) {
		return { reason: "permission_unavailable", status: "deferred" };
	}
	if (!isInboxNotificationEligible(input.item)) {
		return { status: "ineligible" };
	}
	if (
		input.viewingSourceSession &&
		(await isNotificationConversationVisible())
	) {
		return { reason: "source_visible", status: "deferred" };
	}
	// Coalesce owner awareness alerts within each minute without changing unread counts.
	const deliveryKey =
		input.item.sourceTarget.kind === "space" &&
		input.item.sourceTarget.agentOwnerActivity === true
			? `agent-owner:${input.userId}:${input.item.sourceTarget.spaceId}:${Math.floor(Date.parse(input.item.occurredAt) / 60_000)}`
			: input.item.id;
	return await withInboxNotificationClaim(deliveryKey, async () => {
		const currentReadiness = (await input.resolveCurrentReadiness?.()) ?? {
			item: input.item,
			status: "eligible",
		};
		if (currentReadiness.status === "ineligible") {
			return { status: "ineligible" };
		}
		if (currentReadiness.status !== "eligible") {
			return { reason: currentReadiness.status, status: "deferred" };
		}
		const currentItem = currentReadiness.item;
		if (getDesktopPlatform()) {
			return await deliverDesktopInboxNotification(
				input,
				currentItem,
				deliveryKey
			);
		}
		const body = currentItem.contextLabel
			? `${currentItem.contextLabel}: ${currentItem.preview}`
			: currentItem.preview;
		const notification = new window.Notification(currentItem.title, {
			badge: BADGE_PATH,
			body,
			icon: ICON_PATH,
			requireInteraction:
				currentItem.importance === "urgent" ||
				(currentItem.attention === "action_required" &&
					currentItem.resolutionStatus === "open"),
			tag:
				currentItem.sourceTarget.kind === "space" &&
				currentItem.sourceTarget.agentOwnerActivity === true
					? `openmeld-agent-owner:${input.userId}:${currentItem.sourceTarget.spaceId}`
					: `openmeld-inbox:${currentItem.id}`,
		});
		notification.onclick = () => {
			window.focus();
			window.location.assign(input.sourcePath);
			notification.close();
		};
		recordInboxNotificationReceipt(currentItem.id, deliveryKey);
		try {
			queueInboxBrowserNotificationSound({
				item: currentItem,
				userId: input.userId,
			});
		} catch (error) {
			console.warn(
				"[openmeld.web.inbox.browser_notification_sound_queue_failed]",
				{
					error: error instanceof Error ? error.message : String(error),
					itemId: currentItem.id,
				}
			);
		}
		return { notification, status: "delivered" };
	});
}

export function readPendingInboxNotificationItemIds(input: {
	organizationId: string;
	userId: string;
}): Set<string> {
	if (typeof window === "undefined") {
		return new Set();
	}
	try {
		const keyPrefix = buildPendingItemKeyPrefix(input);
		const itemIds = new Set<string>();
		for (let index = 0; index < window.localStorage.length; index += 1) {
			const key = window.localStorage.key(index);
			if (!key?.startsWith(keyPrefix)) {
				continue;
			}
			const encodedItemId = key.slice(keyPrefix.length);
			if (!encodedItemId) {
				continue;
			}
			try {
				itemIds.add(decodeURIComponent(encodedItemId));
			} catch (error) {
				console.warn(
					"[openmeld.web.inbox.browser_notification_pending_item_invalid]",
					{
						error: error instanceof Error ? error.message : String(error),
					}
				);
			}
		}
		return itemIds;
	} catch (error) {
		console.warn(
			"[openmeld.web.inbox.browser_notification_pending_read_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
			}
		);
		return new Set();
	}
}

export function markInboxNotificationItemPending(input: {
	itemId: string;
	organizationId: string;
	userId: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(buildPendingItemKey(input), "pending");
	} catch (error) {
		logPendingInboxNotificationWriteFailure(input, error);
	}
}

export function clearInboxNotificationItemPending(input: {
	itemId: string;
	organizationId: string;
	userId: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.removeItem(buildPendingItemKey(input));
	} catch (error) {
		logPendingInboxNotificationWriteFailure(input, error);
	}
}

export function subscribeInboxNotificationSettings(
	onChange: () => void
): () => void {
	if (typeof window === "undefined") {
		return () => undefined;
	}
	const handleStorage = (event: StorageEvent) => {
		if (
			event.key?.startsWith("openmeld.inbox.browser-notifications.enabled:") ||
			event.key?.startsWith(`${PROMPT_DISMISSED_KEY_PREFIX}:`)
		) {
			onChange();
		}
	};
	const handleVisibilityChange = () => onChange();
	let notificationPermissionStatus: PermissionStatus | null = null;
	let unsubscribed = false;
	const subscribeToNotificationPermission = () => {
		if (!("permissions" in navigator)) {
			return;
		}
		navigator.permissions
			.query({
				name: "notifications",
			})
			.then((permissionStatus) => {
				if (unsubscribed) {
					return;
				}
				notificationPermissionStatus = permissionStatus;
				permissionStatus.addEventListener("change", onChange);
				onChange();
			})
			.catch((error: unknown) => {
				console.warn(
					"[openmeld.web.inbox.browser_notification_permission_subscription_failed]",
					{
						error: error instanceof Error ? error.message : String(error),
					}
				);
			});
	};
	window.addEventListener("storage", handleStorage);
	window.addEventListener(PREFERENCE_CHANGE_EVENT, onChange);
	window.addEventListener(DESKTOP_NOTIFICATION_SETTINGS_EVENT, onChange);
	window.addEventListener("focus", onChange);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	if (!getDesktopPlatform()) {
		subscribeToNotificationPermission();
	}
	return () => {
		unsubscribed = true;
		notificationPermissionStatus?.removeEventListener("change", onChange);
		window.removeEventListener("storage", handleStorage);
		window.removeEventListener(PREFERENCE_CHANGE_EVENT, onChange);
		window.removeEventListener(DESKTOP_NOTIFICATION_SETTINGS_EVENT, onChange);
		window.removeEventListener("focus", onChange);
		document.removeEventListener("visibilitychange", handleVisibilityChange);
	};
}

async function requestInboxNotificationPermission(): Promise<InboxNotificationPermission> {
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

function readInboxNotificationDelivery(
	itemId: string
): "already_delivered" | "not_delivered" | "failed" {
	try {
		const storedValue = window.localStorage.getItem(DELIVERED_ITEM_IDS_KEY);
		const deliveredItemIds = parseItemIds(storedValue, "delivered");
		if (deliveredItemIds.includes(itemId)) {
			return "already_delivered";
		}
		return "not_delivered";
	} catch (error) {
		console.warn("[openmeld.web.inbox.browser_notification_claim_failed]", {
			error: error instanceof Error ? error.message : String(error),
			itemId,
		});
		return "failed";
	}
}

async function withInboxNotificationClaim(
	itemId: string,
	deliver: () =>
		| InboxNotificationDeliveryResult
		| Promise<InboxNotificationDeliveryResult>
): Promise<InboxNotificationDeliveryResult> {
	const claimAndDeliver = async () => {
		const claim = readInboxNotificationDelivery(itemId);
		if (claim === "already_delivered") {
			return { status: "already_delivered" } as const;
		}
		if (claim === "failed") {
			return { reason: "claim_failed", status: "deferred" } as const;
		}
		return await deliver();
	};
	if (typeof navigator !== "undefined" && navigator.locks) {
		return await navigator.locks.request(
			`openmeld-inbox-notification:${itemId}`,
			{ mode: "exclusive" },
			claimAndDeliver
		);
	}
	return await claimAndDeliver();
}

function recordInboxNotificationDelivered(itemId: string): void {
	try {
		const deliveredItemIds = parseItemIds(
			window.localStorage.getItem(DELIVERED_ITEM_IDS_KEY),
			"delivered"
		);
		window.localStorage.setItem(
			DELIVERED_ITEM_IDS_KEY,
			JSON.stringify(
				[
					...deliveredItemIds.filter(
						(deliveredItemId) => deliveredItemId !== itemId
					),
					itemId,
				].slice(-MAX_DELIVERED_ITEM_IDS)
			)
		);
	} catch (error) {
		console.warn(
			"[openmeld.web.inbox.browser_notification_delivery_record_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
				itemId,
			}
		);
	}
}

function parseItemIds(value: string | null, ledger: "delivered"): string[] {
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
		console.warn("[openmeld.web.inbox.browser_notification_ledger_invalid]", {
			ledger,
			reason: "unexpected_shape",
		});
	} catch (error) {
		console.warn("[openmeld.web.inbox.browser_notification_ledger_invalid]", {
			error: error instanceof Error ? error.name : typeof error,
			ledger,
			reason: "invalid_json",
		});
	}
	return [];
}

function logPendingInboxNotificationWriteFailure(
	input: { itemId: string; organizationId: string },
	error: unknown
): void {
	console.warn(
		"[openmeld.web.inbox.browser_notification_pending_write_failed]",
		{
			error: error instanceof Error ? error.message : String(error),
			itemId: input.itemId,
			organizationId: input.organizationId,
		}
	);
}

function buildPendingItemKeyPrefix(input: {
	organizationId: string;
	userId: string;
}): string {
	return `${PENDING_ITEM_KEY_PREFIX}:${requireLedgerScope(input.userId, "user")}:${requireLedgerScope(input.organizationId, "organization")}:`;
}

function buildPendingItemKey(input: {
	itemId: string;
	organizationId: string;
	userId: string;
}): string {
	return `${buildPendingItemKeyPrefix(input)}${requireLedgerScope(input.itemId, "item")}`;
}

function requireLedgerScope(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`Inbox browser notification ${label} scope is required.`);
	}
	return encodeURIComponent(normalized);
}

function buildInboxBrowserPreferenceKey(userId: string): string {
	const normalizedUserId = userId.trim();
	if (!normalizedUserId) {
		throw new Error("Inbox browser notifications require a user id.");
	}
	return `openmeld.inbox.browser-notifications.enabled:${normalizedUserId}`;
}

function buildInboxBrowserNotificationPromptKey(input: {
	userId: string;
}): string {
	const normalizedUserId = input.userId.trim();
	if (!normalizedUserId) {
		throw new Error("Inbox browser notifications require a user id.");
	}
	return `${PROMPT_DISMISSED_KEY_PREFIX}:${normalizedUserId}`;
}

async function deliverDesktopInboxNotification(
	input: Parameters<typeof showInboxNotification>[0],
	currentItem: InboxItem,
	deliveryKey: string
): Promise<InboxNotificationDeliveryResult> {
	if (!input.organizationSlug) {
		return { reason: "context_changed", status: "deferred" };
	}
	const result = await getDesktopPlatform()?.showNotification({
		userId: input.userId,
		organizationId: currentItem.organizationId,
		organizationSlug: input.organizationSlug,
		itemId: currentItem.id,
		soundEnabled: readDesktopNotificationPreference(input.userId, "sound"),
	});
	if (result === "ineligible") {
		return { status: "ineligible" };
	}
	if (result !== "delivered") {
		return {
			reason:
				result === "context_changed"
					? "context_changed"
					: "permission_unavailable",
			status: "deferred",
		};
	}
	recordInboxNotificationReceipt(currentItem.id, deliveryKey);
	return { status: "delivered" };
}

function recordInboxNotificationReceipt(
	itemId: string,
	deliveryKey: string
): void {
	recordInboxNotificationDelivered(itemId);
	if (deliveryKey !== itemId) {
		recordInboxNotificationDelivered(deliveryKey);
	}
}
