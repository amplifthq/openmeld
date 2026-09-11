import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

const CHANGE_EVENT = "openmeld-sidebar-disclosure";
const SIDEBAR_PREFIXES = {
	space: /^Spaces:/,
	people: /^People:/,
	chat: /^Chats:/,
};

export function parseSidebarDisclosure(
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

export function resolveSidebarGroupOpen(
	choices: Record<string, boolean>,
	groupId: string,
	activeGroupId: string | null
): boolean {
	return groupId === activeGroupId || (choices[groupId] ?? false);
}

function subscribe(listener: () => void) {
	window.addEventListener("storage", listener);
	window.addEventListener(CHANGE_EVENT, listener);
	return () => {
		window.removeEventListener("storage", listener);
		window.removeEventListener(CHANGE_EVENT, listener);
	};
}

export function useSidebarDisclosure(
	destination: "space" | "people" | "chat",
	profileId: string,
	organizationId: string,
	activeGroupId: string | null,
	currentItemId: string = activeGroupId ?? "",
	defaultOpenGroupIds: readonly string[] = []
) {
	const prefix = SIDEBAR_PREFIXES[destination];
	const key = `openmeld:${destination}-sidebar-disclosure:${encodeURIComponent(profileId)}:${encodeURIComponent(organizationId)}`;
	const visitKey = `${key}:${currentItemId}`;
	const [visit, setVisit] = useState<{
		key: string;
		choices: Record<string, boolean>;
	}>({ key: visitKey, choices: {} });
	if (visit.key !== visitKey) {
		setVisit({ key: visitKey, choices: {} });
	}
	const visitChoices = visit.key === visitKey ? visit.choices : {};
	const read = useCallback(() => window.localStorage.getItem(key), [key]);
	const raw = useSyncExternalStore(subscribe, read, () => null);
	const choices = useMemo(() => parseSidebarDisclosure(raw), [raw]);
	return {
		isOpen: (id: string) =>
			visitChoices[id.replace(prefix, "")] ??
			resolveSidebarGroupOpen(
				{
					...Object.fromEntries(
						defaultOpenGroupIds.map((groupId) => [groupId, true])
					),
					...choices,
				},
				id.replace(prefix, ""),
				activeGroupId
			),
		setOpen: (id: string, open: boolean) => {
			const groupId = id.replace(prefix, "");
			setVisit((current) => ({
				key: visitKey,
				choices: { ...current.choices, [groupId]: open },
			}));
			const current = parseSidebarDisclosure(read());
			window.localStorage.setItem(
				key,
				JSON.stringify({
					...current,
					[id.replace(prefix, "")]: open,
				})
			);
			window.dispatchEvent(new Event(CHANGE_EVENT));
		},
	};
}
