import { sanitizeSignalTextPreview } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { spaceHistoryQueryOptions } from "#/query/spaces/history";

/** Visible previews share the conversation cache; only the active card owns a live conversation. */
export function HomeSpacePreview({
	space,
	onReply,
}: {
	space: AccountSpaceItem;
	onReply: () => void;
}) {
	const history = useQuery(
		spaceHistoryQueryOptions({
			spaceId: space.spaceId,
			openMeldProfileId: space.openProfileId,
			enabled: true,
		})
	);
	const lastPreview = useRef(space.messagePreview?.signalId);
	useEffect(() => {
		const next = space.messagePreview?.signalId;
		if (lastPreview.current !== next) {
			lastPreview.current = next;
			history.refetch();
		}
	}, [space.messagePreview?.signalId, history.refetch]);
	const messages =
		history.data?.envelopes
			.filter((item) => item.type === "signal.text")
			.slice(-5) ?? [];
	return (
		<>
			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-4 p-4">
					{history.isError && (
						<p className="text-sm" role="alert">
							Couldn’t refresh this conversation.
							<Button
								onClick={() => history.refetch()}
								size="sm"
								variant="ghost"
							>
								Try again
							</Button>
						</p>
					)}
					{history.isPending && (
						<p className="text-muted-foreground text-sm">Loading messages…</p>
					)}
					{!history.isError &&
						messages.map((message) => (
							<div className="space-y-1" key={message.id}>
								<p className="text-muted-foreground text-xs">
									{message.profile.profileName ??
										message.profile.profileHandle ??
										"Member"}
								</p>
								<p className="line-clamp-5 whitespace-pre-wrap break-words text-sm">
									{sanitizeSignalTextPreview(message.data.text) ?? "Message"}
								</p>
							</div>
						))}
					{history.isSuccess && !messages.length && (
						<p className="text-muted-foreground text-sm">
							Start the conversation with your team.
						</p>
					)}
				</div>
			</ScrollArea>
			<div className="border-t p-3">
				<Button
					className="w-full justify-start text-muted-foreground"
					onClick={onReply}
					variant="outline"
				>
					Write a message…
				</Button>
			</div>
		</>
	);
}
