import {
	spaceFileEntryIdSchema,
	spaceFileRevisionNumberSchema,
} from "@openmeld/schemas";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod/v4";
import { isSpaceFileHtml } from "#/components/spaces/space-file-html-document";
import { SpaceFileHtmlPreview } from "#/components/spaces/space-file-html-preview";
import {
	downloadContent,
	resolveSpaceFileErrorMessage,
} from "#/components/spaces/space-file-utils";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";

const searchSchema = z.object({
	spaceId: z.string().trim().min(1).max(512),
	fileId: spaceFileEntryIdSchema,
	revision: z.coerce.number().pipe(spaceFileRevisionNumberSchema),
	profileId: z.string().trim().min(1).max(128).optional(),
	organizationSlug: z.string().trim().min(1).max(512).optional(),
});

export const Route = createFileRoute("/file-preview")({
	ssr: false,
	validateSearch: searchSchema,
	head: () => ({
		meta: [
			{ title: "File preview | OpenMeld" },
			{ name: "robots", content: "noindex, nofollow" },
		],
	}),
	component: FilePreviewPage,
});

function FilePreviewPage() {
	const input = Route.useSearch();
	const api = useMemo(
		() =>
			input.organizationSlug
				? createOrganizationScopedWebSpaceApi({
						organizationSlug: input.organizationSlug,
						openMeldProfileId: input.profileId,
					})
				: createUnscopedWebSpaceApi({ openMeldProfileId: input.profileId }),
		[input.organizationSlug, input.profileId]
	);
	const query = useQuery({
		queryKey: [
			...spaceFileQueryKeys.content(
				input.spaceId,
				input.fileId,
				input.revision
			),
			"preview-page",
			input.profileId,
			input.organizationSlug,
		],
		// A URL identifies a revision; only the ordinary authenticated read grants access.
		queryFn: async ({ signal }) => {
			const [{ file }, content] = await Promise.all([
				api.getFile({ spaceId: input.spaceId, fileId: input.fileId, signal }),
				api.downloadFileContent({
					spaceId: input.spaceId,
					fileId: input.fileId,
					revision: input.revision,
					signal,
				}),
			]);
			return { file, content };
		},
		gcTime: 0,
		staleTime: 0,
		retry: false,
	});
	const spacePath = input.organizationSlug
		? `/o/${encodeURIComponent(input.organizationSlug)}/spaces/${encodeURIComponent(input.spaceId)}`
		: `/spaces/${encodeURIComponent(input.spaceId)}`;
	const openSpaceUrl = input.profileId
		? `${spacePath}?profileId=${encodeURIComponent(input.profileId)}`
		: spacePath;
	const data = query.isError ? undefined : query.data;
	return (
		<main className="flex h-dvh flex-col bg-background">
			<header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
				<div className="min-w-0">
					<h1 className="truncate font-medium text-sm">
						{data?.file.name ?? "File preview"}
					</h1>
					<p className="text-muted-foreground text-xs">
						Version {input.revision}
					</p>
				</div>
				<a
					className={buttonVariants({ size: "sm", variant: "outline" })}
					href={openSpaceUrl}
				>
					Open Space
				</a>
			</header>
			<div className="flex min-h-0 flex-1 flex-col p-5">
				{query.isPending ? (
					<Skeleton aria-label="Loading file" className="flex-1" />
				) : null}
				{query.isError ? (
					<div
						className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
						role="alert"
					>
						<p>{resolveSpaceFileErrorMessage(query.error)}</p>
						<p className="text-muted-foreground text-sm">
							Open the Space to sign in or check your access.
						</p>
						<Button onClick={() => query.refetch()} size="sm" variant="outline">
							Try again
						</Button>
					</div>
				) : null}
				{data && isSpaceFileHtml(data.content.mimeType) ? (
					<SpaceFileHtmlPreview
						bytes={data.content.bytes}
						draft={null}
						fileName={data.file.name}
						hasUnsavedChanges={false}
						isError={false}
						isLoading={false}
						key={`${input.fileId}:${input.revision}`}
						onDownload={() => downloadContent(data.file.name, data.content)}
						onRetry={() => query.refetch()}
						sourceEditor={null}
					/>
				) : null}
				{data && !isSpaceFileHtml(data.content.mimeType) ? (
					<p>
						This file isn’t an HTML document. Open it in Files to view or
						download it.
					</p>
				) : null}
			</div>
		</main>
	);
}
