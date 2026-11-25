import {
	BooksIcon,
	CompassIcon,
	FolderIcon,
	PuzzlePieceIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import {
	SIDEBAR_SHORTCUT_IDS,
	type SidebarShortcutId,
} from "#/lib/appearance/sidebar-shortcuts";
import {
	buildOrganizationAgentsPath,
	buildOrganizationFilesPath,
	buildOrganizationPluginsPath,
	buildOrganizationSkillsPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";

const SHORTCUTS = {
	discover: {
		label: "Discover",
		icon: CompassIcon,
		path: (orgSlug: string) =>
			`${buildOrganizationSpacesPath(orgSlug)}?view=discover`,
	},
	agents: {
		label: "Agents",
		icon: RobotIcon,
		path: buildOrganizationAgentsPath,
	},
	plugins: {
		label: "Plugins",
		icon: PuzzlePieceIcon,
		path: buildOrganizationPluginsPath,
	},
	skills: {
		label: "Skills",
		icon: BooksIcon,
		path: buildOrganizationSkillsPath,
	},
	files: { label: "Files", icon: FolderIcon, path: buildOrganizationFilesPath },
} as const;

export function visibleSidebarShortcuts(
	ids: readonly SidebarShortcutId[],
	isPersonal: boolean
) {
	return ids.filter((id) => !(isPersonal && id === "discover"));
}

export function resolveActiveSidebarShortcut(
	pathname: string,
	orgSlug: string,
	searchStr = ""
) {
	return SIDEBAR_SHORTCUT_IDS.find((id) => {
		if (id === "discover") {
			return (
				pathname === buildOrganizationSpacesPath(orgSlug) &&
				new URLSearchParams(searchStr).get("view") === "discover"
			);
		}
		const path = SHORTCUTS[id].path(orgSlug);
		return pathname === path || pathname.startsWith(`${path}/`);
	});
}

export function buildPinnedRailDestinations(
	pinned: SidebarShortcutId[],
	orgSlug: string
) {
	return pinned.map((id) => {
		const item = SHORTCUTS[id];
		return {
			id,
			label: item.label,
			to: item.path(orgSlug),
			icon: <item.icon aria-hidden="true" className="size-5" />,
		};
	});
}
