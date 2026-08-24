"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
	disableInboxBrowserNotifications,
	enableInboxBrowserNotifications,
	type InboxBrowserNotificationSettings,
	readInboxBrowserNotificationSettings,
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
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			if (!userId) {
				return () => undefined;
			}
			return subscribeInboxBrowserNotificationSettings(() => {
				settingsSnapshotCache.delete(userId);
				onStoreChange();
			});
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

	return {
		error: currentOperationState?.error ?? null,
		isPending: currentOperationState?.isPending ?? false,
		setEnabled,
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
		cached.permission === current.permission
	) {
		return cached;
	}
	settingsSnapshotCache.set(userId, current);
	return current;
}
