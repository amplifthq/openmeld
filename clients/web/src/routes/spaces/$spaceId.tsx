import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";
import {
	PUBLIC_VIEWER_PROFILE_ID,
	PublicSpacePage,
	publicSpaceQueryKey,
	publicSpaceWindowKey,
} from "#/components/spaces/public-space-page";
import { getSession } from "#/lib/auth-session";
import { readPublicSpaceInitialData } from "#/lib/spaces/public-space-initial-read";
import { spaceEntryResolutionQueryKey } from "#/query/spaces/entry-resolution";

const publicSpaceRouteSearchSchema = z.object({
	focusInteractionId: z.string().trim().min(1).optional(),
	focusSignalId: z.string().trim().min(1).optional(),
	focusThreadRootSignalId: z.string().trim().min(1).optional(),
	signalId: z.string().trim().min(1).optional(),
	threadRootSignalId: z.string().trim().min(1).optional(),
});

export const Route = createFileRoute("/spaces/$spaceId")({
	headers: () => ({ "Cache-Control": "private, no-store" }),
	validateSearch: (search) => {
		const parsed = publicSpaceRouteSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	loader: async ({ context, location, params }) => {
		const session = await getSession({
			data: {
				currentUserSessionExpectation: "optional",
				routeFamily: location.pathname,
				sessionCacheMode: "bypass",
			},
		});
		const url = new URL(location.href, "http://localhost");
		const target = new URLSearchParams();
		const signalId =
			url.searchParams.get("focusSignalId") ?? url.searchParams.get("signalId");
		const threadRootSignalId =
			url.searchParams.get("focusThreadRootSignalId") ??
			url.searchParams.get("threadRootSignalId");
		if (signalId) {
			target.set("signalId", signalId);
		}
		if (threadRootSignalId) {
			target.set("threadRootSignalId", threadRootSignalId);
		}
		const initialData = await readPublicSpaceInitialData({
			data: {
				spaceId: params.spaceId,
				...(signalId ? { signalId } : {}),
				...(threadRootSignalId ? { threadRootSignalId } : {}),
			},
		});
		context.queryClient.setQueryData(
			spaceEntryResolutionQueryKey({
				spaceId: params.spaceId,
				...(signalId ? { signalId } : {}),
				...(threadRootSignalId ? { threadRootSignalId } : {}),
			}),
			initialData.entryResolution
		);
		if (initialData.content) {
			context.queryClient.setQueryData(
				publicSpaceQueryKey(params.spaceId, "status"),
				initialData.content.status
			);
			context.queryClient.setQueryData(
				publicSpaceQueryKey(
					params.spaceId,
					"signals",
					publicSpaceWindowKey(initialData.entryResolution.target)
				),
				{
					envelopes: initialData.content.signals,
					nextCursor: initialData.content.nextCursor,
				}
			);
			context.queryClient.setQueryData(
				publicSpaceQueryKey(params.spaceId, "threads"),
				{
					threads: initialData.content.threads,
					previews: initialData.content.threadPreviews,
				}
			);
			context.queryClient.setQueryData(
				[
					"spaces",
					params.spaceId,
					PUBLIC_VIEWER_PROFILE_ID,
					"history-navigation",
				],
				initialData.historyNavigation
			);
			const selectedThread = initialData.entryResolution.target
				.threadRootSignalId
				? initialData.content.threads.find(
						(thread) =>
							thread.rootSignalId ===
							initialData.entryResolution.target.threadRootSignalId
					)
				: undefined;
			if (selectedThread && initialData.threadSignals) {
				context.queryClient.setQueryData(
					[
						...publicSpaceQueryKey(params.spaceId, "thread-signals"),
						selectedThread.threadId,
					],
					initialData.threadSignals
				);
			}
		}
		return {
			isAuthenticated: Boolean(session),
			contextHref: `/v1${location.pathname}/context?${target}`,
		};
	},
	head: ({ params, loaderData }) => ({
		meta: [{ name: "robots", content: "noindex, nofollow" }],
		links: [
			{
				rel: "alternate",
				type: "application/json",
				title: "Read Space context",
				href:
					loaderData?.contextHref ??
					`/v1/spaces/${encodeURIComponent(params.spaceId)}/context`,
			},
		],
	}),
	component: PublicSpaceRoute,
});

function PublicSpaceRoute() {
	const { spaceId } = Route.useParams();
	const { isAuthenticated } = Route.useLoaderData();
	const search = Route.useSearch();

	return (
		<PublicSpacePage
			isAuthenticated={isAuthenticated}
			signalId={search.focusSignalId ?? search.signalId}
			spaceId={spaceId}
			threadRootSignalId={
				search.focusThreadRootSignalId ?? search.threadRootSignalId
			}
		/>
	);
}
