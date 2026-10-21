import {
	type AgentProfileReplyRecoveryPlan,
	isAgentProfileLocalReadinessRefreshReasonCode,
} from "@openmeld/agent-profile";
import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";
import { resolveSpaceMemberAgentOwnerWakeDiagnosticsView } from "@openmeld/space";
import { isAgentExecutionSelfHealingReadiness } from "#/lib/spaces/agent-route-status";
import {
	SPACE_WAKE_STATUS_FRESHNESS_REFRESH_INTERVAL_MS as STRATEGY_SPACE_WAKE_STATUS_FRESHNESS_REFRESH_INTERVAL_MS,
	SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS as STRATEGY_SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS,
	SPACE_WAKE_STATUS_REFRESH_WINDOW_MS as STRATEGY_SPACE_WAKE_STATUS_REFRESH_WINDOW_MS,
} from "#/strategy-constants";

export const SPACE_WAKE_STATUS_FRESHNESS_REFRESH_INTERVAL_MS =
	STRATEGY_SPACE_WAKE_STATUS_FRESHNESS_REFRESH_INTERVAL_MS;
export const SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS =
	STRATEGY_SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS;
export const SPACE_WAKE_STATUS_REFRESH_WINDOW_MS =
	STRATEGY_SPACE_WAKE_STATUS_REFRESH_WINDOW_MS;
export const SPACE_WAKE_STATUS_AUTO_REFRESH_ATTEMPTS = Math.ceil(
	SPACE_WAKE_STATUS_REFRESH_WINDOW_MS / SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS
);

export type SpaceWakeStatusTransientState =
	| "checking"
	| "active_wake_in_progress"
	| "active_wake_waiting_for_folder"
	| "active_wake_waiting_for_service";

const SERVICE_CONNECTION_RECOVERY_REASON_CODES = new Set<string>([
	"local_service.not_connected_for_account",
	"local_service.unavailable",
	"service.not_running",
]);

export function isSpaceWakeStatusAutoRefreshable(input: {
	agent: SpaceMemberAgentSnapshot;
	allowResolvedAgentWakeAvailabilityRefresh?: boolean;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	plan: AgentProfileReplyRecoveryPlan | null | undefined;
}): boolean {
	if (input.autoRefreshExhaustedProfileIds.has(input.agent.profileId)) {
		return false;
	}

	return isSpaceWakeStatusRefreshCandidate(input);
}

export function isSpaceWakeStatusRefreshCandidate(input: {
	agent: SpaceMemberAgentSnapshot;
	allowResolvedAgentWakeAvailabilityRefresh?: boolean;
	plan: AgentProfileReplyRecoveryPlan | null | undefined;
}): boolean {
	const readiness = resolveOwnerWakeDiagnosticsReadiness(input.agent);
	if (
		!input.allowResolvedAgentWakeAvailabilityRefresh &&
		hasResolvedAgentWakeAvailability(input.agent)
	) {
		return (
			hasRefreshableOwnerWakeDiagnosticsReadiness(readiness) ||
			isRefreshableExpiredWakeRoute(input.agent)
		);
	}

	if (readiness && isAgentExecutionSelfHealingReadiness(readiness)) {
		return true;
	}

	if (isSpaceWakeStatusPassiveRefreshCandidate(input)) {
		return true;
	}

	return isServiceConnectionRecoveryPlan(input.plan);
}

export function isSpaceWakeStatusPassiveRefreshCandidate(input: {
	agent: SpaceMemberAgentSnapshot;
	plan: AgentProfileReplyRecoveryPlan | null | undefined;
}): boolean {
	const readiness = resolveOwnerWakeDiagnosticsReadiness(input.agent);
	if (hasResolvedAgentWakeAvailability(input.agent)) {
		return (
			hasRefreshableOwnerWakeDiagnosticsReadiness(readiness) ||
			isRefreshableExpiredWakeRoute(input.agent)
		);
	}

	if (hasRefreshingAgentWakeAvailability(input.agent)) {
		return true;
	}

	if (readiness && isRefreshableLocalReadinessEvidence(readiness)) {
		return true;
	}

	return isLocalReadinessRecoveryPlan(input.plan);
}

export function resolveSpaceWakeStatusTransientState(input: {
	activeWakeWaitingTargetProfileIds: ReadonlySet<string>;
	agent: SpaceMemberAgentSnapshot;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	isAgentRecoveryPending: boolean;
	plan: AgentProfileReplyRecoveryPlan | null | undefined;
}): SpaceWakeStatusTransientState | null {
	if (input.autoRefreshExhaustedProfileIds.has(input.agent.profileId)) {
		return null;
	}

	if (
		isServiceConnectionRecoveryPlan(input.plan) &&
		input.activeWakeWaitingTargetProfileIds.has(input.agent.profileId)
	) {
		return "active_wake_waiting_for_service";
	}

	if (isRefreshableExpiredWakeRoute(input.agent)) {
		return "checking";
	}

	if (hasResolvedAgentWakeAvailability(input.agent)) {
		return null;
	}

	if (input.isAgentRecoveryPending) {
		return "checking";
	}

	return null;
}

function isServiceConnectionRecoveryPlan(
	plan: AgentProfileReplyRecoveryPlan | null | undefined
): boolean {
	return Boolean(
		plan &&
			plan.kind !== "none" &&
			SERVICE_CONNECTION_RECOVERY_REASON_CODES.has(plan.recoveryReasonCode)
	);
}

function isLocalReadinessRecoveryPlan(
	plan: AgentProfileReplyRecoveryPlan | null | undefined
): boolean {
	return Boolean(
		plan &&
			plan.kind !== "none" &&
			isPassiveLocalReadinessRefreshReasonCode(plan.recoveryReasonCode)
	);
}

function isRefreshableExpiredWakeRoute(
	agent: SpaceMemberAgentSnapshot
): boolean {
	const readiness = resolveOwnerWakeDiagnosticsReadiness(agent);
	return Boolean(
		agent.agentWakeAvailability?.status === "offline_for_wake" &&
			agent.agentWakeAvailability.reasonCode ===
				"wake_route.registration_expired" &&
			readiness &&
			readiness.primaryAction === "check_status" &&
			readiness.facts.localService.refreshable
	);
}

function hasRefreshableOwnerWakeDiagnosticsReadiness(
	readiness: ReturnType<
		typeof resolveSpaceMemberAgentOwnerWakeDiagnosticsView
	>["agentExecutionReadiness"]
): boolean {
	return Boolean(readiness && isRefreshableLocalReadinessEvidence(readiness));
}

function isRefreshableLocalReadinessEvidence(
	readiness: ReturnType<
		typeof resolveSpaceMemberAgentOwnerWakeDiagnosticsView
	>["agentExecutionReadiness"]
): boolean {
	return Boolean(
		readiness?.facts.localService.refreshable &&
			isPassiveLocalReadinessRefreshEvidence(readiness)
	);
}

function isPassiveLocalReadinessRefreshEvidence(
	readiness: NonNullable<
		ReturnType<
			typeof resolveSpaceMemberAgentOwnerWakeDiagnosticsView
		>["agentExecutionReadiness"]
	>
): boolean {
	const reasonCodes = getAgentExecutionReadinessReasonCodes(readiness);
	if (reasonCodes.some(isPassiveLocalReadinessRefreshReasonCode)) {
		return true;
	}

	return (
		readiness.primaryAction === "check_status" &&
		reasonCodes.some(isAgentProfileLocalReadinessRefreshReasonCode)
	);
}

function getAgentExecutionReadinessReasonCodes(
	readiness: NonNullable<
		ReturnType<
			typeof resolveSpaceMemberAgentOwnerWakeDiagnosticsView
		>["agentExecutionReadiness"]
	>
): readonly string[] {
	return [
		...readiness.reasonCodes,
		...readiness.facts.profile.reasonCodes,
		...readiness.facts.binding.reasonCodes,
		...readiness.facts.claim.reasonCodes,
		...readiness.facts.providerAccount.reasonCodes,
		...readiness.facts.readinessImpact.reasonCodes,
		...readiness.facts.localService.reasonCodes,
		...readiness.facts.service.reasonCodes,
		...readiness.facts.route.reasonCodes,
		...readiness.facts.runtime.reasonCodes,
	];
}

function isPassiveLocalReadinessRefreshReasonCode(reasonCode: string): boolean {
	return (
		reasonCode !== "runtime.projection_missing" &&
		isAgentProfileLocalReadinessRefreshReasonCode(reasonCode)
	);
}

function hasResolvedAgentWakeAvailability(
	agent: SpaceMemberAgentSnapshot
): boolean {
	const publicStatus = agent.agentWakeAvailability?.status;
	return (
		publicStatus === "available_for_wake" ||
		publicStatus === "offline_for_wake" ||
		publicStatus === "unavailable_for_wake"
	);
}

function hasRefreshingAgentWakeAvailability(
	agent: SpaceMemberAgentSnapshot
): boolean {
	return agent.agentWakeAvailability?.status === "checking_connection";
}

function resolveOwnerWakeDiagnosticsReadiness(
	agent: SpaceMemberAgentSnapshot
): ReturnType<
	typeof resolveSpaceMemberAgentOwnerWakeDiagnosticsView
>["agentExecutionReadiness"] {
	return resolveSpaceMemberAgentOwnerWakeDiagnosticsView(agent)
		.agentExecutionReadiness;
}
