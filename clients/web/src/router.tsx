import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { resolveAppQueryClient } from "./integrations/tanstack-query/query-client";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
	APP_ROUTE_PRELOAD_DELAY_MS,
} from "./lib/app-route-loading";
import { getAppScrollRestorationKey } from "./lib/app-scroll-restoration";
import {
	reportClientApplicationError,
	setApplicationErrorRouteReader,
} from "./lib/observability/application-error-client";
import { installPerformanceReporting } from "./lib/observability/performance-client";
import { resolveAppQueryPersistenceController } from "./query/persistence/app-query-persistence";
import { routeTree } from "./routeTree.gen";

export function getRouter(options?: { isServer?: boolean }) {
	const queryClient = resolveAppQueryClient({ isServer: options?.isServer });
	const queryPersistence = resolveAppQueryPersistenceController({
		isServer: options?.isServer,
	});
	const router = createTanStackRouter({
		routeTree,

		context: { queryClient, queryPersistence },

		scrollRestoration: true,
		// A history-entry key treats every visit as a new scroll surface. The
		// pathname is the stable browser identity for a Space, while search params
		// remain free to focus a message without replacing its remembered position.
		getScrollRestorationKey: getAppScrollRestorationKey,
		defaultPreload: "intent",
		defaultPreloadDelay: APP_ROUTE_PRELOAD_DELAY_MS,
		// TanStack Query owns freshness for loader-prefetched data. Keeping the
		// Router cache at zero prevents a second, unrelated freshness clock from
		// skipping the exact Query checks owned by each route.
		defaultPreloadStaleTime: 0,
		defaultPendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
		defaultPendingMs: APP_ROUTE_PENDING_DELAY_MS,
		defaultOnCatch: (error) => reportClientApplicationError(error, "route"),
	});

	if (typeof window !== "undefined" && options?.isServer !== true) {
		installPerformanceReporting(router);
		setApplicationErrorRouteReader(
			() => router.state.matches.at(-1)?.routeId ?? null
		);
	}

	setupRouterSsrQueryIntegration({ queryClient, router });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
