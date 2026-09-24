import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { formatAgentCreationFailure } from "#/lib/profiles/agent-creation-failure";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";

type PresentedAgentCreation =
	| AgentProfileCreationRequest
	| OptimisticAgentProfileCreation;

export function AgentCreationRequestCard(input: {
	onDismiss?: () => void;
	onReview: () => void;
	request: PresentedAgentCreation;
}) {
	const { request } = input;
	const controller = parseAgentControllerRef(
		request.configuration.agentControllerRef ?? ""
	);
	const controllerLabel = controller
		? formatLocalAgentDisplayName(controller.id)
		: "Agent";
	const summary = [controllerLabel, request.configuration.modelId]
		.filter(Boolean)
		.join(" · ");
	const failed = request.status === "failed";
	const isOptimistic = !("requesterUserId" in request);
	let reviewActionLabel = "View progress";
	if (isOptimistic) {
		reviewActionLabel = "Edit and try again";
	} else if (failed) {
		reviewActionLabel = "Review setup";
	}

	return (
		<article className="space-y-3 rounded-lg border border-border/70 bg-card p-4">
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="truncate font-medium text-sm">
						{request.profileName}
					</h3>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{summary || "Agent setup"}
					</p>
				</div>
				<Badge variant={failed ? "destructive" : "outline"}>
					{failed ? "Needs attention" : requestStatusLabel(request.status)}
				</Badge>
			</div>
			{failed ? (
				<p className="text-destructive text-xs leading-5" role="alert">
					{formatAgentCreationFailure(
						request.failureMessage ?? "Agent setup did not finish."
					)}
				</p>
			) : (
				<output className="flex items-center gap-2 text-muted-foreground text-xs">
					{(request.status === "creating" || request.status === "approved") && (
						<Bars aria-hidden="true" className="h-3 w-4" />
					)}
					{creationStatusDescription(request.status)}
				</output>
			)}
			<div className="flex flex-wrap gap-2">
				{isOptimistic && !failed ? null : (
					<Button onClick={input.onReview} size="sm" type="button">
						{reviewActionLabel}
					</Button>
				)}
				{failed && isOptimistic && input.onDismiss ? (
					<Button
						onClick={input.onDismiss}
						size="sm"
						type="button"
						variant="ghost"
					>
						Dismiss
					</Button>
				) : null}
			</div>
		</article>
	);
}

function requestStatusLabel(status: PresentedAgentCreation["status"]): string {
	if (status === "pending") {
		return "Waiting for approval";
	}
	if (status === "creating") {
		return "Sending request";
	}
	if (status === "completed") {
		return "Agent created";
	}
	if (status === "cancelled") {
		return "Cancelled";
	}
	if (status === "declined") {
		return "Declined";
	}
	return "Creating Agent";
}

function creationStatusDescription(
	status: PresentedAgentCreation["status"]
): string {
	if (status === "pending") {
		return "Creation will continue after approval.";
	}
	if (status === "creating") {
		return "Sending this Agent request.";
	}
	if (status === "completed") {
		return "The Agent is ready.";
	}
	if (status === "cancelled" || status === "declined") {
		return "Review this request in creation history.";
	}
	return "Setup is in progress.";
}
