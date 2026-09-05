import type {
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import { AVAILABILITY_DISPLAY_LABELS } from "#/lib/availability-display";

export function formatDeviceType(
	deviceType: LocalRuntimeComputer["deviceType"]
): string {
	switch (deviceType) {
		case "desktop":
			return "Desktop";
		case "laptop":
			return "Laptop";
		case "server":
			return "Server";
		case "unknown":
			return "";
		default:
			return "";
	}
}

export function formatPlatform(
	platformFamily: LocalRuntimeComputer["platformFamily"],
	osVersion: string | null
): string {
	return osVersion ? `${platformFamily} ${osVersion}` : platformFamily;
}

export function formatObservedAt(value: number | string | null): string {
	if (value === null) {
		return "unknown";
	}

	const date = typeof value === "number" ? new Date(value) : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "unknown";
	}

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

export function formatCheckedAt(
	value: string | null | undefined,
	nowMs = Date.now()
): string | null {
	if (!value) {
		return null;
	}
	const checkedAtMs = new Date(value).getTime();
	if (!Number.isFinite(checkedAtMs)) {
		return null;
	}
	const elapsedMs = Math.max(0, nowMs - checkedAtMs);
	const minuteMs = 60_000;
	const hourMs = 60 * minuteMs;
	const dayMs = 24 * hourMs;
	if (elapsedMs < minuteMs) {
		return "Checked just now";
	}
	if (elapsedMs < hourMs) {
		const minutes = Math.floor(elapsedMs / minuteMs);
		return `Checked ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
	}
	if (elapsedMs < dayMs) {
		const hours = Math.floor(elapsedMs / hourMs);
		return `Checked ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
	}
	const days = Math.floor(elapsedMs / dayMs);
	return `Checked ${days} ${days === 1 ? "day" : "days"} ago`;
}

export function formatRuntimeLane(runtimeLane: string): string {
	if (runtimeLane === "dev-local") {
		return "Dev";
	}
	if (runtimeLane === "canary") {
		return "Canary";
	}
	if (runtimeLane === "prod") {
		return "Production";
	}
	return runtimeLane;
}

export function formatExecutionTargetStatus(
	status: LocalRuntimeExecutionTarget["status"]
): string {
	switch (status) {
		case "ready":
			return AVAILABILITY_DISPLAY_LABELS.available;
		case "partial":
			return AVAILABILITY_DISPLAY_LABELS.partial;
		case "not_ready":
			return AVAILABILITY_DISPLAY_LABELS.unavailable;
		case "stale":
			return "Needs a fresh check";
		case "unknown":
			return AVAILABILITY_DISPLAY_LABELS.checking;
		default:
			return AVAILABILITY_DISPLAY_LABELS.checking;
	}
}

export function createExecutionTargetKey(
	target: LocalRuntimeExecutionTarget
): string {
	return `${target.deviceId}:${target.runtimeLane}:${target.openMeldServiceRuntimeId?.value ?? "runtime-missing"}`;
}

export function formatListForSentence(values: readonly string[]): string {
	const uniqueValues = Array.from(
		new Set(
			values.map((value) => value.trim()).filter((value) => value.length > 0)
		)
	);
	if (uniqueValues.length === 0) {
		return "another Agent Profile";
	}
	if (uniqueValues.length === 1) {
		return uniqueValues[0] ?? "another Agent Profile";
	}
	if (uniqueValues.length === 2) {
		return `${uniqueValues[0]} and ${uniqueValues[1]}`;
	}
	const finalValue = uniqueValues.at(-1);
	const leadingValues = uniqueValues.slice(0, -1);
	return `${leadingValues.join(", ")}, and ${finalValue}`;
}

export function getMutationErrorMessage(error: unknown): string | null {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return null;
}

export function formatMutationError(error: unknown, fallback: string): string {
	return getMutationErrorMessage(error) ?? fallback;
}

const LOCAL_AGENT_CONTROL_TIMEOUT_STATUS = 504;

// Local-agent control work can outlive the gateway request budget and surface as
// an HTTP 504 even though OpenMeld Service keeps applying it. Treat that outcome
// as still running and reconcile from the canonical catalog. An explicit Service
// rejection (HTTP 409) is a real failure and is deliberately excluded.
export function isLocalAgentControlStillRunningError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const { code, status } = error as { code?: unknown; status?: unknown };
	return (
		status === LOCAL_AGENT_CONTROL_TIMEOUT_STATUS ||
		code === "local_agent_control.timeout" ||
		code === "network.timeout"
	);
}

export function isAgentProfileAlreadyRemovedError(error: unknown): boolean {
	const message = getMutationErrorMessage(error);
	if (!message) {
		return false;
	}
	return (
		message === "Agent Profile was already removed." ||
		message === "Failed to remove agent profile: 404"
	);
}

export function normalizeOptionalText(
	value: string | null | undefined
): string | null {
	const normalizedValue = value?.trim() ?? "";
	return normalizedValue.length > 0 ? normalizedValue : null;
}
