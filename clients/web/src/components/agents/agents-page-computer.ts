import type {
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { useEffect, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { resolveConnectedLocalRuntime } from "#/lib/connect/connected-runtime";
import { mapCurrentLocalRuntimeReplyReadinessQueryState } from "#/lib/connect/current-local-runtime-readiness";
import {
	formatDeviceType,
	formatPlatform,
	formatRuntimeLane,
} from "./agents-page-formatters";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;
type DeviceAgentCatalogEntry =
	LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"][number];

export const SHOW_RUNTIME_LANE_TO_USER = import.meta.env.DEV;
const computerTabObservedFormatter = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
});

export type ComputerRecordState =
	| {
			kind: "normal";
	  }
	| {
			kind: "older_same_name_record";
	  };

export function useSelectedComputerTab(input: {
	devices: readonly LocalRuntimeComputer[];
	preferredDeviceId: string | null;
}) {
	const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
		input.preferredDeviceId
	);

	useEffect(() => {
		if (input.devices.length === 0) {
			if (selectedDeviceId !== null) {
				setSelectedDeviceId(null);
			}
			return;
		}

		const selectedStillExists = input.devices.some(
			(device) => device.deviceId === selectedDeviceId
		);
		if (selectedStillExists) {
			return;
		}

		const preferredDevice =
			input.preferredDeviceId === null
				? null
				: input.devices.find(
						(device) => device.deviceId === input.preferredDeviceId
					);
		setSelectedDeviceId(
			(preferredDevice ?? input.devices[0] ?? null)?.deviceId ?? null
		);
	}, [input.devices, input.preferredDeviceId, selectedDeviceId]);

	return [selectedDeviceId, setSelectedDeviceId] as const;
}

export function resolveSelectedComputerIndex(input: {
	devices: readonly LocalRuntimeComputer[];
	selectedDeviceId: string | null;
}): number {
	if (input.devices.length === 0) {
		return -1;
	}

	const selectedIndex = input.devices.findIndex(
		(device) => device.deviceId === input.selectedDeviceId
	);
	return selectedIndex === -1 ? 0 : selectedIndex;
}

export function isSelectedCurrentComputer(input: {
	computer: LocalRuntimeComputer;
	recovery: AgentsPageController;
}): boolean {
	// Whether this computer is the account's connected/current one is a
	// ServiceRuntime liveness question, not a Binding one: a freshly connected
	// computer with no Agent Profile bound yet must still render the rich
	// "Connected" OpenMeld Service view. The resolved Computer groups rotated
	// device identities behind one stable connectedComputerId.
	const connectedComputer = resolveConnectedLocalRuntime(input.recovery);
	if (connectedComputer === null) {
		return false;
	}
	if (
		connectedComputer.connectedComputerId &&
		input.computer.connectedComputerId
	) {
		return (
			connectedComputer.connectedComputerId ===
			input.computer.connectedComputerId
		);
	}
	return connectedComputer.deviceId === input.computer.deviceId;
}

export function resolveSelectedComputerReplyReadiness(input: {
	computer: LocalRuntimeComputer;
	isCurrentComputer: boolean;
	recovery: AgentsPageController;
}): ComputerReplyReadiness | null {
	if (!input.isCurrentComputer) {
		return null;
	}
	if (
		!(
			input.recovery.currentLocalRuntimeReplyReadinessQuery.isPending ||
			input.recovery.currentLocalRuntimeReplyReadinessQuery.data
		)
	) {
		return null;
	}

	return mapCurrentLocalRuntimeReplyReadinessQueryState({
		isFetching:
			input.recovery.currentLocalRuntimeReplyReadinessQuery.isFetching,
		isPending: input.recovery.currentLocalRuntimeReplyReadinessQuery.isPending,
		readiness: input.recovery.currentLocalRuntimeReplyReadinessQuery.data,
	});
}

export function resolveEffectiveSelectedComputerReplyReadiness(input: {
	hasAvailableAgentProfile: boolean;
	hasPendingAgentProfileReadiness: boolean;
	replyReadiness: ComputerReplyReadiness | null;
}): ComputerReplyReadiness | null {
	if (input.replyReadiness === null) {
		return null;
	}

	if (!isStaleServiceDisconnectReason(input.replyReadiness.reasonCode)) {
		return input.replyReadiness;
	}

	if (input.hasAvailableAgentProfile) {
		return {
			...input.replyReadiness,
			reasonCode: "ready",
			status: "ready",
		};
	}

	if (hasCurrentRuntimeSessionMissingEvidence(input.replyReadiness)) {
		return input.replyReadiness;
	}

	if (!input.hasPendingAgentProfileReadiness) {
		return input.replyReadiness;
	}

	return {
		...input.replyReadiness,
		reasonCode: "start_state.checking",
		status: "checking",
	};
}

function isStaleServiceDisconnectReason(
	reasonCode: ComputerReplyReadiness["reasonCode"]
): boolean {
	return (
		reasonCode === "background_helper.not_running" ||
		reasonCode === "current_device.missing" ||
		reasonCode === "device_projection.missing" ||
		reasonCode === "device_reply_readiness.unknown"
	);
}

function hasCurrentRuntimeSessionMissingEvidence(
	replyReadiness: ComputerReplyReadiness
): boolean {
	return (
		replyReadiness.detailReasonCode ===
			"service.current_runtime_session_missing" ||
		replyReadiness.detailReasonCode === "daemon.session.not_found"
	);
}

export function resolveCurrentExecutionTarget(
	computer: LocalRuntimeComputer
): LocalRuntimeExecutionTarget | null {
	return (
		computer.executionTargets.find((target) => target.isCurrent) ??
		computer.executionTargets[0] ??
		null
	);
}

export function formatComputerTabPlatform(
	computer: LocalRuntimeComputer
): string {
	const executionTarget = resolveCurrentExecutionTarget(computer);
	const deviceType = formatDeviceType(computer.deviceType);
	const platform = formatPlatform(computer.platformFamily, computer.osVersion);
	const lane =
		SHOW_RUNTIME_LANE_TO_USER && executionTarget
			? formatRuntimeLane(executionTarget.runtimeLane)
			: null;
	const details = [deviceType, platform, lane].filter(Boolean);
	if (details.length === 0) {
		return "Computer";
	}
	return details.join(" · ");
}

export function formatComputerTabLastSeen(input: {
	recordState: ComputerRecordState;
	value: number | null;
}): string {
	if (input.value === null) {
		return "No recent check-in";
	}

	const date = new Date(input.value);
	if (Number.isNaN(date.getTime())) {
		return "No recent check-in";
	}

	const formatted = computerTabObservedFormatter.format(date);
	return input.recordState.kind === "older_same_name_record"
		? `Older record · Last seen ${formatted}`
		: `Last seen ${formatted}`;
}

export function formatComputerTabLocalAgents(
	executionTarget: LocalRuntimeExecutionTarget | null
): string {
	if (executionTarget === null) {
		return "No local agents";
	}
	const activeLocalAgentCount =
		executionTarget.localAgentCatalog.entries.filter(
			isComputerTabLocalAgentSummaryEntry
		).length;
	if (activeLocalAgentCount > 0) {
		return `${activeLocalAgentCount} ${
			activeLocalAgentCount === 1 ? "local agent" : "local agents"
		}`;
	}
	if (executionTarget.status === "stale") {
		return "Needs a fresh check";
	}
	if (executionTarget.status === "not_ready") {
		return "Unavailable";
	}
	return "No local agents";
}

function isComputerTabLocalAgentSummaryEntry(
	entry: DeviceAgentCatalogEntry
): boolean {
	return (
		entry.detected && entry.selectable && entry.lifecycleStatus !== "suspended"
	);
}

export function resolveComputerRecordState(input: {
	device: LocalRuntimeComputer;
	devices: readonly LocalRuntimeComputer[];
}): ComputerRecordState {
	if (input.device.isCurrent) {
		return { kind: "normal" };
	}

	const currentSameNameDevice = input.devices.find(
		(device) =>
			device.isCurrent &&
			device.deviceId !== input.device.deviceId &&
			normalizeComputerDisplayName(device.deviceDisplayName) ===
				normalizeComputerDisplayName(input.device.deviceDisplayName)
	);
	if (!currentSameNameDevice) {
		return { kind: "normal" };
	}

	if (hasReadyExecutionTarget(input.device)) {
		return { kind: "normal" };
	}

	const currentObservedAt = resolveComputerObservedAt(currentSameNameDevice);
	const deviceObservedAt = resolveComputerObservedAt(input.device);
	if (currentObservedAt === null || deviceObservedAt === null) {
		return { kind: "older_same_name_record" };
	}

	return deviceObservedAt < currentObservedAt
		? { kind: "older_same_name_record" }
		: { kind: "normal" };
}

export function formatComputerTabAriaLabel(input: {
	device: LocalRuntimeComputer;
	recordState: ComputerRecordState;
}): string {
	return input.recordState.kind === "older_same_name_record"
		? `${input.device.deviceDisplayName}, older record`
		: input.device.deviceDisplayName;
}

function normalizeComputerDisplayName(value: string): string {
	return value.trim().toLowerCase();
}

function hasReadyExecutionTarget(device: LocalRuntimeComputer): boolean {
	return device.executionTargets.some(
		(target) => target.status === "ready" || target.status === "partial"
	);
}

function resolveComputerObservedAt(
	device: LocalRuntimeComputer
): number | null {
	const deviceObservedAt = normalizeObservedAtMs(device.lastObservedAtMs);
	if (deviceObservedAt !== null) {
		return deviceObservedAt;
	}

	let latestTargetObservedAt: number | null = null;
	for (const target of device.executionTargets) {
		const targetObservedAt = normalizeObservedAtMs(target.lastObservedAtMs);
		if (
			targetObservedAt !== null &&
			(latestTargetObservedAt === null ||
				targetObservedAt > latestTargetObservedAt)
		) {
			latestTargetObservedAt = targetObservedAt;
		}
	}
	return latestTargetObservedAt;
}

function normalizeObservedAtMs(value: number | null): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatComputerDialogDevice(
	computer: LocalRuntimeComputer
): string {
	const deviceType = formatDeviceType(computer.deviceType);
	const platform = formatPlatform(computer.platformFamily, computer.osVersion);
	const details = [deviceType, platform].filter(Boolean);
	return details.length > 0 ? details.join(" · ") : "Computer";
}

export function formatComputerDialogLane(
	computer: LocalRuntimeComputer
): string {
	const executionTarget = resolveCurrentExecutionTarget(computer);
	return executionTarget
		? formatRuntimeLane(executionTarget.runtimeLane)
		: "None";
}

export function formatComputerReplyReadinessDescription(
	replyReadiness: ComputerReplyReadiness
): string {
	if (replyReadiness.status === "ready") {
		return "OpenMeld Service is connected on this computer.";
	}
	if (
		replyReadiness.reasonCode === "background_helper.update_required" ||
		replyReadiness.reasonCode === "background_helper.installed_outdated"
	) {
		return "Update OpenMeld Service before this computer receives local Wake work.";
	}
	if (replyReadiness.reasonCode === "background_helper.not_running") {
		return "Reconnect OpenMeld Service so this computer can receive local Wake work.";
	}
	if (replyReadiness.status === "checking") {
		return "OpenMeld is checking this computer's local service link.";
	}
	if (replyReadiness.status === "needs_setup") {
		return "Connect OpenMeld Service so this computer can report local agents.";
	}
	return "OpenMeld could not confirm this computer's local service link yet.";
}
