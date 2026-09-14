import { WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE } from "@openmeld/schemas";
import type { WakeProgressItem } from "@openmeld/schemas/types";

const LEADING_MENTION_MARKER_PATTERN = /^@/u;

export type WakeProgressStatusKind =
	| "starting"
	| "sent"
	| "queued"
	| "connecting"
	| "working"
	| "replying"
	| "posting"
	| "retrying"
	| "needs_input"
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
	working: 1,
	replying: 1,
	posting: 1,
	starting: 2,
	sent: 2,
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
>;

/**
 * The one Web-owned semantic presentation for an authoritative Wake snapshot.
 * Surfaces may choose a different density, but must not reinterpret the phase.
 */
export function resolveWakeProgressStatus(
	item: PresentableWakeProgress
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
	if (
		item.deviceWait &&
		(item.phase === "request_sent" || item.phase === "queued")
	) {
		return resolveDeviceWaitStatus(item.deviceWait, targetName);
	}
	if (item.pendingInteraction) {
		return item.pendingInteraction.canRespond
			? {
					description: "The Agent is waiting for your response.",
					kind: "needs_input",
					label: `${targetName} needs your input`,
					status: "pending",
				}
			: {
					description: "The Agent is waiting for its owner to respond.",
					kind: "waiting_for_owner",
					label: `${targetName} is waiting for its owner`,
					status: "pending",
				};
	}

	if (
		item.waitReasonCode ===
		WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
	) {
		return {
			description:
				"Another client holds this Agent’s session. This Wake is waiting for the session to become available.",
			kind: "waiting_for_controller",
			label: `Waiting for ${targetName}’s session`,
			status: "active",
		};
	}

	switch (item.phase) {
		case "sending":
			return {
				description: "OpenMeld is preparing this Wake.",
				kind: "starting",
				label: `Starting Wake for ${targetName}…`,
				status: "active",
			};
		case "request_sent":
			return {
				description: "OpenMeld accepted the Wake request.",
				kind: "sent",
				label: `Wake sent to ${targetName}`,
				status: "active",
			};
		case "queued":
			return {
				description: "This Wake will start when the Agent is available.",
				kind: "queued",
				label: `${targetName} is queued`,
				status: "active",
			};
		case "connecting":
			return {
				description:
					"Your message is saved. OpenMeld is preparing the Agent to run it.",
				kind: "connecting",
				label: `Preparing ${targetName}…`,
				status: "active",
			};
		case "running":
			return {
				description: "The Agent is working on this Wake.",
				kind: "working",
				label: `${targetName} is working`,
				status: "active",
			};
		case "writing":
			return {
				description: "The Agent has started its reply.",
				kind: "replying",
				label: `${targetName} is replying`,
				status: "active",
			};
		case "publishing":
			return {
				description: "The Agent finished and OpenMeld is posting the reply.",
				kind: "posting",
				label: `${targetName} · Posting reply…`,
				status: "active",
			};
		case "retrying":
			return {
				description: "OpenMeld is retrying delivery.",
				kind: "retrying",
				label: `Trying to reach ${targetName}…`,
				status: "active",
			};
		default: {
			const _exhaustive: never = item.phase;
			return _exhaustive;
		}
	}
}

function formatWakeTargetName(targetLabel: string): string {
	const normalized = targetLabel
		.trim()
		.replace(LEADING_MENTION_MARKER_PATTERN, "");
	return normalized && !normalized.startsWith("agt_") ? normalized : "Agent";
}

function resolveDeviceWaitStatus(
	wait: NonNullable<WakeProgressItem["deviceWait"]>,
	targetName: string
): WakeProgressStatusPresentation {
	let label = `${targetName} is queued`;
	let reason = "Earlier work must finish first.";
	if (wait.reason === "device_offline") {
		label = `Waiting for ${targetName}’s computer to come online`;
		reason = "The computer is offline.";
	} else if (wait.reason === "agent_not_ready") {
		label = `Waiting for ${targetName} to become ready`;
		reason = "OpenMeld has not confirmed that the Agent is ready to run.";
	} else if (wait.reason === "access_check_unavailable") {
		label = `Waiting to verify access for ${targetName}`;
		reason =
			"OpenMeld could not verify current Space access. It will check again before starting.";
	} else if (wait.reason === "service_draining") {
		label = `Waiting for ${targetName} to accept new work`;
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
