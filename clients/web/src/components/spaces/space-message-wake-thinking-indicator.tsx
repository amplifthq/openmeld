import { ThinkingIndicator } from "@openmeld/ui/components/thinking-indicator";
import { fontWeights } from "@openmeld/ui/lib/font-weight";
import { cn } from "@openmeld/ui/lib/utils";
import { type ReactNode, useState } from "react";
import { SPACE_AGENT_WORKING_STATUS_TEXT } from "#/lib/spaces/message-state";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import type { SpaceMessageWakeThinkingEntry } from "#/lib/spaces/wake-progress-presentation";
import {
	WAKE_PROGRESS_STATUS_PRIORITY,
	type WakeProgressStatusKind,
} from "#/lib/spaces/wake-progress-status";
import { SpaceAgentOrb } from "./space-agent-orb";
import {
	type SpaceAgentOrbState,
	WAKE_STATUS_ORB_STATE,
} from "./space-agent-orb-state";
import { SpaceMessageProgressRow } from "./space-message-progress-row";
import { formatElapsedDuration } from "./space-request-elapsed-time";

export function SpaceMessageWakeThinkingIndicator(input: {
	align?: "start" | "end";
	className?: string;
	control?: ReactNode;
	entries: readonly SpaceMessageWakeThinkingEntry[];
	onOpenMessageDetails?: () => void;
	showAgentWorkingState?: boolean;
}) {
	const isEndAligned = input.align === "end";
	const previewEntries = input.entries.filter(
		(entry) => entry.kind === "preview"
	);
	const latestPreviewEntry = previewEntries.at(-1) ?? null;
	const progressEntries = input.entries.filter(
		(entry) => entry.kind === "progress"
	);
	const statusEntries = input.entries.filter(
		(entry) => entry.kind === "status"
	);
	const rawElapsedEntry = resolveSingleElapsedEntry(progressEntries);

	if (input.entries.length === 0 && !input.control) {
		return null;
	}

	const indicatorContent = (
		<WakeThinkingIndicatorContent
			className={input.className}
			isEndAligned={isEndAligned}
			key={
				rawElapsedEntry ? resolveElapsedEntryIdentity(rawElapsedEntry) : "none"
			}
			latestPreviewEntry={latestPreviewEntry}
			onOpenMessageDetails={input.onOpenMessageDetails}
			progressEntries={progressEntries}
			rawElapsedEntry={rawElapsedEntry}
			showAgentWorkingState={input.showAgentWorkingState === true}
		/>
	);
	const statusContent = statusEntries.map((entry) => (
		<output
			aria-label={entry.text}
			className="text-[13px] text-muted-foreground"
			data-testid="space-wake-status"
			key={entry.key}
			style={{ fontVariationSettings: fontWeights.medium }}
		>
			{entry.text}
		</output>
	));

	return (
		<SpaceMessageProgressRow
			align={input.align}
			control={input.control}
			slot="space-wake-thinking-row"
			testId="space-wake-thinking-row"
		>
			<div
				className={cn(
					"flex w-full min-w-0 flex-col gap-1",
					isEndAligned ? "items-end" : "items-start"
				)}
			>
				{indicatorContent}
				{statusContent}
			</div>
		</SpaceMessageProgressRow>
	);
}

function WakeThinkingIndicatorContent(input: {
	className?: string;
	isEndAligned: boolean;
	latestPreviewEntry: SpaceMessageWakeThinkingEntry | null;
	onOpenMessageDetails?: () => void;
	progressEntries: readonly SpaceMessageWakeThinkingEntry[];
	rawElapsedEntry: SpaceMessageWakeThinkingEntry | null;
	showAgentWorkingState: boolean;
}) {
	const [elapsedStartedAtMs] = useState(
		() => input.rawElapsedEntry?.elapsedStartedAtMs ?? null
	);
	const elapsedEntry = resolveStableElapsedEntry({
		elapsedStartedAtMs,
		entry: input.rawElapsedEntry,
	});
	const nowMs = useNowMs(elapsedEntry ? 1000 : null);
	const words = input.progressEntries.map((entry) =>
		formatThinkingEntryText({
			entry,
			nowMs,
			showAgentWorkingState: input.showAgentWorkingState,
			showElapsedTime: entry === elapsedEntry,
		})
	);

	const indicator = buildWakeThinkingIndicator({
		className: input.className,
		elapsedEntry,
		latestPreviewEntry: input.latestPreviewEntry,
		nowMs,
		onOpenMessageDetails: input.onOpenMessageDetails !== undefined,
		progressEntries: input.progressEntries,
		showAgentWorkingState: input.showAgentWorkingState,
		words,
	});

	return input.onOpenMessageDetails && indicator ? (
		<button
			aria-label="Open message details"
			className={cn(
				"w-fit min-w-0 max-w-full cursor-pointer appearance-none overflow-hidden border-0 bg-transparent p-0 text-muted-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-4",
				input.isEndAligned ? "text-right" : "text-left"
			)}
			data-testid="space-wake-thinking-indicator"
			onClick={input.onOpenMessageDetails}
			type="button"
		>
			{indicator}
		</button>
	) : (
		indicator
	);
}

function buildWakeThinkingIndicator(input: {
	className?: string;
	elapsedEntry: SpaceMessageWakeThinkingEntry | null;
	latestPreviewEntry: SpaceMessageWakeThinkingEntry | null;
	nowMs: number;
	onOpenMessageDetails: boolean;
	progressEntries: readonly SpaceMessageWakeThinkingEntry[];
	showAgentWorkingState: boolean;
	words: readonly string[];
}): ReactNode {
	const dataTestId = input.onOpenMessageDetails
		? undefined
		: "space-wake-thinking-indicator";
	if (input.latestPreviewEntry) {
		return (
			<InlineWakePreviewIndicator
				className={input.className}
				data-testid={dataTestId}
				text={input.latestPreviewEntry.text}
			/>
		);
	}
	if (input.elapsedEntry) {
		return (
			<StaticElapsedThinkingIndicator
				className={input.className}
				data-testid={dataTestId}
				entry={input.elapsedEntry}
				nowMs={input.nowMs}
				showAgentWorkingState={input.showAgentWorkingState}
			/>
		);
	}
	if (input.progressEntries.length === 0) {
		return null;
	}
	if (input.progressEntries.length > 1) {
		return (
			<StableWakeProgressSummary
				className={input.className}
				data-testid={dataTestId}
				entries={input.progressEntries}
			/>
		);
	}
	const orbState = resolveWakeProgressOrbState(input.progressEntries);
	return (
		<ThinkingIndicator
			aria-label={input.words[0]}
			className={cn(
				"max-w-full px-0 py-0 text-muted-foreground",
				input.className
			)}
			data-testid={dataTestId}
			icon={orbState ? <SpaceAgentOrb state={orbState} /> : undefined}
			words={input.words}
		/>
	);
}

function StableWakeProgressSummary(input: {
	className?: string;
	"data-testid"?: string;
	entries: readonly SpaceMessageWakeThinkingEntry[];
}) {
	return (
		<output
			className={cn(
				"flex max-w-full items-center gap-2 px-0 py-0 text-muted-foreground",
				input.className
			)}
			data-testid={input["data-testid"]}
		>
			<span
				aria-hidden="true"
				className="flex size-5 shrink-0 items-center justify-center"
			>
				<SpaceAgentOrb
					state={resolveWakeProgressOrbState(input.entries) ?? undefined}
				/>
			</span>
			<span
				className="min-w-0 whitespace-normal break-words text-[13px]"
				style={{ fontVariationSettings: fontWeights.medium }}
			>
				{formatWakeProgressSummary(input.entries)}
			</span>
		</output>
	);
}

function formatWakeProgressSummary(
	entries: readonly SpaceMessageWakeThinkingEntry[]
): string {
	const counts = new Map<WakeProgressStatusKind, number>();
	for (const entry of entries) {
		const kind = entry.step.kind;
		counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	const labels: string[] = [];
	for (const [kind, count] of counts) {
		labels.push(formatWakeProgressSummaryPart(kind, count));
	}
	return labels.join(" · ");
}

function formatWakeProgressSummaryPart(
	kind: WakeProgressStatusKind,
	count: number
): string {
	const agentCount = count === 1 ? "1 agent" : `${count} agents`;
	switch (kind) {
		case "sending":
			return `Sending ${count === 1 ? "1 request" : `${count} requests`}`;
		case "request_sent":
			return `${agentCount} waiting to start`;
		case "connecting":
			return `${agentCount} connecting`;
		case "retrying":
			return `Retrying ${count === 1 ? "1 request" : `${count} requests`}`;
		case "confirmation_pending":
			return `${agentCount} awaiting confirmation`;
		case "needs_input":
			return count === 1
				? "1 agent needs your input"
				: `${agentCount} need your input`;
		case "waiting_for_owner":
			return `${agentCount} waiting for ${count === 1 ? "its" : "their"} owner`;
		case "queued":
			return `${agentCount} waiting for earlier tasks`;
		case "working":
			return `${agentCount} working`;
		case "waiting_for_controller":
			return `${agentCount} waiting for an earlier task`;
		case "waiting_for_device":
			return `${agentCount} waiting for a computer`;
		default: {
			const _exhaustive: never = kind;
			return _exhaustive;
		}
	}
}

function InlineWakePreviewIndicator(input: {
	className?: string;
	"data-testid"?: string;
	text: string;
}) {
	return (
		<output
			aria-label={input.text}
			className={cn(
				"flex w-full min-w-0 max-w-full items-center gap-2 overflow-hidden px-0 py-0 text-muted-foreground",
				input.className
			)}
			data-testid={input["data-testid"]}
		>
			<span
				aria-hidden="true"
				className="flex size-5 shrink-0 items-center justify-center"
			>
				<SpaceAgentOrb state="composing" />
			</span>
			<span
				className="shimmer-text min-w-0 flex-1 truncate whitespace-nowrap text-[13px]"
				data-testid="space-wake-preview-text"
				style={{ fontVariationSettings: fontWeights.medium }}
			>
				{input.text}
			</span>
		</output>
	);
}

function StaticElapsedThinkingIndicator(input: {
	className?: string;
	"data-testid"?: string;
	entry: SpaceMessageWakeThinkingEntry;
	nowMs: number;
	showAgentWorkingState: boolean;
}) {
	return (
		<output
			aria-label={`${input.entry.text} · ${formatElapsedDuration(resolveElapsedSeconds(input))}`}
			className={cn(
				"flex max-w-full items-center gap-2 px-0 py-0 text-muted-foreground",
				input.className
			)}
			data-testid={input["data-testid"]}
		>
			<span
				aria-hidden="true"
				className="flex size-5 shrink-0 items-center justify-center"
			>
				<SpaceAgentOrb state={WAKE_STATUS_ORB_STATE[input.entry.step.kind]} />
			</span>
			<span
				className="min-w-0 text-[13px]"
				style={{ fontVariationSettings: fontWeights.medium }}
			>
				<span>
					{formatWakeProgress(input.entry.text, input.showAgentWorkingState)} ·{" "}
				</span>
				<span>{formatElapsedDuration(resolveElapsedSeconds(input))}</span>
			</span>
		</output>
	);
}

function resolveWakeProgressOrbState(
	entries: readonly SpaceMessageWakeThinkingEntry[]
): SpaceAgentOrbState | null {
	const entry = entries.reduce<SpaceMessageWakeThinkingEntry | undefined>(
		(selected, candidate) =>
			!selected ||
			WAKE_PROGRESS_STATUS_PRIORITY[candidate.step.kind] <
				WAKE_PROGRESS_STATUS_PRIORITY[selected.step.kind]
				? candidate
				: selected,
		undefined
	);
	return entry ? WAKE_STATUS_ORB_STATE[entry.step.kind] : null;
}

function resolveSingleElapsedEntry(
	entries: readonly SpaceMessageWakeThinkingEntry[]
): SpaceMessageWakeThinkingEntry | null {
	if (entries.length !== 1) {
		return null;
	}
	const entry = entries[0];
	if (
		!entry ||
		entry.elapsedStartedAtMs === null ||
		entry.step.status !== "active"
	) {
		return null;
	}
	return entry;
}

function resolveStableElapsedEntry(input: {
	elapsedStartedAtMs: number | null;
	entry: SpaceMessageWakeThinkingEntry | null;
}): SpaceMessageWakeThinkingEntry | null {
	if (!(input.entry && input.elapsedStartedAtMs !== null)) {
		return null;
	}
	const entry = input.entry;
	const elapsedStartedAtMs = input.elapsedStartedAtMs;
	if (elapsedStartedAtMs === entry.elapsedStartedAtMs) {
		return entry;
	}
	return {
		...entry,
		elapsedStartedAtMs: Math.min(
			elapsedStartedAtMs,
			entry.elapsedStartedAtMs ?? elapsedStartedAtMs
		),
	};
}

function resolveElapsedEntryIdentity(
	entry: SpaceMessageWakeThinkingEntry
): string {
	return [
		entry.targetProfileId,
		entry.text,
		entry.step.label,
		entry.step.status,
	]
		.map((value) => String(value).trim())
		.join("\u0000");
}

function formatThinkingEntryText(input: {
	entry: SpaceMessageWakeThinkingEntry;
	nowMs: number;
	showAgentWorkingState: boolean;
	showElapsedTime: boolean;
}): string {
	if (!input.showElapsedTime || input.entry.elapsedStartedAtMs === null) {
		return formatWakeProgress(input.entry.text, input.showAgentWorkingState);
	}
	return `${formatWakeProgress(
		input.entry.text,
		input.showAgentWorkingState
	)} · ${formatElapsedDuration(resolveElapsedSeconds(input))}`;
}

function formatWakeProgress(
	detail: string,
	showAgentWorkingState: boolean
): string {
	const trimmedDetail = detail.trim();
	if (!showAgentWorkingState) {
		return trimmedDetail;
	}
	if (
		trimmedDetail.length === 0 ||
		trimmedDetail === SPACE_AGENT_WORKING_STATUS_TEXT
	) {
		return SPACE_AGENT_WORKING_STATUS_TEXT;
	}
	return `${SPACE_AGENT_WORKING_STATUS_TEXT} · ${trimmedDetail}`;
}

function resolveElapsedSeconds(input: {
	entry: SpaceMessageWakeThinkingEntry;
	nowMs: number;
}): number {
	const elapsedStartedAtMs = input.entry.elapsedStartedAtMs;
	if (elapsedStartedAtMs === null) {
		return 0;
	}
	return Math.max(0, Math.floor((input.nowMs - elapsedStartedAtMs) / 1000));
}
