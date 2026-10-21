import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	isSidebarSnapshotSource,
	readSidebarDisplaySnapshot,
	sidebarDisplaySnapshotQueryKey,
} from "#/query/spaces/sidebar-display-snapshot";

const SAVE_DELAY_MS = 1000;

/**
 * Saves what the conversations sidebar painted, so the next hard refresh can
 * paint the same rows before its reads return. Display only.
 */
export function useSaveSidebarDisplaySnapshot(input: {
	organizationId: string;
	profileId: string;
}) {
	const queryClient = useQueryClient();
	const { storageScope } = useAppOrganization();
	const { organizationId, profileId } = input;
	useEffect(() => {
		if (!(profileId && storageScope)) {
			return;
		}
		const queryKey = sidebarDisplaySnapshotQueryKey(
			storageScope,
			organizationId
		);
		let saved = JSON.stringify(queryClient.getQueryData(queryKey) ?? null);
		let timer: ReturnType<typeof setTimeout> | null = null;
		const save = () => {
			timer = null;
			const snapshot = readSidebarDisplaySnapshot(queryClient, {
				organizationId,
				profileId,
			});
			const next = JSON.stringify(snapshot);
			if (!snapshot || next === saved) {
				return;
			}
			saved = next;
			queryClient.setQueryData(queryKey, snapshot);
		};
		const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
			if (
				event.type !== "updated" ||
				event.action.type !== "success" ||
				timer !== null ||
				!isSidebarSnapshotSource(event.query.queryKey)
			) {
				return;
			}
			timer = setTimeout(save, SAVE_DELAY_MS);
		});
		timer = setTimeout(save, SAVE_DELAY_MS);
		return () => {
			unsubscribe();
			if (timer !== null) {
				clearTimeout(timer);
			}
		};
	}, [organizationId, profileId, queryClient, storageScope]);
}
