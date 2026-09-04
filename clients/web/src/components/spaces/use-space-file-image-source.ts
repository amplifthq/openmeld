"use client";

import type { SpaceApi } from "@openmeld/api-client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { spaceFileContentQueryOptions } from "#/query/spaces/space-files";

type SpaceFileObjectUrl = {
	key: string;
	url: string;
};

export function useSpaceFileImageSource(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	fileId: string;
	localPreviewUrl?: string | null;
	mimeType: string;
	revision: number;
	spaceId: string;
}): {
	error: Error | null;
	isLoading: boolean;
	sourceUrl: string | null;
} {
	const sourceKey = useMemo(
		() => `${input.spaceId}:${input.fileId}:${String(input.revision)}`,
		[input.fileId, input.revision, input.spaceId]
	);
	const contentQuery = useQuery(
		spaceFileContentQueryOptions({
			api: input.api,
			enabled: !input.localPreviewUrl,
			fileId: input.fileId,
			revision: input.revision,
			spaceId: input.spaceId,
		})
	);
	const [objectUrl, setObjectUrl] = useState<SpaceFileObjectUrl | null>(null);

	useEffect(() => {
		if (input.localPreviewUrl || !contentQuery.data) {
			return;
		}

		const url = URL.createObjectURL(
			new Blob([contentQuery.data.bytes], {
				type: contentQuery.data.mimeType || input.mimeType,
			})
		);
		setObjectUrl({ key: sourceKey, url });

		return () => {
			URL.revokeObjectURL(url);
		};
	}, [contentQuery.data, input.localPreviewUrl, input.mimeType, sourceKey]);

	if (input.localPreviewUrl) {
		return {
			error: null,
			isLoading: false,
			sourceUrl: input.localPreviewUrl,
		};
	}
	let error: Error | null = null;
	if (contentQuery.error instanceof Error) {
		error = contentQuery.error;
	} else if (contentQuery.error) {
		error = new Error("The image preview could not be loaded.");
	}
	return {
		error,
		isLoading: !(
			error ||
			(objectUrl?.key === sourceKey && objectUrl.url.length > 0)
		),
		sourceUrl: objectUrl?.key === sourceKey ? objectUrl.url : null,
	};
}
