import type { OrganizationDocumentKind } from "@openmeld/schemas/types";
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
		create: search.create === "1" ? ("1" as const) : undefined,
		document:
			typeof search.document === "string" && search.document.trim()
				? search.document.trim()
				: undefined,
		kind: parseKnowledgeKind(search.kind),
		subjectUserId:
			typeof search.subjectUserId === "string" && search.subjectUserId.trim()
				? search.subjectUserId.trim()
				: undefined,
	}),
	component: TeamFilesRoute,
});

function TeamFilesRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { view, folder, create, document, kind, subjectUserId } =
		Route.useSearch();
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
				<TeamKnowledgeFilesPage
					create={create === "1"}
					documentId={document}
					folderId={folder}
					kind={kind}
					subjectUserId={subjectUserId}
				/>
			) : (
				<TeamFilesPage initialLocation={view === "my" ? "my" : "team"} />
			)}
		</AppFullWidthLayout>
	);
}

function parseKnowledgeKind(
	value: unknown
): OrganizationDocumentKind | undefined {
	return value === "brief" ||
		value === "member_profile" ||
		value === "knowledge"
		? value
		: undefined;
}
