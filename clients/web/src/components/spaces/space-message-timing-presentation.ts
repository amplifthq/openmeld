import type {
	GetSpaceMessageDetailsResponse,
	WakeTiming,
	WakeTimingSegmentKind,
} from "@openmeld/schemas/types";

type WakeTarget =
	GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number];

export type MessageTimingGroupKey =
	| "agent_run"
	| "waiting_for_input"
	| "queued_and_starting"
	| "openmeld"
	| "not_recorded";

export type MessageTimingSummaryRow = {
	durationMs: number;
	group: MessageTimingGroupKey;
	label: string;
};

export type MessageTimingSegmentRow = {
	detail: string | null;
	durationMs: number;
	group: MessageTimingGroupKey;
	isOpen: boolean;
	key: string;
	label: string;
	startedAtMs: number;
};

export type MessageTimingTargetPresentation = {
	endToEndMs: number;
	lastUpdateLabel: string | null;
	segments: MessageTimingSegmentRow[];
	statusLabel: string;
	summaryRows: MessageTimingSummaryRow[];
	targetName: string;
	targetProfileId: string;
};

const GROUP_LABELS: Record<MessageTimingGroupKey, string> = {
	agent_run: "Agent run",
	waiting_for_input: "Waiting for input",
	queued_and_starting: "Queued and starting",
	openmeld: "OpenMeld routing and delivery",
	not_recorded: "Not recorded",
};

const SEGMENT_GROUP: Record<WakeTimingSegmentKind, MessageTimingGroupKey> = {
	routing: "openmeld",
	queue: "queued_and_starting",
	delivery: "openmeld",
	startup: "queued_and_starting",
	agent_run: "agent_run",
	waiting_for_input: "waiting_for_input",
	result_delivery: "openmeld",
	publishing: "openmeld",
	not_recorded: "not_recorded",
};

const SEGMENT_LABELS: Record<WakeTimingSegmentKind, string> = {
	routing: "Routing the request",
	queue: "Queued for the Agent",
	delivery: "Delivering to the computer",
	startup: "Starting on the computer",
	agent_run: "Agent run",
	waiting_for_input: "Waiting for input",
	result_delivery: "Returning the result",
	publishing: "Posting to the Space",
	not_recorded: "Not recorded",
};

const LOCAL_CAPACITY_DETAIL = "Waiting for capacity on the computer";
const REASON_DETAILS: Readonly<Record<string, string>> = {
	"runtime_coordinator.head_queued": "Waiting for earlier tasks",
	"daemon.profile.offline": "Waiting for the computer to come online",
	"daemon.profile.pending_first_report":
		"Waiting for the Agent to become ready",
	"wake.device_wait.readiness_checking":
		"Waiting for the Agent to become ready",
	"wake.device_wait.access_check_unavailable": "Waiting to verify access",
	"daemon.service.draining": "Waiting for the computer to accept new work",
	"runtime.local_queue.waiting_workspace_conflict":
		"Waiting for another task in its folder",
	"runtime.local_queue.waiting_global_concurrency": LOCAL_CAPACITY_DETAIL,
	"runtime.local_queue.waiting_local_execution_lane": LOCAL_CAPACITY_DETAIL,
	"runtime.local_queue.waiting_agent_profile_concurrency":
		LOCAL_CAPACITY_DETAIL,
	"runtime.local_queue.waiting_runner_slot": LOCAL_CAPACITY_DETAIL,
	"runtime.local_queue.waiting_controller_maintenance":
		"Waiting for local agent maintenance",
	"runtime.local_queue.starting_runtime": "Starting the local agent",
	"runtime.agent_controller_conversation.occupied": "Waiting for another app",
};

const SUMMARY_GROUP_ORDER: readonly MessageTimingGroupKey[] = [
	"agent_run",
	"waiting_for_input",
	"queued_and_starting",
	"openmeld",
	"not_recorded",
];

const DECIMAL_SECONDS_FORMATTER = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 1,
});
const LEADING_MENTION_MARKER_PATTERN = /^@/u;

export function buildMessageTimingPresentation(
	targets: readonly WakeTarget[]
): MessageTimingTargetPresentation[] {
	return targets.flatMap((target) =>
		target.timing ? [presentTargetTiming(target, target.timing)] : []
	);
}

/** Structured timing for the targets this viewer can read. */
export function buildMessageTimingExport(
	details: GetSpaceMessageDetailsResponse
): string {
	return JSON.stringify(
		{
			spaceId: details.query.spaceId,
			signalId: details.message.signalId,
			targets: details.wakeContext.targets.flatMap((target) =>
				target.timing
					? [
							{
								targetProfileId: target.targetProfileId,
								targetLabel: target.targetLabel,
								timing: target.timing,
							},
						]
					: []
			),
		},
		null,
		2
	);
}

export function formatTimingDuration(durationMs: number): string {
	if (durationMs < 1000) {
		return "<1s";
	}
	if (durationMs < 10_000) {
		return `${DECIMAL_SECONDS_FORMATTER.format(Math.floor(durationMs / 100) / 10)}s`;
	}
	const totalSeconds = Math.floor(durationMs / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) {
		return joinUnits(totalMinutes, "m", totalSeconds % 60, "s");
	}
	const totalHours = Math.floor(totalMinutes / 60);
	if (totalHours < 24) {
		return joinUnits(totalHours, "h", totalMinutes % 60, "m");
	}
	return joinUnits(Math.floor(totalHours / 24), "d", totalHours % 24, "h");
}

function presentTargetTiming(
	target: WakeTarget,
	timing: WakeTiming
): MessageTimingTargetPresentation {
	return {
		endToEndMs: timing.totals.endToEndMs,
		lastUpdateLabel: resolveLastUpdateLabel(timing),
		segments: timing.segments.map((segment) => ({
			detail: segment.reasonCode
				? (REASON_DETAILS[segment.reasonCode] ?? null)
				: null,
			durationMs: segment.durationMs,
			group: SEGMENT_GROUP[segment.kind],
			isOpen: segment.endedAt === null,
			key: `${segment.kind}:${segment.startedAt}`,
			label: SEGMENT_LABELS[segment.kind],
			startedAtMs: Date.parse(segment.startedAt),
		})),
		statusLabel: resolveStatusLabel(timing),
		summaryRows: SUMMARY_GROUP_ORDER.flatMap((group) => {
			const durationMs = timing.segments
				.filter((segment) => SEGMENT_GROUP[segment.kind] === group)
				.reduce((sum, segment) => sum + segment.durationMs, 0);
			return durationMs > 0
				? [{ durationMs, group, label: GROUP_LABELS[group] }]
				: [];
		}),
		targetName: resolveTargetName(target),
		targetProfileId: target.targetProfileId,
	};
}

function resolveStatusLabel(timing: WakeTiming): string {
	const total = formatTimingDuration(timing.totals.endToEndMs);
	switch (timing.state) {
		case "in_progress":
			return `${total} so far`;
		case "settled":
			return `Total ${total}`;
		case "ended":
			return `Ended after ${total}`;
		default: {
			const _exhaustive: never = timing.state;
			return _exhaustive;
		}
	}
}

function resolveLastUpdateLabel(timing: WakeTiming): string | null {
	if (timing.state !== "in_progress") {
		return null;
	}
	const sinceMs = Date.parse(timing.asOf) - Date.parse(timing.lastEvidenceAt);
	return sinceMs < 1000
		? "Last update just now"
		: `Last update ${formatTimingDuration(sinceMs)} ago`;
}

function resolveTargetName(target: WakeTarget): string {
	const name =
		target.agentContext?.profileName.value ??
		target.targetLabel?.replace(LEADING_MENTION_MARKER_PATTERN, "") ??
		null;
	return name && !name.startsWith("agt_") ? name : "Agent";
}

function joinUnits(
	major: number,
	majorUnit: string,
	minor: number,
	minorUnit: string
): string {
	return minor > 0
		? `${major}${majorUnit} ${minor}${minorUnit}`
		: `${major}${majorUnit}`;
}
