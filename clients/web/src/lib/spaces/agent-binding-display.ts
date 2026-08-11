import type {
	AgentProfileBindingDiagnosticPointer,
	AgentProfileBindingDisplayProjection,
	AgentProfileBindingResolutionSource,
	AgentProfileBindingState,
} from "@openmeld/agent-runtime";

export type AgentProfileBindingCanDispatchProjection = {
	value: boolean;
	reasonCodes: readonly string[];
	diagnosticPointer?: AgentProfileBindingCanDispatchDiagnosticPointer;
};

export type AgentProfileBindingCanDispatchDiagnosticPointer = {
	resolutionSource: "dispatch_projection";
	dispatchId: string;
	sourceSignalId: string;
	targetProfileId: string;
	reasonCodes: readonly string[];
};

export type AgentProfileBindingExecutionState =
	| "setup_needed"
	| "enabled"
	| "ready_to_attempt"
	| "unavailable"
	| "compatibility"
	| "conflict"
	| "owner_mismatch";

export type AgentProfileBindingExecutionDisplay = {
	agentProfileId: string;
	executionState: AgentProfileBindingExecutionState;
	membershipState: "unchanged";
	bindingRoutable: boolean;
	dispatchReadiness: "ready_to_attempt" | "blocked" | "unknown";
	primaryLabel: string;
	detail: string;
	reasonCodes: readonly string[];
	resolutionSource: AgentProfileBindingResolutionSource;
	diagnosticPointer: AgentProfileBindingDiagnosticPointer | null;
	dispatchDiagnosticPointer: AgentProfileBindingCanDispatchDiagnosticPointer | null;
};

export function createAgentProfileBindingExecutionDisplay(input: {
	projection: AgentProfileBindingDisplayProjection;
	canDispatch?: AgentProfileBindingCanDispatchProjection;
}): AgentProfileBindingExecutionDisplay {
	const dispatchReadiness = resolveDispatchReadiness(input);
	const executionState = resolveExecutionState({
		bindingState: input.projection.bindingState,
		dispatchReadiness,
	});

	return {
		agentProfileId: input.projection.agentProfileId,
		executionState,
		membershipState: "unchanged",
		bindingRoutable: input.projection.dispatchEligibility.routable,
		dispatchReadiness,
		primaryLabel: formatPrimaryLabel(executionState),
		detail: formatDetail({
			dispatchReadiness,
			executionState,
		}),
		reasonCodes: collectReasonCodes(input),
		resolutionSource: input.projection.resolutionSource,
		diagnosticPointer: input.projection.diagnosticPointer,
		dispatchDiagnosticPointer: input.canDispatch?.diagnosticPointer ?? null,
	};
}

function resolveDispatchReadiness(input: {
	projection: AgentProfileBindingDisplayProjection;
	canDispatch?: AgentProfileBindingCanDispatchProjection;
}): AgentProfileBindingExecutionDisplay["dispatchReadiness"] {
	if (!input.projection.dispatchEligibility.routable) {
		return input.canDispatch?.value === false ? "blocked" : "unknown";
	}
	if (!input.canDispatch) {
		return "unknown";
	}

	return input.canDispatch.value ? "ready_to_attempt" : "blocked";
}

function resolveExecutionState(input: {
	bindingState: AgentProfileBindingState;
	dispatchReadiness: AgentProfileBindingExecutionDisplay["dispatchReadiness"];
}): AgentProfileBindingExecutionState {
	switch (input.bindingState) {
		case "missing":
			return "setup_needed";
		case "enabled_primary":
			return input.dispatchReadiness === "ready_to_attempt"
				? "ready_to_attempt"
				: "enabled";
		case "disabled_historical":
			return "unavailable";
		case "conflict":
			return "conflict";
		case "owner_mismatch":
			return "owner_mismatch";
		default:
			return assertUnreachable(input.bindingState);
	}
}

function formatPrimaryLabel(
	executionState: AgentProfileBindingExecutionState
): string {
	switch (executionState) {
		case "setup_needed":
			return "Execution setup needed";
		case "enabled":
			return "Execution connection enabled";
		case "ready_to_attempt":
			return "Wake can be attempted";
		case "unavailable":
			return "Execution unavailable";
		case "compatibility":
			return "Legacy execution bridge";
		case "conflict":
			return "Execution state conflict";
		case "owner_mismatch":
			return "Execution owner mismatch";
		default:
			return assertUnreachable(executionState);
	}
}

function formatDetail(input: {
	dispatchReadiness: AgentProfileBindingExecutionDisplay["dispatchReadiness"];
	executionState: AgentProfileBindingExecutionState;
}): string {
	switch (input.executionState) {
		case "setup_needed":
			return "This agent can stay in the Space, but execution setup is needed.";
		case "unavailable":
			return "The Agent Profile remains valid, but execution is unavailable.";
		case "compatibility":
			return "This display comes from legacy controller compatibility, not new Binding truth.";
		case "conflict":
			return "Binding projection sources conflict and need diagnostics.";
		case "owner_mismatch":
			return "Binding owner evidence does not match this Runtime.";
		case "enabled":
		case "ready_to_attempt":
			if (input.dispatchReadiness === "unknown") {
				return "Dispatch readiness has not been computed.";
			}
			if (input.dispatchReadiness === "blocked") {
				return "Dispatch projection says Wake should not be attempted right now.";
			}
			return "Dispatch still makes the final execution decision after Wake is attempted.";
		default:
			return assertUnreachable(input.executionState);
	}
}

function collectReasonCodes(input: {
	projection: AgentProfileBindingDisplayProjection;
	canDispatch?: AgentProfileBindingCanDispatchProjection;
}): readonly string[] {
	const reasonCodes = new Set<string>(input.projection.reasonCodes);
	for (const reasonCode of input.canDispatch?.reasonCodes ?? []) {
		reasonCodes.add(reasonCode);
	}
	for (const reasonCode of input.canDispatch?.diagnosticPointer?.reasonCodes ??
		[]) {
		reasonCodes.add(reasonCode);
	}
	if (!input.canDispatch) {
		reasonCodes.add("dispatch.projection_missing");
	}
	if (
		input.canDispatch?.value === true &&
		!input.projection.dispatchEligibility.routable
	) {
		reasonCodes.add("agent_profile_binding.not_routable");
	}
	return [...reasonCodes];
}

function assertUnreachable(value: never): never {
	throw new Error(`Unhandled binding display value: ${String(value)}`);
}
