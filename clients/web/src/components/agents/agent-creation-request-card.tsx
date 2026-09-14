import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { formatAgentCreationFailure } from "#/lib/profiles/agent-creation-failure";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";

type PresentedAgentCreation =
	| AgentProfileCreationRequest
	| OptimisticAgentProfileCreation;

export function AgentCreationRequestCard(input: {
	onDismiss?: () => void;
	onModify: () => void;
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
		reviewActionLabel = "Review and retry";
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
				<CreationProgress status={request.status} />
			)}
			<div className="flex flex-wrap gap-2">
				{isOptimistic && !failed ? null : (
					<Button onClick={input.onReview} size="sm" type="button">
						{reviewActionLabel}
					</Button>
				)}
				{failed && !isOptimistic ? (
					<Button
						onClick={input.onModify}
						size="sm"
						type="button"
						variant="outline"
					>
						Modify
					</Button>
				) : null}
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

function CreationProgress(input: { status: PresentedAgentCreation["status"] }) {
	const steps = (() => {
		if (input.status === "creating") {
			return [
				"Creating Agent",
				"Connecting local agent",
				"Checking Wake availability",
			];
		}
		if (input.status === "pending") {
			return ["Request accepted", "Waiting for approval", "Creating Agent"];
		}
		return ["Request accepted", "Creating Agent", "Checking Wake availability"];
	})();
	const activeStepCount = input.status === "creating" ? 1 : 2;
	return (
		<ol className="grid gap-1 text-xs">
			{steps.map((step, index) => (
				<li
					className={
						index < activeStepCount
							? "text-foreground"
							: "text-muted-foreground"
					}
					key={step}
				>
					{index + 1}. {step}
				</li>
			))}
		</ol>
	);
}

function requestStatusLabel(status: PresentedAgentCreation["status"]): string {
	if (status === "pending") {
		return "Waiting for approval";
	}
	return "Creating Agent";
}
