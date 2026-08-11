import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import {
	hasCurrentLocalRuntimeOpenMeldToolsUpdate,
	isOpenMeldToolsComponentUpdateRequired,
} from "./openmeld-tools-update";

export type SettingsAttentionReason =
	| "agent_needs_setup"
	| "service_not_connected"
	| "openmeld_tools_update";

export type SettingsAttentionTone = "warning" | "danger";

export type SettingsAttention = {
	label: string;
	reason: SettingsAttentionReason;
	tone: SettingsAttentionTone;
};

export type CurrentLocalRuntimeServiceConnectionStatus =
	| "connected"
	| "not_connected";

const SERVICE_NOT_CONNECTED_ATTENTION = {
	label: "OpenMeld Service is not connected",
	reason: "service_not_connected",
	tone: "danger",
} as const satisfies SettingsAttention;

const AGENT_NEEDS_SETUP_ATTENTION = {
	label: "Local agents need repair",
	reason: "agent_needs_setup",
	tone: "danger",
} as const satisfies SettingsAttention;

const OPENMELD_TOOLS_UPDATE_AVAILABLE_ATTENTION = {
	label: "Update available",
	reason: "openmeld_tools_update",
	tone: "warning",
} as const satisfies SettingsAttention;

const OPENMELD_TOOLS_UPDATE_REQUIRED_ATTENTION = {
	label: "Update required",
	reason: "openmeld_tools_update",
	tone: "danger",
} as const satisfies SettingsAttention;

export function resolveCurrentLocalRuntimeSettingsAttention(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): SettingsAttention | null {
	if (!readiness) {
		return null;
	}
	if (isCurrentLocalRuntimeServiceDisconnected(readiness)) {
		return SERVICE_NOT_CONNECTED_ATTENTION;
	}
	if (
		readiness.nextAction === "run_setup" &&
		!isOnlyIncompleteControllerCheck(readiness)
	) {
		return AGENT_NEEDS_SETUP_ATTENTION;
	}
	const openMeldToolsUpdateAttention =
		resolveOpenMeldToolsUpdateSettingsAttention(readiness);
	if (openMeldToolsUpdateAttention) {
		return openMeldToolsUpdateAttention;
	}
	return null;
}

function isOnlyIncompleteControllerCheck(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): boolean {
	return (
		readiness.primaryBlocker === "agent_controller_report_not_ready" &&
		readiness.runtime.reasonCodes.length > 0 &&
		readiness.runtime.reasonCodes.every(
			(reasonCode) => reasonCode === "controller.interface.check_failed"
		)
	);
}

export function hasCurrentLocalRuntimeSettingsAttention(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): boolean {
	return resolveCurrentLocalRuntimeSettingsAttention(readiness) !== null;
}

export function resolveCurrentLocalRuntimeSettingsAttentionTone(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): SettingsAttentionTone | null {
	return resolveCurrentLocalRuntimeSettingsAttention(readiness)?.tone ?? null;
}

export function resolveCurrentLocalRuntimeSettingsAttentionToneForInventory(input: {
	localRuntimeCount: number | null | undefined;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined;
}): SettingsAttentionTone | null {
	if (input.localRuntimeCount === 0) {
		return null;
	}
	return resolveCurrentLocalRuntimeSettingsAttentionTone(input.readiness);
}

export function resolveCurrentLocalRuntimeSettingsAttentionDeviceId(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): string | null {
	if (!resolveCurrentLocalRuntimeSettingsAttention(readiness)) {
		return null;
	}
	return resolveCurrentLocalRuntimeSubjectDeviceId(readiness);
}

export function resolveCurrentLocalRuntimeSubjectDeviceId(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): string | null {
	if (readiness?.currentTarget.availability === "resolved") {
		return readiness.currentTarget.deviceId;
	}
	return readiness?.runtime.deviceId ?? null;
}

export function isCurrentLocalRuntimeServiceConnected(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): boolean {
	return readiness?.service.connected === true;
}

export function resolveCurrentLocalRuntimeServiceConnectionStatus(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): CurrentLocalRuntimeServiceConnectionStatus | null {
	if (!readiness) {
		return null;
	}
	return isCurrentLocalRuntimeServiceConnected(readiness)
		? "connected"
		: "not_connected";
}

export function isCurrentLocalRuntimeServiceDisconnected(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): boolean {
	return (
		readiness.service.connected !== true ||
		readiness.primaryBlocker === "service_not_connected"
	);
}

function resolveOpenMeldToolsUpdateSettingsAttention(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): SettingsAttention | null {
	if (hasRequiredOpenMeldToolsUpdate(readiness)) {
		return OPENMELD_TOOLS_UPDATE_REQUIRED_ATTENTION;
	}
	if (hasCurrentLocalRuntimeOpenMeldToolsUpdate(readiness)) {
		return OPENMELD_TOOLS_UPDATE_AVAILABLE_ATTENTION;
	}
	return null;
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
