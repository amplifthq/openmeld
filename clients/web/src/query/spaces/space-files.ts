import type { SpaceApi } from "@openmeld/api-client";
import { queryOptions } from "@tanstack/react-query";
import {
	baseQueryOptions,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";

export const spaceFileQueryKeys = {
	all: ["space-files"] as const,
	space: (spaceId: string) => [...spaceFileQueryKeys.all, spaceId] as const,
	folder: (
		spaceId: string,
		parentId: string | null,
		view: "active" | "trash" = "active"
	) =>
		[...spaceFileQueryKeys.space(spaceId), "folder", view, parentId] as const,
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

export function spaceFileContentQueryOptions(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	enabled?: boolean;
	fileId: string;
	revision: number;
	spaceId: string;
}) {
	return queryOptions({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await input.api.downloadFileContent({
				fileId: input.fileId,
				revision: input.revision,
				signal,
				spaceId: input.spaceId,
			}),
		queryKey: spaceFileQueryKeys.content(
			input.spaceId,
			input.fileId,
			input.revision
		),
		retry: baseQueryOptions.retry,
		staleTime: Number.POSITIVE_INFINITY,
	});
}
