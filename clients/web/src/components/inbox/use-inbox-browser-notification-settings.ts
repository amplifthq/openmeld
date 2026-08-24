"use client";

import { useEffect, useRef, useState } from "react";
import {
	disableInboxBrowserNotifications,
	enableInboxBrowserNotifications,
	type InboxBrowserNotificationSettings,
	readInboxBrowserNotificationSettings,
	subscribeInboxBrowserNotificationSettings,
} from "#/lib/inbox/browser-notifications";

type SettingsSnapshot = {
	settings: InboxBrowserNotificationSettings;
	userId: string;
};

export function useInboxBrowserNotificationSettings(
	userId: string | null | undefined
) {
	const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(() =>
		userId ? readSnapshot(userId) : null
	);
	const [isPending, setIsPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const operationIdRef = useRef(0);
	const userIdRef = useRef(userId);
	userIdRef.current = userId;

	useEffect(() => {
		operationIdRef.current += 1;
		setIsPending(false);
		if (!userId) {
			setSnapshot(null);
			setError(null);
			return;
		}
		const refresh = () => {
			setSnapshot(readSnapshot(userId));
			setError(null);
		};
		refresh();
		return subscribeInboxBrowserNotificationSettings(refresh);
	}, [userId]);

	const settings =
		snapshot && snapshot.userId === userId ? snapshot.settings : null;
	const setEnabled = async (enabled: boolean) => {
		if (!userId) {
			return;
		}
		const operationId = operationIdRef.current + 1;
		operationIdRef.current = operationId;
		const isCurrentOperation = () =>
			operationIdRef.current === operationId && userIdRef.current === userId;
		setIsPending(true);
		setError(null);
		try {
			const nextSettings = enabled
				? await enableInboxBrowserNotifications({ userId })
				: disableInboxBrowserNotifications({ userId });
			if (!isCurrentOperation()) {
				return;
			}
			setSnapshot({ settings: nextSettings, userId });
			if (enabled && nextSettings.permission === "default") {
				setError("OpenMeld did not receive notification permission.");
			}
		} catch (caughtError) {
			if (!isCurrentOperation()) {
				return;
			}
			setSnapshot(readSnapshot(userId));
			setError(
				caughtError instanceof Error
					? caughtError.message
					: "OpenMeld could not update browser notifications."
			);
		} finally {
			if (isCurrentOperation()) {
				setIsPending(false);
			}
		}
	};

	return { error, isPending, setEnabled, settings };
}

function readSnapshot(userId: string): SettingsSnapshot {
	return {
		settings: readInboxBrowserNotificationSettings({ userId }),
		userId,
	};
}
