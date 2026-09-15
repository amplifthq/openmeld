"use client";

import type { SpaceApi } from "@openmeld/api-client";
import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { spaceFileContentQueryOptions } from "#/query/spaces/space-files";

type SpaceFileObjectUrl = {
	key: string;
	url: string;
};

export function useSpaceFileImageSource(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	fileId: string;
	isLocal?: boolean;
	localPreviewUrl?: string | null;
	mimeType: string;
	revision: number;
	spaceId: string;
}): {
	error: Error | null;
	isLoading: boolean;
	placeholderRef: RefObject<HTMLOutputElement | null>;
	sourceUrl: string | null;
} {
	const sourceKey = useMemo(
		() => `${input.spaceId}:${input.fileId}:${String(input.revision)}`,
		[input.fileId, input.revision, input.spaceId]
	);
	const placeholderRef = useRef<HTMLOutputElement>(null);
	const [visibleSourceKey, setVisibleSourceKey] = useState<string | null>(null);
	const eligible = visibleSourceKey === sourceKey;
	useEffect(() => {
		const element = placeholderRef.current;
		if (!element || input.localPreviewUrl || input.isLocal) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisibleSourceKey(sourceKey);
					observer.disconnect();
				}
			},
			{ rootMargin: "300px" }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [sourceKey, input.localPreviewUrl, input.isLocal]);
	const contentQuery = useQuery(
		spaceFileContentQueryOptions({
			api: input.api,
			enabled: eligible && !(input.localPreviewUrl || input.isLocal),
			fileId: input.fileId,
			revision: input.revision,
			spaceId: input.spaceId,
		})
	);
	const [objectUrl, setObjectUrl] = useState<SpaceFileObjectUrl | null>(null);

	useEffect(() => {
		if (!eligible || input.localPreviewUrl || !contentQuery.data) {
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
	}, [
		contentQuery.data,
		eligible,
		input.localPreviewUrl,
		input.mimeType,
		sourceKey,
	]);

	if (input.localPreviewUrl) {
		return {
			placeholderRef,
			error: null,
			isLoading: false,
			sourceUrl: input.localPreviewUrl,
		};
	}
	let error: Error | null = null;
	if (eligible && contentQuery.error instanceof Error) {
		error = contentQuery.error;
	} else if (eligible && contentQuery.error) {
		error = new Error("The image preview could not be loaded.");
	}
	return {
		placeholderRef,
		error,
		isLoading: !(
			input.isLocal ||
			error ||
			(objectUrl?.key === sourceKey && objectUrl.url.length > 0)
		),
		sourceUrl: objectUrl?.key === sourceKey ? objectUrl.url : null,
	};
}
