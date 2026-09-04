import { beforeEach, describe, expect, it } from "vitest";
import { resetBrowserQueryClientForTests } from "./integrations/tanstack-query/query-client";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
	APP_ROUTE_PRELOAD_DELAY_MS,
} from "./lib/app-route-loading";
import { resetAppQueryPersistenceControllerForTests } from "./query/persistence/app-query-persistence";
import { getRouter } from "./router";

describe("router query integration", () => {
	beforeEach(() => {
		resetBrowserQueryClientForTests();
		resetAppQueryPersistenceControllerForTests();
	});

	it("keeps the query client in router context and installs the SSR query wrap", () => {
		const router = getRouter({ isServer: true });

		expect(router.options.context.queryClient).toBeDefined();
		expect(router.options.context.queryPersistence).toBeDefined();
		expect(router.options.defaultPendingMinMs).toBe(
			APP_ROUTE_PENDING_MIN_DURATION_MS
		);
		expect(router.options.defaultPendingMs).toBe(APP_ROUTE_PENDING_DELAY_MS);
		expect(router.options.defaultPreloadStaleTime).toBe(0);
		expect(router.options.defaultPreloadDelay).toBe(APP_ROUTE_PRELOAD_DELAY_MS);
		expect(router.options.defaultPendingComponent).toBeUndefined();
		expect(router.options.Wrap).toBeTypeOf("function");
	});

	it("reuses the stable browser query client across router creations", () => {
		const firstRouter = getRouter({ isServer: false });
		const secondRouter = getRouter({ isServer: false });

		expect(firstRouter.options.context.queryClient).toBe(
			secondRouter.options.context.queryClient
		);
		expect(firstRouter.options.context.queryPersistence).toBe(
			secondRouter.options.context.queryPersistence
		);
	});

	it("remembers nested scroll positions by page instead of navigation entry", () => {
		const router = getRouter({ isServer: true });
		const getScrollRestorationKey = router.options.getScrollRestorationKey;

		expect(getScrollRestorationKey).toBeTypeOf("function");
		expect(
			getScrollRestorationKey?.({
				pathname: "/o/acme/spaces/space-a",
				searchStr: "?signalId=first",
				state: { __TSR_key: "visit-a" },
			} as never)
		).toBe("/o/acme/spaces/space-a");
		expect(
			getScrollRestorationKey?.({
				pathname: "/o/acme/spaces/space-a",
				searchStr: "?signalId=second",
				state: { __TSR_key: "visit-b" },
			} as never)
		).toBe("/o/acme/spaces/space-a");
		expect(
			getScrollRestorationKey?.({
				pathname: "/o/acme/spaces/space-b",
				searchStr: "",
				state: { __TSR_key: "visit-c" },
			} as never)
		).toBe("/o/acme/spaces/space-b");
	});

	it("creates a fresh query client for each server-side router creation", () => {
		const firstRouter = getRouter({ isServer: true });
		const secondRouter = getRouter({ isServer: true });

		expect(firstRouter.options.context.queryClient).not.toBe(
			secondRouter.options.context.queryClient
		);
	});

	it("nests Center Agent under its own route layout instead of the Spaces branch", () => {
		const router = getRouter({ isServer: true });
		const centerAgentLayout = router.routesById["/o/$orgSlug/_center-agent"];
		const centerAgentRoute =
			router.routesById["/o/$orgSlug/_center-agent/center-agent"];
		const spacesRoute = router.routesById["/o/$orgSlug/spaces/"];

		expect(centerAgentLayout.parentRoute.id).toBe("/o/$orgSlug");
		expect(centerAgentRoute.parentRoute.id).toBe("/o/$orgSlug/_center-agent");
		expect(spacesRoute.parentRoute.id).toBe("/o/$orgSlug");
		expect(centerAgentLayout.options.pendingComponent).toBeTypeOf("function");
		expect(centerAgentRoute.fullPath).toBe("/o/$orgSlug/center-agent");
	});
});
