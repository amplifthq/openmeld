import { createContext, type ReactNode, useContext, useState } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { useSpaceMessageEditing } from "./space-message-editing";
import { SpaceWakeSuggestionToken } from "./space-wake-suggestion-token";

export function findRecentWakeExchange(
	items: readonly SpaceTimelineItem[],
	selfProfileId: string
) {
	const source = [...items]
		.reverse()
		.find(
			(item) =>
				item.actorProfileId === selfProfileId &&
				item.actorProfileKind === "human" &&
				item.wakeTargetProfileIds.length > 0 &&
				item.deliveryState === "sent" &&
				!item.recalledAt
		);
	if (!source || source.wakeTargetProfileIds.length !== 1) {
		return null;
	}
	const profileId = source.wakeTargetProfileIds[0];
	const reply = [...items]
		.reverse()
		.find(
			(item) =>
				item.actorProfileId === profileId &&
				item.actorProfileKind === "agent" &&
				item.deliveryState === "sent" &&
				!item.recalledAt &&
				!item.agentStreamState &&
				(item.wakeSourceSignalId === source.id ||
					item.replyToSignalId === source.id)
		);
	return reply ? { profileId, exchangeId: reply.id } : null;
}

type RecommendationContext = {
	candidate: ReturnType<typeof findRecentWakeExchange>;
	dismiss: () => void;
	recordSend: (profileId: string | null) => void;
	nudge: { messageId: string; profileId: string } | null;
	dismissNudge: () => void;
};
const Context = createContext<RecommendationContext | null>(null);
export const useSpaceWakeRecommendation = () => useContext(Context);

export function SpaceWakeRecommendationScope(input: {
	items: readonly SpaceTimelineItem[];
	selfProfileId: string;
	children: ReactNode;
}) {
	const exchange = findRecentWakeExchange(input.items, input.selfProfileId);
	const [dismissedExchange, setDismissedExchange] = useState<string | null>(
		null
	);
	const [sent, setSent] = useState<{
		profileId: string;
		previousIds: ReadonlySet<string>;
	} | null>(null);
	const candidate =
		exchange?.exchangeId === dismissedExchange ? null : exchange;
	const latestOwn = [...input.items]
		.reverse()
		.find(
			(item) =>
				item.actorProfileId === input.selfProfileId &&
				item.actorProfileKind === "human"
		);
	const nudge =
		sent &&
		latestOwn &&
		!sent.previousIds.has(latestOwn.id) &&
		latestOwn.deliveryState === "sent" &&
		!latestOwn.recalledAt &&
		latestOwn.wakeTargetProfileIds.length === 0
			? { messageId: latestOwn.id, profileId: sent.profileId }
			: null;
	return (
		<Context.Provider
			value={{
				candidate,
				dismiss: () => {
					setDismissedExchange(exchange?.exchangeId ?? null);
					setSent(null);
				},
				recordSend: (profileId) =>
					setSent(
						profileId
							? {
									profileId,
									previousIds: new Set(input.items.map((item) => item.id)),
								}
							: null
					),
				nudge,
				dismissNudge: () => setSent(null),
			}}
		>
			{input.children}
		</Context.Provider>
	);
}

export function SpaceMessageWakeRecommendation({
	item,
	align,
}: {
	item: SpaceTimelineItem;
	align?: "start" | "end";
}) {
	const recommendation = useSpaceWakeRecommendation();
	const editing = useSpaceMessageEditing();
	const nudge = recommendation?.nudge;
	if (
		!nudge ||
		nudge.messageId !== item.id ||
		item.actorProfileId !== editing?.selfProfileId
	) {
		return null;
	}
	const target = editing.mentionPickerItems.find(
		(entry) => entry.suggestion.profileId === nudge.profileId
	);
	if (!target?.suggestion.allowedRelations.wake) {
		return null;
	}
	return (
		<div
			className={`flex w-full min-w-0 items-center text-sm ${align === "end" ? "justify-end" : "justify-start"}`}
			data-slot="message-wake-recommendation"
		>
			<SpaceWakeSuggestionToken
				onAccept={() => editing.beginEdit(item, nudge.profileId)}
				onDismiss={recommendation.dismissNudge}
				target={target}
			/>
		</div>
	);
}
