import { cn } from "@openmeld/ui/lib/utils";
import { StopCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { APP_MOBILE_TOUCH_TARGET_CLASS_NAME } from "#/components/app/app-touch-target";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	resolveWakeFailureDisplay,
	type WakeFailureDisplay,
	type WakeFailureTargetContext,
} from "#/lib/spaces/wake-failure-display";
import { Marker, MarkerContent, MarkerIcon } from "./primitives/marker";
import {
	EMPTY_SPACE_MESSAGE_REFERENCES,
	type SpaceMessageReferencesById,
	SpaceMessageReferenceText,
} from "./space-message-reference";
import {
	resolveSpaceOutcomeRowTone,
	type SpaceOutcomeRowTone,
} from "./space-outcome-tone";
import {
	SpaceExecutionRecoveryButton,
	type SpaceExecutionRecoveryHandler,
	type SpaceExecutionRecoveryRequest,
	SpaceWakeRetryButton,
	type SpaceWakeRetryHandler,
	type SpaceWakeRetryRequest,
} from "./space-wake-retry";

// A request-level Wake outcome (terminal_failure or wake_stopped) is a compact,
// always-visible one-line summary. A single terminal execution failure may add
// one inline Retry action when OpenMeld can safely create a fresh Wake from the
// original source text and exact target. Full reason and diagnostics remain in
// Message details; grouped, stopped, publication, and incomplete outcomes never
// guess at a retry target.
/**
 * Resolves the outcome row's optional recovery action from the notice's
 * `reasonCode`, reusing the same shared public-failure-recovery mapping the
 * rest of the Wake failure UI (`wake-failure-display.ts`) already consumes.
 * MVP keeps this to whatever that shared mapping already produces -- a
 * labeled recovery link when one is known, nothing new invented here.
 *
 * Only `terminal_failure` ever gets a recovery action. `wake_stopped` is not
 * a failure, so it never shows one. A missing `reasonCode` returns `null`
 * instead of a classified guess -- the row always falls back to rendering
 * `text` verbatim, never a derived summary.
 */
export function resolveSpaceOutcomeRowRecoveryDisplay(input: {
	isPersonalContext?: boolean;
	noticeType: string | null;
	reasonCode: string | null | undefined;
	targetContext?: WakeFailureTargetContext | null;
	targetLabel: string;
}): WakeFailureDisplay | null {
	if (input.noticeType !== "terminal_failure" || !input.reasonCode) {
		return null;
	}

	return resolveWakeFailureDisplay({
		failureReasonCode: input.reasonCode,
		isPersonalContext: input.isPersonalContext,
		targetContext: input.targetContext,
		targetLabel: input.targetLabel,
	});
}

function renderSpaceOutcomeAction(input: {
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	recoveryRequest?: SpaceExecutionRecoveryRequest | null;
	retryRequest?: SpaceWakeRetryRequest | null;
}) {
	if (input.recoveryRequest && input.onRecoverExecution) {
		return (
			<SpaceExecutionRecoveryButton
				className="h-7 shrink-0 px-2.5"
				onRecoverExecution={input.onRecoverExecution}
				presentation="compact"
				request={input.recoveryRequest}
			/>
		);
	}
	if (input.retryRequest && input.onRetryWakeTarget) {
		return (
			<SpaceWakeRetryButton
				className="h-7 shrink-0 px-2.5"
				onRetryWakeTarget={input.onRetryWakeTarget}
				request={input.retryRequest}
			/>
		);
	}
	return null;
}

export function SpaceOutcomeRow(input: {
	align?: "end" | "start";
	className?: string;
	onOpenDetails: (() => void) | null;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	recoveryRequest?: SpaceExecutionRecoveryRequest | null;
	retryRequest?: SpaceWakeRetryRequest | null;
	spaceReferencesById?: SpaceMessageReferencesById;
	text: string;
	tone: SpaceOutcomeRowTone;
}) {
	const isEndAligned = input.align === "end";
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;
	const isClickable = Boolean(input.onOpenDetails);

	return (
		<div
			className={cn(
				"flex w-full min-w-0",
				isEndAligned ? "justify-end" : "justify-start",
				input.className
			)}
			data-align={input.align ?? "start"}
			data-slot="space-outcome-row"
			data-testid="space-outcome-row"
		>
			<div className="flex min-w-0 max-w-full items-center gap-2">
				<Marker
					aria-label={isClickable ? "Open message details" : undefined}
					className={cn(
						"w-fit min-w-0 max-w-full items-center gap-2",
						resolveSpaceOutcomeRowToneClassName(input.tone),
						isClickable &&
							cn(
								APP_MOBILE_TOUCH_TARGET_CLASS_NAME,
								"cursor-pointer appearance-none border-0 bg-transparent p-0 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-2"
							)
					)}
					onClick={input.onOpenDetails ?? undefined}
					render={isClickable ? <button type="button" /> : undefined}
				>
					<MarkerIcon>{resolveSpaceOutcomeRowIcon(input.tone)}</MarkerIcon>
					<MarkerContent
						className={cn(
							"min-w-0 text-[13px] leading-5",
							isEndAligned ? "text-right" : "text-left"
						)}
					>
						<span className="block max-w-full max-sm:break-words sm:truncate">
							<SpaceMessageReferenceText
								referencesById={spaceReferencesById}
								text={input.text}
							/>
						</span>
					</MarkerContent>
				</Marker>
				{renderSpaceOutcomeAction(input)}
			</div>
		</div>
	);
}

function resolveSpaceOutcomeRowIcon(tone: SpaceOutcomeRowTone) {
	if (tone === "muted") {
		return <StopCircleIcon aria-hidden="true" />;
	}
	return <WarningCircleIcon aria-hidden="true" />;
}

function resolveSpaceOutcomeRowToneClassName(
	tone: SpaceOutcomeRowTone
): string {
	switch (tone) {
		case "destructive":
			return "text-destructive";
		case "warning":
			return "text-amber-600 dark:text-amber-400";
		case "muted":
			return "text-muted-foreground";
		default: {
			const _exhaustive: never = tone;
			return _exhaustive;
		}
	}
}

export type AnchoredOutcomeRowGroup = {
	key: string;
	notices: readonly SpaceTimelineItem[];
	tone: SpaceOutcomeRowTone;
};

// A single Wake can dispatch to several targets at once, and each target
// that fails or stops lands as its own terminal_failure/wake_stopped notice
// -- so a 3-target Wake where all 3 fail produces 3 notices anchored to the
// same source message. Rendering one row per notice piles up duplicate-looking
// "OpenMeld could not wake X" rows under a single message, which reads as
// noise rather than "one Wake, one outcome". Grouping by tone (rather than
// blindly merging everything) keeps a publication-stage warning from folding
// into a destructive execution failure, and keeps a stop (never a failure)
// out of a failure row. Shared by the main conversation panel and the thread
// panel -- both anchor notices under their source message the same way, and
// keeping one implementation is what stops a fix like this landing in only
// one of the two.
export function groupAnchoredOutcomeNotices(
	notices: readonly SpaceTimelineItem[]
): readonly AnchoredOutcomeRowGroup[] {
	const groups: AnchoredOutcomeRowGroup[] = [];
	const groupedStopIndexByTone = new Map<SpaceOutcomeRowTone, number>();

	for (const notice of notices) {
		const tone = resolveSpaceOutcomeRowTone({
			failureStage: notice.systemNoticeFailureStage,
			noticeType: notice.systemNoticeType,
			reasonCode: notice.systemNoticeReasonCode,
		});
		if (notice.systemNoticeType === "terminal_failure") {
			groups.push({
				key: `${notice.systemNoticeDispatchId ?? notice.id}:${notice.systemNoticeTargetProfileId ?? "unknown"}`,
				notices: [notice],
				tone,
			});
			continue;
		}
		const existingGroupIndex = groupedStopIndexByTone.get(tone);
		if (existingGroupIndex === undefined) {
			groupedStopIndexByTone.set(tone, groups.length);
			groups.push({ key: notice.id ?? tone, notices: [notice], tone });
			continue;
		}
		const existingGroup = groups[existingGroupIndex];
		if (existingGroup) {
			groups[existingGroupIndex] = {
				...existingGroup,
				notices: [...existingGroup.notices, notice],
			};
		}
	}

	return groups;
}

// A single notice keeps the backend's own per-target sentence verbatim (it
// already names the one target and the one fix). Multiple notices need a
// client-composed summary instead of concatenating N backend sentences --
// each may cite a different reason and a different fix, and mashing those
// together would assert one fix that doesn't apply to every target. The
// per-target reasons stay available (each still gets its own line in Message
// details); this row is only ever the "something needs your attention, open
// details" pointer. `resolveTargetLabel` is a callback rather than a fixed
// map type because the two callers resolve a target's display name from
// different data (a member directory vs. a Wake Stop target-label map).
export function resolveGroupedOutcomeRowText(input: {
	notices: readonly SpaceTimelineItem[];
	resolveTargetLabel: (targetProfileId: string) => string | null;
	tone: SpaceOutcomeRowTone;
}): string {
	if (input.notices.length === 1) {
		return input.notices[0]?.text ?? "";
	}

	const targetLabels: string[] = [];
	for (const notice of input.notices) {
		const targetProfileId = notice.systemNoticeTargetProfileId;
		const targetLabel = targetProfileId
			? input.resolveTargetLabel(targetProfileId)
			: null;
		if (!targetLabel) {
			return resolveGroupedOutcomeRowFallbackText({
				targetCount: input.notices.length,
				tone: input.tone,
			});
		}
		targetLabels.push(targetLabel);
	}

	const joinedTargetLabels = joinLabelsWithAnd(targetLabels);
	return input.tone === "muted"
		? `Wake was stopped for ${joinedTargetLabels}.`
		: `OpenMeld could not wake ${joinedTargetLabels}. Open message details for what happened with each.`;
}

function resolveGroupedOutcomeRowFallbackText(input: {
	targetCount: number;
	tone: SpaceOutcomeRowTone;
}): string {
	return input.tone === "muted"
		? `Wake was stopped for ${input.targetCount} agents.`
		: `OpenMeld could not wake ${input.targetCount} agents for this message.`;
}

function joinLabelsWithAnd(labels: readonly string[]): string {
	if (labels.length <= 1) {
		return labels[0] ?? "";
	}
	if (labels.length === 2) {
		return `${labels[0]} and ${labels[1]}`;
	}
	return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
