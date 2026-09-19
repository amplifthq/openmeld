import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";

export type SkillCatalogStatus = "all" | "enabled" | "disabled";
type CatalogView = {
	search: string;
	status: SkillCatalogStatus;
	scrollTop: number;
};

/** Only view preferences, never Skill contents. QueryClient lifetime isolates accounts;
 * storageScope + Organization identity also isolates account/tenant switches.
 * This key is not in the persistent server-read cache's allowlist.
 */
export function useSkillCatalogView(ready: boolean) {
	const queryClient = useQueryClient();
	const { currentOrganization, storageScope } = useAppOrganization();
	const key = ["skill-catalog-view", storageScope, currentOrganization.id];
	const [view, setView] = useState<CatalogView>(
		() =>
			queryClient.getQueryData<CatalogView>(key) ?? {
				search: "",
				status: "all",
				scrollTop: 0,
			}
	);
	const current = useRef(view);
	const root = useRef<HTMLDivElement>(null);
	const restored = useRef(false);
	const update = (patch: Partial<CatalogView>) => {
		current.current = { ...current.current, ...patch };
		queryClient.setQueryData(key, current.current);
		setView(current.current);
	};
	useLayoutEffect(() => {
		if (!ready || restored.current) {
			return;
		}
		restored.current = true;
		const viewport = root.current?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]'
		);
		if (viewport) {
			viewport.scrollTop = current.current.scrollTop;
		}
	}, [ready]);
	useEffect(() => {
		const viewport = root.current?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]'
		);
		if (!viewport) {
			return;
		}
		const remember = () => {
			current.current = { ...current.current, scrollTop: viewport.scrollTop };
			queryClient.setQueryData(
				["skill-catalog-view", storageScope, currentOrganization.id],
				current.current
			);
		};
		viewport.addEventListener("scroll", remember, { passive: true });
		return () => viewport.removeEventListener("scroll", remember);
	}, [queryClient, storageScope, currentOrganization.id]);
	return { root, search: view.search, status: view.status, update };
}
