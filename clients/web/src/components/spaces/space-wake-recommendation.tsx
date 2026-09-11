import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useState,
} from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	readWakeRecommendationRecord,
	type WakeRecommendationRecord,
	wakeRecommendationSessionKey,
	writeWakeRecommendationRecord,
} from "#/lib/spaces/wake-recommendation-session";
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
	return reply ? { profileId, exchangeId: source.id } : null;
}

type RecommendationContext = {
	candidate: ReturnType<typeof findRecentWakeExchange>;
	dismiss: () => void;
	recordSend: (profileId: string | null, clientMessageId: string) => void;
	nudge: { messageId: string; profileId: string } | null;
	dismissNudge: () => void;
};
const Context = createContext<RecommendationContext | null>(null);
export const useSpaceWakeRecommendation = () => useContext(Context);

export function SpaceWakeRecommendationScope(input: {
	items: readonly SpaceTimelineItem[];
	selfProfileId: string;
	orgSlug?: string;
	spaceId?: string;
	children: ReactNode;
}) {
	const exchange = findRecentWakeExchange(input.items, input.selfProfileId);
	const storageKey = wakeRecommendationSessionKey(input);
	const restored = useMemo(
		() => readWakeRecommendationRecord(storageKey),
		[storageKey]
	);
	const [session, setSession] = useState({ key: storageKey, record: restored });
	const record = session.key === storageKey ? session.record : restored;
	const remember = (next: WakeRecommendationRecord) => {
		writeWakeRecommendationRecord(storageKey, next);
		setSession({ key: storageKey, record: next });
	};
	const candidate =
		exchange?.exchangeId === record?.exchangeId ? null : exchange;
	const latestOwn = [...input.items]
		.reverse()
		.find(
			(item) =>
				item.actorProfileId === input.selfProfileId &&
				item.actorProfileKind === "human"
		);
	const nudge =
		record?.status === "message" &&
		latestOwn &&
		latestOwn.clientMessageId === record.clientMessageId &&
		latestOwn.deliveryState === "sent" &&
		!latestOwn.recalledAt &&
		latestOwn.wakeTargetProfileIds.length === 0
			? { messageId: latestOwn.id, profileId: record.profileId }
			: null;
	const dismiss = () => {
		const exchangeId = exchange?.exchangeId ?? record?.exchangeId;
		if (exchangeId) {
			remember({ exchangeId, status: "dismissed" });
		}
	};
	return (
		<Context.Provider
			value={{
				candidate,
				dismiss,
				recordSend: (profileId, clientMessageId) => {
					if (profileId && exchange) {
						remember({
							exchangeId: exchange.exchangeId,
							status: "message",
							profileId,
							clientMessageId,
						});
					} else {
						dismiss();
					}
				},
				nudge,
				dismissNudge: dismiss,
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
			className={`flex w-full min-w-0 flex-col text-sm ${align === "end" ? "items-end" : "items-start"}`}
			data-slot="message-wake-recommendation"
		>
			<SpaceWakeSuggestionToken
				disabled={editing.busy}
				onAccept={async () => {
					await editing.wake(item, target);
				}}
				onDismiss={recommendation.dismissNudge}
				target={target}
			/>
			{editing.error ? (
				<p className="text-destructive text-xs" role="alert">
					{editing.error}
				</p>
			) : null}
		</div>
	);
}
