import {
	createAgentProfileBindingDisplayProjection,
	resolveAgentExecutionStatus,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import { createAgentExecutionStatusDisplay } from "./agent-execution-status-display";

describe("Web agent execution status display", () => {
	it("renders ready from the shared reply status projection", () => {
		const display = createAgentExecutionStatusDisplay({
			projection: resolveAgentExecutionStatus({
				agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
				binding: createAgentProfileBindingDisplayProjection({
					agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
					bindingId: "bind_11111111-1111-4111-8111-111111111111",
					bindingState: "enabled_primary",
					executionTarget: {
						agentControllerRef: "builtin:codex",
						openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
					},
				}),
				runtimeReadiness: {
					displayState: "ready",
					ready: true,
					reasonCodes: ["runtime.ready"],
				},
				route: {
					deviceId: "dev_felix_macbook_pro",
					observedAt: "2026-05-10T12:00:00.000Z",
					status: "online",
				},
			}),
		});

		expect(display).toMatchObject({
			state: "ready",
			summary: "This agent can reply from this computer.",
		});
		expect(display.rows).toContainEqual({
			label: "Connection",
			value: "Local agent connection is set.",
		});
		expect(display.rows).toContainEqual({
			label: "Reply route",
			value: "OpenMeld Service is online for replies.",
		});
	});

	it("renders a missing local connection as not ready even when local readiness is ready", () => {
		const display = createAgentExecutionStatusDisplay({
			projection: resolveAgentExecutionStatus({
				agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
				runtimeReadiness: {
					displayState: "ready",
					ready: true,
					reasonCodes: ["runtime.ready"],
				},
			}),
		});

		expect(display).toMatchObject({
			state: "not_ready",
			summary: "This agent is not connected to a local agent yet.",
			truthBoundary: {
				grantsBindingTruth: false,
				grantsClaimSuccess: false,
				grantsDispatchRouting: false,
				grantsRuntimeTruth: false,
				startsRuntimeExecution: false,
			},
		});
		expect(display.rows).toContainEqual({
			label: "Connection",
			value: "Choose a local agent for this profile.",
		});
	});

	it("fails closed on local connection mismatch and unavailable evidence", () => {
		const mismatch = createAgentExecutionStatusDisplay({
			projection: resolveAgentExecutionStatus({
				agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
				binding: createAgentProfileBindingDisplayProjection({
					agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
					bindingId: "bind_33333333-3333-4333-8333-333333333333",
					bindingState: "enabled_primary",
					executionTarget: {
						agentControllerRef: "builtin:codex",
						openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
					},
				}),
				runtimeReadiness: {
					displayState: "ready",
					ready: true,
					reasonCodes: ["runtime.ready"],
				},
			}),
		});
		expect(mismatch).toMatchObject({
			state: "blocked",
			summary: "This local connection belongs to a different agent profile.",
			truthBoundary: {
				grantsClaimSuccess: false,
				startsRuntimeExecution: false,
			},
		});

		const unavailable = createAgentExecutionStatusDisplay({
			projection: resolveAgentExecutionStatus({
				agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
				binding: {
					reasonCodes: ["agent_profile_binding.read_unavailable"],
					status: "unavailable",
				},
			}),
		});
		expect(unavailable.rows).toContainEqual({
			label: "Connection",
			value: "OpenMeld could not check this agent's local connection.",
		});
	});

	it("renders claim diagnostics without implying Runtime execution success", () => {
		const display = createAgentExecutionStatusDisplay({
			projection: resolveAgentExecutionStatus({
				agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
				binding: createAgentProfileBindingDisplayProjection({
					agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
					bindingId: "bind_55555555-5555-4555-8555-555555555555",
					bindingState: "enabled_primary",
					executionTarget: {
						agentControllerRef: "builtin:codex",
						openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
					},
				}),
				claimDiagnostics: {
					reasonCodes: ["execution_authority.missing"],
					status: "rejected",
				},
				route: {
					deviceId: "dev_felix_macbook_pro",
					observedAt: "2026-05-10T12:00:00.000Z",
					status: "online",
				},
				runtimeReadiness: {
					displayState: "ready",
					ready: true,
					reasonCodes: ["runtime.ready"],
				},
			}),
		});

		expect(display).toMatchObject({
			state: "blocked",
			summary: "Wake execution authority is missing.",
		});
		expect(display.truthBoundary).toMatchObject({
			grantsClaimSuccess: false,
			startsRuntimeExecution: false,
		});
		expect(display.rows).toContainEqual({
			label: "Wake",
			value: "Wake execution authority is missing.",
		});
	});
});
