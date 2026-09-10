import { getOrganizationJoinLinkResponseSchema } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { cn } from "@openmeld/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { requestAuthEndpoint } from "#/lib/auth-transport";
import { copyTextToClipboard } from "#/lib/clipboard";
import {
	getOrganizationJoinLink,
	revokeOrganizationJoinLink,
} from "#/lib/organizations/auth-organizations";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

export function InvitationRequestLink(input: {
	organizationId: string;
	className?: string;
	spaceId?: string;
	canManage?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const currentUserId = useOptionalAppOrganization()?.currentUserId;
	const client = useQueryClient();
	const mode = input.canManage ? "direct" : "request";
	const scope = {
		organizationId: input.organizationId,
		spaceId: input.spaceId,
		mode,
	} as const;
	const queryKey = [
		...organizationQueryKeys.joinLink(input.organizationId),
		mode,
		input.spaceId ?? null,
		currentUserId,
	];
	const query = useQuery({
		queryKey,
		queryFn: () => getOrganizationJoinLink(scope),
		retry: false,
		staleTime: 0,
	});
	const link = query.data;
	const mutation = useMutation({
		onMutate: () => client.cancelQueries({ queryKey }),
		onSuccess: (createdLink) => {
			client.setQueryData(queryKey, createdLink);
			setCopied(false);
			setCopyFailed(false);
		},
		mutationFn: async () => {
			const response = await requestAuthEndpoint({
				path: "/organization/join-link/ensure",
				fallbackMessage: "Could not create the link. Try again.",
				request: {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						responseVersion: "3",
						organizationId: input.organizationId,
						spaceId: input.spaceId,
						mode,
					}),
				},
			});
			if (response.error) {
				throw new Error(response.error.message ?? "Could not create the link.");
			}
			const result = getOrganizationJoinLinkResponseSchema.parse(response.data);
			if (!result.joinLink) {
				throw new Error("No invitation link was returned. Try again.");
			}
			return result.joinLink;
		},
	});
	const revoke = useMutation({
		onMutate: () => client.cancelQueries({ queryKey }),
		mutationFn: () => revokeOrganizationJoinLink(scope),
		onSuccess: () => {
			client.setQueryData(queryKey, null);
			mutation.reset();
			setCopied(false);
			setCopyFailed(false);
		},
	});
	const busy = mutation.isPending || revoke.isPending || query.isFetching;
	if (query.isPending) {
		return (
			<output className="block text-muted-foreground text-sm">
				Loading invite link…
			</output>
		);
	}
	if (query.isError) {
		return (
			<div className="space-y-2">
				<p className="text-destructive text-sm" role="alert">
					{query.error.message}
				</p>
				<Button onClick={() => query.refetch()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	return (
		<div className={cn("space-y-2 border-t pt-3", input.className)}>
			<p className="font-medium text-sm">Invite link</p>
			<p className="text-muted-foreground text-sm">
				{(link?.mode ?? mode) === "direct"
					? `Anyone with this link can join the organization${input.spaceId ? " and this Space" : ""} as a member. No approval needed. The link expires after 30 days.`
					: "Anyone with this link can request to join. An owner or admin must approve each request."}
			</p>
			{link ? (
				<>
					<Input
						aria-label="Invitation request link"
						readOnly
						value={link.url}
					/>
					<div className="flex items-center justify-end gap-2">
						{input.canManage ? (
							<Button
								disabled={busy}
								onClick={() => revoke.mutate()}
								size="sm"
								variant="ghost"
							>
								Revoke link
							</Button>
						) : null}
						<Button
							disabled={busy}
							onClick={async () => {
								const success = await copyTextToClipboard(link.url);
								setCopied(success);
								setCopyFailed(!success);
							}}
							size="sm"
							variant="outline"
						>
							{copied ? "Copied" : "Copy link"}
						</Button>
					</div>
				</>
			) : (
				<Button
					disabled={busy}
					onClick={() => mutation.mutate()}
					size="sm"
					variant="outline"
				>
					{mutation.isPending ? "Creating…" : "Create link"}
				</Button>
			)}
			{mutation.error ? (
				<p className="text-destructive text-sm" role="alert">
					{mutation.error.message}
				</p>
			) : null}
			{revoke.error ? (
				<p className="text-destructive text-sm" role="alert">
					{revoke.error.message}
				</p>
			) : null}
			{copyFailed ? (
				<p className="text-sm" role="alert">
					Could not copy the link. Select it above and copy it manually.
				</p>
			) : null}
		</div>
	);
}
