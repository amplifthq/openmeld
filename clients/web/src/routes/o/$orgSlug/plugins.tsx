import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppGlobalControls } from "#/components/app/app-global-controls";
import { AppOuterRail } from "#/components/app/app-outer-rail";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { AppSurfaceLayout } from "#/components/app/app-surface-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
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
	const account = useAppShellAccount();
	const { sidebarStates } = Route.useLoaderData();
	return (
		<AppSurfaceLayout
			globalControls={<AppGlobalControls />}
			outerRail={
				<AppOuterRail account={account} initialState={sidebarStates.outer} />
			}
		>
			<ScrollArea className="min-h-0 flex-1">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
					<Outlet />
				</div>
			</ScrollArea>
		</AppSurfaceLayout>
	);
}
