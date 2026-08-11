"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { startQueryKeys } from "#/query/query-keys";

// A settled "Connected" reply readiness intentionally stops polling at an
// explicit expiration boundary (see
// `boundedCurrentLocalRuntimeReplyReadinessRefetchInterval` and
// developing/clients/web.md "Wake Availability And Recovery Presentation").
// Nothing then re-checks the local service link, so if OpenMeld Service later dies
// while the tab sits idle the green "Connected" indicator strands on a
// last-known-good state. That is exactly what web.md forbids: Web "must not
// keep a last-known `Available for Wake` badge when the current Core projection
// says the route, service, or execution path is no longer available."
//
// Re-poll once when the tab regains visibility, mirroring the Space feed
// reconnect-on-refocus pattern (`use-space-landing-feed.ts`). This is a
// discrete reconciliation like the manual "Check status" action, not an
// extension of the auto-refresh budget: after the single refetch the bounded
// interval re-evaluates and stops again when the result is still good, so no
// infinite polling is reintroduced.
export function useRefreshReplyReadinessOnRefocus(input: {
	enabled: boolean;
	storageScope: string;
}): void {
	const queryClient = useQueryClient();
	const { enabled, storageScope } = input;

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") {
				return;
			}
			queryClient
				.invalidateQueries({
					queryKey:
						startQueryKeys.currentLocalRuntimeReplyReadiness(storageScope),
				})
				.catch((error: unknown) => {
					console.error(
						"Failed to refresh reply readiness after the tab became visible.",
						error
					);
				});
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [enabled, queryClient, storageScope]);
}
