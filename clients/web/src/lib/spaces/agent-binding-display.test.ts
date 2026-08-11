import { createAgentProfileBindingDisplayProjection } from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import { createAgentProfileBindingExecutionDisplay } from "./agent-binding-display";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const CLAIMED_RESERVED_OR_CLAIM_SUCCESS_WORD_PATTERN =
	/claimed|reserved|claim success/i;

describe("agent profile binding execution display", () => {
	it("treats missing binding as action needed instead of routable execution", () => {
		const projection = createAgentProfileBindingDisplayProjection({
			agentProfileId: AGENT_PROFILE_ID,
			bindingState: "missing",
		});

		expect(
			createAgentProfileBindingExecutionDisplay({ projection })
		).toMatchObject({
			agentProfileId: AGENT_PROFILE_ID,
			executionState: "setup_needed",
			membershipState: "unchanged",
			bindingRoutable: false,
			dispatchReadiness: "unknown",
			detail:
				"This agent can stay in the Space, but execution setup is needed.",
		});
	});

	it("treats disabled binding as execution unavailable instead of invalid profile", () => {
		const projection = createAgentProfileBindingDisplayProjection({
			agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
			bindingId: "binding-1",
			bindingState: "disabled_historical",
			executionTarget: {
				openMeldServiceRuntimeId: "runtime-1",
				agentControllerRef: "builtin:codex",
			},
		});

		expect(
			createAgentProfileBindingExecutionDisplay({
				projection,
				canDispatch: {
					value: false,
					reasonCodes: ["dispatch.blocked"],
				},
			})
		).toMatchObject({
			executionState: "unavailable",
			membershipState: "unchanged",
			bindingRoutable: false,
			dispatchReadiness: "blocked",
		});
	});

	it("keeps canDispatch absence as unknown instead of claim-ready", () => {
		const projection = createAgentProfileBindingDisplayProjection({
			agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
			bindingId: "binding-2",
			bindingState: "enabled_primary",
			executionTarget: {
				openMeldServiceRuntimeId: "runtime-1",
				agentControllerRef: "builtin:codex",
			},
		});

		expect(
			createAgentProfileBindingExecutionDisplay({ projection })
		).toMatchObject({
			executionState: "enabled",
			bindingRoutable: true,
			dispatchReadiness: "unknown",
			dispatchDiagnosticPointer: null,
			detail: "Dispatch readiness has not been computed.",
		});
	});

	it("keeps Dispatch diagnostic evidence separate from Binding diagnostic evidence", () => {
		const targetProfileId = "agt_77777777-7777-4777-8777-777777777777";
		const projection = createAgentProfileBindingDisplayProjection({
			agentProfileId: targetProfileId,
			bindingId: "binding-7",
			bindingState: "enabled_primary",
			executionTarget: {
				openMeldServiceRuntimeId: "runtime-7",
				agentControllerRef: "builtin:codex",
			},
		});

		const display = createAgentProfileBindingExecutionDisplay({
			projection,
			canDispatch: {
				value: false,
				reasonCodes: ["dispatch.blocked"],
				diagnosticPointer: {
					resolutionSource: "dispatch_projection",
					dispatchId: "dispatch-7",
					sourceSignalId: "signal-7",
					targetProfileId,
					reasonCodes: ["dispatch.blocked"],
				},
			},
		});

		expect(display.diagnosticPointer).toMatchObject({
			agentProfileId: targetProfileId,
			bindingId: "binding-7",
			resolutionSource: "binding_truth",
		});
		expect(display.dispatchDiagnosticPointer).toMatchObject({
			resolutionSource: "dispatch_projection",
			dispatchId: "dispatch-7",
			sourceSignalId: "signal-7",
			targetProfileId,
			reasonCodes: ["dispatch.blocked"],
		});
	});

	it("does not present canDispatch=true as claimed or reserved execution", () => {
		const projection = createAgentProfileBindingDisplayProjection({
			agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
			bindingId: "binding-2",
			bindingState: "enabled_primary",
			executionTarget: {
				openMeldServiceRuntimeId: "runtime-1",
				agentControllerRef: "builtin:codex",
			},
		});

		const display = createAgentProfileBindingExecutionDisplay({
			projection,
			canDispatch: {
				value: true,
				reasonCodes: ["dispatch.can_attempt"],
			},
		});

		expect(display).toMatchObject({
			executionState: "ready_to_attempt",
			bindingRoutable: true,
			dispatchReadiness: "ready_to_attempt",
			primaryLabel: "Wake can be attempted",
		});
		expect(`${display.primaryLabel} ${display.detail}`).not.toMatch(
			CLAIMED_RESERVED_OR_CLAIM_SUCCESS_WORD_PATTERN
		);
		expect(display.detail).toContain(
			"Dispatch still makes the final execution decision"
		);
	});

	it.each([
		{ bindingState: "conflict" as const, executionState: "conflict" },
		{
			bindingState: "owner_mismatch" as const,
			executionState: "owner_mismatch",
		},
	])("keeps $bindingState visible and not routable", (input) => {
		const projection = createAgentProfileBindingDisplayProjection(
			input.bindingState === "owner_mismatch"
				? {
						agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
						bindingId: "binding-3",
						bindingState: input.bindingState,
						executionTarget: {
							openMeldServiceRuntimeId: "runtime-2",
							agentControllerRef: "builtin:codex",
						},
					}
				: {
						agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
						bindingState: input.bindingState,
					}
		);

		expect(
			createAgentProfileBindingExecutionDisplay({ projection })
		).toMatchObject({
			executionState: input.executionState,
			bindingRoutable: false,
			dispatchReadiness: "unknown",
			membershipState: "unchanged",
		});
	});

	it("keeps missing Binding out of Binding truth and Dispatch routing", () => {
		const projection = createAgentProfileBindingDisplayProjection({
			agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
			bindingState: "missing",
		});
		const display = createAgentProfileBindingExecutionDisplay({ projection });

		expect(display).toMatchObject({
			executionState: "setup_needed",
			bindingRoutable: false,
			dispatchReadiness: "unknown",
		});
		expect(display.reasonCodes).toContain("agent_profile_binding.missing");
	});
});
