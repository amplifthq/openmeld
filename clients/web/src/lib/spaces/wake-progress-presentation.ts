import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type { WakeProgressItem } from "@openmeld/schemas/types";
import { doWakeProgressItemsMatch } from "@openmeld/space";
import type { SpaceEphemeralActivityItem } from "./dispatch-activity";
import type { SpaceTimelineItem } from "./timeline";
import {
	resolveHistoricalWakeFailureBody,
	type WakeFailureDisplay,
	type WakeFailureTargetContext,
} from "./wake-failure-display";
import {
	resolveWakeProgressStatus,
	type WakeProgressStatusPresentation,
} from "./wake-progress-status";
import {
	buildSpaceWakeOutcomeIndex,
	buildSpaceWakeStopSelectorKey,
	matchesSpaceMessageWakeProgressItem,
	resolveRequestedStopUiStatus,
	resolveSpaceMessageWakeTargetProfileIds,
	type SpaceWakeOutcomeIndex,
	type SpaceWakeStopRequestStatus,
	type SpaceWakeStopTargetResolution,
} from "./wake-stop-target";

export type SpaceMessageWakeThinkingEntry = {
	elapsedStartedAtMs: number | null;
	key: string;
	kind: "preview" | "progress" | "status";
	phase: WakeProgressItem["phase"] | null;
	step: WakeProgressStatusPresentation;
	targetProfileId: string;
	text: string;
};

export type SpaceMessageWakeIssueAction =
	| {
			display: WakeFailureDisplay;
			kind: "wake_failure";
	  }
	| {
			kind: "agent_recovery";
			plan: Exclude<AgentProfileReplyRecoveryPlan, { kind: "none" }>;
	  };

export type SpaceMessageWakeIssueEntry = {
	action: SpaceMessageWakeIssueAction | null;
	body: string;
	key: string;
	message: string;
	targetLabel: string;
	targetProfileId: string;
};

export type SpaceMessageWakeProgressState = {
	hasProblem: boolean;
	issueEntries: readonly SpaceMessageWakeIssueEntry[];
	thinkingEntries: readonly SpaceMessageWakeThinkingEntry[];
};

export function buildWakeProblemSourceSignalIds(input: {
	items: readonly SpaceTimelineItem[];
	wakeProgressItems: readonly SpaceEphemeralActivityItem[];
}): ReadonlySet<string> {
	const sourceSignalIds = new Set<string>();

	for (const item of input.wakeProgressItems) {
		if (isProblemWakeProgressItem(item) && item.sourceSignalId) {
			sourceSignalIds.add(item.sourceSignalId);
		}
	}

	for (const item of input.items) {
		if (
			item.signalType === "signal.system_notice" &&
			item.systemNoticeType === "terminal_failure" &&
			item.replyToSignalId !== null
		) {
			sourceSignalIds.add(item.replyToSignalId);
		}
	}

	return sourceSignalIds;
}

export function resolveSpaceMessageWakeProgressState(input: {
	agentRecoveryPlansByProfileId?: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	isPersonalContext?: boolean;
	item: SpaceTimelineItem;
	items: readonly SpaceEphemeralActivityItem[];
	timelineItems?: readonly SpaceTimelineItem[];
	wakeOutcomeIndex?: SpaceWakeOutcomeIndex;
	wakeFailureTargetContextsByProfileId?: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
}): SpaceMessageWakeProgressState {
	const wakeTargetProfileIds = resolveSpaceMessageWakeTargetProfileIds({
		sourceItem: input.item,
		wakeProgressItems: input.items,
	});
	if (wakeTargetProfileIds.length === 0) {
		return EMPTY_MESSAGE_WAKE_PROGRESS_STATE;
	}

	const targetProfileIds = new Set(wakeTargetProfileIds);
	const matchingItems = input.items
		.filter((item) =>
			matchesSpaceMessageWakeProgressItem({
				item,
				sourceItem: input.item,
				targetProfileIds,
			})
		)
		.sort(compareWakeProgressItems);
	const wakeOutcomeIndex =
		input.wakeOutcomeIndex ??
		buildSpaceWakeOutcomeIndex(input.timelineItems ?? []);
	const progressEntries = matchingItems
		.filter(
			(item) =>
				!(
					matchingItems.some(
						(outcome) =>
							outcome.phase === "replied" &&
							doWakeProgressItemsMatch({ left: item, right: outcome })
					) ||
					wakeOutcomeIndex.hasVisibleOutcomeForSourceTarget({
						sourceItem: input.item,
						targetProfileId: item.targetProfileId,
						dispatchId: item.dispatchId,
					})
				)
		)
		.flatMap((item) =>
			resolveWakeProgressThinkingEntry({
				item,
				showElapsedTime: wakeTargetProfileIds.length === 1,
			})
		);
	const issueEntries = matchingItems.flatMap((item) =>
		resolveWakeIssueEntry({
			agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
			item,
			wakeFailureTargetContextsByProfileId:
				input.wakeFailureTargetContextsByProfileId,
		})
	);
	return {
		hasProblem: matchingItems.some(isProblemWakeProgressItem),
		issueEntries,
		thinkingEntries: progressEntries,
	};
}

export function resolveSpaceMessageWakeProgressFallbackEntries(input: {
	item: SpaceTimelineItem;
	wakeStopTargets: readonly SpaceWakeStopTargetResolution[];
}): readonly SpaceMessageWakeThinkingEntry[] {
	if (input.item.wakeTargetProfileIds.length === 0) {
		return [];
	}
	return input.wakeStopTargets.flatMap((target) => {
		if (!(target.selector && target.targetProfileId)) {
			return [];
		}
		const step = resolveWakeStopFallbackStep(target);
		if (!step) {
			return [];
		}
		return [
			{
				elapsedStartedAtMs: null,
				key: `wake-stop-fallback:${target.selectorKey ?? target.targetProfileId}`,
				kind: "progress" as const,
				phase: null,
				step,
				targetProfileId: target.targetProfileId,
				text: step.label,
			},
		];
	});
}

const EMPTY_MESSAGE_WAKE_PROGRESS_STATE: SpaceMessageWakeProgressState = {
	hasProblem: false,
	issueEntries: [],
	thinkingEntries: [],
};

function resolveWakeStopFallbackStep(
	target: SpaceWakeStopTargetResolution
): WakeProgressStatusPresentation | null {
	switch (target.status) {
		case "active":
			return {
				description: "The Agent is processing your request.",
				kind: "working",
				label: "Working…",
				status: "active",
			};
		case "stopping":
			return {
				description: "Waiting for the Agent to confirm it has stopped.",
				kind: "working",
				label: "Stopping…",
				status: "active",
			};
		case "retry_later":
			return {
				description: "Check your connection and try stopping again.",
				kind: "working",
				label: "Stop not confirmed",
				status: "pending",
			};
		case "stopped":
			return {
				description: "The request was stopped.",
				kind: "working",
				label: "Stopped",
				status: "complete",
			};
		default:
			return null;
	}
}

/** A Stop command changes feedback immediately without inventing a final runtime outcome. */
export function resolveSpaceMessageStopFeedback(
	item: Partial<
		Pick<
			SpaceTimelineItem,
			| "activeWakeProgress"
			| "agentStreamState"
			| "wakeClientMessageId"
			| "clientMessageId"
			| "wakeSourceSignalId"
			| "id"
			| "wakeTargetProfileIds"
		>
	>,
	statuses: ReadonlyMap<string, SpaceWakeStopRequestStatus>
): readonly SpaceMessageWakeThinkingEntry[] {
	if (
		item.activeWakeProgress?.terminal ||
		(item.agentStreamState && item.agentStreamState.status !== "streaming")
	) {
		return [];
	}
	const progress = item.activeWakeProgress;
	const clientMessageId =
		progress?.clientMessageId ??
		item.wakeClientMessageId ??
		item.clientMessageId;
	const sourceSignalId =
		progress?.sourceSignalId ?? item.wakeSourceSignalId ?? item.id;
	if (!(clientMessageId || sourceSignalId)) {
		return [];
	}
	const targets = progress
		? [progress.targetProfileId]
		: (item.wakeTargetProfileIds ?? []);
	return targets.flatMap((targetProfileId) => {
		const selector = clientMessageId
			? { by: "client_message" as const, clientMessageId, targetProfileId }
			: {
					by: "source_signal" as const,
					sourceSignalId: sourceSignalId as string,
					targetProfileId,
				};
		const key = buildSpaceWakeStopSelectorKey(selector);
		const request = statuses.get(key);
		const status = resolveRequestedStopUiStatus(request);
		if (
			!(
				status === "stopping" ||
				status === "stopped" ||
				status === "retry_later"
			)
		) {
			return [];
		}
		const step = resolveWakeStopFallbackStep({
			canStop: false,
			clientMessageId: clientMessageId ?? null,
			selector,
			selectorKey: key,
			sourceSignalId: sourceSignalId ?? null,
			status,
			targetLabel: progress?.targetLabel ?? null,
			targetProfileId,
		});
		return step
			? [
					{
						elapsedStartedAtMs: null,
						key,
						kind: "status" as const,
						phase: null,
						step,
						targetProfileId,
						text: step.label,
					},
				]
			: [];
	});
}

export function resolveWakeProgressThinkingEntry(input: {
	item: WakeProgressItem;
	showElapsedTime: boolean;
	showTargetName?: boolean;
	requestStartedAtMs?: number;
}): SpaceMessageWakeThinkingEntry[] {
	const item = input.item;
	if (isProblemWakeProgressItem(item) || item.terminal) {
		return [];
	}

	const step = resolveWakeProgressStatus(item, {
		showTargetName: input.showTargetName,
	});
	if (!step) {
		return [];
	}
	const awaitingConfirmation = step.kind === "confirmation_pending";

	return [
		{
			elapsedStartedAtMs:
				input.showElapsedTime &&
				step.status === "active" &&
				!awaitingConfirmation &&
				!item.pendingInteraction
					? (input.requestStartedAtMs ?? item.startedAtMs ?? null)
					: null,
			key: resolveWakeProgressKey(item),
			kind: item.previewText && !awaitingConfirmation ? "preview" : "progress",
			phase: item.phase,
			step,
			targetProfileId: item.targetProfileId,
			text: awaitingConfirmation
				? step.label
				: (item.previewText ?? step.label),
		},
	];
}

function isProblemWakeProgressItem(item: WakeProgressItem): boolean {
	return item.phase === "failed" || item.phase === "publication_unknown";
}

function resolveWakeIssueEntry(input: {
	agentRecoveryPlansByProfileId?: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	item: WakeProgressItem;
	wakeFailureTargetContextsByProfileId?: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
}): SpaceMessageWakeIssueEntry[] {
	const item = input.item;
	if (!isProblemWakeProgressItem(item)) {
		return [];
	}
	if (item.phase === "publication_unknown") {
		return [
			{
				action: null,
				body: item.message,
				key: resolveWakeProgressKey(item),
				message: item.message,
				targetLabel: item.targetLabel,
				targetProfileId: item.targetProfileId,
			},
		];
	}

	const plan =
		input.agentRecoveryPlansByProfileId?.get(item.targetProfileId) ?? null;
	const currentAction =
		plan && plan.kind !== "none"
			? ({ kind: "agent_recovery", plan } as const)
			: null;
	return [
		{
			action: currentAction,
			body: resolveHistoricalWakeFailureBody({
				failureReasonCode: item.failureReasonCode,
				targetLabel: item.targetLabel,
			}),
			key: resolveWakeProgressKey(item),
			message: resolveWakeIssueMessage(item),
			targetLabel: item.targetLabel,
			targetProfileId: item.targetProfileId,
		},
	];
}

function resolveWakeIssueMessage(item: WakeProgressItem): string {
	const message = item.message.trim();
	return message.length > 0
		? message
		: `${item.targetLabel} could not complete this Wake.`;
}

function compareWakeProgressItems(
	left: WakeProgressItem,
	right: WakeProgressItem
): number {
	return left.updatedAtMs - right.updatedAtMs;
}

function resolveWakeProgressKey(item: WakeProgressItem): string {
	return (
		item.dispatchId ??
		(item.clientMessageId
			? `${item.clientMessageId}:${item.targetProfileId}`
			: `${item.targetProfileId}:${item.updatedAtMs}`)
	);
}
