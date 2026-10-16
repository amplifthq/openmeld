import { useMemo } from "react";
import { z } from "zod/v4";
import { readBrowserPreference } from "#/lib/spaces/browser-preference-storage";
import { useBrowserPreference } from "#/lib/use-browser-preference";
import type { AgentListView } from "./agent-list";

const listStateSchema = z.object({
	search: z.string(),
	view: z
		.object({
			filters: z.object({
				type: z.array(z.string()),
				availability: z.array(z.string()),
				controller: z.array(z.string()),
				provider: z.array(z.string()),
				model: z.array(z.string()),
			}),
			sort: z.enum(["recent", "created", "name"]),
			grouping: z.enum([
				"none",
				"controller-provider",
				"controller",
				"provider",
				"model",
			]),
		})
		.nullable(),
});

function parseListState(stored: string | null) {
	try {
		const parsed = listStateSchema.safeParse(JSON.parse(stored ?? "null"));
		if (parsed.success) {
			return parsed.data;
		}
	} catch {
		// An obsolete or malformed preference does not prevent using the list.
	}
	return { search: "", view: null };
}

// Presentation preferences only: never cache Profile, permission or readiness facts.
export function useAgentListState(key: string) {
	const storageKey = `${key}:filters`;
	const [stored, save] = useBrowserPreference(storageKey);
	const state = useMemo(() => parseListState(stored), [stored]);
	const update = (patch: Partial<z.infer<typeof listStateSchema>>) => {
		const latest = parseListState(readBrowserPreference(storageKey));
		save(JSON.stringify({ ...latest, ...patch }));
	};
	return {
		...state,
		setSearch: (search: string) => update({ search }),
		setView: (view: AgentListView | null) => update({ view }),
	};
}
