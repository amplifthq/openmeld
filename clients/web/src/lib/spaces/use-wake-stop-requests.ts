import { useCallback, useSyncExternalStore } from "react";
import type { SpaceWakeStopRequestStatus } from "./wake-stop-target";

type Statuses = ReadonlyMap<string, SpaceWakeStopRequestStatus>;
const empty: Statuses = new Map();
const stores = new Map<string, Statuses>();
const listeners = new Set<() => void>();
const statuses = new Set<SpaceWakeStopRequestStatus>([
	"cancelled",
	"already_cancelled",
	"cancellation_requested",
	"retry_later",
	"unsupported",
	"not_found",
	"not_stoppable",
	"delivery_unknown",
]);

function read(scope: string): Statuses {
	if (typeof window === "undefined") {
		return empty;
	}
	const cached = stores.get(scope);
	if (cached) {
		return cached;
	}
	const restored = new Map<string, SpaceWakeStopRequestStatus>();
	try {
		const entries: unknown = JSON.parse(sessionStorage.getItem(scope) ?? "[]");
		if (Array.isArray(entries)) {
			for (const entry of entries) {
				if (
					!Array.isArray(entry) ||
					typeof entry[0] !== "string" ||
					!statuses.has(entry[1])
				) {
					continue;
				}
				// Reload loses the in-flight HTTP request, not the user's Stop intent.
				restored.set(
					entry[0],
					entry[1] === "cancellation_requested" ? "delivery_unknown" : entry[1]
				);
			}
		}
	} catch {
		/* Storage can be disabled; the live request still works. */
	}
	stores.set(scope, restored);
	return restored;
}

/** Stores command receipts only. Space/runtime snapshots still own execution. */
export function useWakeStopRequests(profileId: string, spaceId: string) {
	const scope = `openmeld.stop-requests:${JSON.stringify([profileId, spaceId])}`;
	const subscribe = useCallback((listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}, []);
	const snapshot = useCallback(() => read(scope), [scope]);
	const value = useSyncExternalStore(subscribe, snapshot, () => empty);
	const update = useCallback(
		(updater: (current: Statuses) => Statuses) => {
			const next = updater(read(scope));
			stores.set(scope, next);
			try {
				sessionStorage.setItem(scope, JSON.stringify([...next]));
			} catch {
				/* See read(). */
			}
			for (const listener of listeners) {
				listener();
			}
		},
		[scope]
	);
	return [value, update] as const;
}
