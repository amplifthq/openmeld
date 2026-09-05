"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { subscribeInboxBrowserNotificationSoundSettings } from "#/lib/inbox/browser-notification-sound";
import {
	disableInboxBrowserNotifications,
	enableInboxBrowserNotifications,
	type InboxBrowserNotificationSettings,
	readInboxBrowserNotificationSettings,
	setInboxBrowserNotificationSoundEnabled,
	subscribeInboxBrowserNotificationSettings,
} from "#/lib/inbox/browser-notifications";

type SettingsOperationState = {
	error: string | null;
	isPending: boolean;
	userId: string;
};

type SettingsOperationStates = Record<string, SettingsOperationState>;

const settingsSnapshotCache = new Map<
	string,
	InboxBrowserNotificationSettings
>();

export function useInboxBrowserNotificationSettings(
	userId: string | null | undefined
) {
	const [operationStates, setOperationStates] =
		useState<SettingsOperationStates>({});
	const [soundErrors, setSoundErrors] = useState<Record<string, string | null>>(
		{}
	);
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			if (!userId) {
				return () => undefined;
			}
			const handleChange = () => {
				settingsSnapshotCache.delete(userId);
				onStoreChange();
			};
			const unsubscribeNotifications =
				subscribeInboxBrowserNotificationSettings(handleChange);
			const unsubscribeSounds =
				subscribeInboxBrowserNotificationSoundSettings(handleChange);
			return () => {
				unsubscribeNotifications();
				unsubscribeSounds();
			};
		},
		[userId]
	);
	const getSnapshot = useCallback(
		() => (userId ? readStableSettingsSnapshot(userId) : null),
		[userId]
	);
	const settings = useSyncExternalStore(subscribe, getSnapshot, () => null);
	const currentOperationState = userId
		? (operationStates[userId] ?? null)
		: null;
	const setEnabled = async (enabled: boolean) => {
		if (!userId) {
			return;
		}
		setOperationStates((current) => ({
			...current,
			[userId]: { error: null, isPending: true, userId },
		}));
		let nextError: string | null = null;
		try {
			const nextSettings = enabled
				? await enableInboxBrowserNotifications({ userId })
				: disableInboxBrowserNotifications({ userId });
			if (enabled && nextSettings.permission === "default") {
				nextError = "OpenMeld did not receive notification permission.";
			}
		} catch (caughtError) {
			nextError =
				caughtError instanceof Error
					? caughtError.message
					: "OpenMeld could not update browser notifications.";
		} finally {
			settingsSnapshotCache.delete(userId);
			setOperationStates((current) => ({
				...current,
				[userId]: { error: nextError, isPending: false, userId },
			}));
		}
	};
	const setSoundEnabled = (enabled: boolean) => {
		if (!userId) {
			return;
		}
		let nextError: string | null = null;
		try {
			setInboxBrowserNotificationSoundEnabled({ enabled, userId });
		} catch (caughtError) {
			nextError =
				caughtError instanceof Error
					? caughtError.message
					: "OpenMeld could not update notification sounds.";
		} finally {
			settingsSnapshotCache.delete(userId);
			setSoundErrors((current) => ({
				...current,
				[userId]: nextError,
			}));
		}
	};

	return {
		error: currentOperationState?.error ?? null,
		isPending: currentOperationState?.isPending ?? false,
		setEnabled,
		setSoundEnabled,
		soundError: userId ? (soundErrors[userId] ?? null) : null,
		settings,
	};
}

function readStableSettingsSnapshot(
	userId: string
): InboxBrowserNotificationSettings {
	const current = readInboxBrowserNotificationSettings({ userId });
	const cached = settingsSnapshotCache.get(userId);
	if (
		cached &&
		cached.enabled === current.enabled &&
		cached.permission === current.permission &&
		cached.soundEnabled === current.soundEnabled
	) {
		return cached;
	}
	settingsSnapshotCache.set(userId, current);
	return current;
}
