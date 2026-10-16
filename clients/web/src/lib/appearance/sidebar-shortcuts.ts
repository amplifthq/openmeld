import { useBrowserPreference } from "../use-browser-preference";

export const SIDEBAR_SHORTCUT_IDS = [
	"messages",
	"discover",
	"agents",
	"plugins",
	"skills",
	"files",
] as const;
export type SidebarShortcutId = (typeof SIDEBAR_SHORTCUT_IDS)[number];

export function useSidebarShortcuts() {
	const [stored, write] = useBrowserPreference(
		"openmeld.appearance.sidebar-shortcuts"
	);
	const pinned = [...new Set((stored ?? "").split(" "))].filter(
		(id): id is SidebarShortcutId =>
			SIDEBAR_SHORTCUT_IDS.some((choice) => choice === id)
	);
	return {
		pinned,
		toggle: (id: SidebarShortcutId) =>
			write(
				(pinned.includes(id)
					? pinned.filter((choice) => choice !== id)
					: [...pinned, id]
				).join(" ")
			),
	};
}
