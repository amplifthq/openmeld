"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	START_SETUP_FAST_CHECK_INTERVAL_MS,
	START_SETUP_FAST_CHECK_WINDOW_MS,
	START_SETUP_SLOW_CHECK_INTERVAL_MS,
} from "#/strategy-constants";

const FAST_CHECK_INTERVAL_MS = START_SETUP_FAST_CHECK_INTERVAL_MS;
const FAST_CHECK_WINDOW_MS = START_SETUP_FAST_CHECK_WINDOW_MS;
const SLOW_CHECK_INTERVAL_MS = START_SETUP_SLOW_CHECK_INTERVAL_MS;

function isDocumentHidden() {
	return (
		typeof document !== "undefined" && document.visibilityState === "hidden"
	);
}

function resolveNextCheckDelay(startedAtMs: number) {
	const elapsedMs = Date.now() - startedAtMs;
	return elapsedMs < FAST_CHECK_WINDOW_MS
		? FAST_CHECK_INTERVAL_MS
		: SLOW_CHECK_INTERVAL_MS;
}

export function useStartSetupCommandWatcher(input: {
	enabled: boolean;
	isExpired: boolean;
	onCheckNow: () => Promise<void>;
	stopWhen: boolean;
}) {
	const { enabled, isExpired, onCheckNow, stopWhen } = input;
	const canCheck = !(isExpired || stopWhen);
	const isWatching = enabled && canCheck;
	const [isChecking, setIsChecking] = useState(false);
	const [lastCheckedAtMs, setLastCheckedAtMs] = useState<number | null>(null);
	const checkInFlightRef = useRef<Promise<void> | null>(null);
	const canCheckRef = useRef(canCheck);
	const isMountedRef = useRef(true);
	const isWatchingRef = useRef(isWatching);
	const onCheckNowRef = useRef(onCheckNow);
	const startedAtMsRef = useRef<number | null>(null);
	const timeoutIdRef = useRef<number | null>(null);

	canCheckRef.current = canCheck;
	isWatchingRef.current = isWatching;
	onCheckNowRef.current = onCheckNow;

	const clearScheduledCheck = useCallback(() => {
		if (timeoutIdRef.current === null) {
			return;
		}

		window.clearTimeout(timeoutIdRef.current);
		timeoutIdRef.current = null;
	}, []);

	const checkNow = useCallback(async () => {
		if (!canCheckRef.current || isDocumentHidden()) {
			return;
		}

		if (checkInFlightRef.current !== null) {
			await checkInFlightRef.current;
			return;
		}

		let checkPromise!: Promise<void>;
		checkPromise = (async () => {
			setIsChecking(true);
			try {
				await onCheckNowRef.current();
				if (isMountedRef.current) {
					setLastCheckedAtMs(Date.now());
				}
			} finally {
				if (isMountedRef.current) {
					setIsChecking(false);
				}
				if (checkInFlightRef.current === checkPromise) {
					checkInFlightRef.current = null;
				}
			}
		})();

		checkInFlightRef.current = checkPromise;
		await checkPromise;
	}, []);

	const scheduleNextCheck = useCallback(() => {
		clearScheduledCheck();

		if (!isWatchingRef.current || isDocumentHidden()) {
			return;
		}

		const startedAtMs = startedAtMsRef.current ?? Date.now();
		startedAtMsRef.current = startedAtMs;
		const delayMs = resolveNextCheckDelay(startedAtMs);

		timeoutIdRef.current = window.setTimeout(() => {
			checkNow()
				.catch((error: unknown) => {
					console.error("Failed to check this computer after setup.", error);
				})
				.finally(() => {
					scheduleNextCheck();
				});
		}, delayMs);
	}, [checkNow, clearScheduledCheck]);

	useEffect(() => {
		isMountedRef.current = true;

		return () => {
			isMountedRef.current = false;
			clearScheduledCheck();
		};
	}, [clearScheduledCheck]);

	useEffect(() => {
		if (!isWatching) {
			clearScheduledCheck();
			startedAtMsRef.current = null;
			return;
		}

		startedAtMsRef.current = Date.now();
		checkNow()
			.catch((error: unknown) => {
				console.error("Failed to check this computer after setup.", error);
			})
			.finally(() => {
				scheduleNextCheck();
			});

		return () => {
			clearScheduledCheck();
		};
	}, [checkNow, clearScheduledCheck, isWatching, scheduleNextCheck]);

	useEffect(() => {
		if (!isWatching) {
			return;
		}

		const handleVisibilityChange = () => {
			clearScheduledCheck();

			if (isDocumentHidden()) {
				return;
			}

			checkNow()
				.catch((error: unknown) => {
					console.error("Failed to check this computer after setup.", error);
				})
				.finally(() => {
					scheduleNextCheck();
				});
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [checkNow, clearScheduledCheck, isWatching, scheduleNextCheck]);

	const statusText = useMemo(() => {
		if (isExpired) {
			return "This command expired. Copy a fresh command before running it.";
		}
		if (isChecking) {
			return "Reading this computer...";
		}
		if (isWatching) {
			return "OpenMeld is waiting for this computer...";
		}

		return null;
	}, [isChecking, isExpired, isWatching]);

	return {
		checkNow,
		isChecking,
		isWatching,
		lastCheckedAtMs,
		statusText,
	};
}
