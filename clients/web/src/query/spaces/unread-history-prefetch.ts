import type { QueryClient } from "@tanstack/react-query";
import type { SpaceHistorySnapshot } from "./history";
import { spaceHistoryPrefetchQueryOptions } from "./history-sync";
import { spaceQueryKeys } from "./status";

type Target = { spaceId: string; openMeldProfileId: string; revision: number };

// One sidebar owner, no polling or second message store. Unread snapshots only
// prioritize reads; every message still comes from the authorized Space API.
export function createUnreadHistoryPrefetcher(queryClient: QueryClient) {
	const attempted = new Map<string, number>();
	const active = new Map<string, number>();
	let pending = new Map<string, Target>();
	let disposed = false;
	const key = (target: Target) =>
		JSON.stringify([target.spaceId, target.openMeldProfileId]);
	const drain = () => {
		if (disposed) {
			return;
		}
		for (const [id, target] of pending) {
			if (active.size >= 2) {
				break;
			}
			if (active.has(id)) {
				continue;
			}
			pending.delete(id);
			if (attempted.get(id) === target.revision) {
				continue;
			}
			active.set(id, target.revision);
			queryClient
				.fetchQuery({
					...spaceHistoryPrefetchQueryOptions(queryClient, target),
					staleTime: 0,
				})
				.catch((error: unknown) => {
					console.warn("[openmeld.web.space.unread_prefetch_failed]", {
						spaceId: target.spaceId,
						error,
					});
				})
				.finally(() => {
					attempted.set(id, target.revision);
					active.delete(id);
					drain();
				});
		}
	};
	return {
		schedule(targets: readonly Target[]) {
			if (disposed) {
				return;
			}
			// Restrict speculation to warm conversations. Hover/activation owns cold
			// restore; a large unread inbox must not hydrate every saved Space.
			const warm = targets.filter(
				(target) =>
					queryClient.getQueryData<SpaceHistorySnapshot>(
						spaceQueryKeys.history(target.spaceId, target.openMeldProfileId)
					)?.envelopes.length
			);
			pending = new Map(
				warm.slice(0, 5).map((target) => [key(target), target])
			);
			const currentIds = new Set(targets.map(key));
			for (const id of attempted.keys()) {
				if (!currentIds.has(id)) {
					attempted.delete(id);
				}
			}
			drain();
		},
		dispose() {
			disposed = true;
			pending.clear();
		},
	};
}
