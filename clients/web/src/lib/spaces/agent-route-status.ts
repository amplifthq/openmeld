import {
	isAgentExecutionLocalReadinessRefreshingReasonCode as isSharedAgentExecutionLocalReadinessRefreshingReasonCode,
	isAgentExecutionRouteStatusUpdatingReasonCode as isSharedAgentExecutionRouteStatusUpdatingReasonCode,
	isAgentExecutionSelfHealingReadiness as isSharedAgentExecutionSelfHealingReadiness,
	isAgentExecutionSelfHealingReasonCode as isSharedAgentExecutionSelfHealingReasonCode,
} from "@openmeld/agent-runtime";
import type { AgentExecutionReadiness } from "@openmeld/schemas/types";

export function isAgentExecutionRouteStatusUpdatingReasonCode(
	reasonCode: string
): boolean {
	return isSharedAgentExecutionRouteStatusUpdatingReasonCode(reasonCode);
}

export function isAgentExecutionLocalReadinessRefreshingReasonCode(
	reasonCode: string
): boolean {
	return isSharedAgentExecutionLocalReadinessRefreshingReasonCode(reasonCode);
}

export function isAgentExecutionSelfHealingReasonCode(
	reasonCode: string
): boolean {
	return isSharedAgentExecutionSelfHealingReasonCode(reasonCode);
}

export function isAgentExecutionSelfHealingReadiness(
	readiness: AgentExecutionReadiness
): boolean {
	return isSharedAgentExecutionSelfHealingReadiness(readiness);
}
