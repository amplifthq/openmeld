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
const EFFECT_COPY = {
	destructive: "Deletes or irreversibly changes data",
	write: "Creates or changes data",
	unspecified: "May change data",
} as const;

export function PluginActionRequest({ requestId }: { requestId: string }) {
	const { query, mutation } = usePluginActionRequest(requestId);
	const [error, setError] = useState<string | null>(null);
	const request = query.data;
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
			<div className="mt-3 space-y-2 rounded-md border border-border/70 p-4">
				<p className="text-destructive text-sm" role="alert">
					This request could not be loaded. Refresh to try again.
				</p>
				<Button onClick={() => query.refetch()} size="sm" variant="outline">
					Refresh request
				</Button>
			</div>
		);
	}
	return (
		<ApprovalCard className="mt-3">
			<ApprovalCardHeader
				description="Review the account and action before continuing."
				icon={<ShieldCheckIcon />}
				title="Confirm a Plugin action"
			/>
			<dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
				<div>
					<dt className="text-muted-foreground">Plugin</dt>
					<dd className="break-words">{request.service}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Account</dt>
					<dd className="break-words">
						{request.accountName} ·{" "}
						{request.accountScope === "shared" ? "Shared" : "Personal"}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Action</dt>
					<dd className="break-all">{request.actionId}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Effect</dt>
					<dd>{EFFECT_COPY[request.effect]}</dd>
				</div>
				{request.targets.map((target) => (
					<div key={target.label}>
						<dt className="text-muted-foreground">{target.label}</dt>
						<dd className="break-all">{target.value}</dd>
					</div>
				))}
			</dl>
			<p className="text-muted-foreground text-xs">
				This approval applies to the exact account and submitted input.
				{request.inputFieldCount > request.targets.length
					? " Some input is not shown. This summary does not verify omitted content."
					: " Review the details before approving."}
			</p>
			{request.state === "pending" ? (
				<div className="space-y-3 border-border/70 border-t pt-4">
					<p className="text-muted-foreground text-sm">
						Only your signed-in account can approve this request. It expires at{" "}
						{new Date(request.expiresAtMs).toLocaleTimeString([], {
							hour: "numeric",
							minute: "2-digit",
						})}
						.
					</p>
					<ApprovalCardFooter>
						<Button
							disabled={disabled}
							onClick={() => respond("approve")}
							size="sm"
						>
							{request.sourceSignalId
								? "Approve and continue"
								: "Approve action"}
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
				</div>
			) : (
				<output className="block border-border/70 border-t pt-3 text-sm">
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
				</output>
			)}
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			{query.isRefetchError ? (
				<div className="space-y-2">
					<p className="text-destructive text-sm" role="alert">
						Couldn’t refresh this request. Confirm its current status before
						responding.
					</p>
					<Button onClick={() => query.refetch()} size="sm" variant="outline">
						Refresh request
					</Button>
				</div>
			) : null}
		</ApprovalCard>
	);
}
