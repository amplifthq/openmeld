import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { spaceHeaderTitleDisplayQueryOptions } from "#/query/spaces/header-title-display";

/**
 * The conversation title to paint: the live title when known, else the one
 * saved the last time it was known. Saving each live title keeps it through
 * a hard refresh and through a moment when its read is briefly empty, so the
 * header never falls back to another name once a real one is known.
 */
export function useSavedConversationTitle(input: {
	known: string | null;
	profileId: string;
	spaceId: string;
}): string | undefined {
	const queryClient = useQueryClient();
	const options = spaceHeaderTitleDisplayQueryOptions(
		input.spaceId,
		input.profileId
	);
	const saved = useQuery(options).data?.title;
	const { known } = input;
	useEffect(() => {
		if (!known || known === saved) {
			return;
		}
		queryClient.setQueryData(options.queryKey, { version: 1, title: known });
	}, [known, options.queryKey, queryClient, saved]);
	return known ?? saved;
}
