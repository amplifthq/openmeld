import { isAgentProfileLocalReadinessRefreshReasonCode } from "@openmeld/agent-profile";
import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import {
	createAgentProfileBindingApi,
	createPrepareReadinessApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { formatLocalSetupActionLabel } from "@openmeld/schemas";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AgentProfileBindingSessionInventorySelection,
	DaemonServiceLane,
} from "@openmeld/schemas/types";
import { sleep } from "@openmeld/utils";
import {
	createOrganizationScopedWebOpenMeldApiFoundation,
	createUnscopedWebOpenMeldApiFoundation,
} from "#/lib/openmeld-api/client";

const AGENT_CONTROLLER_REPORT_BINDING_MAX_ATTEMPTS = 5;
const AGENT_CONTROLLER_REPORT_BINDING_RETRY_DELAY_MS = 1500;

type RuntimeReadinessFailureReason =
	| "device_unavailable"
	| "runtime_readiness_unavailable";

type PrepareReadinessResponse = Awaited<
	ReturnType<ReturnType<typeof createPrepareReadinessApi>["getReadiness"]>
>;

export type WebAgentProfileRuntimeReadinessResult =
	| {
			agentControllerRef: string;
			deviceId: string;
			lane: string;
			reasonCodes: readonly string[];
			routable: true;
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority";
				value: string;
			};
			status: "accepted";
	  }
	| {
			agentControllerRef?: string;
			reason: RuntimeReadinessFailureReason;
			reasonCodes: readonly string[];
			routable: false;
			status: "unavailable";
	  };

export type EnsureWebAgentProfileRuntimeBindingResult =
	| {
			agentControllerRef: string;
			deviceId: string;
			lane: string;
			outcome: "created" | "reused" | "reconnected";
			reasonCodes: readonly string[];
			routable: true;
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority";
				value: string;
			};
			status: "accepted";
	  }
	| {
			agentControllerRef?: string;
			reason:
				| "binding_rejected"
				| "binding_unavailable"
				| RuntimeReadinessFailureReason;
			reasonCodes: readonly string[];
			routable: false;
			status: "rejected" | "unavailable";
	  };

export async function checkWebAgentProfileRuntimeReadiness(input: {
	actorProfileId?: string | null;
	agentControllerRef: string;
	deviceId: string | null;
	runtimeLane: DaemonServiceLane | null;
}): Promise<WebAgentProfileRuntimeReadinessResult> {
	const deviceId = normalizeRequiredIdentifier(input.deviceId);
	if (!deviceId) {
		return {
			reason: "device_unavailable",
			reasonCodes: ["agent_profile_binding.device_unavailable"],
			routable: false,
			status: "unavailable",
		};
	}
	const runtimeLane = normalizeRequiredIdentifier(input.runtimeLane);
	if (!runtimeLane) {
		return {
			reason: "runtime_readiness_unavailable",
			reasonCodes: ["agent_profile_binding.runtime_lane_unavailable"],
			routable: false,
			status: "unavailable",
		};
	}

	const agentControllerRef = resolveBindingAgentControllerRef({
		agentControllerRef: input.agentControllerRef,
	});
	if (!agentControllerRef) {
		return {
			reason: "runtime_readiness_unavailable",
			reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
			routable: false,
			status: "unavailable",
		};
	}

	try {
		const foundation = createUnscopedWebOpenMeldApiFoundation({
			...(input.actorProfileId
				? { openMeldProfileId: input.actorProfileId }
				: {}),
		});
		const readiness = await createPrepareReadinessApi(foundation).getReadiness({
			agentControllerRefs: [agentControllerRef],
			deviceId,
			lane: runtimeLane,
		});
		if (
			readiness.status !== "ready" ||
			!readiness.summary.ready ||
			!hasAuthorityRunnableBindingCapability({ agentControllerRef, readiness })
		) {
			return {
				agentControllerRef,
				reason: "runtime_readiness_unavailable",
				reasonCodes: [
					...new Set([
						"agent_profile_binding.runtime_readiness_unavailable",
						...readiness.summary.reasonCodes,
						...collectTargetCapabilityReasonCodes({
							agentControllerRef,
							readiness,
						}),
					]),
				],
				routable: false,
				status: "unavailable",
			};
		}

		const openMeldServiceRuntimeId = readiness.openMeldServiceRuntimeId;
		if (!openMeldServiceRuntimeId) {
			return {
				agentControllerRef,
				reason: "runtime_readiness_unavailable",
				reasonCodes: ["agent_profile_binding.runtime_readiness_unavailable"],
				routable: false,
				status: "unavailable",
			};
		}
		return {
			agentControllerRef,
			deviceId,
			lane: runtimeLane,
			reasonCodes: readiness.summary.reasonCodes,
			routable: true,
			openMeldServiceRuntimeId,
			status: "accepted",
		};
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		return {
			agentControllerRef,
			reason: "runtime_readiness_unavailable",
			reasonCodes: [
				failure.code
					? `agent_profile_binding.${failure.code}`
					: "agent_profile_binding.runtime_readiness_unavailable",
			],
			routable: false,
			status: "unavailable",
		};
	}
}

export async function ensureWebAgentProfileRuntimeBinding(input: {
	actorProfileId?: string | null;
	agentControllerConversationId?: string | null;
	agentProfileId: string;
	agentControllerCollaborationMode?: AgentControllerCollaborationMode | null;
	agentControllerPermissionMode?: AgentControllerPermissionMode | null;
	agentControllerRef: string;
	deviceId: string | null;
	modelId?: string | null;
	openCodePermission?: AgentProfileBindingOpenCodePermission | null;
	organizationId: string;
	reasoningLevel?: string | null;
	runtimeLane: DaemonServiceLane | null;
	sessionInventorySelection?: AgentProfileBindingSessionInventorySelection;
	writeMode?: "ensure" | "reconnect";
}): Promise<EnsureWebAgentProfileRuntimeBindingResult> {
	const readinessResult = await checkWebAgentProfileRuntimeReadiness(input);
	if (readinessResult.status !== "accepted") {
		return readinessResult;
	}

	try {
		const foundation = createBindingApiFoundation(input);
		const agentProfileBindingApi = createAgentProfileBindingApi(foundation);
		const modelId = normalizeOptionalBindingText(input.modelId);
		const reasoningLevel = modelId
			? normalizeOptionalBindingText(input.reasoningLevel)
			: null;
		const agentControllerConversationId = normalizeOptionalBindingText(
			input.agentControllerConversationId
		);
		const bindingRequest = {
			agentProfileId: input.agentProfileId,
			...(input.agentControllerCollaborationMode
				? {
						agentControllerCollaborationMode:
							input.agentControllerCollaborationMode,
					}
				: {}),
			...(input.agentControllerPermissionMode
				? { agentControllerPermissionMode: input.agentControllerPermissionMode }
				: {}),
			agentControllerRef: readinessResult.agentControllerRef,
			...(agentControllerConversationId
				? {
						agentControllerConversationId,
					}
				: {}),
			deviceId: readinessResult.deviceId,
			lane: readinessResult.lane,
			openMeldServiceRuntimeId: readinessResult.openMeldServiceRuntimeId,
			...(modelId ? { modelId } : {}),
			...(reasoningLevel ? { reasoningLevel } : {}),
			...(input.openCodePermission
				? { openCodePermission: input.openCodePermission }
				: {}),
			...toSessionInventorySelectionRequestFields(
				input.sessionInventorySelection
			),
			...(input.writeMode ? { writeMode: input.writeMode } : {}),
		};
		let binding =
			await agentProfileBindingApi.ensurePrimaryBinding(bindingRequest);
		for (
			let attempt = 1;
			attempt < AGENT_CONTROLLER_REPORT_BINDING_MAX_ATTEMPTS &&
			shouldRetryAgentControllerReportBindingRejection(binding);
			attempt++
		) {
			await sleep(AGENT_CONTROLLER_REPORT_BINDING_RETRY_DELAY_MS);
			binding =
				await agentProfileBindingApi.ensurePrimaryBinding(bindingRequest);
		}
		if (binding.status !== "accepted") {
			return {
				agentControllerRef: readinessResult.agentControllerRef,
				reason: "binding_rejected",
				reasonCodes: binding.reasonCodes,
				routable: false,
				status: "rejected",
			};
		}
		if (!binding.outcome) {
			return {
				agentControllerRef: readinessResult.agentControllerRef,
				reason: "binding_unavailable",
				reasonCodes: ["agent_profile_binding.write_unavailable"],
				routable: false,
				status: "unavailable",
			};
		}

		return {
			agentControllerRef: readinessResult.agentControllerRef,
			deviceId: readinessResult.deviceId,
			lane: readinessResult.lane,
			outcome: binding.outcome,
			reasonCodes: binding.reasonCodes,
			routable: true,
			openMeldServiceRuntimeId: readinessResult.openMeldServiceRuntimeId,
			status: "accepted",
		};
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		return {
			agentControllerRef: readinessResult.agentControllerRef,
			reason: "binding_unavailable",
			reasonCodes: [
				failure.code
					? `agent_profile_binding.${failure.code}`
					: "agent_profile_binding.write_unavailable",
			],
			routable: false,
			status: "unavailable",
		};
	}
}

function createBindingApiFoundation(input: {
	actorProfileId?: string | null;
	organizationId: string;
}) {
	const actor = input.actorProfileId
		? { openMeldProfileId: input.actorProfileId }
		: {};
	return createOrganizationScopedWebOpenMeldApiFoundation({
		...actor,
		organizationId: input.organizationId,
	});
}

function toSessionInventorySelectionRequestFields(
	selection: AgentProfileBindingSessionInventorySelection | undefined
): {
	sessionInventorySelection?: AgentProfileBindingSessionInventorySelection;
} {
	return selection ? { sessionInventorySelection: selection } : {};
}

export function formatWebAgentProfileRuntimeBindingFailure(
	result: Exclude<
		EnsureWebAgentProfileRuntimeBindingResult,
		{ status: "accepted" }
	>
): string {
	if (result.reason === "device_unavailable") {
		return "Connect your computer before connecting that local agent.";
	}
	if (hasServiceUpdateRequiredReason(result)) {
		return "Update OpenMeld on your computer before connecting that local agent.";
	}
	if (
		result.reason === "binding_rejected" &&
		result.reasonCodes.includes(
			"agent_profile_binding.member_agent_harness_locked"
		)
	) {
		return "This Agent Profile belongs to an Agent and can't move to another harness. Create a Profile under that harness's Agent instead.";
	}
	if (
		result.reason === "binding_rejected" &&
		hasAgentControllerReportBindingReason(result)
	) {
		return "This computer hasn't reported that this local agent is ready yet. Reconnect the computer, then try again.";
	}
	if (hasLocalReadinessRefreshReason(result)) {
		return "Connect local agent after OpenMeld refreshes this computer's local agent list.";
	}
	if (
		result.reason === "binding_rejected" &&
		result.reasonCodes.includes(
			"agent_profile_binding.controller_change_blocked_active_execution"
		)
	) {
		return "This Agent is still working. Wait for the current Wake to finish before changing its Controller.";
	}
	if (
		result.reason === "binding_rejected" &&
		result.reasonCodes.includes(
			"agent_profile_binding.controller_change_eligibility_unavailable"
		)
	) {
		return "OpenMeld couldn’t confirm whether this Agent is working. Try changing its Controller again.";
	}
	if (
		result.reason === "binding_rejected" &&
		result.reasonCodes.includes(
			"agent_profile_binding.session_resume_unavailable"
		)
	) {
		return "This Session changed or is no longer available to resume. Refresh Agent Activity and choose it again.";
	}
	if (result.reason === "binding_rejected") {
		return "OpenMeld could not save this local agent connection. Connect the local agent again.";
	}
	return "OpenMeld could not confirm this computer can use that local agent. Connect the local agent again.";
}

export function formatWebAgentProfileRuntimeBindingFailureActionLabel(
	result:
		| Exclude<EnsureWebAgentProfileRuntimeBindingResult, { status: "accepted" }>
		| Exclude<WebAgentProfileRuntimeReadinessResult, { status: "accepted" }>
): string {
	if (hasServiceUpdateRequiredReason(result)) {
		return formatLocalSetupActionLabel("update_service");
	}
	if (result.reason === "device_unavailable") {
		return formatLocalSetupActionLabel("connect_service");
	}
	return formatLocalSetupActionLabel("connect_local_agent");
}

export function formatWebAgentProfileRuntimeReadinessFailure(
	result: Exclude<WebAgentProfileRuntimeReadinessResult, { status: "accepted" }>
): string {
	return formatWebAgentProfileRuntimeBindingFailure(result);
}

export function shouldOfferWebAgentProfileSetupRefresh(
	result:
		| Exclude<EnsureWebAgentProfileRuntimeBindingResult, { status: "accepted" }>
		| Exclude<WebAgentProfileRuntimeReadinessResult, { status: "accepted" }>
): boolean {
	return (
		result.reason === "device_unavailable" ||
		result.reason === "runtime_readiness_unavailable" ||
		hasLocalReadinessRefreshReason(result) ||
		hasServiceUpdateRequiredReason(result)
	);
}

function resolveBindingAgentControllerRef(input: {
	agentControllerRef: string;
}): string | null {
	return parseAgentControllerRef(input.agentControllerRef)?.ref ?? null;
}

function hasAuthorityRunnableBindingCapability(input: {
	agentControllerRef: string;
	readiness: PrepareReadinessResponse;
}): input is {
	agentControllerRef: string;
	readiness: PrepareReadinessResponse & {
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority";
			value: string;
		};
	};
} {
	if (
		input.readiness.openMeldServiceRuntimeId?.source !==
		"runtime_registry_authority"
	) {
		return false;
	}
	return input.readiness.runnableCapabilities.some(
		(capability) =>
			capability.agentControllerRef === input.agentControllerRef &&
			capability.status === "ready"
	);
}

function normalizeRequiredIdentifier(
	value: string | null | undefined
): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalBindingText(
	value: string | null | undefined
): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function collectTargetCapabilityReasonCodes(input: {
	agentControllerRef: string;
	readiness: PrepareReadinessResponse;
}): string[] {
	const reasonCodes: string[] = [];
	for (const capability of [
		...input.readiness.runnableCapabilities,
		...input.readiness.nonRunnableCapabilities,
	]) {
		if (capability.agentControllerRef === input.agentControllerRef) {
			reasonCodes.push(...capability.reasonCodes);
		}
	}
	return reasonCodes;
}

function hasLocalReadinessRefreshReason(result: {
	reasonCodes: readonly string[];
}): boolean {
	return result.reasonCodes.some(isAgentProfileLocalReadinessRefreshReasonCode);
}

function shouldRetryAgentControllerReportBindingRejection(result: {
	reasonCodes: readonly string[];
	status: string;
}): boolean {
	return (
		result.status === "rejected" &&
		hasAgentControllerReportBindingReason(result)
	);
}

function hasAgentControllerReportBindingReason(result: {
	reasonCodes: readonly string[];
}): boolean {
	return result.reasonCodes.some(
		(reasonCode) =>
			reasonCode === "agent_profile_binding.agent_controller_report_missing" ||
			reasonCode === "agent_profile_binding.agent_controller_report_stale"
	);
}

function hasServiceUpdateRequiredReason(result: {
	reasonCodes: readonly string[];
}): boolean {
	return result.reasonCodes.some((reasonCode) =>
		[
			"background_helper.update_required",
			"daemon.runtime_contract.mismatch",
			"service.update_required",
		].includes(reasonCode)
	);
}
