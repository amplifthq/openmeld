import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";

export function useSpaceConversationReadCache(input: {
	spaceId: string;
	openMeldProfileId: string;
}): void {
	const organization = useOptionalAppOrganization();
	const queryClient = useQueryClient();
	const queryPersistence = useMemo(
		() => resolveAppQueryPersistenceController(),
		[]
	);

	useEffect(() => {
		if (!organization) {
			return;
		}
		queryPersistence
			.activateSpaceConversation({
				organizationId: organization.currentOrganization.id,
				organizationSlug: organization.currentOrganization.slug,
				ownerAccountId: organization.storageScope,
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.openMeldProfileId,
			})
			.catch((error: unknown) => {
				console.error("Failed to activate the saved Space conversation view.", {
					error,
					spaceId: input.spaceId,
				});
			});
	}, [
		input.spaceId,
		input.openMeldProfileId,
		organization,
		queryClient,
		queryPersistence,
	]);
}
