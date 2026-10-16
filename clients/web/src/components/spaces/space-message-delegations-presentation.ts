import type {
	SpaceMessageDelegatedTask,
	SpaceMessageDelegations,
} from "@openmeld/schemas/types";

export function delegatedTaskStatus(child: SpaceMessageDelegatedTask): string {
	if (child.availability !== "readable") {
		return "Unavailable";
	}
	if (child.outcome) {
		return {
			succeeded: "Completed",
			completed: "Completed",
			failed: "Failed",
			stopped: "Stopped",
			stayed_silent: "Finished without a reply",
			publication_failed: "Reply failed",
		}[child.outcome.status];
	}
	if (child.progress?.pendingInteraction) {
		return "Waiting for owner input";
	}
	if (child.progress) {
		return {
			sending: "Sending",
			request_sent: "Waiting to start",
			queued: "Queued",
			connecting: "Connecting",
			running: "Running",
			writing: "Preparing reply",
			publishing: "Reply pending",
			publication_unknown: "Publication unconfirmed",
			retrying: "Retrying delivery",
			failed: "Failed",
			stopped: "Stopped",
			replied: "Completed",
		}[child.progress.phase];
	}
	if (child.coordinationState === "planned") {
		return "Planned";
	}
	if (child.coordinationState === "skipped") {
		return "Not needed";
	}
	if (child.coordinationState === "cancelled") {
		return "Cancellation requested";
	}
	return "Status unavailable";
}

export function delegatedWorkSummary(
	delegations: SpaceMessageDelegations
): string {
	const children = delegations.groups.flatMap((group) => group.children);
	const counts = new Map<string, number>();
	for (const child of children) {
		const status = delegatedTaskStatus(child).toLowerCase();
		counts.set(status, (counts.get(status) ?? 0) + 1);
	}
	return [...counts].map(([status, count]) => `${count} ${status}`).join(" · ");
}

export function delegationCompletionLabel(
	group: SpaceMessageDelegations["groups"][number],
	coordinatorName: string
): string {
	if (group.completionPolicy.mode === "child_reports_directly") {
		return "Each Agent reports its own result directly.";
	}
	const condition = {
		all_terminal: "after all delegated tasks finish, including failures",
		first_success: "after the first successful task",
		on_failure: "if a delegated task fails",
		on_each_terminal: "after each delegated task finishes",
	}[group.completionPolicy.when];
	return `${coordinatorName} owns the follow-up ${condition}.`;
}
