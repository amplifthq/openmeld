import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";

export const Route = createFileRoute("/o/$orgSlug/plugins")({
	validateSearch: (
		search: Record<string, unknown>
	): { scope: "personal" | "organization" } => ({
		scope: search.scope === "personal" ? "personal" : "organization",
	}),
	staticData: appShellStaticData.plugins,
	component: PluginsLayout,
});

function PluginsLayout() {
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			mainHeader={<TeamHeader active="plugins" />}
			showMainHeader
		>
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
				<Outlet />
			</div>
		</AppFullWidthLayout>
	);
}
