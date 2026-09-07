import { useCallback, useMemo, useSyncExternalStore } from "react";

const CHANGE_EVENT = "openmeld-space-sidebar-disclosure";
const MAIN_SIDEBAR_PREFIX = /^Spaces:/;

export function parseSpaceSidebarDisclosure(
	raw: string | null
): Record<string, boolean> {
	try {
		const value: unknown = JSON.parse(raw ?? "{}");
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(value).filter(([, open]) => typeof open === "boolean")
		);
	} catch {
		return {};
	}
}

export function resolveSpaceSidebarGroupOpen(
	choices: Record<string, boolean>,
	groupId: string,
	activeGroupId: string | null
): boolean {
	return choices[groupId] ?? groupId === activeGroupId;
}

function subscribe(listener: () => void) {
	window.addEventListener("storage", listener);
	window.addEventListener(CHANGE_EVENT, listener);
	return () => {
		window.removeEventListener("storage", listener);
		window.removeEventListener(CHANGE_EVENT, listener);
	};
}

export function useSpaceSidebarDisclosure(
	profileId: string,
	organizationId: string,
	activeGroupId: string | null
) {
	const key = `openmeld:space-sidebar-disclosure:${encodeURIComponent(profileId)}:${encodeURIComponent(organizationId)}`;
	const read = useCallback(() => window.localStorage.getItem(key), [key]);
	const raw = useSyncExternalStore(subscribe, read, () => null);
	const choices = useMemo(() => parseSpaceSidebarDisclosure(raw), [raw]);
	return {
		isOpen: (id: string) =>
			resolveSpaceSidebarGroupOpen(
				choices,
				id.replace(MAIN_SIDEBAR_PREFIX, ""),
				activeGroupId
			),
		setOpen: (id: string, open: boolean) => {
			const current = parseSpaceSidebarDisclosure(read());
			window.localStorage.setItem(
				key,
				JSON.stringify({
					...current,
					[id.replace(MAIN_SIDEBAR_PREFIX, "")]: open,
				})
			);
			window.dispatchEvent(new Event(CHANGE_EVENT));
		},
	};
}
