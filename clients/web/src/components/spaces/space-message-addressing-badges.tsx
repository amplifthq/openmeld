import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";

const LEADING_MENTION_MARK = /^@/u;

export function SpaceMessageAddressingBadges(input: {
	item: SpaceTimelineItem;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	wakeProgressItems: readonly SpaceEphemeralActivityItem[];
}) {
	if (
		input.item.actorProfileKind !== "agent" ||
		input.item.signalType !== "signal.text"
	) {
		return null;
	}
	const groups = [
		{ label: "Wake", profileIds: input.item.wakeTargetProfileIds },
		{ label: "Mention", profileIds: input.item.mentionTargetProfileIds ?? [] },
		{
			label: "Reference",
			profileIds: input.item.referenceTargetProfileIds ?? [],
		},
	];
	const badges = groups.flatMap(({ label, profileIds }) =>
		profileIds.map((profileId) => ({
			key: `${label}:${profileId}`,
			text: `${label} ${
				input.profilePresentationsById.get(profileId)?.profileName ?? "member"
			}`,
		}))
	);
	if (badges.length === 0) {
		// Core anchors a native continuation to its exact published child result.
		const continuation = input.wakeProgressItems.find(
			(progress) =>
				progress.sourceSignalId === input.item.id &&
				progress.clientMessageId === null &&
				progress.targetProfileId !== input.item.actorProfileId &&
				!progress.terminal
		);
		if (continuation) {
			badges.push({
				key: `continuation:${continuation.dispatchId ?? continuation.targetProfileId}`,
				text: `Auto resumes ${continuation.targetLabel.replace(LEADING_MENTION_MARK, "")}`,
			});
		}
	}
	if (badges.length === 0) {
		return null;
	}
	return (
		<div
			className="mb-1.5 flex flex-wrap gap-1.5"
			data-testid="space-message-addressing"
		>
			{badges.map((badge) => (
				<span
					className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground text-xs"
					key={badge.key}
				>
					{badge.text}
				</span>
			))}
		</div>
	);
}
