"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { prefetchCenterAgentConversationData } from "#/lib/organizations/app-route-prefetch";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";

export type CenterAgentConversationIntentPrefetch = () => void;

export function useCenterAgentConversationIntentPrefetch(): CenterAgentConversationIntentPrefetch {
	const { currentOrganization, storageScope } = useAppOrganization();
	const queryClient = useQueryClient();
	const queryPersistence = useMemo(
		() => resolveAppQueryPersistenceController(),
		[]
	);
	const inFlightRef = useRef<Promise<void> | null>(null);

	return useCallback(() => {
		if (inFlightRef.current) {
			return;
		}
		const prefetch = prefetchCenterAgentConversationData({
			organizationId: currentOrganization.id,
			organizationSlug: currentOrganization.slug,
			ownerAccountId: storageScope,
			queryClient,
			queryPersistence,
		});
		inFlightRef.current = prefetch;
		prefetch
			.catch((error: unknown) => {
				console.error("Failed to prefetch the Center Agent conversation.", {
					error,
					organizationId: currentOrganization.id,
				});
			})
			.finally(() => {
				if (inFlightRef.current === prefetch) {
					inFlightRef.current = null;
				}
			});
	}, [
		currentOrganization.id,
		currentOrganization.slug,
		queryClient,
		queryPersistence,
		storageScope,
	]);
}
