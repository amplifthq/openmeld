import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type { WakeProgressItem } from "@openmeld/schemas/types";
import type { SpaceEphemeralActivityItem } from "./dispatch-activity";
import type { SpaceTimelineItem } from "./timeline";
import {
	resolveWakeProgressThinkingStep,
	type WakeFlowStep,
} from "./wake-details-view";
import {
	resolveWakeFailureDisplay,
	type WakeFailureDisplay,
	type WakeFailureTargetContext,
} from "./wake-failure-display";
import {
	matchesSpaceMessageWakeProgressItem,
	resolveSpaceMessageWakeTargetProfileIds,
	resolveVisibleWakeOutcomeTargetProfileIds,
	type SpaceWakeOutcomeIndex,
	type SpaceWakeStopTargetResolution,
} from "./wake-stop-target";

export type SpaceMessageWakeThinkingEntry = {
	elapsedStartedAtMs: number | null;
	lastEvidenceAtMs: number | null;
	key: string;
	kind: "preview" | "progress" | "status";
	phase: WakeProgressItem["phase"] | null;
	step: WakeFlowStep;
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
	const progressEntries = matchingItems.flatMap((item) =>
		resolveWakeProgressThinkingEntry({
			item,
			showElapsedTime: wakeTargetProfileIds.length === 1,
		})
	);
	const issueEntries = matchingItems.flatMap((item) =>
		resolveWakeIssueEntry({
			agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
			isPersonalContext: input.isPersonalContext === true,
			item,
			wakeFailureTargetContextsByProfileId:
				input.wakeFailureTargetContextsByProfileId,
		})
	);
	const finalOutcomeTargetProfileIds = resolveWakeFinalOutcomeTargetProfileIds({
		items: matchingItems,
		sourceItem: input.item,
		targetProfileIds,
		timelineItems: input.timelineItems ?? [],
		wakeOutcomeIndex: input.wakeOutcomeIndex,
	});

	return {
		hasProblem: matchingItems.some(isProblemWakeProgressItem),
		issueEntries,
		thinkingEntries: progressEntries.filter(
			(entry) => !finalOutcomeTargetProfileIds.has(entry.targetProfileId)
		),
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
				lastEvidenceAtMs: null,
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
): WakeFlowStep | null {
	switch (target.status) {
		case "active":
		case "retry_later":
			return {
				description: "OpenMeld has accepted the Wake.",
				label: "Starting Wake",
				status: "active",
			};
		case "stopping":
			return {
				description: "OpenMeld is requesting Stop for this Wake.",
				label: "Stopping Wake",
				status: "active",
			};
		default:
			return null;
	}
}

function resolveWakeProgressThinkingEntry(input: {
	item: WakeProgressItem;
	showElapsedTime: boolean;
}): SpaceMessageWakeThinkingEntry[] {
	const item = input.item;
	if (isProblemWakeProgressItem(item) || item.terminal) {
		return [];
	}

	const step = resolveWakeProgressThinkingStep(item);
	if (!step) {
		return [];
	}

	return [
		{
			elapsedStartedAtMs:
				input.showElapsedTime && item.phase === "running"
					? (item.startedAtMs ?? null)
					: null,
			lastEvidenceAtMs: item.updatedAtMs,
			key: resolveWakeProgressKey(item),
			kind: item.phase === "writing" ? "preview" : "progress",
			phase: item.phase,
			step,
			targetProfileId: item.targetProfileId,
			text: item.phase === "writing" ? item.message : step.label,
		},
	];
}

function resolveWakeFinalOutcomeTargetProfileIds(input: {
	items: readonly WakeProgressItem[];
	sourceItem: SpaceTimelineItem;
	targetProfileIds: ReadonlySet<string>;
	timelineItems: readonly SpaceTimelineItem[];
	wakeOutcomeIndex?: SpaceWakeOutcomeIndex;
}): ReadonlySet<string> {
	const targetProfileIds = new Set<string>();

	for (const item of input.items) {
		if (item.phase !== "replied") {
			continue;
		}
		targetProfileIds.add(item.targetProfileId);
	}

	for (const targetProfileId of resolveVisibleWakeOutcomeTargetProfileIds({
		sourceItem: input.sourceItem,
		targetProfileIds: input.targetProfileIds,
		timelineItems: input.timelineItems,
		wakeOutcomeIndex: input.wakeOutcomeIndex,
	})) {
		targetProfileIds.add(targetProfileId);
	}

	return targetProfileIds;
}

function isProblemWakeProgressItem(item: WakeProgressItem): boolean {
	return item.phase === "failed" || item.phase === "publication_unknown";
}

function resolveWakeIssueEntry(input: {
	agentRecoveryPlansByProfileId?: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	isPersonalContext: boolean;
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
	if (
		plan &&
		plan.kind !== "none" &&
		shouldPreferRecoveryPlanForWakeFailure(item)
	) {
		return [
			{
				action: { kind: "agent_recovery", plan },
				body: resolveWakeIssueRecoveryFallbackDetail(plan),
				key: resolveWakeProgressKey(item),
				message: resolveWakeIssueMessage(item),
				targetLabel: item.targetLabel,
				targetProfileId: item.targetProfileId,
			},
		];
	}

	const display = resolveWakeFailureDisplay({
		failureReasonCode: item.failureReasonCode,
		isPersonalContext: input.isPersonalContext,
		targetContext:
			input.wakeFailureTargetContextsByProfileId?.get(item.targetProfileId) ??
			null,
		targetLabel: item.targetLabel,
	});
	if (display) {
		return [
			{
				action: { display, kind: "wake_failure" },
				body: display.body,
				key: resolveWakeProgressKey(item),
				message: resolveWakeIssueMessage(item),
				targetLabel: item.targetLabel,
				targetProfileId: item.targetProfileId,
			},
		];
	}

	const fallbackPlan = item.failureReasonCode ? null : plan;
	if (fallbackPlan) {
		return [
			{
				action:
					fallbackPlan.kind === "none"
						? null
						: { kind: "agent_recovery", plan: fallbackPlan },
				body: resolveWakeIssueRecoveryFallbackDetail(fallbackPlan),
				key: resolveWakeProgressKey(item),
				message: resolveWakeIssueMessage(item),
				targetLabel: item.targetLabel,
				targetProfileId: item.targetProfileId,
			},
		];
	}

	return [
		{
			action: null,
			body: resolveWakeIssueMessage(item),
			key: resolveWakeProgressKey(item),
			message: resolveWakeIssueMessage(item),
			targetLabel: item.targetLabel,
			targetProfileId: item.targetProfileId,
		},
	];
}

function shouldPreferRecoveryPlanForWakeFailure(
	item: WakeProgressItem
): boolean {
	const reasonCode = item.failureReasonCode?.trim().toLowerCase();
	return (
		reasonCode === "profile.unbound" ||
		reasonCode === "agent_profile_binding.missing"
	);
}

function resolveWakeIssueRecoveryFallbackDetail(
	plan: AgentProfileReplyRecoveryPlan
): string {
	return plan.kind === "none"
		? "OpenMeld could not route this agent. Open People to see the agent setup status."
		: plan.body;
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
