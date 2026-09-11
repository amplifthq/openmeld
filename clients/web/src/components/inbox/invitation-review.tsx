import { Button } from "@openmeld/ui/components/button";
import { RequestDetails } from "#/components/organizations/invitation-request-details";
import { useAppSettings } from "#/components/settings/use-app-settings";
import { useInvitationRequest } from "#/query/organizations/invitation-requests";

export function InvitationReview({
	requestId,
	inline = false,
	onInteract,
}: {
	requestId: string;
	inline?: boolean;
	onInteract?: () => void;
}) {
	const { query, mutation } = useInvitationRequest(requestId);
	const openSettings = useAppSettings();
	if (query.isPending) {
		return (
			<p aria-busy="true" className="text-muted-foreground text-sm">
				Loading request…
			</p>
		);
	}
	if (!query.data) {
		return (
			<div className="space-y-2">
				<p className="text-destructive text-sm" role="alert">
					{query.error?.message ?? "This request is unavailable."}
				</p>
				<Button onClick={() => query.refetch()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	return (
		<div className="space-y-3">
			<RequestDetails
				disabled={query.isRefetchError}
				onReview={(action) => {
					onInteract?.();
					mutation.mutate(
						action === "approve" && query.data.status === "approved"
							? "retry"
							: action
					);
				}}
				pending={mutation.isPending}
				request={query.data}
				showEmail={!inline}
			/>
			{query.isRefetchError ? (
				<p className="text-destructive text-sm" role="alert">
					Couldn’t refresh this request.{" "}
					<button
						className="underline"
						onClick={() => query.refetch()}
						type="button"
					>
						Try again
					</button>
				</p>
			) : null}
			{mutation.error ? (
				<p className="text-destructive text-sm" role="alert">
					{mutation.error.message}
				</p>
			) : null}
			{inline ? null : (
				<button
					className="inline-block text-muted-foreground text-xs underline-offset-4 hover:underline"
					onClick={() => openSettings("invitations")}
					type="button"
				>
					View approval history
				</button>
			)}
		</div>
	);
}
