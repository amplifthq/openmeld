import { useEffect, useState } from "react";

type Expansion = { all: boolean; exceptions: string[] };
const COLLAPSED: Expansion = { all: false, exceptions: [] };

/** Presentation preferences only; never stores message content or read state. */
export function useInboxExpansion(accountId: string, organizationId: string) {
	const key = `openmeld:inbox-expansion:${accountId}:${organizationId}`;
	const [state, setState] = useState<{ key: string; value: Expansion }>({
		key,
		value: COLLAPSED,
	});
	useEffect(() => {
		let value = COLLAPSED;
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
			if (
				saved &&
				typeof saved === "object" &&
				"all" in saved &&
				typeof saved.all === "boolean" &&
				"exceptions" in saved &&
				Array.isArray(saved.exceptions) &&
				saved.exceptions.every((entry) => typeof entry === "string")
			) {
				value = { all: saved.all, exceptions: saved.exceptions.slice(-100) };
			}
		} catch {
			// Storage is optional; the controls still work for this visit.
		}
		setState({ key, value });
	}, [key]);
	const value = state.key === key ? state.value : COLLAPSED;
	const update = (next: Expansion) => {
		setState({ key, value: next });
		try {
			localStorage.setItem(key, JSON.stringify(next));
		} catch {
			// Private browsing or a full storage quota must not block the Inbox.
		}
	};
	return {
		isExpanded: (groupKey: string) =>
			value.exceptions.includes(groupKey) ? !value.all : value.all,
		toggle: (groupKey: string) =>
			update({
				all: value.all,
				exceptions: value.exceptions.includes(groupKey)
					? value.exceptions.filter((entry) => entry !== groupKey)
					: [...value.exceptions, groupKey].slice(-100),
			}),
		setAll: (all: boolean) => update({ all, exceptions: [] }),
	};
}
