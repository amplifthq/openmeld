import {
	ApprovalCard,
	ApprovalCardFooter,
	ApprovalCardHeader,
} from "@openmeld/ui/components/approval-card";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { ShieldCheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { usePluginActionRequest } from "#/query/organizations/plugin-action-requests";
import {
	ApprovalRequestErrors,
	ApprovalRequestOutcome,
	ApprovalRequestUnavailable,
} from "./approval-request-states";
import { PluginActionRequestDetails } from "./plugin-action-request-details";

const STATE_COPY = {
	approved:
		"Approved. The Agent can continue this request. Approval does not mean the operation has run.",
	rejected:
		"Declined. No new operation was authorized. Earlier operations remain unchanged.",
	expired:
		"This request expired. Ask the Agent for a new request if you still want to proceed.",
	revoked:
		"This account or its permissions changed. Review the connection in Plugins before requesting another action.",
} as const;
const ISSUE_PROVIDERS: Readonly<Record<string, string>> = {
	"linear.create_linear_issue": "Linear",
	"github.create_issue": "GitHub",
};

export function PluginActionRequest({
	requestId,
	presentation,
}: {
	requestId: string;
	presentation?: "surface";
}) {
	const { query, mutation } = usePluginActionRequest(requestId);
	const [error, setError] = useState<string | null>(null);
	const request = query.data;
	const issueProvider = ISSUE_PROVIDERS[request?.actionId ?? ""] ?? null;
	const disabled = mutation.isPending || query.isRefetchError;
	async function respond(operation: "approve" | "reject") {
		setError(null);
		try {
			await mutation.mutateAsync({ operation, requestId });
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Your response could not be confirmed. Refresh this request before trying again."
			);
		} finally {
			mutation.reset();
		}
	}
	if (query.isPending) {
		return <SkeletonRows label="Loading Plugin request" rows={3} />;
	}
	if (!request) {
		return (
			<ApprovalRequestUnavailable
				message="This request could not be loaded. Refresh to try again."
				onRefresh={() => query.refetch()}
			/>
		);
	}
	return (
		<ApprovalCard
			className={
				presentation === "surface" ? "border-0 bg-transparent p-0" : "mt-3"
			}
		>
			<ApprovalCardHeader
				description={
					issueProvider
						? "Review the destination and issue before continuing."
						: "Review the account and action before continuing."
				}
				icon={<ShieldCheckIcon />}
				title={
					issueProvider
						? `Create ${issueProvider} issue`
						: "Confirm a Plugin action"
				}
			/>
			<PluginActionRequestDetails
				issueProvider={issueProvider}
				request={request}
			/>
			{request.state === "pending" ? (
				<ApprovalCardFooter>
					<Button
						disabled={disabled}
						onClick={() => respond("approve")}
						size="sm"
					>
						{request.sourceSignalId ? "Approve and continue" : "Approve action"}
					</Button>
					<Button
						disabled={disabled}
						onClick={() => respond("reject")}
						size="sm"
						variant="outline"
					>
						Decline request
					</Button>
				</ApprovalCardFooter>
			) : (
				<ApprovalRequestOutcome>
					{request.state === "approved" && request.continuation
						? {
								pending:
									"Approved. The Agent will continue when its current reply is ready.",
								requested:
									"Approved. The Agent has been asked to continue the original request.",
								unavailable:
									"Approved, but the original request can no longer continue. Send a new message to the Agent.",
							}[request.continuation]
						: STATE_COPY[request.state]}
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
