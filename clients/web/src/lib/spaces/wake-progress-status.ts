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
	| "waiting_for_controller";

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
	waiting_for_owner: 3,
} as const satisfies Record<WakeProgressStatusKind, number>;

type PresentableWakeProgress = Pick<
	WakeProgressItem,
	"pendingInteraction" | "phase" | "targetLabel" | "waitReasonCode"
>;

/**
 * The one Web-owned semantic presentation for an authoritative Wake snapshot.
 * Surfaces may choose a different density, but must not reinterpret the phase.
 */
export function resolveWakeProgressStatus(
	item: PresentableWakeProgress
): WakeProgressStatusPresentation | null {
	const targetName = formatWakeTargetName(item.targetLabel);
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
				"This Wake will start when the Agent’s current task finishes.",
			kind: "waiting_for_controller",
			label: `Waiting for ${targetName}’s current task`,
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
				description: "OpenMeld is opening the Agent’s runtime.",
				kind: "connecting",
				label: `Connecting to ${targetName}…`,
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
				label: `Posting reply from ${targetName}…`,
				status: "active",
			};
		case "retrying":
			return {
				description: "OpenMeld is retrying delivery.",
				kind: "retrying",
				label: `Trying to reach ${targetName}…`,
				status: "active",
			};
		case "failed":
		case "publication_unknown":
		case "replied":
		case "stopped":
			return null;
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
	return normalized || "Agent";
}
