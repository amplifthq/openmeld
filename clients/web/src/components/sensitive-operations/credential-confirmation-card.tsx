import type {
	CredentialConfirmationDecision,
	CredentialConfirmationView,
	SensitiveOperation,
} from "@openmeld/schemas";
import {
	ApprovalCard,
	ApprovalCardBody,
	ApprovalCardFooter,
	ApprovalCardHeader,
} from "@openmeld/ui/components/approval-card";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { ShieldWarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
	ApprovalRequestErrors,
	ApprovalRequestOutcome,
	ApprovalRequestUnavailable,
} from "#/components/inbox/approval-request-states";
import {
	useCredentialConfirmation,
	useDecideCredentialConfirmation,
} from "#/query/sensitive-operations";

const OPERATION_LABELS: Record<SensitiveOperation, string> = {
	agent_access_decision: "Answer an Agent access request",
	agent_access_grant_revoke: "Revoke Agent access",
	agent_interaction_answer: "Answer an Agent's approval request",
	binding_collaboration_mode: "Change the collaboration mode",
	binding_disable: "Disconnect the Agent",
	binding_ensure: "Connect the Agent",
	binding_model_selection: "Change the model",
	binding_opencode_permission: "Change the OpenCode permission",
	binding_permission_mode: "Change the permission mode",
	creation_defaults_write: "Change defaults for new Agents",
	default_project_write: "Change the default Project",
	execution_mode_write: "Change how many tasks the Agent runs at once",
	profile_delete: "Delete an Agent Profile",
	session_archive: "Archive a chat with the Agent",
	session_delete: "Delete a chat with the Agent",
	runtime_settings_write: "Change the Agent's settings",
	space_delete: "Delete a Space",
	space_members_add_agent: "Add the Agent to a Space",
	work_recovery: "Approve or skip queued work",
	working_folder_write: "Change the working folder",
};

export function credentialConfirmationOperationLabel(
	operation: SensitiveOperation
): string {
	return OPERATION_LABELS[operation];
}

/** What happened, from the owner's side. */
export function credentialConfirmationOutcomeCopy(
	confirmation: Pick<CredentialConfirmationView, "status">
): string {
	switch (confirmation.status) {
		case "pending":
			return "Waiting for your answer.";
		case "approved":
			return "Confirmed. The command on your computer can continue.";
		case "consumed":
			return "Confirmed and done.";
		case "declined":
			return "Declined. Nothing changed.";
		case "expired":
			return "This request expired. Nothing changed.";
		default:
			return "";
	}
}

/** The owner's answer to one sensitive CLI request (Inbox). */
export function CredentialConfirmationCard(input: { confirmationId: string }) {
	const query = useCredentialConfirmation(input.confirmationId);
	const decide = useDecideCredentialConfirmation();
	const [error, setError] = useState<string | null>(null);
	const confirmation = query.data;
	if (query.isPending) {
		return <SkeletonRows label="Loading confirmation" rows={2} />;
	}
	if (!confirmation) {
		return (
			<ApprovalRequestUnavailable
				message={query.error?.message ?? "This confirmation is unavailable."}
				onRefresh={() => query.refetch()}
			/>
		);
	}
	const respond = async (decision: CredentialConfirmationDecision) => {
		setError(null);
		try {
			await decide.mutateAsync({
				confirmationId: confirmation.id,
				decision,
			});
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Your answer couldn't be saved. Refresh and try again."
			);
		}
	};
	const disabled = decide.isPending || query.isRefetchError;
	return (
		<ApprovalCard>
			<ApprovalCardHeader
				description={confirmation.agentProfileName ?? "Sensitive change"}
				icon={<ShieldWarningIcon />}
				title={credentialConfirmationOperationLabel(confirmation.operation)}
			/>
			<ApprovalCardBody>
				<p className="text-muted-foreground text-sm">
					A command on your computer used your OpenMeld sign-in while a task
					requested by someone else was running there. Confirm only if you ran
					it yourself.
				</p>
			</ApprovalCardBody>
			{confirmation.status === "pending" ? (
				<ApprovalCardFooter>
					<Button
						disabled={disabled}
						onClick={() => respond("approve")}
						size="sm"
					>
						Confirm
					</Button>
					<Button
						disabled={disabled}
						onClick={() => respond("decline")}
						size="sm"
						variant="outline"
					>
						Decline
					</Button>
				</ApprovalCardFooter>
			) : (
				<ApprovalRequestOutcome>
					{credentialConfirmationOutcomeCopy(confirmation)}
				</ApprovalRequestOutcome>
			)}
			<ApprovalRequestErrors
				error={error}
				onRefresh={() => query.refetch()}
				refetchFailed={query.isRefetchError}
			/>
		</ApprovalCard>
	);
}
