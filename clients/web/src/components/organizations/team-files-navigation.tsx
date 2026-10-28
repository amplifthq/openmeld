import { FolderIcon, TrashIcon, UserIcon } from "@phosphor-icons/react";
import { parseAsString, useQueryStates } from "nuqs";
import { AppContextualSidebarNav } from "#/components/app/app-contextual-layout";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { fileViewParser } from "#/lib/page-tab-search";

export function useTeamFilesView() {
	const [search, setSearch] = useQueryStates({
		view: fileViewParser,
		folder: parseAsString,
		file: parseAsString,
		create: parseAsString,
		document: parseAsString,
		kind: parseAsString,
		subjectUserId: parseAsString,
	});
	const changeView = (view: "team" | "my" | "trash" | "trash-my") =>
		setSearch({
			view,
			folder: null,
			file: null,
			create: null,
			document: null,
			kind: null,
			subjectUserId: null,
		});
	return [search.view, changeView] as const;
}

export function TeamFilesSidebar() {
	const { currentOrganization } = useAppOrganization();
	const [view, changeView] = useTeamFilesView();
	let activeView = view === "my" ? "my" : "team";
	if (view === "trash" || view === "trash-my") {
		activeView = "trash";
	}
	return (
		<AppContextualSidebarNav
			activeItemId={activeView}
			ariaLabel="File locations"
			groups={[
				{
					id: "locations",
					ariaLabel: "File navigation",
					label: "Files",
					contentOnly: true,
					items: [
						{ id: "team", label: "Team files", icon: FolderIcon },
						...(currentOrganization.isPersonal
							? []
							: [{ id: "my", label: "My files", icon: UserIcon }]),
						{ id: "trash", label: "Trash", icon: TrashIcon },
					],
				},
			]}
			onActivate={(id) => {
				if (id === "team" || id === "my") {
					changeView(id);
				} else if (id === "trash") {
					changeView(
						view === "my" || view === "trash-my" ? "trash-my" : "trash"
					);
				}
			}}
			placement="module"
			title="Files"
		/>
	);
}
