"use client";

import type { OrganizationJoinLink } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { CopyIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { copyTextToClipboard } from "#/lib/clipboard";
import {
	getOrganizationJoinLink,
	resetOrganizationJoinLink,
	revokeOrganizationJoinLink,
} from "#/lib/organizations/auth-organizations";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

type CopyStatus = "copied" | "failed" | "idle";

export function OrganizationInviteLink(input: { organizationId: string }) {
	const queryClient = useQueryClient();
	const queryKey = organizationQueryKeys.joinLink(input.organizationId);
	const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
	const joinLinkQuery = useQuery({
		queryFn: async () =>
			await getOrganizationJoinLink({
				organizationId: input.organizationId,
			}),
		queryKey,
		refetchOnWindowFocus: false,
		retry: 1,
		staleTime: 10_000,
	});
	const resetMutation = useMutation({
		mutationFn: async () =>
			await resetOrganizationJoinLink({
				organizationId: input.organizationId,
			}),
		onSuccess: (joinLink) => {
			setCopyStatus("idle");
			queryClient.setQueryData(queryKey, joinLink);
		},
	});
	const revokeMutation = useMutation({
		mutationFn: async () =>
			await revokeOrganizationJoinLink({
				organizationId: input.organizationId,
			}),
		onSuccess: () => {
			setCopyStatus("idle");
			queryClient.setQueryData(queryKey, null);
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Invite link</CardTitle>
				<CardDescription>
					Anyone with this link can join this organization as a member. The link
					does not expire.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<OrganizationInviteLinkContent
					copyStatus={copyStatus}
					isResetPending={resetMutation.isPending}
					isRevokePending={revokeMutation.isPending}
					joinLink={joinLinkQuery.data ?? null}
					onCopy={async (url) => {
						setCopyStatus(
							(await copyTextToClipboard(url)) ? "copied" : "failed"
						);
					}}
					onGenerate={() => resetMutation.mutate()}
					onReset={() => resetMutation.mutate()}
					onRetry={() => joinLinkQuery.refetch()}
					onRevoke={() => revokeMutation.mutate()}
					queryError={joinLinkQuery.error}
					queryPending={joinLinkQuery.isPending}
					resetError={resetMutation.error}
					revokeError={revokeMutation.error}
				/>
			</CardContent>
		</Card>
	);
}

function OrganizationInviteLinkContent(input: {
	copyStatus: CopyStatus;
	isResetPending: boolean;
	isRevokePending: boolean;
	joinLink: OrganizationJoinLink | null;
	onCopy: (url: string) => Promise<void>;
	onGenerate: () => void;
	onReset: () => void;
	onRetry: () => void;
	onRevoke: () => void;
	queryError: Error | null;
	queryPending: boolean;
	resetError: Error | null;
	revokeError: Error | null;
}) {
	if (input.queryPending) {
		return (
			<p className="text-muted-foreground text-sm">Loading invite link.</p>
		);
	}
	if (input.queryError) {
		return (
			<div className="space-y-3">
				<p className="text-destructive text-sm">{input.queryError.message}</p>
				<Button
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</div>
		);
	}
	if (!input.joinLink) {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					Generate one reusable link for inviting members.
				</p>
				{input.resetError ? (
					<p className="text-destructive text-sm">{input.resetError.message}</p>
				) : null}
				<Button
					disabled={input.isResetPending}
					onClick={input.onGenerate}
					size="sm"
					type="button"
				>
					{input.isResetPending ? "Generating..." : "Generate invite link"}
				</Button>
			</div>
		);
	}

	const joinLink = input.joinLink;
	const mutationPending = input.isResetPending || input.isRevokePending;
	return (
		<div className="space-y-4">
			<div className="grid gap-2">
				<Label htmlFor="organization-invite-link-url">Invite link URL</Label>
				<Input
					id="organization-invite-link-url"
					readOnly
					value={joinLink.url}
				/>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={mutationPending}
					onClick={() => input.onCopy(joinLink.url)}
					size="sm"
					type="button"
					variant="outline"
				>
					<CopyIcon aria-hidden="true" data-icon="inline-start" />
					{input.copyStatus === "copied" ? "Copied" : "Copy"}
				</Button>
				<Button
					disabled={mutationPending}
					onClick={input.onReset}
					size="sm"
					type="button"
					variant="outline"
				>
					{input.isResetPending ? "Resetting..." : "Reset"}
				</Button>
				<Button
					disabled={mutationPending}
					onClick={input.onRevoke}
					size="sm"
					type="button"
					variant="outline"
				>
					{input.isRevokePending ? "Revoking..." : "Revoke"}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				Resetting creates a new link and immediately disables this one.
			</p>
			<div aria-live="polite">
				{input.copyStatus === "failed" ? (
					<p className="text-destructive text-sm">
						OpenMeld could not copy the link automatically. Select the URL and
						copy it manually.
					</p>
				) : null}
				{input.resetError ? (
					<p className="text-destructive text-sm">{input.resetError.message}</p>
				) : null}
				{input.revokeError ? (
					<p className="text-destructive text-sm">
						{input.revokeError.message}
					</p>
				) : null}
			</div>
		</div>
	);
}
