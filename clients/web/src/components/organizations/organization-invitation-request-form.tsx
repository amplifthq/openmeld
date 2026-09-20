import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { invitationRequestQueryKey } from "#/query/organizations/invitation-requests";
import { InvitationRequestLink } from "./invitation-request-link";

export function OrganizationInvitationRequestForm(input: {
	organizationId: string;
}) {
	const emailId = useId();
	const [email, setEmail] = useState("");
	const client = useQueryClient();
	const { currentOrganization } = useAppOrganization();
	const request = useMutation({
		mutationFn: () =>
			requestOrganizationJoinRequests({
				action: "create",
				organizationId: input.organizationId,
				email,
			}),
		onSuccess: () => {
			setEmail("");
			return client.invalidateQueries({ queryKey: invitationRequestQueryKey });
		},
	});
	return (
		<div className="space-y-4">
			<h3 className="font-medium text-sm">Invite members</h3>
			<form
				className="space-y-2"
				onSubmit={(event) => {
					event.preventDefault();
					request.mutate();
				}}
			>
				<p className="text-muted-foreground text-sm">
					We’ll notify all owners and admins by email and in their Inbox. Once
					one approves, we’ll email your teammate an invitation.
				</p>
				<label className="text-sm" htmlFor={emailId}>
					Email address
				</label>
				<Input
					id={emailId}
					onChange={(event) => setEmail(event.target.value)}
					placeholder="name@example.com"
					required
					type="email"
					value={email}
				/>
				<Button disabled={request.isPending || !email.trim()} type="submit">
					Request invitation
				</Button>
				{request.error ? <p role="alert">{request.error.message}</p> : null}
				{request.data?.[0] ? (
					<output className="block">
						Request submitted.{" "}
						<Link
							className="underline"
							params={{ orgSlug: currentOrganization.slug }}
							search={{ requestId: request.data[0].id }}
							to="/o/$orgSlug/inbox"
						>
							View request
						</Link>
					</output>
				) : null}
			</form>
			<InvitationRequestLink organizationId={input.organizationId} />
		</div>
	);
}
