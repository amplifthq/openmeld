import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import {
	hasCurrentLocalRuntimeOpenMeldToolsUpdate,
	isOpenMeldToolsComponentUpdateRequired,
} from "./openmeld-tools-update";

export type ComputerAttentionTone = "warning" | "danger";

export type ComputerSummaryStatusTone =
	| "ready"
	| "checking"
	| "warning"
	| "danger"
	| "muted";

export type ComputerSummaryStatusReason =
	| "ready"
	| "checking"
	| "agent_check_failed"
	| "agent_needs_setup"
	| "agent_sign_in_needed"
	| "local_agents_off"
	| "service_not_connected"
	| "openmeld_tools_update"
	| "status_unavailable";

export type ComputerSummaryStatus = {
	label: string;
	localAgent?: {
		agentId: string;
		displayName: string;
	};
	reason: ComputerSummaryStatusReason;
	showLabel: boolean;
	tone: ComputerSummaryStatusTone;
};

type OrganizationComputerServiceState =
	| "connected"
	| "needs_attention"
	| "not_connected"
	| "unknown"
	| null;

const READY_STATUS = {
	label: "OpenMeld Tools are ready",
	reason: "ready",
	showLabel: false,
	tone: "ready",
} as const satisfies ComputerSummaryStatus;

const CHECKING_STATUS = {
	label: "Checking OpenMeld Tools status",
	reason: "checking",
	showLabel: true,
	tone: "checking",
} as const satisfies ComputerSummaryStatus;

const SERVICE_NOT_CONNECTED_STATUS = {
	label: "Computer not connected",
	reason: "service_not_connected",
	showLabel: true,
	tone: "danger",
} as const satisfies ComputerSummaryStatus;

const AGENT_NEEDS_SETUP_STATUS = {
	label: "Local agents need attention",
	reason: "agent_needs_setup",
	showLabel: true,
	tone: "warning",
} as const satisfies ComputerSummaryStatus;

// Signing in to a local agent is a routine, reversible account state, not a
// computer failure. It stays quiet (muted, no rail attention) the same way a
// switched-off local agent does.
const AGENT_SIGN_IN_NEEDED_STATUS = {
	label: "Sign in to a local agent",
	reason: "agent_sign_in_needed",
	showLabel: true,
	tone: "muted",
} as const satisfies ComputerSummaryStatus;

const AGENT_CHECK_FAILED_STATUS = {
	label: "Check delayed",
	reason: "agent_check_failed",
	showLabel: true,
	tone: "warning",
} as const satisfies ComputerSummaryStatus;

const LOCAL_AGENTS_OFF_STATUS = {
	label: "Local agents are off",
	reason: "local_agents_off",
	showLabel: true,
	tone: "muted",
} as const satisfies ComputerSummaryStatus;

const UPDATE_AVAILABLE_STATUS = {
	label: "Update available",
	reason: "openmeld_tools_update",
	showLabel: true,
	tone: "warning",
} as const satisfies ComputerSummaryStatus;

const UPDATE_REQUIRED_STATUS = {
	label: "Update required",
	reason: "openmeld_tools_update",
	showLabel: true,
	tone: "danger",
} as const satisfies ComputerSummaryStatus;

const ORGANIZATION_UPDATE_STATUS = {
	label: "OpenMeld Tools need an update",
	reason: "openmeld_tools_update",
	showLabel: true,
	tone: "warning",
} as const satisfies ComputerSummaryStatus;

const ORGANIZATION_NOT_CONNECTED_STATUS = {
	label: "Computer offline",
	reason: "service_not_connected",
	showLabel: true,
	tone: "muted",
} as const satisfies ComputerSummaryStatus;

const STATUS_UNAVAILABLE = {
	label: "OpenMeld Tools status unavailable",
	reason: "status_unavailable",
	showLabel: true,
	tone: "muted",
} as const satisfies ComputerSummaryStatus;

export function resolveCurrentLocalRuntimeComputerSummaryStatus(input: {
	executionTarget?: LocalRuntimeExecutionTarget | null;
	isReconcilingStatus?: boolean;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined;
}): ComputerSummaryStatus | null {
	const readiness = input.readiness;
	if (!readiness) {
		return input.isReconcilingStatus ? CHECKING_STATUS : null;
	}
	if (isCurrentLocalRuntimeServiceDisconnected(readiness)) {
		return SERVICE_NOT_CONNECTED_STATUS;
	}
	if (
		readiness.primaryBlocker === "service_update_required" ||
		hasRequiredOpenMeldToolsUpdate(readiness)
	) {
		return UPDATE_REQUIRED_STATUS;
	}
	if (hasCurrentLocalRuntimeOpenMeldToolsUpdate(readiness)) {
		return UPDATE_AVAILABLE_STATUS;
	}
	if (readiness.nextAction === "run_setup") {
		return resolveLocalAgentAttentionStatus({
			executionTarget: input.executionTarget ?? null,
			readiness,
		});
	}
	if (input.isReconcilingStatus) {
		return CHECKING_STATUS;
	}
	if (
		readiness.nextAction === "none" &&
		readiness.primaryBlocker === "agent_controller_report_not_ready" &&
		readiness.status === "blocked"
	) {
		return LOCAL_AGENTS_OFF_STATUS;
	}
	if (
		readiness.nextAction === "check_status" &&
		readiness.primaryBlocker === "agent_controller_report_not_ready"
	) {
		return AGENT_CHECK_FAILED_STATUS;
	}
	if (readiness.status === "checking") {
		return CHECKING_STATUS;
	}
	if (readiness.primaryBlocker !== "none") {
		return STATUS_UNAVAILABLE;
	}
	return READY_STATUS;
}

function resolveLocalAgentAttentionStatus(input: {
	executionTarget: LocalRuntimeExecutionTarget | null;
	readiness: CurrentLocalRuntimeReplyReadinessResponse;
}): ComputerSummaryStatus {
	const blockers =
		input.executionTarget?.capabilities.filter(
			(capability) => capability.enabled && capability.status !== "ready"
		) ?? [];
	const blocker = blockers.length === 1 ? blockers[0] : null;
	const localAgent =
		blocker && input.executionTarget
			? resolveComputerSummaryLocalAgent(input.executionTarget, blocker)
			: null;

	if (hasOnlyControllerSignInBlockers(input.readiness)) {
		if (localAgent) {
			return {
				...AGENT_SIGN_IN_NEEDED_STATUS,
				label: `Sign in to ${localAgent.displayName}`,
				localAgent,
			};
		}
		return blockers.length > 1
			? { ...AGENT_SIGN_IN_NEEDED_STATUS, label: "Sign in to local agents" }
			: AGENT_SIGN_IN_NEEDED_STATUS;
	}

	if (blocker && localAgent) {
		if (
			blocker.reasonCodes.includes("controller.launch.choice_required") ||
			blocker.agentControllerInterface?.launch.status === "needs_choice"
		) {
			return {
				...AGENT_NEEDS_SETUP_STATUS,
				label: `Choose a ${localAgent.displayName} installation`,
				localAgent,
			};
		}
		if (
			blocker.reasonCodes.includes("controller.launch.needs_repair") ||
			blocker.agentControllerInterface?.launch.status === "needs_repair"
		) {
			return {
				...AGENT_NEEDS_SETUP_STATUS,
				label: `${localAgent.displayName} can’t start`,
				localAgent,
			};
		}
	}

	return AGENT_NEEDS_SETUP_STATUS;
}

function resolveComputerSummaryLocalAgent(
	executionTarget: LocalRuntimeExecutionTarget,
	capability: LocalRuntimeExecutionTarget["capabilities"][number]
): ComputerSummaryStatus["localAgent"] | null {
	const parsed = parseAgentControllerRef(capability.agentControllerRef);
	if (!parsed) {
		return null;
	}
	const entry = executionTarget.localAgentCatalog.entries.find(
		(candidate) => candidate.agentId === parsed.id
	);
	return entry
		? { agentId: entry.agentId, displayName: entry.displayName }
		: null;
}

export function resolveOrganizationComputerSummaryStatus(
	serviceState: OrganizationComputerServiceState
): ComputerSummaryStatus {
	switch (serviceState) {
		case "connected":
			return READY_STATUS;
		case "needs_attention":
			return ORGANIZATION_UPDATE_STATUS;
		case "not_connected":
			return ORGANIZATION_NOT_CONNECTED_STATUS;
		default:
			return STATUS_UNAVAILABLE;
	}
}

export function resolveComputerAttentionTone(
	status: ComputerSummaryStatus | null | undefined
): ComputerAttentionTone | null {
	return status?.tone === "warning" || status?.tone === "danger"
		? status.tone
		: null;
}

export function resolveCurrentLocalRuntimeComputerAttentionToneForInventory(input: {
	isReconcilingStatus?: boolean;
	localRuntimeCount: number | null | undefined;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined;
}): ComputerAttentionTone | null {
	if (input.localRuntimeCount === 0) {
		return null;
	}
	return resolveComputerAttentionTone(
		resolveCurrentLocalRuntimeComputerSummaryStatus(input)
	);
}

export function resolveCurrentLocalRuntimeComputerSummaryStatusDeviceId(input: {
	isReconcilingStatus?: boolean;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined;
}): string | null {
	if (!resolveCurrentLocalRuntimeComputerSummaryStatus(input)) {
		return null;
	}
	return resolveCurrentLocalRuntimeSubjectDeviceId(input.readiness);
}

export function resolveCurrentLocalRuntimeSubjectDeviceId(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): string | null {
	if (readiness?.currentTarget.availability === "resolved") {
		return readiness.currentTarget.deviceId;
	}
	return readiness?.runtime.deviceId ?? null;
}

export function isCurrentLocalRuntimeServiceDisconnected(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): boolean {
	return (
		readiness.service.connected !== true ||
		readiness.primaryBlocker === "service_not_connected"
	);
}

function hasRequiredOpenMeldToolsUpdate(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): boolean {
	const localComponents = readiness.localComponents;
	if (!localComponents) {
		return false;
	}
	return (
		isOpenMeldToolsComponentUpdateRequired(localComponents.service) ||
		isOpenMeldToolsComponentUpdateRequired(
			(localComponents as Partial<typeof localComponents>).cli
		) ||
		isOpenMeldToolsComponentUpdateRequired(
			(localComponents as Partial<typeof localComponents>).skills
		)
	);
}

function hasOnlyControllerSignInBlockers(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): boolean {
	return readiness.runtime.signInOnlyBlockers === true;
}
