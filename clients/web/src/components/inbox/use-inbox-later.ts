import { useCallback, useEffect, useState } from "react";

const LATER_DURATION_MS = 60 * 60 * 1000;
const INBOX_LATER_CHANGE_EVENT = "openmeld:inbox-later-changed";
const EMPTY_LATER: Record<string, number> = {};

function readLater(key: string): Record<string, number> {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
		if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(stored).filter(
				(entry): entry is [string, number] =>
					typeof entry[1] === "number" &&
					Number.isFinite(entry[1]) &&
					entry[1] > Date.now()
			)
		);
	} catch {
		return {};
	}
}

/** A browser-local presentation preference, never a source decision or read. */
export function useInboxLater(scope: string) {
	const key = `openmeld.inbox.later:${scope}`;
	const [state, setState] = useState(() => ({ key, items: readLater(key) }));
	const later = state.key === key ? state.items : EMPTY_LATER;

	useEffect(() => {
		const refresh = () => setState({ key, items: readLater(key) });
		refresh();
		const onStorage = (event: Event) => {
			if (
				event instanceof StorageEvent &&
				(event.key === key || event.key === null)
			) {
				refresh();
			}
		};
		window.addEventListener("storage", onStorage);
		window.addEventListener(INBOX_LATER_CHANGE_EVENT, onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener(INBOX_LATER_CHANGE_EVENT, onStorage);
		};
	}, [key]);

	useEffect(() => {
		const next = Math.min(...Object.values(later));
		if (!Number.isFinite(next)) {
			return;
		}
		const timer = window.setTimeout(
			() => {
				setState({
					key,
					items: Object.fromEntries(
						Object.entries(later).filter(([, until]) => until > Date.now())
					),
				});
			},
			Math.max(0, next - Date.now())
		);
		return () => window.clearTimeout(timer);
	}, [key, later]);

	const defer = useCallback(
		(id: string) => {
			const items = {
				...readLater(key),
				...later,
				[id]: Date.now() + LATER_DURATION_MS,
			};
			try {
				localStorage.setItem(key, JSON.stringify(items));
				window.dispatchEvent(
					new StorageEvent(INBOX_LATER_CHANGE_EVENT, { key })
				);
			} catch {
				// Keep the preference for this open page if storage is unavailable.
			}
			setState({ key, items });
		},
		[key, later]
	);

	return { defer, later };
}
