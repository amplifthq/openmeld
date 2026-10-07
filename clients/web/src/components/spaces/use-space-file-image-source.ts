"use client";

import type { SpaceApi } from "@openmeld/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { spaceFileMediaResources } from "#/query/spaces/space-file-media-resource";
import { spaceFileContentQueryOptions } from "#/query/spaces/space-files";

const noSource = () => null;
const noSubscription = () => () => {
	// No display resource exists yet.
};
const unavailable = new Error("The image preview is no longer available.");

export function useSpaceFileImageSource(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	fileId: string;
	enabled?: boolean;
	isLocal?: boolean;
	localPreviewUrl?: string | null;
	mimeType: string;
	revision: number;
	spaceId: string;
}): {
	error: Error | null;
	isLoading: boolean;
	sourceUrl: string | null;
	retry: () => Promise<void>;
} {
	const client = useQueryClient();
	const localResource = input.localPreviewUrl
		? spaceFileMediaResources(client).find(input.localPreviewUrl)
		: undefined;
	const contentQuery = useQuery(
		spaceFileContentQueryOptions({
			api: input.api,
			enabled:
				input.enabled !== false &&
				!(localResource?.getSnapshot() || input.isLocal),
			fileId: input.fileId,
			revision: input.revision,
			spaceId: input.spaceId,
		})
	);
	const resource = contentQuery.data?.mediaPreview ?? localResource;
	// A cached handle is available during render, not in a later effect. Every
	// mounted thumbnail/viewer has a lease and observes privacy revocation.
	const sourceUrl = useSyncExternalStore(
		resource?.subscribe ?? noSubscription,
		resource?.getSnapshot ?? noSource,
		resource?.getServerSnapshot ?? noSource
	);
	let error: Error | null = null;
	if (contentQuery.error instanceof Error) {
		error = contentQuery.error;
	} else if (contentQuery.error) {
		error = new Error("The image preview could not be loaded.");
	}
	if (
		!(contentQuery.isFetching || sourceUrl) &&
		(resource || input.isLocal || contentQuery.isSuccess)
	) {
		error ??= unavailable;
	}
	return {
		error,
		isLoading: !(sourceUrl || error),
		sourceUrl,
		retry: async () => {
			if (!input.isLocal) {
				// An explicit decode retry must replace bad bytes, not just reuse
				// the same immutable URL as an ordinary successful revalidation.
				resource?.revoke();
				await contentQuery.refetch();
			}
		},
	};
}
