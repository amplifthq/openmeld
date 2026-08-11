import {
	createSpaceMemberAgentExecutionReadiness,
	createSpaceMemberAgentSnapshot,
} from "@openmeld/schemas/testing";
import { describe, expect, it } from "vitest";
import {
	isSpaceWakeStatusAutoRefreshable,
	isSpaceWakeStatusPassiveRefreshCandidate,
	resolveSpaceWakeStatusTransientState,
} from "./space-wake-status-refresh";

describe("resolveSpaceWakeStatusTransientState", () => {
	it("does not turn passive refreshable readiness into a visible Checking state", () => {
		const agent = createRefreshableRouteGapAgent();

		expect(
			resolveSpaceWakeStatusTransientState({
				activeWakeWaitingTargetProfileIds: new Set(),
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				isAgentRecoveryPending: false,
				plan: null,
			})
		).toBeNull();
	});

	it("does not let owner pending refresh override resolved AgentWakeAvailability", () => {
		const agent = createRefreshableRouteGapAgent({
			agentWakeAvailability: { status: "available_for_wake" },
		});

		expect(
			resolveSpaceWakeStatusTransientState({
				activeWakeWaitingTargetProfileIds: new Set(),
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				isAgentRecoveryPending: true,
				plan: null,
			})
		).toBeNull();
	});

	it("does not start passive refresh for route gaps under resolved AgentWakeAvailability", () => {
		const agent = createRefreshableRouteGapAgent({
			agentWakeAvailability: { status: "available_for_wake" },
		});

		expect(
			isSpaceWakeStatusPassiveRefreshCandidate({
				agent,
				plan: null,
			})
		).toBe(false);
		expect(
			isSpaceWakeStatusAutoRefreshable({
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				plan: null,
			})
		).toBe(false);
	});

	it("refreshes stale owner wake diagnostics without overriding resolved AgentWakeAvailability", () => {
		const agent = createRefreshableLocalReadinessAgent({
			agentWakeAvailability: { status: "unavailable_for_wake" },
		});

		expect(
			isSpaceWakeStatusPassiveRefreshCandidate({
				agent,
				plan: null,
			})
		).toBe(true);
		expect(
			isSpaceWakeStatusAutoRefreshable({
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				plan: null,
			})
		).toBe(true);
		expect(
			resolveSpaceWakeStatusTransientState({
				activeWakeWaitingTargetProfileIds: new Set(),
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				isAgentRecoveryPending: true,
				plan: null,
			})
		).toBeNull();
	});

	it("does not refresh resolved AgentWakeAvailability from a owner repair plan alone", () => {
		const agent = createSpaceMemberAgentSnapshot({
			includeAgentExecutionReadiness: false,
			agentWakeAvailability: { status: "unavailable_for_wake" },
		});
		const plan = {
			body: "Codex needs a current local agent connection from this computer.",
			kind: "prepare_agent_profile" as const,
			primaryActionId: "connect_local_agent" as const,
			primaryActionLabel: "Connect local agent",
			profileId: agent.profileId,
			profileName: agent.profileName,
			recoveryReasonCode: "runtime.agent_controller_report_stale",
			secondaryLabel: "Connect local agent",
			title: "Codex needs a local agent connection",
		};

		expect(
			isSpaceWakeStatusPassiveRefreshCandidate({
				agent,
				plan,
			})
		).toBe(false);
		expect(
			isSpaceWakeStatusAutoRefreshable({
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				plan,
			})
		).toBe(false);
	});

	it("starts passive refresh from public checking availability", () => {
		const agent = createSpaceMemberAgentSnapshot({
			includeAgentExecutionReadiness: false,
			agentWakeAvailability: { status: "checking_connection" },
		});

		expect(
			isSpaceWakeStatusPassiveRefreshCandidate({
				agent,
				plan: null,
			})
		).toBe(true);
	});

	it("allows explicit convergence refresh to continue under resolved AgentWakeAvailability", () => {
		const agent = createRefreshableRouteGapAgent({
			agentWakeAvailability: { status: "available_for_wake" },
		});

		expect(
			isSpaceWakeStatusAutoRefreshable({
				agent,
				allowResolvedAgentWakeAvailabilityRefresh: true,
				autoRefreshExhaustedProfileIds: new Set(),
				plan: null,
			})
		).toBe(true);
	});

	it("stops refreshing and showing transient checking after the refresh boundary expires", () => {
		const agent = createRefreshableRouteGapAgent();
		const exhaustedProfileIds = new Set([agent.profileId]);

		expect(
			isSpaceWakeStatusAutoRefreshable({
				agent,
				allowResolvedAgentWakeAvailabilityRefresh: true,
				autoRefreshExhaustedProfileIds: exhaustedProfileIds,
				plan: null,
			})
		).toBe(false);
		expect(
			resolveSpaceWakeStatusTransientState({
				activeWakeWaitingTargetProfileIds: new Set(),
				agent,
				autoRefreshExhaustedProfileIds: exhaustedProfileIds,
				isAgentRecoveryPending: true,
				plan: null,
			})
		).toBeNull();
	});

	it("shows expired Wake route availability as Checking until refresh is exhausted", () => {
		const agent = createExpiredWakeRouteAgent();

		expect(
			isSpaceWakeStatusPassiveRefreshCandidate({
				agent,
				plan: null,
			})
		).toBe(true);
		expect(
			isSpaceWakeStatusAutoRefreshable({
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				plan: null,
			})
		).toBe(true);
		expect(
			resolveSpaceWakeStatusTransientState({
				activeWakeWaitingTargetProfileIds: new Set(),
				agent,
				autoRefreshExhaustedProfileIds: new Set(),
				isAgentRecoveryPending: false,
				plan: null,
			})
		).toBe("checking");
		expect(
			resolveSpaceWakeStatusTransientState({
				activeWakeWaitingTargetProfileIds: new Set(),
				agent,
				autoRefreshExhaustedProfileIds: new Set([agent.profileId]),
				isAgentRecoveryPending: true,
				plan: null,
			})
		).toBeNull();
	});
});

function createRefreshableRouteGapAgent(
	input: Parameters<typeof createSpaceMemberAgentSnapshot>[0] = {}
) {
	return createSpaceMemberAgentSnapshot({
		agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
			displayState: "not_ready",
			facts: {
				binding: {
					reasonCodes: [],
					routable: true,
					source: "binding_truth",
				},
				localService: {
					reachable: true,
					refreshable: true,
					reasonCodes: ["local_service.refresh_in_progress"],
					source: "runtime_transport",
				},
				route: {
					online: false,
					reasonCodes: ["route.not_registered"],
					source: "daemon_route",
				},
				service: {
					executionCompatible: true,
					reasonCodes: [],
					source: "runtime_transport",
				},
			},
			primaryAction: "check_status",
			reasonCodes: ["route.not_registered"],
		}),
		liveNow: false,
		wakeState: "offline",
		wakeabilityStatus: "blocked",
		...input,
	});
}

function createRefreshableLocalReadinessAgent(
	input: Parameters<typeof createSpaceMemberAgentSnapshot>[0] = {}
) {
	return createSpaceMemberAgentSnapshot({
		agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
			displayState: "not_ready",
			facts: {
				localService: {
					reachable: true,
					refreshable: true,
					reasonCodes: [],
					source: "runtime_transport",
				},
				runtime: {
					ready: false,
					reasonCodes: ["runtime.agent_controller_report_stale"],
					source: "prepare_readiness",
				},
			},
			primaryAction: "check_status",
			reasonCodes: ["runtime.agent_controller_report_stale"],
		}),
		liveNow: false,
		wakeState: "offline",
		wakeabilityStatus: "blocked",
		...input,
	});
}

function createExpiredWakeRouteAgent() {
	return createRefreshableRouteGapAgent({
		agentWakeAvailability: {
			action: "check_status",
			badgeLabel: "Offline",
			category: "offline",
			isRefreshing: false,
			label: "Offline for Wake",
			phase: "offline",
			reasonCode: "wake_route.registration_expired",
			status: "offline_for_wake",
			summary: "This agent's connection is offline.",
			tooltip: "Agent connection is offline",
		},
	});
}
