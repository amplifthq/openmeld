"use client";

import type { SpaceApi } from "@openmeld/api-client";
import { useEffect, useMemo, useState } from "react";

type SpaceFileImageSourceState = {
	error: Error | null;
	key: string;
	url: string | null;
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
	const [remoteSource, setRemoteSource] =
		useState<SpaceFileImageSourceState | null>(null);

	useEffect(() => {
		if (input.localPreviewUrl) {
			return;
		}

		const controller = new AbortController();
		let objectUrl: string | null = null;

		input.api
			.downloadFileContent({
				fileId: input.fileId,
				revision: input.revision,
				signal: controller.signal,
				spaceId: input.spaceId,
			})
			.then((content) => {
				if (controller.signal.aborted) {
					return;
				}
				objectUrl = URL.createObjectURL(
					new Blob([content.bytes], {
						type: content.mimeType || input.mimeType,
					})
				);
				setRemoteSource({ error: null, key: sourceKey, url: objectUrl });
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) {
					return;
				}
				setRemoteSource({
					error:
						error instanceof Error
							? error
							: new Error("The image preview could not be loaded."),
					key: sourceKey,
					url: null,
				});
			});

		return () => {
			controller.abort();
			if (objectUrl) {
				URL.revokeObjectURL(objectUrl);
			}
		};
	}, [
		input.api,
		input.fileId,
		input.localPreviewUrl,
		input.mimeType,
		input.revision,
		input.spaceId,
		sourceKey,
	]);

	if (input.localPreviewUrl) {
		return {
			error: null,
			isLoading: false,
			sourceUrl: input.localPreviewUrl,
		};
	}
	if (remoteSource?.key !== sourceKey) {
		return { error: null, isLoading: true, sourceUrl: null };
	}
	return {
		error: remoteSource.error,
		isLoading: remoteSource.url === null && remoteSource.error === null,
		sourceUrl: remoteSource.url,
	};
}
