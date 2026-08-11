import {
	createSpaceMemberAgentExecutionReadiness,
	createSpaceMemberAgentSnapshot,
} from "@openmeld/schemas/testing";
import type {
	SpaceMemberAgentSnapshot,
	StartDeviceProjection,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { describe, expect, it } from "vitest";
import { planAgentProfileReplyRecoveryFromWebEvidence } from "./agent-profile-reply-recovery";

describe("planAgentProfileReplyRecoveryFromWebEvidence", () => {
	it("maps selectable local agents to Agent Profile reply recovery", () => {
		const plan = planAgentProfileReplyRecoveryFromWebEvidence({
			localAgentCatalog: createLocalAgentCatalog([
				createLocalAgentCatalogEntry({
					agentId: "codex",
					displayName: "Codex",
				}),
			]),
			member: createUnboundAgentMember({
				agentControllerRef: "builtin:codex",
				profileName: "Codex",
			}),
		});

		expect(plan).toMatchObject({
			agentId: "codex",
			agentControllerRef: "builtin:codex",
			kind: "connect_controller",
			primaryActionLabel: "Connect local agent",
		});
	});

	it("filters non-selectable local agents before planning recovery", () => {
		const plan = planAgentProfileReplyRecoveryFromWebEvidence({
			localAgentCatalog: createLocalAgentCatalog([
				createLocalAgentCatalogEntry({
					agentId: "codex",
					displayName: "Codex",
					selectable: false,
					selectableReason: "needs_repair",
				}),
			]),
			member: createUnboundAgentMember({
				agentControllerRef: "builtin:codex",
				profileName: "Codex",
			}),
		});

		expect(plan).toMatchObject({
			kind: "choose_controller",
			primaryActionLabel: "Choose local agent",
		});
	});

	it("maps ready current local runtime reply readiness without showing stale service recovery", () => {
		const plan = planAgentProfileReplyRecoveryFromWebEvidence({
			currentLocalRuntimeReplyReadiness: createComputerReplyReadiness({
				status: "ready",
			}),
			member: createSpaceMemberAgentSnapshot({
				agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
					displayState: "not_ready",
					facts: {
						binding: {
							reasonCodes: [],
							routable: true,
							source: "binding_truth",
						},
						claim: {
							executionBlocked: false,
							reasonCodes: [],
							source: "claim_diagnostics",
						},
						localService: {
							reachable: true,
							refreshable: false,
							reasonCodes: [],
							source: "runtime_transport",
						},
						route: {
							online: true,
							reasonCodes: [],
							source: "daemon_route",
						},
						runtime: {
							ready: true,
							reasonCodes: [],
							source: "prepare_readiness",
						},
						service: {
							reasonCodes: ["service.drifted"],
							source: "runtime_transport",
						},
					},
					primaryAction: "check_status",
					reasonCodes: ["service.drifted"],
				}),
				profileName: "Codex",
				wakeState: "offline",
				wakeabilityReasonCodes: ["service.drifted"],
				wakeabilityReasonText: "Blocked",
				wakeabilityStatus: "blocked",
			}),
		});

		expect(plan).toEqual({ kind: "none" });
	});
});

function createUnboundAgentMember(
	input: Partial<SpaceMemberAgentSnapshot>
): SpaceMemberAgentSnapshot {
	return createSpaceMemberAgentSnapshot({
		...input,
		agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
			displayState: "not_ready",
			facts: {
				binding: {
					reasonCodes: ["agent_profile_binding.missing"],
					routable: false,
					source: "missing",
				},
			},
			primaryAction: "reconnect_binding",
			reasonCodes: ["agent_profile_binding.missing"],
		}),
		wakeState: "offline",
		wakeabilityReasonCodes: ["agent_profile_binding.missing"],
		wakeabilityReasonText: "Blocked",
		wakeabilityStatus: "blocked",
	});
}

function createComputerReplyReadiness(input: {
	status: ComputerReplyReadiness["status"];
}): ComputerReplyReadiness {
	return {
		detailReasonCode: null,
		executionTargetStatus: null,
		reasonCode: input.status === "ready" ? "ready" : "execution_target.unknown",
		service: null,
		status: input.status,
	};
}

function createLocalAgentCatalog(
	entries: StartDeviceProjection["deviceAgentCatalog"]["entries"]
): StartDeviceProjection["deviceAgentCatalog"] {
	return {
		detectedNotSupportedYet: 0,
		detectedSupported: entries.filter((entry) => entry.launchStatus === "ready")
			.length,
		entries,
		needsChoice: 0,
		needsRepair: 0,
		notDetected: entries.filter((entry) => !entry.detected).length,
		totalBuiltins: entries.filter((entry) => entry.targetKind === "builtin")
			.length,
	};
}

function createLocalAgentCatalogEntry(
	input: Partial<StartDeviceProjection["deviceAgentCatalog"]["entries"][number]>
): StartDeviceProjection["deviceAgentCatalog"]["entries"][number] {
	return {
		agentId: input.agentId ?? "codex",
		detected: input.detected ?? true,
		displayName: input.displayName ?? "Codex",
		enabled: input.enabled ?? true,
		launchStatus: input.launchStatus ?? "ready",
		selectable: input.selectable ?? true,
		selectableReason: input.selectableReason ?? null,
		targetKind: input.targetKind ?? "builtin",
	};
}
