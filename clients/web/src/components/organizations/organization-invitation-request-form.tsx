import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { InvitationRequestLink } from "./invitation-request-link";

export function OrganizationInvitationRequestForm(input: {
	organizationId: string;
}) {
	const [email, setEmail] = useState("");
	const request = useMutation({
		mutationFn: () =>
			requestOrganizationJoinRequests({
				action: "create",
				organizationId: input.organizationId,
				email,
			}),
		onSuccess: () => setEmail(""),
	});
	return (
		<div className="space-y-4">
			<form
				className="space-y-2"
				onSubmit={(event) => {
					event.preventDefault();
					request.mutate();
				}}
			>
				<p className="text-muted-foreground text-sm">
					An owner or admin must approve your invitation before it is sent.
				</p>
				<label
					className="text-sm"
					htmlFor="organization-invitation-request-email"
				>
					Email address
				</label>
				<Input
					id="organization-invitation-request-email"
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
						<a
							className="underline"
							href={`/invitation-requests?requestId=${encodeURIComponent(request.data[0].id)}`}
						>
							View request
						</a>
					</output>
				) : null}
			</form>
			<InvitationRequestLink organizationId={input.organizationId} />
		</div>
	);
}
