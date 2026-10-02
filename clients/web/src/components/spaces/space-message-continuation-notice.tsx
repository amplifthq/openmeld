import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

const LEADING_MENTION_MARK = /^@/u;

export function SpaceMessageContinuationNotice(input: {
	item: SpaceTimelineItem;
	wakeProgressItems: readonly SpaceEphemeralActivityItem[];
}) {
	if (
		input.item.actorProfileKind !== "agent" ||
		input.item.signalType !== "signal.text" ||
		input.item.wakeTargetProfileIds.length > 0 ||
		(input.item.mentionTargetProfileIds?.length ?? 0) > 0 ||
		(input.item.referenceTargetProfileIds?.length ?? 0) > 0
	) {
		return null;
	}
	// Core anchors a native continuation to its exact published child result.
	const continuation = input.wakeProgressItems.find(
		(progress) =>
			progress.sourceSignalId === input.item.id &&
			progress.clientMessageId === null &&
			progress.targetProfileId !== input.item.actorProfileId &&
			!progress.terminal
	);
	if (!continuation) {
		return null;
	}
	return (
		<div
			className="mb-1.5 flex flex-wrap gap-1.5"
			data-testid="space-message-continuation"
		>
			<span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
				{`Auto resumes ${continuation.targetLabel.replace(LEADING_MENTION_MARK, "")}`}
			</span>
		</div>
	);
}
