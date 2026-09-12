import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";
import { TeamPeopleSidebar } from "#/components/directory/team-people-sidebar";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/plugins")({
	validateSearch: (
		search: Record<string, unknown>
	): { scope: "personal" | "organization" } => ({
		scope: search.scope === "personal" ? "personal" : "organization",
	}),
	staticData: appShellStaticData.plugins,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: PluginsLayout,
});

function PluginsLayout() {
	const { sidebarStates } = Route.useLoaderData();
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={sidebarStates.outer}
			mainHeader={<TeamHeader active="plugins" />}
			mainSidebarContent={<TeamPeopleSidebar />}
			showMainHeader
		>
			<div className="flex w-full flex-col gap-6 px-[var(--app-page-inline-padding)] py-8">
				<Outlet />
			</div>
		</AppFullWidthLayout>
	);
}
