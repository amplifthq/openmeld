import {
	type SpaceApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { baseQueryOptions } from "#/query/query-config";
import {
	type CachedSpaceFileContent,
	clearSpaceFileMedia,
	spaceFileMediaResources,
} from "./space-file-media-resource";

export const spaceFileQueryKeys = {
	all: ["space-files"] as const,
	space: (spaceId: string) => [...spaceFileQueryKeys.all, spaceId] as const,
	folder: (
		spaceId: string,
		parentId: string | null,
		view: "active" | "trash" = "active",
		origin: "artifact" | "all" = "artifact"
	) =>
		[
			...spaceFileQueryKeys.space(spaceId),
			"folder",
			view,
			origin,
			parentId,
		] as const,
	content: (spaceId: string, fileId: string, revision: number) =>
		[
			...spaceFileQueryKeys.space(spaceId),
			"content",
			fileId,
			revision,
		] as const,
	revisions: (spaceId: string, fileId: string) =>
		[...spaceFileQueryKeys.space(spaceId), "revisions", fileId] as const,
};

const browserPreviewMimeTypes = new Set([
	"application/pdf",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function supportsSpaceFileDocumentPreview(mimeType: string): boolean {
	return browserPreviewMimeTypes.has(mimeType);
}

export function spaceFileContentQueryOptions(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	enabled?: boolean;
	fileId: string;
	revision: number;
	spaceId: string;
}) {
	return queryOptions({
		enabled: input.enabled,
		// Binary originals have a shorter idle lifetime than display history.
		gcTime: 5 * 60 * 1000,
		queryFn: async ({ client, signal }): Promise<CachedSpaceFileContent> => {
			const owner = spaceFileMediaResources(client);
			const generation = owner.generation;
			const content = await input.api
				.downloadFileContent({
					fileId: input.fileId,
					revision: input.revision,
					signal,
					spaceId: input.spaceId,
				})
				.catch((error: unknown) => {
					const failure = toStructuredApiClientFailure(error);
					const cached = client.getQueryData<CachedSpaceFileContent>(
						spaceFileQueryKeys.content(
							input.spaceId,
							input.fileId,
							input.revision
						)
					);
					if (
						cached?.mediaPreview &&
						[401, 403, 404, 410].includes(failure.status ?? 0)
					) {
						clearSpaceFileMedia(client, input.spaceId, input.fileId);
					}
					throw error;
				});
			signal.throwIfAborted();
			if (generation !== owner.generation) {
				throw new DOMException(
					"The account changed during this image read.",
					"AbortError"
				);
			}
			if (content.revision !== input.revision) {
				throw new Error(
					"The image response did not match the requested revision."
				);
			}
			if (
				!(
					content.mimeType.startsWith("image/") ||
					supportsSpaceFileDocumentPreview(content.mimeType)
				)
			) {
				return content;
			}
			const existing = client.getQueryData<CachedSpaceFileContent>(
				spaceFileQueryKeys.content(input.spaceId, input.fileId, input.revision)
			);
			// A successful immutable-revision revalidation keeps the same URL.
			if (existing?.mediaPreview?.getSnapshot()) {
				return existing;
			}
			const bytes = new Blob([content.bytes], { type: content.mimeType });
			return {
				...content,
				bytes,
				mediaPreview: owner.create(
					bytes,
					input.spaceId,
					`${input.fileId}:${input.revision}`,
					signal
				),
			};
		},
		queryKey: spaceFileQueryKeys.content(
			input.spaceId,
			input.fileId,
			input.revision
		),
		retry: baseQueryOptions.retry,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/** A local media selection retains the existing File; remote videos never enter this cache. */
export function cacheSpaceComposerMedia(input: {
	queryClient: QueryClient;
	spaceId: string;
	localId: string;
	mimeType: string;
	bytes: File;
}): string | null {
	if (
		!(
			input.mimeType.startsWith("image/") || input.mimeType.startsWith("video/")
		)
	) {
		return null;
	}
	const resource = spaceFileMediaResources(input.queryClient).create(
		input.bytes,
		input.spaceId,
		input.localId
	);
	// A local selection is an immutable, browser-only revision. This existing
	// non-persisted cache also owns pending previews while the composer unmounts.
	input.queryClient.setQueryData<CachedSpaceFileContent>(
		spaceFileQueryKeys.content(input.spaceId, input.localId, 1),
		{
			bytes: input.bytes,
			mimeType: input.mimeType,
			revision: 1,
			mediaPreview: resource,
		}
	);
	return resource.getSnapshot();
}

/** Canonical publication transfers the exact original before the message posts. */
export function seedPublishedSpaceFileMedia(input: {
	queryClient: QueryClient;
	spaceId: string;
	fileId: string;
	revision: number;
	mimeType: string;
	sizeBytes: number;
	localId: string;
	previewUrl: string | null;
	bytes: File;
}): void {
	if (
		!(
			(input.mimeType.startsWith("image/") ||
				input.mimeType.startsWith("video/")) &&
			input.previewUrl
		)
	) {
		return;
	}
	const resource = spaceFileMediaResources(input.queryClient).find(
		input.previewUrl
	);
	if (
		!(
			resource?.getSnapshot() &&
			resource.identity === input.localId &&
			resource.spaceId === input.spaceId
		)
	) {
		return;
	}
	if (input.bytes.size !== input.sizeBytes) {
		throw new Error("The published media did not match the selected file.");
	}
	input.queryClient.setQueryData<CachedSpaceFileContent>(
		spaceFileQueryKeys.content(input.spaceId, input.fileId, input.revision),
		{
			bytes: input.bytes,
			mimeType: input.mimeType,
			revision: input.revision,
			mediaPreview: resource,
		}
	);
}

export function resolveSpaceFileMediaPresentationKey(
	client: QueryClient | undefined,
	spaceId: string,
	file: { fileId: string; revision: number; isLocal?: boolean }
): string {
	if (file.isLocal) {
		return file.fileId;
	}
	return (
		client?.getQueryData<CachedSpaceFileContent>(
			spaceFileQueryKeys.content(spaceId, file.fileId, file.revision)
		)?.mediaPreview?.identity ?? `${file.fileId}:${file.revision}`
	);
}
