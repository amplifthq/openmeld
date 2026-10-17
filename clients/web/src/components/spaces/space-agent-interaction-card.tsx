import {
	isWorkingFolderRecoveryDecline,
	isWorkingFolderRecoveryQuestion,
} from "@openmeld/schemas";
import type {
	AgentControllerPermissionMode,
	AgentInteractionRequest,
	AgentInteractionResponse,
	RespondToSpaceAgentInteractionBody,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	ApprovalCard,
	ApprovalCardFooter,
	ApprovalCardHeader,
} from "@openmeld/ui/components/approval-card";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleDotsIcon,
	ListChecksIcon,
	TerminalIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
	type ActionPermissionModeOption,
	ActionRequestForm,
} from "#/components/actions/action-request-form";
import { isAgentInteractionResponseUnconfirmed } from "#/lib/spaces/agent-interaction-response";

export type SpaceAgentInteractionResponseHandler = (
	input: RespondToSpaceAgentInteractionBody
) => Promise<void>;

export type SpaceAgentPermissionModeOption = ActionPermissionModeOption;

type SpaceAgentInteractionSubmission = "continue" | "stop";

/** Why a submitted response did not land, so a remounted card can show it. */
export type SpaceAgentInteractionFailure =
	| { errorMessage: string }
	| { unconfirmedResponse: AgentInteractionResponse };

export type SpaceAgentPermissionModeUpdateHandler = (input: {
	permissionMode: AgentControllerPermissionMode;
	profileId: string;
}) => Promise<
	NonNullable<
		Extract<
			AgentInteractionResponse,
			{ kind: "permission" }
		>["permissionModeUpdate"]
	>
>;

type SpaceAgentInteractionCardProps = {
	item: WakeProgressItem;
	onPermissionModeUpdate?: SpaceAgentPermissionModeUpdateHandler;
	onRespond?: SpaceAgentInteractionResponseHandler;
	onSubmitFailed?: (failure: SpaceAgentInteractionFailure) => void;
	onSubmitStarted?: () => void;
	permissionModeOptions?: readonly SpaceAgentPermissionModeOption[];
	presentation?: "surface" | "timeline";
	restoredFailure?: SpaceAgentInteractionFailure;
};

export function SpaceAgentInteractionCard(
	input: SpaceAgentInteractionCardProps
) {
	return (
		<SpaceAgentInteractionCardState
			{...input}
			key={`${input.item.runtimeCoordinatorExecutionId}:${input.item.pendingInteraction?.interactionId}`}
		/>
	);
}

function SpaceAgentInteractionCardState(input: SpaceAgentInteractionCardProps) {
	const pendingInteraction = input.item.pendingInteraction;
	const [errorMessage, setErrorMessage] = useState<string | null>(() =>
		input.restoredFailure && "errorMessage" in input.restoredFailure
			? input.restoredFailure.errorMessage
			: null
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [unconfirmedResponse, setUnconfirmedResponse] =
		useState<AgentInteractionResponse | null>(() =>
			input.restoredFailure && "unconfirmedResponse" in input.restoredFailure
				? input.restoredFailure.unconfirmedResponse
				: null
		);
	const [submission, setSubmission] =
		useState<SpaceAgentInteractionSubmission | null>(null);

	if (!pendingInteraction) {
		return null;
	}

	const request = pendingInteraction.request;
	const canRespond =
		pendingInteraction.canRespond && request !== null && input.onRespond;

	const respond = async (
		response: AgentInteractionResponse,
		permissionMode?: AgentControllerPermissionMode
	) => {
		if (!(request && canRespond)) {
			return;
		}
		const runtimeCoordinatorExecutionId =
			input.item.runtimeCoordinatorExecutionId;
		if (!runtimeCoordinatorExecutionId) {
			setErrorMessage(
				"OpenMeld cannot send this response because the Wake is missing its execution reference. Refresh the Space or open Wake details."
			);
			return;
		}

		setErrorMessage(null);
		setIsSubmitting(true);
		input.onSubmitStarted?.();
		let submittedResponse: AgentInteractionResponse | null = null;
		try {
			submittedResponse = await preparePermissionResponse({
				response,
				permissionMode,
				profileId: input.item.targetProfileId,
				onPermissionModeUpdate: input.onPermissionModeUpdate,
			});
			await canRespond({
				interactionId: pendingInteraction.interactionId,
				response: submittedResponse,
				runtimeCoordinatorExecutionId,
			});
			setUnconfirmedResponse(null);
			const nextSubmission: SpaceAgentInteractionSubmission =
				isWorkingFolderRecoveryQuestion(request) &&
				isWorkingFolderRecoveryDecline(response)
					? "stop"
					: "continue";
			setSubmission(nextSubmission);
		} catch (error) {
			if (submittedResponse && isAgentInteractionResponseUnconfirmed(error)) {
				setUnconfirmedResponse(submittedResponse);
				input.onSubmitFailed?.({ unconfirmedResponse: submittedResponse });
				return;
			}
			const failureMessage =
				error instanceof Error
					? error.message
					: "Couldn't confirm your response. Refresh to check its status before trying again.";
			setUnconfirmedResponse(null);
			setErrorMessage(failureMessage);
			input.onSubmitFailed?.({ errorMessage: failureMessage });
		} finally {
			setIsSubmitting(false);
		}
	};

	if (unconfirmedResponse && canRespond) {
		return (
			<InteractionShell
				kind={pendingInteraction.kind}
				presentation={input.presentation}
				targetLabel={input.item.targetLabel}
				title="Response not confirmed"
			>
				<output aria-live="polite" className="text-muted-foreground text-sm">
					Your response may already be saved. Check the response to confirm it.
				</output>
				<ApprovalCardFooter>
					<Button
						disabled={isSubmitting}
						onClick={() => respond(unconfirmedResponse)}
						type="button"
						variant="outline"
					>
						{isSubmitting ? "Checking response…" : "Check response"}
					</Button>
				</ApprovalCardFooter>
			</InteractionShell>
		);
	}

	if (submission) {
		return (
			<InteractionShell
				kind={pendingInteraction.kind}
				presentation={input.presentation}
				targetLabel={input.item.targetLabel}
				title={submission === "stop" ? "Stop requested" : "Response sent"}
			>
				<p aria-live="polite" className="text-muted-foreground text-sm">
					{submission === "stop"
						? "Waiting for confirmation that this task has stopped."
						: `Waiting for ${input.item.targetLabel} to continue.`}
				</p>
			</InteractionShell>
		);
	}

	if (!canRespond) {
		return (
			<InteractionShell
				kind={pendingInteraction.kind}
				presentation={input.presentation}
				targetLabel={input.item.targetLabel}
				title="Waiting for the local agent owner"
			>
				<p className="text-muted-foreground text-sm leading-6">
					This Wake is paused until the person who owns this local agent
					responds. You can keep using this Space while it waits.
				</p>
			</InteractionShell>
		);
	}

	return (
		<InteractionShell
			kind={request.kind}
			presentation={input.presentation}
			targetLabel={input.item.targetLabel}
			title={request.title}
		>
			<ActionRequestForm
				disabled={isSubmitting}
				key={request.interactionId}
				onRespond={respond}
				permissionModeOptions={
					input.onPermissionModeUpdate ? input.permissionModeOptions : undefined
				}
				request={request}
			/>
			{isSubmitting ? (
				<p aria-live="polite" className="text-muted-foreground text-xs">
					Sending response…
				</p>
			) : null}
			{errorMessage ? (
				<p
					aria-live="assertive"
					className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm"
					role="alert"
				>
					{errorMessage}
				</p>
			) : null}
		</InteractionShell>
	);
}

async function preparePermissionResponse(input: {
	response: AgentInteractionResponse;
	permissionMode?: AgentControllerPermissionMode;
	profileId: string;
	onPermissionModeUpdate?: SpaceAgentPermissionModeUpdateHandler;
}): Promise<AgentInteractionResponse> {
	if (
		input.response.kind !== "permission" ||
		!input.permissionMode ||
		!input.onPermissionModeUpdate
	) {
		return input.response;
	}
	const permissionModeUpdate = await input.onPermissionModeUpdate({
		permissionMode: input.permissionMode,
		profileId: input.profileId,
	});
	return { ...input.response, permissionModeUpdate };
}

function InteractionShell(input: {
	children: ReactNode;
	kind: AgentInteractionRequest["kind"];
	presentation?: "surface" | "timeline";
	targetLabel: string;
	title: string;
}) {
	return (
		<ApprovalCard
			aria-label={`Request from ${input.targetLabel}`}
			className={cn(
				input.presentation === "surface"
					? "border-0 bg-transparent p-0"
					: "my-2"
			)}
			data-agent-interaction-kind={input.kind}
		>
			<ApprovalCardHeader
				description={`${resolveInteractionKindLabel(input.kind)} · ${input.targetLabel}`}
				icon={<InteractionKindIcon kind={input.kind} />}
				title={input.title}
			/>
			{input.children}
		</ApprovalCard>
	);
}

function InteractionKindIcon({
	kind,
}: {
	kind: AgentInteractionRequest["kind"];
}) {
	const Icon = {
		plan_review: ListChecksIcon,
		question: ChatCircleDotsIcon,
		permission: TerminalIcon,
	}[kind];
	return <Icon aria-hidden="true" />;
}

function resolveInteractionKindLabel(
	kind: AgentInteractionRequest["kind"]
): string {
	switch (kind) {
		case "permission":
			return "Permission needed";
		case "question":
			return "Question";
		case "plan_review":
			return "Plan review";
		default:
			return "Local agent request";
	}
}
