"use client";

import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

export const ROUTE_INTENT_PREFETCH_DELAY_MS = 50;

type PendingRoutePrefetch = {
	prefetchData?: RouteIntentDataPrefetch;
	timeoutId: ReturnType<typeof setTimeout>;
	to: string;
};

export type RouteIntentDataPrefetch = () => Promise<void>;

export type RouteIntentPrefetchController = {
	cancel: (to: string) => void;
	prefetchNow: (to: string, prefetchData?: RouteIntentDataPrefetch) => void;
	schedule: (to: string, prefetchData?: RouteIntentDataPrefetch) => void;
};

export function useRouteIntentPrefetch(): RouteIntentPrefetchController {
	const router = useRouter();
	const pendingRef = useRef<PendingRoutePrefetch | null>(null);

	const cancelPending = useCallback((to?: string) => {
		const pending = pendingRef.current;
		if (!pending || (to !== undefined && pending.to !== to)) {
			return;
		}
		clearTimeout(pending.timeoutId);
		pendingRef.current = null;
	}, []);

	const preload = useCallback(
		(to: string, prefetchData?: RouteIntentDataPrefetch) => {
			prefetchData?.().catch((error: unknown) => {
				console.error("Failed to preload route data from user intent.", {
					error,
					to,
				});
			});
			router.preloadRoute({ to }).catch((error: unknown) => {
				console.error("Failed to preload a route from user intent.", {
					error,
					to,
				});
			});
		},
		[router]
	);

	const prefetchNow = useCallback(
		(to: string, prefetchData?: RouteIntentDataPrefetch) => {
			cancelPending();
			preload(to, prefetchData);
		},
		[cancelPending, preload]
	);

	const schedule = useCallback(
		(to: string, prefetchData?: RouteIntentDataPrefetch) => {
			if (pendingRef.current?.to === to) {
				return;
			}
			cancelPending();
			pendingRef.current = {
				timeoutId: setTimeout(() => {
					pendingRef.current = null;
					preload(to, prefetchData);
				}, ROUTE_INTENT_PREFETCH_DELAY_MS),
				prefetchData,
				to,
			};
		},
		[cancelPending, preload]
	);

	useEffect(() => () => cancelPending(), [cancelPending]);

	return useMemo(
		() => ({
			cancel: (to: string) => cancelPending(to),
			prefetchNow,
			schedule,
		}),
		[cancelPending, prefetchNow, schedule]
	);
}
