import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	SetupTimeline,
	SetupTimelineStep,
} from "@openmeld/ui/components/setup-timeline";
import { formatAgentCreationFailure } from "#/lib/profiles/agent-creation-failure";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";

type PresentedCreation =
	| Pick<OptimisticAgentProfileCreation, "profileName" | "status">
	| AgentProfileCreationRequest;

function creationStage(request: AgentProfileCreationRequest | null): number {
	if (request?.status === "completed") {
		return 3;
	}
	if (request?.createdAgentProfileId) {
		return 2;
	}
	return request ? 1 : 0;
}

function describeCreation(creation: PresentedCreation | null) {
	const request =
		creation && "createdAgentProfileId" in creation ? creation : null;
	const failed = request?.status === "failed";
	const cancelled = request?.status === "cancelled";
	const declined = request?.status === "declined";
	const stopped = failed || cancelled || declined;
	const completed = request?.status === "completed";
	const otherOwner = Boolean(
		request && request.targetOwnerUserId !== request.requesterUserId
	);
	const stage = creationStage(request);
	const targetLabel = request?.requestedSpaceId ? "Space" : "chat";
	let title = `Creating ${creation?.profileName ?? "Agent"}`;
	if (failed) {
		title = "Agent setup needs attention";
	} else if (cancelled) {
		title = "Agent request cancelled";
	} else if (declined) {
		title = "Agent request declined";
	} else if (completed) {
		title = otherOwner ? "Agent created" : `Opening ${targetLabel}`;
	}
	let detail = progressDetail(request);
	if (failed) {
		detail = formatAgentCreationFailure(
			request?.failureMessage ?? "Agent setup did not finish."
		);
	} else if (stopped) {
		detail = "You can review this request in creation history.";
	}
	return {
		completed,
		detail,
		otherOwner,
		stage,
		steps: [
			"Request received",
			request?.status === "pending" ? "Wait for approval" : "Create Agent",
			"Finish setup",
		],
		stopped,
		targetLabel,
		title,
	};
}

function progressDetail(request: AgentProfileCreationRequest | null): string {
	if (!request) {
		return "Sending request…";
	}
	if (request.status === "pending") {
		return "Waiting for approval";
	}
	if (request.status === "completed") {
		if (request.targetOwnerUserId !== request.requesterUserId) {
			return "The Agent is ready for its owner.";
		}
		return request.requestedSpaceId ? "Opening Space…" : "Opening chat…";
	}
	if (request.createdAgentProfileId) {
		return "Agent created. Finishing setup…";
	}
	return "Creating Agent…";
}

function progressStepState(input: {
	index: number;
	stage: number;
	stopped: boolean;
}): "active" | "blocked" | "complete" | "pending" {
	if (input.stage > input.index) {
		return "complete";
	}
	if (input.stage < input.index) {
		return "pending";
	}
	return input.stopped ? "blocked" : "active";
}

export function AgentCreationProgress(input: {
	creation: PresentedCreation | null;
	error?: string | null;
	isOpening: boolean;
	needsSetupReview?: boolean;
	onReview: () => void;
	onRetryOpen: () => void;
	onRetryRead: () => void;
	readFailed: boolean;
}) {
	const progress = describeCreation(input.creation);
	return (
		<section
			aria-live="polite"
			className="mx-auto grid w-full max-w-4xl content-start gap-10 px-6 py-14 sm:px-10 sm:py-20"
		>
			<div className="grid gap-3">
				<h1 className="font-semibold text-3xl tracking-tight">
					{progress.title}
				</h1>
				<p className="text-base text-muted-foreground">{progress.detail}</p>
			</div>
			<SetupTimeline className="gap-8 rounded-lg border border-border/70 bg-card/50 p-6 sm:p-8">
				{progress.steps.map((label, index) => (
					<SetupTimelineStep
						className="[&_h2]:text-base"
						key={label}
						state={progressStepState({
							index,
							stage: progress.stage,
							stopped: progress.stopped,
						})}
						summary={progress.stage === index ? progress.detail : ""}
						title={label}
					/>
				))}
			</SetupTimeline>
			{input.readFailed && (
				<div className="grid justify-items-start gap-2" role="alert">
					<p className="text-sm">Couldn’t check the latest setup status.</p>
					<Button onClick={input.onRetryRead} size="sm" variant="outline">
						Check again
					</Button>
				</div>
			)}
			{(progress.stopped || (progress.completed && progress.otherOwner)) && (
				<Button className="justify-self-start" onClick={input.onReview}>
					View creation history
				</Button>
			)}
			{input.error && (
				<div className="grid justify-items-start gap-2" role="alert">
					<p className="text-destructive text-sm">{input.error}</p>
					<Button
						onClick={
							input.needsSetupReview ? input.onReview : input.onRetryOpen
						}
						size="sm"
					>
						{input.needsSetupReview
							? "Review setup"
							: `Open ${progress.targetLabel}`}
					</Button>
				</div>
			)}
			{!(
				progress.stopped ||
				input.error ||
				input.isOpening ||
				progress.otherOwner
			) &&
				progress.completed && (
					<Button
						className="justify-self-start"
						onClick={input.onRetryOpen}
						size="sm"
						variant="outline"
					>
						Open {progress.targetLabel}
					</Button>
				)}
		</section>
	);
}
