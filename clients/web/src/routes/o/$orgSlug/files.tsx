import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";
import { TeamPeopleSidebar } from "#/components/directory/team-people-sidebar";
import { TeamFilesPage } from "#/components/organizations/team-files-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/files")({
	staticData: appShellStaticData.files,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: TeamFilesRoute,
});

function TeamFilesRoute() {
	const { sidebarStates } = Route.useLoaderData();
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={sidebarStates.outer}
			mainHeader={<TeamHeader active="files" />}
			mainSidebarContent={<TeamPeopleSidebar />}
			scroll={false}
			showMainHeader
		>
			<TeamFilesPage />
		</AppFullWidthLayout>
	);
}
