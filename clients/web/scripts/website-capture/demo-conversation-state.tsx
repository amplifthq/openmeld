import type { WakeProgressItem } from "@openmeld/schemas/types";
import {
	createWakeProgressItem,
	prepareSpaceComposerSubmission,
} from "@openmeld/space";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	buildSpaceActiveWakeSummary,
	type SpaceSidebarActiveWakeSummary,
} from "../../src/components/spaces/space-active-wake-presentation";
import type { ComposerDraftAuthoredMention } from "../../src/lib/composer-draft-storage";
import { demoTemplateReply } from "./demo-conversation-content";
import { buildDemoSpaceMembers, DEMO_CENTER_PROFILE_ID } from "./demo-members";

const WORD_BOUNDARY = /\s+/u;

export type DemoConversationTurn = {
	id: string;
	spaceId: string;
	text: string;
	createdAtMs: number;
	wakeTargetProfileIds: string[];
	referenceTargetProfileIds: string[];
	mentionTargetProfileIds: string[];
	replies: { profileId: string; name: string; text: string }[];
	phase: "sending" | "thinking" | "replying" | "complete";
	visibleWords: number;
};

type DemoConversationState = {
	turns: readonly DemoConversationTurn[];
	activeWakeSummaryBySpaceId: ReadonlyMap<
		string,
		SpaceSidebarActiveWakeSummary
	>;
	send: (input: {
		spaceId: string;
		text: string;
		authoredMentions: readonly ComposerDraftAuthoredMention[];
	}) => string;
};
const DemoConversationContext = createContext<DemoConversationState | null>(
	null
);

// One memory-only request owns the optimistic message, replies and all Working
// projections. No timer or account transport is created by a display component.
export function DemoConversationProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [turns, setTurns] = useState<DemoConversationTurn[]>([]);
	const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
	useEffect(
		() => () => {
			for (const timer of timers.current) {
				clearTimeout(timer);
			}
			timers.current.clear();
		},
		[]
	);
	const send = useCallback(
		(input: Parameters<DemoConversationState["send"]>[0]) => {
			const snapshot = buildDemoSpaceMembers(input.spaceId);
			const submission = prepareSpaceComposerSubmission({
				text: input.text,
				authoredMentionsInTextOrder: input.authoredMentions,
				snapshot,
				missingSnapshotMessage: "Choose a member from this Space.",
			});
			const id = crypto.randomUUID();
			const wakeTargetProfileIds =
				input.spaceId === "center-agent"
					? [DEMO_CENTER_PROFILE_ID]
					: (submission.messageEnvelope?.activationTargets ?? []);
			const replies = snapshot.agents
				.filter((agent) => wakeTargetProfileIds.includes(agent.profileId))
				.map((agent) => ({
					profileId: agent.profileId,
					name: agent.profileName,
					text: demoTemplateReply(agent.profileId, input.spaceId),
				}));
			setTurns((current) => [
				...current,
				{
					id,
					spaceId: input.spaceId,
					text: submission.text,
					createdAtMs: Date.now(),
					wakeTargetProfileIds,
					referenceTargetProfileIds:
						submission.messageEnvelope?.referenceTargets ?? [],
					mentionTargetProfileIds:
						submission.messageEnvelope?.mentionTargets ?? [],
					replies,
					phase: "sending",
					visibleWords: 0,
				},
			]);
			const update = (patch: Partial<DemoConversationTurn>) =>
				setTurns((current) =>
					current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn))
				);
			const schedule = (delay: number, action: () => void) => {
				const timer = setTimeout(() => {
					timers.current.delete(timer);
					action();
				}, delay);
				timers.current.add(timer);
			};
			schedule(650, () =>
				update({ phase: replies.length ? "thinking" : "complete" })
			);
			if (replies.length) {
				const wordCount = Math.max(
					...replies.map((reply) => reply.text.split(WORD_BOUNDARY).length)
				);
				let visibleWords = 0;
				const stream = () => {
					visibleWords += 3;
					const complete = visibleWords >= wordCount;
					update({ visibleWords, phase: complete ? "complete" : "replying" });
					if (!complete) {
						schedule(180, stream);
					}
				};
				schedule(3400, () => {
					if (reduceMotion) {
						update({ visibleWords: wordCount, phase: "complete" });
					} else {
						stream();
					}
				});
			}
			return id;
		},
		[reduceMotion]
	);
	const activeWakeSummaryBySpaceId = useMemo(() => {
		const bySpace = new Map<string, WakeProgressItem[]>();
		for (const turn of turns) {
			const progress = demoTurnWakeProgress(turn);
			if (progress.length) {
				bySpace.set(turn.spaceId, [
					...(bySpace.get(turn.spaceId) ?? []),
					...progress,
				]);
			}
		}
		return new Map(
			[...bySpace].map(([spaceId, items]) => [
				spaceId,
				buildSpaceActiveWakeSummary({ spaceId, items }),
			])
		);
	}, [turns]);
	return (
		<DemoConversationContext
			value={{ turns, send, activeWakeSummaryBySpaceId }}
		>
			{children}
		</DemoConversationContext>
	);
}

export function useDemoConversationState() {
	const state = useContext(DemoConversationContext);
	if (!state) {
		throw new Error(
			"Demo conversation state requires its presentation provider."
		);
	}
	return state;
}

export function useDemoSpaceListIndicators() {
	const { activeWakeSummaryBySpaceId } = useDemoConversationState();
	return {
		activeWakeSummaryBySpaceId,
		unreadBySpaceId: new Map<string, number>(),
		activityUnavailable: false,
		isPending: false,
	};
}

export function demoTurnWakeProgress(
	turn: DemoConversationTurn
): WakeProgressItem[] {
	if (turn.phase === "complete") {
		return [];
	}
	return turn.replies.map((reply) =>
		createWakeProgressItem({
			clientMessageId: turn.id,
			sourceSignalId: turn.id,
			dispatchId: `${turn.id}:${reply.profileId}`,
			targetProfileId: reply.profileId,
			targetLabel: reply.name,
			phase: "running",
			startedAtMs: turn.createdAtMs,
			updatedAtMs: turn.createdAtMs,
		})
	);
}
