import { useEffect } from "react";
import { toast } from "sonner";
import type { RecentlyDeletedSpaceItem } from "#/lib/spaces/account-spaces";

const STORAGE_KEY = "openmeld:deleted-space-notices-shown";
export function useDeletedSpaceNotices(
	items: readonly RecentlyDeletedSpaceItem[] | undefined
) {
	useEffect(() => {
		if (!items?.length) {
			return;
		}
		let shown = new Set<string>();
		try {
			const value: unknown = JSON.parse(
				localStorage.getItem(STORAGE_KEY) ?? "[]"
			);
			if (Array.isArray(value)) {
				shown = new Set(
					value.filter((id): id is string => typeof id === "string")
				);
			}
		} catch {
			/* Notices still render when browser storage is unavailable. */
		}
		for (const item of items) {
			if (!shown.has(item.spaceId)) {
				toast(
					`${item.deletedByProfileName ?? "Someone"} deleted "${item.spaceName ?? "a space"}".`
				);
			}
		}
		try {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify(items.map((item) => item.spaceId))
			);
		} catch {
			/* Best-effort browser presentation preference. */
		}
	}, [items]);
}
