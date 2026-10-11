import { Button } from "@openmeld/ui/components/button";
import { XIcon } from "@phosphor-icons/react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { resolveReplyPreviewText } from "./space-message-run";
export function SpaceComposerReplyBanner(input: {
	onClear: () => void;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	signalId: string | null;
	timelineItems: readonly SpaceTimelineItem[];
}) {
	if (!input.signalId) {
		return null;
	}
	const item = input.timelineItems.find(
		(candidate) => candidate.id === input.signalId
	);
	const preview = resolveReplyPreviewText(
		item?.text ?? "",
		item,
		input.profilePresentationsById
	)
		.replace(/\s+/g, " ")
		.trim();
	const excerpt = preview.length > 100 ? `${preview.slice(0, 100)}…` : preview;
	return (
		<div
			className="mx-1 mb-2 flex min-w-0 items-center gap-2 border-border border-b pb-2 text-muted-foreground text-xs"
			data-slot="composer-reply-banner"
		>
			<Button
				aria-label="Cancel reply"
				className="size-6 shrink-0 [&_svg]:size-3.5"
				onClick={input.onClear}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<XIcon aria-hidden="true" />
			</Button>
			<p className="min-w-0 truncate border-border border-l pl-2">
				Replying {item?.actorName ?? "earlier message"}
				{excerpt ? `: ${excerpt}` : ""}
			</p>
		</div>
	);
}
