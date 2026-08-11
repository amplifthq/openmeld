"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { prefetchKnownSpaceConversationData } from "#/lib/organizations/app-route-prefetch";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";

export type SpaceConversationIntentPrefetch = (input: {
	spaceId: string;
	openMeldProfileId: string;
}) => Promise<void>;

export function useSpaceConversationIntentPrefetch(): SpaceConversationIntentPrefetch {
	const { currentOrganization, storageScope } = useAppOrganization();
	const queryClient = useQueryClient();
	const queryPersistence = useMemo(
		() => resolveAppQueryPersistenceController(),
		[]
	);

	return useCallback(
		async (input) =>
			await prefetchKnownSpaceConversationData({
				organizationId: currentOrganization.id,
				organizationSlug: currentOrganization.slug,
				ownerAccountId: storageScope,
				queryClient,
				queryPersistence,
				spaceId: input.spaceId,
				openMeldProfileId: input.openMeldProfileId,
			}),
		[
			currentOrganization.id,
			currentOrganization.slug,
			queryClient,
			queryPersistence,
			storageScope,
		]
	);
}
