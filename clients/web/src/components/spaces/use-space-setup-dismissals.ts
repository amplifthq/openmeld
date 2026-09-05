import type { OnboardingPlan } from "@openmeld/schemas/types";
import { useCallback, useSyncExternalStore } from "react";

type DecisionId = OnboardingPlan["decisions"][number]["id"];
const CHANGE_EVENT = "openmeld:space-setup-dismissals";
const memoryFallback = new Map<string, string>();

function subscribe(onChange: () => void) {
	window.addEventListener("storage", onChange);
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => {
		window.removeEventListener("storage", onChange);
		window.removeEventListener(CHANGE_EVENT, onChange);
	};
}

function read(key: string): string {
	const fallback = memoryFallback.get(key);
	if (fallback !== undefined) {
		return fallback;
	}
	try {
		return window.localStorage.getItem(key) ?? "[]";
	} catch {
		return memoryFallback.get(key) ?? "[]";
	}
}

function parse(value: string | null): Set<DecisionId> {
	try {
		const ids: unknown = JSON.parse(value ?? "[]");
		return new Set(
			Array.isArray(ids)
				? ids.filter(
						(id): id is DecisionId =>
							id === "connect_this_computer" || id === "bring_agents"
					)
				: []
		);
	} catch {
		return new Set();
	}
}

export function useSpaceSetupDismissals(input: {
	userId: string | null;
	orgSlug: string;
	spaceId: string;
}) {
	const key = input.userId
		? `openmeld.space-setup-dismissals.v1:${JSON.stringify([input.userId, input.orgSlug, input.spaceId])}`
		: null;
	const getSnapshot = useCallback(() => (key ? read(key) : null), [key]);
	const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
	const write = useCallback(
		(ids: ReadonlySet<DecisionId>) => {
			if (!key) {
				return;
			}
			const value = JSON.stringify([...ids]);
			try {
				if (ids.size > 0) {
					window.localStorage.setItem(key, value);
				} else {
					window.localStorage.removeItem(key);
				}
				memoryFallback.delete(key);
			} catch {
				// Dismissal still works for this page when browser storage is blocked.
				memoryFallback.set(key, value);
			}
			window.dispatchEvent(new Event(CHANGE_EVENT));
		},
		[key]
	);
	const dismiss = useCallback(
		(id: DecisionId) => write(parse(key ? read(key) : null).add(id)),
		[key, write]
	);
	const recall = useCallback(() => write(new Set()), [write]);
	return {
		dismissedIds: parse(snapshot),
		dismiss,
		recall,
		isReady: snapshot !== null,
	};
}
