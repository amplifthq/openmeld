import type { OrganizationDocumentKind } from "@openmeld/schemas/types";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";
import { TeamFilesSidebar } from "#/components/organizations/team-files-navigation";
import {
	TeamFilesPage,
	TeamKnowledgeFilesPage,
} from "#/components/organizations/team-files-page";
import { buildOrganizationSkillsPath } from "#/lib/organizations/organization-routes";
import { fileViewParser } from "#/lib/page-tab-search";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/files")({
	staticData: appShellStaticData.files,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	validateSearch: (
		search: Record<string, unknown>
	): {
		view?: "team" | "my" | "trash" | "trash-my" | "knowledge" | "skills";
		folder?: string;
		file?: string;
		create?: "1";
		document?: string;
		kind?: OrganizationDocumentKind;
		subjectUserId?: string;
	} => ({
		view:
			typeof search.view === "string"
				? (fileViewParser.parse(search.view) ?? undefined)
				: undefined,
		folder:
			typeof search.folder === "string" && search.folder.trim()
				? search.folder.trim()
				: undefined,
		file:
			typeof search.file === "string" && search.file.trim()
				? search.file.trim()
				: undefined,
		create:
			search.create === "1" || search.create === 1 ? ("1" as const) : undefined,
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
	beforeLoad: ({ params, search }) => {
		if (search.view === "skills") {
			throw redirect({
				to: buildOrganizationSkillsPath(params.orgSlug),
				replace: true,
			});
		}
	},
	component: TeamFilesRoute,
});

function TeamFilesRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { view, folder, create, document, kind, subjectUserId } =
		Route.useSearch();
	let content = <TeamFilesPage />;
	if (view === "knowledge") {
		content = (
			<TeamKnowledgeFilesPage
				create={create === "1"}
				documentId={document}
				folderId={folder}
				kind={kind}
				subjectUserId={subjectUserId}
			/>
		);
	}
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			defaultModuleSidebarOpen
			initialOuterSidebarState={sidebarStates.outer}
			mainHeader={<TeamHeader active="files" />}
			mainSidebar={{
				key: "files",
				label: "Files",
				content: <TeamFilesSidebar />,
			}}
			scroll={false}
			showMainHeader
		>
			{content}
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
