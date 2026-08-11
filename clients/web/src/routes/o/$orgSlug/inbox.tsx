import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { InboxPagePending } from "#/components/inbox/inbox-page-presentation";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/inbox")({
	staticData: appShellStaticData.inbox,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	pendingComponent: InboxPendingRoute,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	component: InboxLayoutRoute,
});

function InboxLayoutRoute() {
	const { sidebarStates } = Route.useLoaderData();
	return (
		<AppFullWidthLayout initialOuterSidebarState={sidebarStates.outer}>
			<Outlet />
		</AppFullWidthLayout>
	);
}

function InboxPendingRoute() {
	return (
		<AppFullWidthLayout>
			<InboxPagePending />
		</AppFullWidthLayout>
	);
}
