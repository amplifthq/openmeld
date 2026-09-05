import { getOrganizationJoinLinkResponseSchema } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { requestAuthEndpoint } from "#/lib/auth-transport";
import { copyTextToClipboard } from "#/lib/clipboard";

export function InvitationRequestLink(input: {
	organizationId: string;
	spaceId?: string;
	canManage?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);
	const mutation = useMutation({
		mutationFn: async () => {
			const response = await requestAuthEndpoint({
				path: "/organization/join-link/ensure",
				fallbackMessage: "Could not create the link. Try again.",
				request: {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						organizationId: input.organizationId,
						spaceId: input.spaceId,
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
			return result.joinLink.url;
		},
	});
	const revoke = useMutation({
		mutationFn: async () => {
			const query = new URLSearchParams({
				organizationId: input.organizationId,
			});
			if (input.spaceId) {
				query.set("spaceId", input.spaceId);
			}
			const result = await requestAuthEndpoint({
				path: `/organization/join-link?${query}`,
				fallbackMessage: "Could not revoke the link. Try again.",
				request: { method: "DELETE" },
			});
			if (result.error) {
				throw new Error(result.error.message);
			}
		},
		onSuccess: () => {
			mutation.reset();
			setCopied(false);
		},
	});
	return (
		<div className="space-y-2 border-t pt-3">
			<p className="font-medium text-sm">Share a link</p>
			<p className="text-muted-foreground text-sm">
				Anyone with this link can request an invitation. Each person needs
				approval before joining.
			</p>
			{mutation.data ? (
				<>
					<Input
						aria-label="Invitation request link"
						readOnly
						value={mutation.data}
					/>
					<Button
						onClick={async () => {
							const success = await copyTextToClipboard(mutation.data ?? "");
							setCopied(success);
							setCopyFailed(!success);
						}}
						size="sm"
						variant="outline"
					>
						{copied ? "Copied" : "Copy link"}
					</Button>
					{input.canManage ? (
						<Button
							disabled={revoke.isPending}
							onClick={() => revoke.mutate()}
							size="sm"
							variant="ghost"
						>
							Revoke link
						</Button>
					) : null}
				</>
			) : (
				<Button
					disabled={mutation.isPending}
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
