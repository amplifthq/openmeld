import type { InboxItem } from "@openmeld/schemas/types";
import { play } from "cuelume";

export const INBOX_BROWSER_NOTIFICATION_SOUND_PREFERENCE_KEY_PREFIX =
	"openmeld.inbox.browser-notification-sounds.enabled";

const ENABLED_VALUE = "enabled";
const DISABLED_VALUE = "disabled";
const SOUND_PREFERENCE_CHANGE_EVENT =
	"openmeld:inbox-browser-notification-sounds-changed";
const SOUND_BATCH_WINDOW_MS = 350;

type InboxBrowserNotificationSoundCue = "attention" | "update";

type PendingSound = {
	cue: InboxBrowserNotificationSoundCue;
	timer: ReturnType<typeof setTimeout>;
	userId: string;
};

let pendingSound: PendingSound | null = null;

export function readInboxBrowserNotificationSoundEnabled(input: {
	userId: string;
}): boolean {
	if (typeof window === "undefined") {
		return true;
	}
	const key = buildSoundPreferenceKey(input.userId);
	try {
		const value = window.localStorage.getItem(key);
		if (value === ENABLED_VALUE) {
			return true;
		}
		if (value === DISABLED_VALUE) {
			return false;
		}
		if (value !== null) {
			console.warn(
				"[openmeld.web.inbox.browser_notification_sound_preference_invalid]",
				{ key }
			);
			window.localStorage.removeItem(key);
		}
		return true;
	} catch (error) {
		console.warn(
			"[openmeld.web.inbox.browser_notification_sound_preference_read_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
			}
		);
		return false;
	}
}

export function writeInboxBrowserNotificationSoundEnabled(input: {
	enabled: boolean;
	userId: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			buildSoundPreferenceKey(input.userId),
			input.enabled ? ENABLED_VALUE : DISABLED_VALUE
		);
	} catch (error) {
		console.warn(
			"[openmeld.web.inbox.browser_notification_sound_preference_write_failed]",
			{
				error: error instanceof Error ? error.message : String(error),
			}
		);
		throw error;
	}
	window.dispatchEvent(new Event(SOUND_PREFERENCE_CHANGE_EVENT));
	if (!input.enabled) {
		cancelPendingInboxBrowserNotificationSound({ userId: input.userId });
	}
}

export function subscribeInboxBrowserNotificationSoundSettings(
	onChange: () => void
): () => void {
	if (typeof window === "undefined") {
		return () => undefined;
	}
	const handleStorage = (event: StorageEvent) => {
		if (
			event.key?.startsWith(
				`${INBOX_BROWSER_NOTIFICATION_SOUND_PREFERENCE_KEY_PREFIX}:`
			)
		) {
			onChange();
		}
	};
	window.addEventListener("storage", handleStorage);
	window.addEventListener(SOUND_PREFERENCE_CHANGE_EVENT, onChange);
	return () => {
		window.removeEventListener("storage", handleStorage);
		window.removeEventListener(SOUND_PREFERENCE_CHANGE_EVENT, onChange);
	};
}

export function queueInboxBrowserNotificationSound(input: {
	item: InboxItem;
	userId: string;
}): void {
	if (!readInboxBrowserNotificationSoundEnabled({ userId: input.userId })) {
		return;
	}
	const cue = resolveInboxBrowserNotificationSoundCue(input.item);
	if (pendingSound?.userId !== input.userId) {
		cancelPendingInboxBrowserNotificationSound();
	}
	if (pendingSound) {
		if (cue === "attention") {
			pendingSound.cue = cue;
		}
		return;
	}
	pendingSound = {
		cue,
		timer: setTimeout(flushPendingSound, SOUND_BATCH_WINDOW_MS),
		userId: input.userId,
	};
}

export function cancelPendingInboxBrowserNotificationSound(input?: {
	userId: string;
}): void {
	if (!pendingSound || (input && pendingSound.userId !== input.userId)) {
		return;
	}
	clearTimeout(pendingSound.timer);
	pendingSound = null;
}

export function resolveInboxBrowserNotificationSoundCue(
	item: InboxItem
): InboxBrowserNotificationSoundCue {
	if (
		item.importance === "urgent" ||
		(item.attention === "action_required" && item.resolutionStatus === "open")
	) {
		return "attention";
	}
	return "update";
}

function flushPendingSound(): void {
	const sound = pendingSound;
	pendingSound = null;
	if (
		!(
			sound &&
			readInboxBrowserNotificationSoundEnabled({ userId: sound.userId })
		)
	) {
		return;
	}
	try {
		play(sound.cue === "attention" ? "chime" : "ready", { volume: 1 });
	} catch (error) {
		console.warn("[openmeld.web.inbox.browser_notification_sound_failed]", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function buildSoundPreferenceKey(userId: string): string {
	const normalizedUserId = userId.trim();
	if (!normalizedUserId) {
		throw new Error("Inbox browser notification sounds require a user id.");
	}
	return `${INBOX_BROWSER_NOTIFICATION_SOUND_PREFERENCE_KEY_PREFIX}:${normalizedUserId}`;
}
