import type { InboxItem } from "@openmeld/schemas/types";

export type InboxBrowserNotificationPermission =
	| NotificationPermission
	| "unsupported";

export type InboxBrowserNotificationSettings = {
	enabled: boolean;
	permission: InboxBrowserNotificationPermission;
};

export function resolveBrowserNotificationDescription(
	permission: InboxBrowserNotificationSettings["permission"]
): string {
	if (permission === "unsupported") {
		return "This browser does not support notifications. Your Inbox is still available in OpenMeld.";
	}
	if (permission === "denied") {
		return "Notifications are blocked. Allow them in your browser’s site settings, then return here.";
	}
	return "Notify for directly addressed messages, actions, and urgent items in this browser. Applies to every Space and Direct Message.";
}

export type InboxBrowserNotificationDeliveryResult =
	| { notification: Notification; status: "delivered" }
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

export type InboxBrowserNotificationDeliveryReadiness =
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

export function readInboxBrowserNotificationSettings(input: {
	userId: string;
}): InboxBrowserNotificationSettings {
	const permission = readInboxBrowserNotificationPermission();
	const preference = readInboxBrowserPreference(input);
	return {
		enabled: permission === "granted" && preference !== false,
		permission,
	};
}

export function readInboxBrowserNotificationPromptDismissed(input: {
	userId: string;
}): boolean {
	if (typeof window === "undefined") {
		return false;
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
	if (item.resolutionStatus === "resolved") {
		return false;
	}
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

/**
 * Update-class items that still directly concern the member: being referenced,
 * replies addressed to them, their own Wake outcomes, and Center Agent Task
 * endings. The Task producer only emits an item for needs_attention or a
 * terminal status (succeeded/failed/stopped), never for intermediate progress,
 * so every unread center_agent_task update is an ending the requester should
 * hear about.
 */
function isDirectlyAddressedInboxUpdate(kind: InboxItem["kind"]): boolean {
	return (
		kind === "space_reference" ||
		kind === "agent_reply" ||
		kind === "wake_outcome" ||
		kind === "center_agent_task"
	);
}

export async function showInboxBrowserNotification(input: {
	item: InboxItem;
	resolveCurrentReadiness?: () =>
		| InboxBrowserNotificationDeliveryReadiness
		| Promise<InboxBrowserNotificationDeliveryReadiness>;
	sourcePath: string;
	viewingSourceSession: boolean;
}): Promise<InboxBrowserNotificationDeliveryResult> {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return { reason: "permission_unavailable", status: "deferred" };
	}
	if (readInboxBrowserNotificationPermission() !== "granted") {
		return { reason: "permission_unavailable", status: "deferred" };
	}
	if (!isInboxBrowserNotificationEligible(input.item)) {
		return { status: "ineligible" };
	}
	if (document.visibilityState === "visible" && input.viewingSourceSession) {
		return { reason: "source_visible", status: "deferred" };
	}
	return await withInboxBrowserNotificationClaim(input.item.id, async () => {
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
			tag: `openmeld-inbox:${currentItem.id}`,
		});
		notification.onclick = () => {
			window.focus();
			window.location.assign(input.sourcePath);
			notification.close();
		};
		recordInboxBrowserNotificationDelivered(currentItem.id);
		return { notification, status: "delivered" };
	});
}

export function readPendingInboxBrowserNotificationItemIds(input: {
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

export function markInboxBrowserNotificationItemPending(input: {
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
		logPendingInboxBrowserNotificationWriteFailure(input, error);
	}
}

export function clearInboxBrowserNotificationItemPending(input: {
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
		logPendingInboxBrowserNotificationWriteFailure(input, error);
	}
}

export function subscribeInboxBrowserNotificationSettings(
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

function readInboxBrowserNotificationDelivery(
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

async function withInboxBrowserNotificationClaim(
	itemId: string,
	deliver: () =>
		| InboxBrowserNotificationDeliveryResult
		| Promise<InboxBrowserNotificationDeliveryResult>
): Promise<InboxBrowserNotificationDeliveryResult> {
	const claimAndDeliver = async () => {
		const claim = readInboxBrowserNotificationDelivery(itemId);
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

function recordInboxBrowserNotificationDelivered(itemId: string): void {
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

function logPendingInboxBrowserNotificationWriteFailure(
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
