import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";
import { TeamPeopleSidebar } from "#/components/directory/team-people-sidebar";
import {
	TeamFilesPage,
	TeamKnowledgeFilesPage,
} from "#/components/organizations/team-files-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/files")({
	staticData: appShellStaticData.files,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	validateSearch: (search: Record<string, unknown>) => ({
		view:
			search.view === "knowledge" || search.view === "my"
				? search.view
				: undefined,
		folder:
			typeof search.folder === "string" && search.folder.trim()
				? search.folder.trim()
				: undefined,
	}),
	component: TeamFilesRoute,
});

function TeamFilesRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { view, folder } = Route.useSearch();
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={sidebarStates.outer}
			mainHeader={<TeamHeader active="files" />}
			mainSidebarContent={<TeamPeopleSidebar />}
			scroll={false}
			showMainHeader
		>
			{view === "knowledge" ? (
				<TeamKnowledgeFilesPage folderId={folder} />
			) : (
				<TeamFilesPage initialLocation={view === "my" ? "my" : "team"} />
			)}
		</AppFullWidthLayout>
	);
}
