import {
	REMOTE_AGENT_EXECUTION_CONFIRMATION_PENDING_REASON_CODE,
	WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
	WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE,
} from "@openmeld/schemas";
import type { WakeProgressItem } from "@openmeld/schemas/types";

const LEADING_MENTION_MARKER_PATTERN = /^@/u;

export type WakeProgressStatusKind =
	| "sending"
	| "request_sent"
	| "connecting"
	| "retrying"
	| "queued"
	| "working"
	| "needs_input"
	| "confirmation_pending"
	| "waiting_for_owner"
	| "waiting_for_controller"
	| "waiting_for_device";

export type WakeProgressStatusPresentation = {
	description: string;
	kind: WakeProgressStatusKind;
	label: string;
	status: "active" | "complete" | "failed" | "pending";
};

/** Lower values need attention first. Equal priorities retain Wake order. */
export const WAKE_PROGRESS_STATUS_PRIORITY = {
	needs_input: 0,
	confirmation_pending: 0,
	working: 1,
	sending: 2,
	request_sent: 2,
	connecting: 2,
	retrying: 2,
	queued: 3,
	waiting_for_controller: 3,
	waiting_for_device: 3,
	waiting_for_owner: 3,
} as const satisfies Record<WakeProgressStatusKind, number>;

type PresentableWakeProgress = Pick<
	WakeProgressItem,
	| "pendingInteraction"
	| "phase"
	| "targetLabel"
	| "waitReasonCode"
	| "deviceWait"
	| "failureReasonCode"
>;

/**
 * The one Web-owned semantic presentation for an authoritative Wake snapshot.
 * Surfaces may choose a different density, but must not reinterpret the phase.
 */
export function resolveWakeProgressStatus(
	item: PresentableWakeProgress,
	options: { showTargetName?: boolean } = {}
): WakeProgressStatusPresentation | null {
	// A final outcome takes precedence over interaction/queue evidence retained
	// on the snapshot. That earlier evidence must never revive an ended Wake.
	if (
		item.phase === "failed" ||
		item.phase === "publication_unknown" ||
		item.phase === "replied" ||
		item.phase === "stopped"
	) {
		return null;
	}
	const targetName = formatWakeTargetName(item.targetLabel);
	const showTargetName = options.showTargetName !== false;
	const formatLabel = (text: string, namedText = `${targetName} · ${text}`) =>
		showTargetName ? namedText : text;
	if (
		item.phase === "running" &&
		item.failureReasonCode ===
			REMOTE_AGENT_EXECUTION_CONFIRMATION_PENDING_REASON_CODE
	) {
		return {
			kind: "confirmation_pending",
			label: formatLabel("Result awaiting confirmation"),
			status: "pending",
			description:
				"Later work in this conversation may be waiting. Stop this request to release it once the Agent confirms execution has ended. Do not resend the original request.",
		};
	}
	if (
		item.deviceWait &&
		(item.phase === "request_sent" || item.phase === "queued")
	) {
		return resolveDeviceWaitStatus(
			item.deviceWait,
			showTargetName ? targetName : null
		);
	}
	if (item.pendingInteraction) {
		return item.pendingInteraction.canRespond
			? {
					description: "The Agent is waiting for your response.",
					kind: "needs_input",
					label: formatLabel(
						"Needs your input",
						`${targetName} needs your input`
					),
					status: "pending",
				}
			: {
					description: "The Agent is waiting for its owner to respond.",
					kind: "waiting_for_owner",
					label: formatLabel(
						"Waiting for the owner",
						`${targetName} is waiting for its owner`
					),
					status: "pending",
				};
	}

	if (
		item.waitReasonCode ===
		WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
	) {
		return {
			description: "Another app is using this conversation.",
			kind: "waiting_for_controller",
			label: formatLabel("Waiting for another app"),
			status: "active",
		};
	}

	if (item.waitReasonCode === WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE) {
		return {
			description:
				"Another task on this computer is using the same folder. This task has not started and starts when that task finishes.",
			kind: "queued",
			label: formatLabel("Waiting for another task in its folder"),
			status: "pending",
		};
	}

	switch (item.phase) {
		case "sending":
			return {
				description: "OpenMeld is sending the request to the Agent.",
				kind: "sending",
				label: formatLabel("Sending request…"),
				status: "pending",
			};
		case "request_sent":
			return {
				description:
					"The request has been sent. Agent execution is not yet confirmed.",
				kind: "request_sent",
				label: formatLabel("Waiting to start…"),
				status: "pending",
			};
		case "connecting":
			return {
				description:
					"OpenMeld is connecting to the Agent. Execution is not yet confirmed.",
				kind: "connecting",
				label: formatLabel("Connecting…"),
				status: "pending",
			};
		case "retrying":
			return {
				description: "OpenMeld is retrying delivery of the request.",
				kind: "retrying",
				label: formatLabel("Retrying delivery…"),
				status: "pending",
			};
		case "running":
		case "writing":
		case "publishing":
			return presentWorkingStatus(item.targetLabel, options);
		case "queued":
			return {
				description: "The Agent will start when its earlier work finishes.",
				kind: "queued",
				label: formatLabel("Waiting for earlier tasks"),
				status: "active",
			};
		default: {
			const _exhaustive: never = item.phase;
			return _exhaustive;
		}
	}
}

/** Shared appearance for confirmed Agent work or an admitted live reply stream. */
export function presentWorkingStatus(
	targetLabel: string,
	options: { showTargetName?: boolean } = {}
): WakeProgressStatusPresentation {
	return {
		description: "The request is in progress.",
		kind: "working",
		label:
			options.showTargetName === false
				? "Working…"
				: `${formatWakeTargetName(targetLabel)} · Working…`,
		status: "active",
	};
}

function formatWakeTargetName(targetLabel: string): string {
	const normalized = targetLabel
		.trim()
		.replace(LEADING_MENTION_MARKER_PATTERN, "");
	return normalized && !normalized.startsWith("agt_") ? normalized : "Agent";
}

function resolveDeviceWaitStatus(
	wait: NonNullable<WakeProgressItem["deviceWait"]>,
	targetName: string | null
): WakeProgressStatusPresentation {
	let label = `${targetName ? `${targetName} · ` : ""}Waiting for earlier tasks`;
	let reason = "Earlier work must finish first.";
	if (wait.reason === "device_offline") {
		label = `Waiting for ${targetName ? `${targetName}’s` : "the"} computer to come online`;
		reason = "The computer is offline.";
	} else if (wait.reason === "agent_not_ready") {
		label = `Waiting for ${targetName ?? "the Agent"} to become ready`;
		reason = "OpenMeld has not confirmed that the Agent is ready to run.";
	} else if (wait.reason === "access_check_unavailable") {
		label = targetName
			? `Waiting to verify access for ${targetName}`
			: "Waiting to verify access";
		reason =
			"OpenMeld could not verify current Space access. It will check again before starting.";
	} else if (wait.reason === "service_draining") {
		label = `Waiting for ${targetName ?? "the Agent"} to accept new work`;
		reason =
			"OpenMeld on this computer is finishing existing work and is not accepting new tasks yet.";
	}
	return {
		kind: wait.reason === "earlier_work" ? "queued" : "waiting_for_device",
		label,
		description: `${reason} No work has started. Waiting expires ${new Date(wait.deadlineAtMs).toLocaleString()}.`,
		status: "pending",
	};
}
