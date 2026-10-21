import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { sessionQueryOptionsClient } from "#/query/query-options";

export function AccountSessionObserver() {
	const queryClient = useQueryClient();
	const router = useRouter();
	// Renewal stays on the existing account query and never gates an authorized
	// page. Its observer also refreshes stale sessions on focus and reconnect.
	useQuery(sessionQueryOptionsClient());

	useEffect(
		() =>
			router.subscribe("onResolved", ({ pathChanged }) => {
				if (pathChanged) {
					// A continuously focused tab can navigate without another focus
					// event. Prefetch respects the query's existing stale time.
					queryClient.prefetchQuery(sessionQueryOptionsClient());
				}
			}),
		[queryClient, router]
	);

	return null;
}
