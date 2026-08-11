import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import {
	CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
	getAgentExecutionReadinessResponseSchema,
} from "@openmeld/schemas";
import type { GetAgentExecutionReadinessResponse } from "@openmeld/schemas/types";

type RemoteAgentRuntimeState = "available" | "faulted" | "resting";

const DEFAULT_AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const GENERATED_AT = "2026-07-06T00:00:00.000Z";

/**
 * Build a legal, schema-validated hosted Center Agent readiness projection for
 * one of the three product states (available / resting / faulted). The shape is
 * modeled on the Core-owned projection Core actually emits for a
 * `hosted:center-agent` Binding, not on the Web reader's assumptions, and it is
 * parsed through the shared schema so any drift fails the test at build time.
 */
export function buildRemoteCenterAgentReadiness(
	state: RemoteAgentRuntimeState,
	options: {
		agentProfileId?: string;
		reasonCode?: string;
		restingUntilMs?: number;
	} = {}
): GetAgentExecutionReadinessResponse {
	const agentProfileId = options.agentProfileId ?? DEFAULT_AGENT_PROFILE_ID;
	return assembleReadiness({
		agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
		agentProfileId,
		reasonCode: options.reasonCode ?? defaultReasonCode(state),
		restingUntilMs: options.restingUntilMs ?? null,
		runtimeDeviceDisplayName: "Remote Agent",
		state,
	});
}

function defaultReasonCode(state: RemoteAgentRuntimeState): string {
	switch (state) {
		case "available":
			return "remote_agent.available";
		case "resting":
			return "remote_agent.budget_resting";
		default:
			return "remote_agent.worker_unavailable";
	}
}

function assembleReadiness(input: {
	agentControllerRef: string;
	agentProfileId: string;
	reasonCode: string;
	restingUntilMs: number | null;
	runtimeDeviceDisplayName: string;
	state: RemoteAgentRuntimeState;
}): GetAgentExecutionReadinessResponse {
	const isAvailable = input.state === "available";
	const isResting = input.state === "resting";
	const observedAtMs = Date.parse(GENERATED_AT);
	const candidate: GetAgentExecutionReadinessResponse = {
		agentControllerRef: input.agentControllerRef,
		agentExecutionReadiness: {
			agentProfileId: input.agentProfileId,
			displayState: resolveDisplayState(input.state),
			facts: {
				binding: {
					reasonCodes: ["agent_profile_binding.command_eligible"],
					routable: true,
					source: "binding_truth",
				},
				claim: {
					executionBlocked: false,
					grantsClaimSuccess: false,
					reasonCodes: ["claim.not_checked"],
					source: "not_checked",
				},
				localService: {
					reachable: isAvailable,
					refreshable: false,
					reasonCodes: [input.reasonCode],
					source: isAvailable ? "runtime_transport" : "unavailable",
				},
				profile: {
					active: true,
					reasonCodes: ["profile.active"],
					source: "profile_identity",
				},
				providerAccount: {
					blocked: false,
					expiresAtMs: null,
					observedAtMs: null,
					provider: null,
					reasonCodes: [],
					source: "not_checked",
				},
				providerConversation: {
					agentControllerConversationId: null,
					errorCode: null,
					errorMessage: null,
					errorType: null,
					expiresAtMs: null,
					method: null,
					observedAtMs: null,
					provider: null,
					ready: true,
					reasonCodes: [],
					required: false,
					source: "not_required",
					status: "not_required",
				},
				readinessImpact: isAvailable
					? {
							blocked: false,
							expiresAtMs: null,
							impactKind: null,
							observedAtMs: null,
							reasonCodes: [],
							source: "not_checked",
						}
					: {
							blocked: isResting,
							expiresAtMs: input.restingUntilMs,
							impactKind: "local_execution",
							observedAtMs,
							reasonCodes: [input.reasonCode],
							source: "wake_failure",
						},
				route: {
					deviceId: null,
					lane: null,
					observedAt: null,
					online: false,
					reasonCodes: [],
					source: "missing",
				},
				runtime: {
					ready: isAvailable,
					reasonCodes: [input.reasonCode],
					source: "prepare_readiness",
				},
				service: {
					executionCompatible: isAvailable,
					expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
					observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
					reasonCodes: [],
					source: isAvailable ? "runtime_transport" : "unavailable",
				},
			},
			primaryAction: isAvailable ? "none" : "check_status",
			reasonCodes: [input.reasonCode],
		},
		agentProfileId: input.agentProfileId,
		agentWakeAvailability: {
			action: isAvailable ? "none" : "check_status",
			badgeLabel: resolveBadgeLabel(input.state),
			category: isAvailable ? "available" : "unavailable",
			isRefreshing: false,
			label: resolveBadgeLabel(input.state),
			phase: isAvailable ? "available" : "unavailable",
			reasonCode: isAvailable ? null : input.reasonCode,
			status: isAvailable ? "available_for_wake" : "unavailable_for_wake",
			summary: resolveBadgeLabel(input.state),
			tooltip: resolveBadgeLabel(input.state),
		},
		agentWakeRouteRegistration: {
			daemonSessionId: null,
			deviceId: null,
			lane: null,
			reasonCode: isAvailable ? null : input.reasonCode,
			reportedAtMs: null,
			serviceVersion: null,
			status: isAvailable ? "registered" : "unavailable",
		},
		generatedAt: GENERATED_AT,
		ownerUserId: "user-1",
		primaryBinding: null,
		primaryActionPlan: { action: "none", target: null },
		profileName: "Center Agent",
		routeDeviceId: null,
		routeLane: null,
		runtimeDeviceDisplayName: input.runtimeDeviceDisplayName,
		wakeRouteEvidence: isAvailable
			? { observedAt: GENERATED_AT, reasonCode: "online", status: "online" }
			: {
					observedAt: GENERATED_AT,
					reasonCode: "not_requested",
					status: "unavailable",
				},
		wakeRouteStatus: isAvailable
			? { status: "checking" }
			: { status: "unavailable" },
	};
	return getAgentExecutionReadinessResponseSchema.parse(candidate);
}

function resolveDisplayState(
	state: RemoteAgentRuntimeState
): "blocked" | "not_ready" | "ready" {
	switch (state) {
		case "available":
			return "ready";
		case "resting":
			return "blocked";
		default:
			return "not_ready";
	}
}

function resolveBadgeLabel(state: RemoteAgentRuntimeState): string {
	switch (state) {
		case "available":
			return "Available";
		case "resting":
			return "Resting";
		default:
			return "Unavailable";
	}
}
