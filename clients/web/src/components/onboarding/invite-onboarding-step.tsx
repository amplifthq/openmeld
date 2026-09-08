"use client";

import type { OrganizationJoinLink } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Textarea } from "@openmeld/ui/components/textarea";
import {
	ArrowRightIcon,
	CheckIcon,
	CopyIcon,
	EnvelopeSimpleIcon,
	LinkIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { z } from "zod/v4";
import { copyTextToClipboard } from "#/lib/clipboard";
import {
	getOrganizationJoinLink,
	inviteOrganizationMember,
	listOrganizationInvitations,
	type OrganizationInvitation,
	resetOrganizationJoinLink,
} from "#/lib/organizations/auth-organizations";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	organizationMemberRoleQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";

const MAX_INVITES_PER_BATCH = 20;
const INVITE_EMAIL_SEPARATOR_PATTERN = /[\s,;]+/u;
const inviteEmailSchema = z.email();

type InviteBatchResult = {
	email: string;
	error: Error | null;
};

type InviteBatchContext = {
	optimisticIdsByEmail: ReadonlyMap<string, string>;
	previousInvitations: OrganizationInvitation[] | undefined;
};

type CopyStatus = "copied" | "failed" | "idle";

export function InviteOnboardingStep(input: { onContinue: () => void }) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState("");
	const [validationMessage, setValidationMessage] = useState<string | null>(
		null
	);
	const [batchResults, setBatchResults] = useState<InviteBatchResult[]>([]);
	const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: currentOrganization.isPersonal !== true,
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	const canInvite =
		currentOrganization.isPersonal !== true &&
		canManageOrganizationArea(roleQuery.data, {
			invitation: ["create"],
		});
	const invitationsQueryKey = organizationQueryKeys.invitations(
		currentOrganization.id
	);
	const invitationsQuery = useQuery({
		enabled: canInvite,
		queryFn: async () =>
			await listOrganizationInvitations({
				organizationId: currentOrganization.id,
			}),
		queryKey: invitationsQueryKey,
		refetchOnWindowFocus: false,
		retry: 1,
		staleTime: 10_000,
	});
	const joinLinkQueryKey = [
		...organizationQueryKeys.joinLink(currentOrganization.id),
		"direct",
	];
	const joinLinkQuery = useQuery({
		enabled: canInvite,
		queryFn: async () =>
			await getOrganizationJoinLink({
				mode: "direct",
				organizationId: currentOrganization.id,
			}),
		queryKey: joinLinkQueryKey,
		refetchOnWindowFocus: false,
		retry: 1,
		staleTime: 10_000,
	});
	const inviteMutation = useMutation<
		InviteBatchResult[],
		Error,
		string[],
		InviteBatchContext
	>({
		mutationFn: async (emails) =>
			await Promise.all(
				emails.map(async (email) => {
					try {
						await inviteOrganizationMember({
							email,
							organizationId: currentOrganization.id,
							role: "member",
						});
						return { email, error: null };
					} catch (error) {
						return {
							email,
							error: toError(error, "OpenMeld could not send this invitation."),
						};
					}
				})
			),
		mutationKey: [
			"onboarding",
			"organization-invitations",
			currentOrganization.id,
		],
		onError: (error, emails, context) => {
			queryClient.setQueryData(
				invitationsQueryKey,
				context?.previousInvitations
			);
			setBatchResults(emails.map((email) => ({ email, error })));
		},
		onMutate: async (emails) => {
			await queryClient.cancelQueries({ queryKey: invitationsQueryKey });
			const previousInvitations =
				queryClient.getQueryData<OrganizationInvitation[]>(invitationsQueryKey);
			const optimisticIdsByEmail = new Map(
				emails.map((email, index) => [
					email,
					`onboarding-invitation:${Date.now()}:${index}:${email}`,
				])
			);
			queryClient.setQueryData<OrganizationInvitation[]>(
				invitationsQueryKey,
				(current = []) => [
					...current.filter(
						(invitation) =>
							!emails.includes(invitation.email.trim().toLocaleLowerCase())
					),
					...emails.map((email) => ({
						email,
						expiresAt: null,
						id: optimisticIdsByEmail.get(email) ?? email,
						organizationId: currentOrganization.id,
						role: "member",
						status: "sending",
					})),
				]
			);
			setBatchResults(emails.map((email) => ({ email, error: null })));
			return { optimisticIdsByEmail, previousInvitations };
		},
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: invitationsQueryKey }),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.directory(currentOrganization.id),
				}),
			]);
		},
		onSuccess: (results, _emails, context) => {
			const failedEmails = new Set(
				results
					.filter((result) => result.error !== null)
					.map((result) => result.email)
			);
			queryClient.setQueryData<OrganizationInvitation[]>(
				invitationsQueryKey,
				(current = []) =>
					current
						.filter((invitation) => !failedEmails.has(invitation.email))
						.map((invitation) =>
							context?.optimisticIdsByEmail.get(invitation.email) ===
							invitation.id
								? { ...invitation, status: "pending" }
								: invitation
						)
			);
			setBatchResults(results);
			if (results.every((result) => result.error === null)) {
				setDraft("");
			}
		},
	});
	const joinLinkMutation = useMutation({
		mutationFn: async () =>
			await resetOrganizationJoinLink({
				mode: "direct",
				organizationId: currentOrganization.id,
			}),
		mutationKey: [
			"onboarding",
			"organization-join-link",
			currentOrganization.id,
		],
		onError: (_error, _variables, previousJoinLink) => {
			queryClient.setQueryData(joinLinkQueryKey, previousJoinLink);
		},
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: joinLinkQueryKey });
			setCopyStatus("idle");
			return queryClient.getQueryData(joinLinkQueryKey);
		},
		onSuccess: (joinLink) => {
			queryClient.setQueryData(joinLinkQueryKey, joinLink);
		},
	});
	const visibleInvitations = useMemo(
		() =>
			(invitationsQuery.data ?? []).filter((invitation) =>
				["pending", "sending"].includes(invitation.status ?? "")
			),
		[invitationsQuery.data]
	);

	const submitInvitations = () => {
		const parsed = parseOrganizationInviteEmails(draft);
		if (parsed.emails.length === 0) {
			setValidationMessage("Enter at least one email address.");
			return;
		}
		if (parsed.invalidEmails.length > 0) {
			setValidationMessage(
				`Check ${formatList(parsed.invalidEmails)} and try again.`
			);
			return;
		}
		if (parsed.emails.length > MAX_INVITES_PER_BATCH) {
			setValidationMessage(
				`Send up to ${MAX_INVITES_PER_BATCH} invitations at a time.`
			);
			return;
		}
		setValidationMessage(null);
		setBatchResults([]);
		inviteMutation.mutate(parsed.emails);
	};

	return (
		<div className="flex flex-1 flex-col">
			<InvitationAccessContent
				canInvite={canInvite}
				isPersonalWorkspace={currentOrganization.isPersonal === true}
				roleError={roleQuery.isError}
				rolePending={roleQuery.isPending}
			>
				<InvitationManager
					batchResults={batchResults}
					copyStatus={copyStatus}
					draft={draft}
					invitePending={inviteMutation.isPending}
					joinLink={joinLinkQuery.data ?? null}
					joinLinkError={
						joinLinkMutation.error?.message ??
						joinLinkQuery.error?.message ??
						null
					}
					joinLinkPending={
						joinLinkMutation.isPending || joinLinkQuery.isPending
					}
					onCopy={(url) => {
						copyTextToClipboard(url)
							.then((didCopy) => setCopyStatus(didCopy ? "copied" : "failed"))
							.catch(() => setCopyStatus("failed"));
					}}
					onDraftChange={(value) => {
						setDraft(value);
						setValidationMessage(null);
					}}
					onGenerateJoinLink={() => joinLinkMutation.mutate()}
					onSubmitInvitations={submitInvitations}
					pendingInvitationCount={visibleInvitations.length}
					validationMessage={validationMessage}
				/>
			</InvitationAccessContent>
			<div className="mt-auto flex items-center justify-between gap-4 pt-6">
				<p className="text-muted-foreground text-xs">
					Optional. Invite more people later from Directory.
				</p>
				<Button onClick={input.onContinue} type="button">
					Continue
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
		</div>
	);
}

function InvitationAccessContent(input: {
	canInvite: boolean;
	children: ReactNode;
	isPersonalWorkspace: boolean;
	roleError: boolean;
	rolePending: boolean;
}) {
	if (input.isPersonalWorkspace) {
		return (
			<ReadOnlyInvitationState>
				Invites become available after you create or join an organization.
			</ReadOnlyInvitationState>
		);
	}
	if (input.roleError) {
		return (
			<ReadOnlyInvitationState tone="error">
				OpenMeld could not confirm your invitation permissions. You can continue
				and invite teammates later.
			</ReadOnlyInvitationState>
		);
	}
	if (input.rolePending) {
		return (
			<div className="rounded-md border border-border/75 bg-card/25 p-4">
				<p className="text-muted-foreground text-sm">
					Checking who can invite teammates…
				</p>
			</div>
		);
	}
	if (!input.canInvite) {
		return (
			<ReadOnlyInvitationState>
				An organization owner or admin can invite teammates. Your setup is
				already saved.
			</ReadOnlyInvitationState>
		);
	}
	return input.children;
}

function InvitationManager(input: {
	batchResults: InviteBatchResult[];
	copyStatus: CopyStatus;
	draft: string;
	invitePending: boolean;
	joinLink: OrganizationJoinLink | null;
	joinLinkError: string | null;
	joinLinkPending: boolean;
	onCopy: (url: string) => void;
	onDraftChange: (value: string) => void;
	onGenerateJoinLink: () => void;
	onSubmitInvitations: () => void;
	pendingInvitationCount: number;
	validationMessage: string | null;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-md border border-border/75 bg-card/25 p-4">
				<div className="flex items-center gap-2">
					<EnvelopeSimpleIcon
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
					<p className="font-medium text-sm">Invite by email</p>
				</div>
				<Textarea
					aria-label="Teammate email addresses"
					className="mt-3 min-h-24 resize-none"
					disabled={input.invitePending}
					onChange={(event) => input.onDraftChange(event.target.value)}
					placeholder={"alex@acme.com\nmaya@acme.com"}
					value={input.draft}
				/>
				<div className="mt-3 flex items-center justify-between gap-3">
					<p className="text-muted-foreground text-xs">
						Separate emails with a comma or new line.
					</p>
					<Button
						disabled={input.invitePending || input.draft.trim().length === 0}
						onClick={input.onSubmitInvitations}
						size="sm"
						type="button"
					>
						{input.invitePending
							? `Sending ${parseOrganizationInviteEmails(input.draft).emails.length}…`
							: "Send invites"}
					</Button>
				</div>
				{input.validationMessage ? (
					<p className="mt-3 text-destructive text-xs">
						{input.validationMessage}
					</p>
				) : null}
				<InvitationProgress
					batchResults={input.batchResults}
					invitePending={input.invitePending}
					pendingInvitationCount={input.pendingInvitationCount}
				/>
			</div>

			<div className="rounded-md border border-border/75 bg-card/25 p-4">
				<div className="flex items-center gap-2">
					<LinkIcon
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
					<p className="font-medium text-sm">Share an invite link</p>
				</div>
				<p className="mt-1 text-muted-foreground text-xs leading-5">
					Anyone with this link can join as a member. No approval needed. The
					link expires after 30 days.
				</p>
				<InviteLinkControl
					copyStatus={input.copyStatus}
					joinLink={input.joinLink}
					joinLinkPending={input.joinLinkPending}
					onCopy={input.onCopy}
					onGenerateJoinLink={input.onGenerateJoinLink}
				/>
				{input.joinLinkError ? (
					<p className="mt-3 text-destructive text-xs">{input.joinLinkError}</p>
				) : null}
				{input.copyStatus === "failed" ? (
					<p className="mt-2 text-destructive text-xs">
						Could not copy. Select the link and copy it manually.
					</p>
				) : null}
			</div>
		</div>
	);
}

function InvitationProgress(input: {
	batchResults: InviteBatchResult[];
	invitePending: boolean;
	pendingInvitationCount: number;
}) {
	if (input.batchResults.length > 0) {
		return (
			<div className="mt-3 space-y-2 border-border/60 border-t pt-3">
				{input.batchResults.map((result) => (
					<div
						className="flex items-center justify-between gap-3 text-xs"
						key={result.email}
					>
						<span className="truncate">{result.email}</span>
						<BatchResultStatus
							invitePending={input.invitePending}
							result={result}
						/>
					</div>
				))}
			</div>
		);
	}
	if (input.pendingInvitationCount > 0) {
		return (
			<p className="mt-3 border-border/60 border-t pt-3 text-muted-foreground text-xs">
				{input.pendingInvitationCount} pending{" "}
				{input.pendingInvitationCount === 1 ? "invitation" : "invitations"}
			</p>
		);
	}
	return null;
}

function BatchResultStatus(input: {
	invitePending: boolean;
	result: InviteBatchResult;
}) {
	if (input.result.error) {
		return (
			<span className="flex items-center gap-1.5 text-destructive">
				<WarningCircleIcon aria-hidden="true" className="size-3.5" />
				{input.result.error.message}
			</span>
		);
	}
	return (
		<span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
			<CheckIcon aria-hidden="true" className="size-3.5" />
			{input.invitePending ? "Sending" : "Sent"}
		</span>
	);
}

function InviteLinkControl(input: {
	copyStatus: CopyStatus;
	joinLink: OrganizationJoinLink | null;
	joinLinkPending: boolean;
	onCopy: (url: string) => void;
	onGenerateJoinLink: () => void;
}) {
	if (!input.joinLink) {
		return (
			<Button
				className="mt-3"
				disabled={input.joinLinkPending}
				onClick={input.onGenerateJoinLink}
				size="sm"
				type="button"
				variant="outline"
			>
				{input.joinLinkPending ? "Generating…" : "Generate invite link"}
			</Button>
		);
	}
	return (
		<div className="mt-3 flex items-center gap-2">
			<div className="min-w-0 flex-1 truncate rounded-md border border-border/70 bg-background px-3 py-2 font-mono text-muted-foreground text-xs">
				{input.joinLink.url}
			</div>
			<Button
				aria-label="Copy invite link"
				onClick={() => input.onCopy(input.joinLink?.url ?? "")}
				size="icon"
				type="button"
				variant="outline"
			>
				{input.copyStatus === "copied" ? (
					<CheckIcon aria-hidden="true" />
				) : (
					<CopyIcon aria-hidden="true" />
				)}
			</Button>
		</div>
	);
}

function ReadOnlyInvitationState(input: {
	children: string;
	tone?: "error" | "muted";
}) {
	return (
		<div className="rounded-md border border-border/75 bg-card/25 p-4">
			<p
				className={
					input.tone === "error"
						? "text-destructive text-sm leading-6"
						: "text-muted-foreground text-sm leading-6"
				}
			>
				{input.children}
			</p>
		</div>
	);
}

export function parseOrganizationInviteEmails(input: string): {
	emails: string[];
	invalidEmails: string[];
} {
	const candidates = input
		.split(INVITE_EMAIL_SEPARATOR_PATTERN)
		.map((candidate) => candidate.trim().toLocaleLowerCase())
		.filter(Boolean);
	const uniqueCandidates = [...new Set(candidates)];
	const emails: string[] = [];
	const invalidEmails: string[] = [];
	for (const candidate of uniqueCandidates) {
		if (inviteEmailSchema.safeParse(candidate).success) {
			emails.push(candidate);
		} else {
			invalidEmails.push(candidate);
		}
	}
	return { emails, invalidEmails };
}

function formatList(values: string[]): string {
	if (values.length <= 2) {
		return values.join(" and ");
	}
	return `${values.slice(0, 2).join(", ")} and ${values.length - 2} more`;
}

function toError(error: unknown, fallbackMessage: string): Error {
	return error instanceof Error ? error : new Error(fallbackMessage);
}
