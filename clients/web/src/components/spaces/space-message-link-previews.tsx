import type { SpaceApi } from "@openmeld/api-client";
import { collectMessagePreviewUrls } from "@openmeld/protocol";
import { MAX_MESSAGE_LINK_PREVIEWS } from "@openmeld/schemas";
import { LinkPreviewCard } from "@openmeld/ui/components/link-preview-card";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

export function SpaceMessageLinkPreviews(input: {
	api: Pick<SpaceApi, "getLinkPreviews">;
	spaceId: string;
	signalId: string;
	revision: number;
	text: string;
	viewerKey: string;
}) {
	const urls = useMemo(
		() =>
			collectMessagePreviewUrls(input.text)
				.filter((url) => url.length <= 4096)
				.slice(0, MAX_MESSAGE_LINK_PREVIEWS),
		[input.text]
	);
	const root = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [expanded, setExpanded] = useState(false);
	useEffect(() => {
		const element = root.current;
		if (!element || urls.length === 0) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: "100px" }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [urls.length]);
	const query = useQuery({
		queryKey: [
			"space-link-previews",
			input.viewerKey,
			input.spaceId,
			input.signalId,
			input.revision,
			urls,
		],
		queryFn: ({ signal }) =>
			input.api.getLinkPreviews({
				spaceId: input.spaceId,
				signalId: input.signalId,
				signal,
			}),
		enabled: visible && urls.length > 0,
		staleTime: 5 * 60_000,
		gcTime: 10 * 60_000,
		retry: false,
		refetchOnWindowFocus: false,
	});
	if (!urls.length) {
		return null;
	}
	const previews =
		query.data?.revision === input.revision ? query.data.previews : [];
	const displayed = expanded ? urls : urls.slice(0, 3);
	return (
		<div className="flex min-w-0 flex-col gap-3" ref={root}>
			{displayed.map((url) => (
				<LinkPreviewCard
					key={url}
					{...previews.find((preview) => preview.url === url)}
					url={url}
				/>
			))}
			{urls.length > 3 ? (
				<button
					aria-expanded={expanded}
					className="w-fit text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
					onClick={() => setExpanded(!expanded)}
					type="button"
				>
					{expanded
						? "Show fewer links"
						: `Show ${urls.length - 3} more ${urls.length === 4 ? "link" : "links"}`}
				</button>
			) : null}
		</div>
	);
}
