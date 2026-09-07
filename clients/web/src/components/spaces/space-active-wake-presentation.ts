import { WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE } from "@openmeld/schemas";
import type {
	AccountSpaceActiveWakeSummaryItem,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	resolveWakeProgressStatus,
	WAKE_PROGRESS_STATUS_PRIORITY,
	type WakeProgressStatusPresentation,
} from "#/lib/spaces/wake-progress-status";
import {
	type SpaceAgentOrbState,
	WAKE_STATUS_ORB_STATE,
} from "./space-agent-orb-state";

const LEADING_MENTION_MARKER_PATTERN = /^@+/;
export type SpaceSidebarActiveWakeSummary =
	AccountSpaceActiveWakeSummaryItem & {
		waitReasonCode?: WakeProgressItem["waitReasonCode"];
		statuses?: readonly WakeProgressStatusPresentation[];
		hasMore?: boolean;
	};
export function buildSpaceActiveWakeSummary(input: {
	fallbackSummary?: AccountSpaceActiveWakeSummaryItem;
	items: readonly WakeProgressItem[];
	spaceId: string;
}): SpaceSidebarActiveWakeSummary {
	const fallbackNamesByProfileId = new Map(
		(input.fallbackSummary?.activeTargets ?? []).map((target) => [
			target.profileId,
			target.profileName
				? normalizeWorkingTargetLabel(target.profileName)
				: null,
		])
	);
	const targetsByProfileId = new Map<
		string,
		{ activeWakeCount: number; profileName: string | null }
	>();
	const activeItems = input.items.filter((item) => !item.terminal);
	for (const item of activeItems) {
		const current = targetsByProfileId.get(item.targetProfileId);
		targetsByProfileId.set(item.targetProfileId, {
			activeWakeCount: (current?.activeWakeCount ?? 0) + 1,
			profileName:
				current?.profileName ??
				fallbackNamesByProfileId.get(item.targetProfileId) ??
				normalizeWorkingTargetLabel(item.targetLabel) ??
				null,
		});
	}
	const activeTargets = Array.from(
		targetsByProfileId,
		([profileId, target]) => ({ profileId, ...target })
	);
	return {
		activeTargets,
		statuses: [...activeItems]
			.sort((left, right) => (left.startedAtMs ?? 0) - (right.startedAtMs ?? 0))
			.flatMap((item) => {
				const status = resolveWakeProgressStatus({
					...item,
					targetLabel:
						normalizeWorkingTargetLabel(item.targetLabel) ??
						fallbackNamesByProfileId.get(item.targetProfileId) ??
						"Agent",
				});
				return status ? [status] : [];
			}),
		activeWakeCount: activeTargets.reduce(
			(total, target) => total + target.activeWakeCount,
			0
		),
		spaceId: input.spaceId,
		waitReasonCode:
			activeItems.length > 0 &&
			activeItems.every(
				(item) =>
					item.waitReasonCode ===
					WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
			)
				? WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
				: null,
	};
}

export type SpaceActiveWakePresentation = {
	isWaitingForCurrentTask: boolean;
	label: string;
	orbState?: SpaceAgentOrbState;
};

export function resolveSpaceActiveWakePresentation(
	summary: SpaceSidebarActiveWakeSummary
): SpaceActiveWakePresentation {
	if (summary.statuses?.length) {
		const statuses = [...summary.statuses].sort(
			(left, right) =>
				WAKE_PROGRESS_STATUS_PRIORITY[left.kind] -
				WAKE_PROGRESS_STATUS_PRIORITY[right.kind]
		);
		const first = statuses[0];
		if (first) {
			return {
				isWaitingForCurrentTask: first.kind === "waiting_for_controller",
				label: [
					...new Set(statuses.map((status) => status.label)),
					...(summary.hasMore ? ["More active tasks in this Space"] : []),
				].join("; "),
				orbState: WAKE_STATUS_ORB_STATE[first.kind],
			};
		}
	}
	const isWaitingForCurrentTask =
		summary.waitReasonCode ===
		WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE;
	const activeTargets = summary.activeTargets ?? [];
	if (activeTargets.length > 0) {
		return {
			isWaitingForCurrentTask,
			label: resolveAttributedSpaceWakeStatusLabel({
				activeTargets,
				isWaitingForCurrentTask,
			}),
		};
	}
	return {
		isWaitingForCurrentTask,
		label: resolveGenericSpaceWakeStatusLabel({
			activeWakeCount: summary.activeWakeCount,
			isWaitingForCurrentTask,
		}),
	};
}

function resolveGenericSpaceWakeStatusLabel(input: {
	activeWakeCount: number;
	isWaitingForCurrentTask: boolean;
}): string {
	if (input.isWaitingForCurrentTask) {
		return input.activeWakeCount === 1
			? "An agent is waiting for its current task"
			: `${String(input.activeWakeCount)} Wakes are waiting for current tasks`;
	}
	return input.activeWakeCount === 1
		? "A Wake is active"
		: `${String(input.activeWakeCount)} Wakes are active`;
}

function resolveAttributedSpaceWakeStatusLabel(input: {
	activeTargets: NonNullable<SpaceSidebarActiveWakeSummary["activeTargets"]>;
	isWaitingForCurrentTask: boolean;
}): string {
	const namedTargets = input.activeTargets.filter(
		(target): target is typeof target & { profileName: string } =>
			target.profileName !== null &&
			normalizeWorkingTargetLabel(target.profileName) !== null
	);
	const unknownTargetCount = input.activeTargets.length - namedTargets.length;
	const targetLabels = namedTargets.map((target) => target.profileName);
	if (unknownTargetCount === 1) {
		targetLabels.push("another agent");
	} else if (unknownTargetCount > 1) {
		targetLabels.push(`${String(unknownTargetCount)} other agents`);
	}
	const plural = input.activeTargets.length > 1;
	const status = input.isWaitingForCurrentTask
		? `${plural ? "are" : "is"} waiting for ${plural ? "their" : "its"} current task`
		: `${plural ? "have" : "has"} an active Wake`;
	return capitalizeStatusFragment(
		`${formatEnglishList(targetLabels)} ${status}`
	);
}

function formatEnglishList(values: readonly string[]): string {
	if (values.length <= 1) {
		return values[0] ?? "";
	}
	if (values.length === 2) {
		return `${values[0]} and ${values[1]}`;
	}
	return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function capitalizeStatusFragment(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function normalizeWorkingTargetLabel(value: string): string | null {
	const normalized = value
		.trim()
		.replace(LEADING_MENTION_MARKER_PATTERN, "")
		.trim();
	return normalized.length > 0 && !normalized.startsWith("agt_")
		? normalized
		: null;
}
