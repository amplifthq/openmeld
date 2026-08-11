import type { CenterAgentTask } from "@openmeld/schemas/types";
import type { StatusTone } from "@openmeld/ui/lib/status-tone";
import { formatCenterAgentInteractionClient } from "#/lib/organizations/center-agent-interaction-source";

export function resolveTaskStatusPresentation(
	task: Pick<CenterAgentTask, "outcome" | "phase" | "state">
): {
	label: string;
	tone: StatusTone;
} {
	switch (task.state) {
		case "active":
			switch (task.phase) {
				case "queued":
					return { label: "Queued", tone: "muted" };
				case "stopping":
					return { label: "Stopping", tone: "muted" };
				case "working":
					return { label: "In progress", tone: "checking" };
				case null:
				case "waiting":
					return { label: "Active", tone: "muted" };
				default:
					return assertNever(task.phase);
			}
		case "needs_action":
			return { label: "Needs action", tone: "warning" };
		case "finished":
			switch (task.outcome) {
				case "completed":
					return { label: "Completed", tone: "ready" };
				case "failed":
					return { label: "Failed", tone: "danger" };
				case "stopped":
					return { label: "Stopped", tone: "muted" };
				case null:
					return { label: "Finished", tone: "muted" };
				default:
					return assertNever(task.outcome);
			}
		default:
			return assertNever(task.state);
	}
}

export function formatTaskOrigin(
	task: Pick<CenterAgentTask, "origin">
): string {
	if (task.origin.kind === "open_meld") {
		return task.origin.localAgent
			? `Started in OpenMeld via ${formatCenterAgentInteractionClient(task.origin.localAgent.client)}`
			: "Started in OpenMeld";
	}
	return `Started from ${formatTaskOriginProvider(task)}`;
}

export function formatTaskRequester(
	task: Pick<CenterAgentTask, "origin">
): string | null {
	return task.origin.requestedBy
		? `Requested by ${task.origin.requestedBy.displayName}`
		: null;
}

export function formatTaskOriginProvider(
	task: Pick<CenterAgentTask, "origin">
): "Feishu" | "Lark" | "Slack" | null {
	if (task.origin.kind === "open_meld") {
		return null;
	}
	const provider = {
		feishu: "Feishu",
		lark: "Lark",
		slack: "Slack",
	} as const;
	return provider[task.origin.destination.provider];
}

function assertNever(value: never): never {
	throw new Error(`Unsupported Center Agent Task status: ${String(value)}`);
}
