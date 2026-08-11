import {
	type PrepareReadinessDisplayState,
	type PrepareReadinessProjection,
	resolvePrepareReadinessSummary,
} from "@openmeld/agent-runtime";
import { formatWebCliCommand } from "#/lib/cli-entry-command";

export type StartShellPrepareProjectionStatus =
	| "ready"
	| "pending"
	| "unavailable"
	| "needs_prepare"
	| "needs_repair"
	| "unknown";

export type StartShellAllRunnableCapabilitiesPreparedProjection = {
	value: boolean | null;
	status: "prepared" | "not_prepared" | "partial" | "unknown";
	runnableCapabilityCount?: number;
	preparedCapabilityCount?: number;
	reasonCodes: readonly string[];
};

export type StartShellRuntimeReadinessProjection = {
	status:
		| "ready"
		| "pending"
		| "unavailable"
		| "needs_prepare"
		| "needs_repair"
		| "stale"
		| "unknown";
	openMeldServiceRuntimeId?: string;
	deviceId?: string;
	lane?: "openmeld" | "openmeld-dev" | "openmeld-canary" | string;
	displayName?: string;
	lastPreparedAt?: string;
	lastHeartbeatAt?: string;
	reasonCodes: readonly string[];
};

export type StartShellCapabilityReadinessProjection = {
	agentControllerRef?: string;
	displayName: string;
	source?: "builtin" | "custom" | "provider" | "agent_registry" | "unknown";
	status:
		| "ready"
		| "pending"
		| "disabled"
		| "unavailable"
		| "needs_auth"
		| "needs_install"
		| "needs_repair"
		| "unsupported_lane"
		| "unknown";
	reasonCodes: readonly string[];
	diagnosticPointer?: StartShellPrepareProjectionDiagnosticPointer;
};

export type StartShellServiceReadinessProjection = {
	status:
		| "running"
		| "starting"
		| "not_running"
		| "not_installed"
		| "needs_repair"
		| "unavailable"
		| "unknown";
	displayName?: string;
	installedVersion?: string;
	expectedVersion?: string;
	reasonCodes: readonly string[];
	diagnosticPointer?: StartShellPrepareProjectionDiagnosticPointer;
};

export type StartShellPrepareProjectionSource =
	| "runtime_projection"
	| "prepare_attempt"
	| "start_handoff_bridge"
	| "historical_local_agent_preparation_bridge"
	| "unavailable"
	| "unknown";

export type StartShellPrepareProjectionDiagnosticPointer = {
	type: "prepare_projection";
	source: StartShellPrepareProjectionSource;
	correlationId?: string;
	prepareAttemptId?: string;
	openMeldServiceRuntimeId?: string;
	deviceId?: string;
	lane?: string;
	startSessionId?: string;
	agentControllerRefs?: readonly string[];
	reasonCodes: readonly string[];
	observedAt?: string;
	traceCommandDisplay?: string;
};

export type StartShellPrepareProjectionNextStep = {
	kind:
		| "none"
		| "wait"
		| "run_prepare"
		| "repair_service"
		| "authenticate"
		| "install_capability"
		| "retry"
		| "contact_support";
	label: string;
	commandDisplay?: {
		command: string;
		copyable: boolean;
		requiresFreshToken?: boolean;
	};
	blocksContinue: boolean;
	reasonCodes: readonly string[];
	diagnosticPointer?: StartShellPrepareProjectionDiagnosticPointer;
};

export type StartShellPrepareProjectionForDisplay = {
	projectionStatus: StartShellPrepareProjectionStatus;
	allRunnableCapabilitiesPrepared: StartShellAllRunnableCapabilitiesPreparedProjection;
	runtimeReadiness: StartShellRuntimeReadinessProjection;
	capabilityStatuses: readonly StartShellCapabilityReadinessProjection[];
	serviceReadiness: StartShellServiceReadinessProjection;
	reasonCodes: readonly string[];
	diagnosticPointer?: StartShellPrepareProjectionDiagnosticPointer;
	nextSteps?: readonly StartShellPrepareProjectionNextStep[];
	observedAt?: string;
	expiresAt?: string;
	source: StartShellPrepareProjectionSource;
};

export type StartShellPrepareReadinessState = PrepareReadinessDisplayState;

export type StartShellPrepareReadinessDisplay = {
	state: StartShellPrepareReadinessState;
	statusLabel: string;
	summary: string;
	allRunnableCapabilitiesPrepared: boolean | null;
	reasonCodes: readonly string[];
	diagnosticPointer: StartShellPrepareProjectionDiagnosticPointer | null;
	commandDisplay: {
		command: string;
		copyable: boolean;
		requiresFreshToken?: boolean;
	} | null;
	source: StartShellPrepareProjectionSource;
};

export function createStartShellPrepareReadinessDisplay(
	projection: StartShellPrepareProjectionForDisplay | null
): StartShellPrepareReadinessDisplay {
	const sharedSummary = resolvePrepareReadinessSummary(
		toSharedPrepareReadinessProjection(projection)
	);
	const state = sharedSummary.displayState;
	return {
		state,
		statusLabel: formatPrepareReadinessStatusLabel(state),
		summary: formatPrepareReadinessSummary({
			state,
		}),
		allRunnableCapabilitiesPrepared:
			projection?.allRunnableCapabilitiesPrepared.value ?? null,
		reasonCodes: sharedSummary.reasonCodes,
		diagnosticPointer: projection
			? resolvePrepareDiagnosticPointer(projection)
			: null,
		commandDisplay: projection
			? resolvePrepareCommandDisplay(projection)
			: null,
		source: projection?.source ?? "unknown",
	};
}

function toSharedPrepareReadinessProjection(
	projection: StartShellPrepareProjectionForDisplay | null
): PrepareReadinessProjection | null {
	if (!projection) {
		return null;
	}

	const projectionStatus = resolveSharedPrepareProjectionStatus(projection);
	return {
		projectionStatus,
		allRunnableCapabilitiesPrepared: {
			status: projection.allRunnableCapabilitiesPrepared.status,
		},
		serviceReadiness: {
			status: projection.serviceReadiness.status,
		},
		reasonCodes: collectPrepareProjectionReasonCodes({
			projection,
			projectionStatus,
		}),
		observedAt: projection.observedAt,
		expiresAt: projection.expiresAt,
		nextSteps: projection.nextSteps?.map((step) => ({ kind: step.kind })),
	};
}

function resolveSharedPrepareProjectionStatus(
	projection: StartShellPrepareProjectionForDisplay
): PrepareReadinessProjection["projectionStatus"] {
	if (
		projection.runtimeReadiness.status === "stale" ||
		isPrepareProjectionExpired(projection.expiresAt)
	) {
		return "stale";
	}

	return projection.projectionStatus;
}

function isPrepareProjectionExpired(expiresAt: string | undefined): boolean {
	if (!expiresAt) {
		return false;
	}

	const expiresAtMs = Date.parse(expiresAt);
	return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

function collectPrepareProjectionReasonCodes(input: {
	projection: StartShellPrepareProjectionForDisplay;
	projectionStatus: PrepareReadinessProjection["projectionStatus"];
}): readonly string[] {
	const reasonCodes = new Set<string>();

	for (const reasonCode of input.projection.reasonCodes) {
		reasonCodes.add(reasonCode);
	}
	for (const reasonCode of input.projection.allRunnableCapabilitiesPrepared
		.reasonCodes) {
		reasonCodes.add(reasonCode);
	}
	for (const reasonCode of input.projection.runtimeReadiness.reasonCodes) {
		reasonCodes.add(reasonCode);
	}
	for (const reasonCode of input.projection.serviceReadiness.reasonCodes) {
		reasonCodes.add(reasonCode);
	}
	for (const capability of input.projection.capabilityStatuses) {
		for (const reasonCode of capability.reasonCodes) {
			reasonCodes.add(reasonCode);
		}
	}
	if (input.projectionStatus === "stale") {
		reasonCodes.add("runtime.projection_stale");
	}

	return [...reasonCodes];
}

function formatPrepareReadinessStatusLabel(
	state: StartShellPrepareReadinessState
): string {
	switch (state) {
		case "ready":
			return "Local agents connected";
		case "pending":
			return "Local agent setup pending";
		case "unavailable":
			return "Local agent setup unavailable";
		case "needs_prepare":
			return "Local agent setup needed";
		case "needs_repair":
			return "Repair needed";
		case "stale":
			return "Local agent setup stale";
		case "unknown":
			return "Local agent setup unknown";
		default:
			return assertUnreachable(state);
	}
}

function formatPrepareReadinessSummary(input: {
	state: StartShellPrepareReadinessState;
}): string {
	switch (input.state) {
		case "ready":
			return "All local agents are connected on this computer.";
		case "pending":
			return "OpenMeld is waiting for the latest local agent setup result from this computer.";
		case "unavailable":
			return "OpenMeld cannot read the local agent setup status for this computer right now.";
		case "needs_prepare":
			return "This computer needs setup before local agents can be used.";
		case "needs_repair":
			return "This computer needs repair before local agents can be used.";
		case "stale":
			return "The latest local agent setup status for this computer is stale.";
		case "unknown":
			return "OpenMeld cannot confirm local agent capability for this computer yet.";
		default:
			return assertUnreachable(input.state);
	}
}

function resolvePrepareDiagnosticPointer(
	projection: StartShellPrepareProjectionForDisplay
): StartShellPrepareProjectionDiagnosticPointer | null {
	const diagnosticPointer =
		projection.diagnosticPointer ??
		projection.serviceReadiness.diagnosticPointer ??
		projection.capabilityStatuses.find(
			(capability) => capability.diagnosticPointer
		)?.diagnosticPointer ??
		projection.nextSteps?.find((step) => step.diagnosticPointer)
			?.diagnosticPointer ??
		null;
	if (!diagnosticPointer) {
		return null;
	}

	return {
		...diagnosticPointer,
		...(diagnosticPointer.traceCommandDisplay
			? {
					traceCommandDisplay: formatPrepareProjectionCommand(
						diagnosticPointer.traceCommandDisplay,
						projection
					),
				}
			: {}),
	};
}

function resolvePrepareCommandDisplay(
	projection: StartShellPrepareProjectionForDisplay
): StartShellPrepareReadinessDisplay["commandDisplay"] {
	const commandDisplay = projection.nextSteps?.find(
		(step) => step.commandDisplay
	)?.commandDisplay;
	if (!commandDisplay) {
		return null;
	}

	return {
		...commandDisplay,
		command: formatPrepareProjectionCommand(commandDisplay.command, projection),
	};
}

function formatPrepareProjectionCommand(
	command: string,
	projection: StartShellPrepareProjectionForDisplay
): string {
	return formatWebCliCommand(command, {
		runtimeLane: projection.runtimeReadiness.lane,
	});
}

function assertUnreachable(value: never): never {
	throw new Error(
		`Unhandled prepare readiness display value: ${String(value)}`
	);
}
