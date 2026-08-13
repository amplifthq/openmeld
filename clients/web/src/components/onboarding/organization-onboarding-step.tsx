"use client";

import { Button } from "@openmeld/ui/components/button";
import { Card } from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	ArrowRightIcon,
	BuildingsIcon,
	CheckIcon,
	LinkIcon,
	PlusIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import type { OrganizationOnboardingPreview } from "#/components/onboarding/organization-onboarding-demo";
import { OrganizationIdentityMark } from "#/components/organizations/organization-identity-mark";
import {
	acceptOrganizationInvitation,
	acceptOrganizationJoinLink,
	createOrganization,
	listCurrentUserOrganizationInvitations,
	listOrganizations,
	type OrganizationCreateInput,
	previewOrganizationJoinLink,
	type UserOrganizationInvitation,
} from "#/lib/organizations/auth-organizations";
import type {
	OrganizationScopeResolution,
	OrganizationSummary,
} from "#/lib/organizations/organization-types";
import { organizationScopeQueryKeys } from "#/query/organizations/organization-scope";

type OrganizationChoiceMode = "choose" | "create" | "join";
type OrganizationMutationContext = {
	optimisticOrganization: OrganizationSummary;
	snapshots: OrganizationScopeSnapshot[];
};
type PendingInvitationMutationContext = OrganizationMutationContext & {
	previousInvitations: UserOrganizationInvitation[] | undefined;
};

export function OrganizationOnboardingStep(input: {
	currentOrganization: OrganizationSummary;
	currentUserId: string;
	onOrganizationChosen: (organization: OrganizationSummary) => Promise<void>;
	onPreviewOrganizationChange: (
		organization: OrganizationOnboardingPreview
	) => void;
	organizations: OrganizationSummary[];
}) {
	const queryClient = useQueryClient();
	const [mode, setMode] = useState<OrganizationChoiceMode>("choose");
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [inviteLink, setInviteLink] = useState("");
	const slugEditedRef = useRef(false);
	const personalWorkspace = input.organizations.find(
		(organization) => organization.isPersonal === true
	);
	const teamOrganizations = input.organizations.filter(
		(organization) => organization.isPersonal !== true
	);
	const userInvitationsQueryKey = organizationScopeQueryKeys.userInvitations(
		input.currentUserId
	);
	const userInvitationsQuery = useQuery({
		enabled: mode === "choose",
		queryFn: listCurrentUserOrganizationInvitations,
		queryKey: userInvitationsQueryKey,
		refetchOnWindowFocus: true,
		retry: 1,
		staleTime: 10_000,
	});
	const pendingInvitations = (userInvitationsQuery.data ?? []).filter(
		(invitation) =>
			invitation.status === "pending" &&
			!input.organizations.some(
				(organization) => organization.id === invitation.organizationId
			)
	);

	const createMutation = useMutation<
		OrganizationSummary,
		Error,
		OrganizationCreateInput,
		OrganizationMutationContext
	>({
		mutationFn: createOrganization,
		mutationKey: ["onboarding", "organization", "create"],
		onError: (_error, _variables, context) => {
			restoreOrganizationScopeSnapshots(queryClient, context?.snapshots);
		},
		onMutate: async (variables) => {
			const optimisticOrganization: OrganizationSummary = {
				id: `optimistic:${variables.slug}`,
				isPersonal: false,
				name: variables.name,
				slug: variables.slug,
			};
			const snapshots = await addOptimisticOrganization({
				organization: optimisticOrganization,
				queryClient,
			});
			return { optimisticOrganization, snapshots };
		},
		onSettled: async () => {
			await queryClient.invalidateQueries({
				queryKey: organizationScopeQueryKeys.all,
			});
		},
		onSuccess: (organization, _variables, context) => {
			replaceOptimisticOrganization({
				organization,
				optimisticId: context.optimisticOrganization.id,
				queryClient,
			});
		},
	});
	const previewMutation = useMutation({
		mutationFn: async (value: string) =>
			await previewOrganizationJoinLink({
				token: extractJoinLinkToken(value),
			}),
		mutationKey: ["onboarding", "organization", "join-link", "preview"],
	});
	const acceptJoinLinkMutation = useMutation<
		Awaited<ReturnType<typeof acceptOrganizationJoinLink>>,
		Error,
		string,
		OrganizationMutationContext
	>({
		mutationFn: async (value: string) =>
			await acceptOrganizationJoinLink({
				token: extractJoinLinkToken(value),
			}),
		mutationKey: ["onboarding", "organization", "join-link", "accept"],
		onError: (_error, _variables, context) => {
			restoreOrganizationScopeSnapshots(queryClient, context?.snapshots);
		},
		onMutate: async () => {
			const preview = previewMutation.data;
			if (!preview?.active) {
				throw new Error("Check the invite link before joining.");
			}
			const optimisticOrganization: OrganizationSummary = {
				id: `optimistic:join:${preview.organizationSlug}`,
				isPersonal: false,
				name: preview.organizationName,
				slug: preview.organizationSlug,
			};
			const snapshots = await addOptimisticOrganization({
				organization: optimisticOrganization,
				queryClient,
			});
			return { optimisticOrganization, snapshots };
		},
		onSettled: async () => {
			await queryClient.invalidateQueries({
				queryKey: organizationScopeQueryKeys.all,
			});
		},
		onSuccess: (result, _variables, context) => {
			replaceOptimisticOrganization({
				organization: {
					id: result.organizationId,
					isPersonal: false,
					name: result.organizationName,
					slug: result.organizationSlug,
				},
				optimisticId: context.optimisticOrganization.id,
				queryClient,
			});
		},
	});
	const acceptPendingInvitationMutation = useMutation<
		OrganizationSummary,
		Error,
		UserOrganizationInvitation,
		PendingInvitationMutationContext
	>({
		mutationFn: async (invitation) => {
			const accepted = await acceptOrganizationInvitation({
				invitationId: invitation.id,
			});
			const organizations = await listOrganizations();
			const organization = organizations.find(
				(candidate) => candidate.id === accepted.organizationId
			);
			if (!organization) {
				throw new Error(
					"OpenMeld joined the organization but could not load it yet."
				);
			}
			return organization;
		},
		mutationKey: ["onboarding", "organization", "pending-invitation", "accept"],
		onError: (_error, _invitation, context) => {
			restoreOrganizationScopeSnapshots(queryClient, context?.snapshots);
			queryClient.setQueryData(
				userInvitationsQueryKey,
				context?.previousInvitations
			);
		},
		onMutate: async (invitation) => {
			await queryClient.cancelQueries({ queryKey: userInvitationsQueryKey });
			const previousInvitations = queryClient.getQueryData<
				UserOrganizationInvitation[]
			>(userInvitationsQueryKey);
			queryClient.setQueryData<UserOrganizationInvitation[]>(
				userInvitationsQueryKey,
				(current = []) =>
					current.filter((candidate) => candidate.id !== invitation.id)
			);
			const optimisticOrganization: OrganizationSummary = {
				id: invitation.organizationId,
				isPersonal: false,
				name: invitation.organizationName,
				slug: deriveOrganizationSlug(invitation.organizationName),
			};
			const snapshots = await addOptimisticOrganization({
				organization: optimisticOrganization,
				queryClient,
			});
			return {
				optimisticOrganization,
				previousInvitations,
				snapshots,
			};
		},
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: userInvitationsQueryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: organizationScopeQueryKeys.all,
				}),
			]);
		},
		onSuccess: (organization, _invitation, context) => {
			replaceOptimisticOrganization({
				organization,
				optimisticId: context.optimisticOrganization.id,
				queryClient,
			});
		},
	});

	if (mode === "create") {
		return (
			<OrganizationCreateForm
				error={createMutation.error}
				isPending={createMutation.isPending}
				name={name}
				onBack={() => {
					createMutation.reset();
					setMode("choose");
					input.onPreviewOrganizationChange(
						toOrganizationOnboardingPreview(input.currentOrganization)
					);
				}}
				onNameChange={(value) => {
					setName(value);
					input.onPreviewOrganizationChange({
						id: "preview:create",
						isPersonal: false,
						logo: null,
						name: value,
					});
					if (!slugEditedRef.current) {
						setSlug(deriveOrganizationSlug(value));
					}
				}}
				onSlugChange={(value) => {
					slugEditedRef.current = true;
					setSlug(value);
				}}
				onSubmit={async () => {
					const organization = await createMutation.mutateAsync({
						name: name.trim(),
						slug: slug.trim(),
					});
					await input.onOrganizationChosen(organization);
				}}
				slug={slug}
			/>
		);
	}
	if (mode === "join") {
		return (
			<OrganizationJoinForm
				acceptError={acceptJoinLinkMutation.error}
				inviteLink={inviteLink}
				isAccepting={acceptJoinLinkMutation.isPending}
				isPreviewing={previewMutation.isPending}
				onAccept={async () => {
					const result = await acceptJoinLinkMutation.mutateAsync(inviteLink);
					await input.onOrganizationChosen({
						id: result.organizationId,
						isPersonal: false,
						name: result.organizationName,
						slug: result.organizationSlug,
					});
				}}
				onBack={() => {
					acceptJoinLinkMutation.reset();
					previewMutation.reset();
					setMode("choose");
					input.onPreviewOrganizationChange(
						toOrganizationOnboardingPreview(input.currentOrganization)
					);
				}}
				onChange={(value) => {
					setInviteLink(value);
					previewMutation.reset();
					acceptJoinLinkMutation.reset();
				}}
				onPreview={async () => {
					const preview = await previewMutation.mutateAsync(inviteLink);
					if (preview.active) {
						input.onPreviewOrganizationChange({
							id: "preview:join",
							isPersonal: false,
							logo: null,
							name: preview.organizationName,
						});
					}
				}}
				preview={previewMutation.data}
				previewError={previewMutation.error}
			/>
		);
	}

	return (
		<div className="flex flex-1 flex-col">
			{personalWorkspace ? (
				<div className="mb-5">
					<ChoiceGroupLabel>Personal</ChoiceGroupLabel>
					<OrganizationChoice
						current={personalWorkspace.id === input.currentOrganization.id}
						description="For you only. Create an organization to connect Slack or invite teammates."
						icon={
							<UserIcon
								aria-hidden="true"
								className="size-4.5 text-muted-foreground"
							/>
						}
						onClick={() => {
							input.onPreviewOrganizationChange(
								toOrganizationOnboardingPreview(personalWorkspace)
							);
							input
								.onOrganizationChosen(personalWorkspace)
								.catch((error: unknown) => {
									console.error("OpenMeld could not open onboarding.", {
										error,
										organizationId: personalWorkspace.id,
									});
								});
						}}
						organization={personalWorkspace}
						title="Personal Workspace"
					/>
				</div>
			) : null}
			{pendingInvitations.length > 0 ? (
				<div className="mb-5">
					<ChoiceGroupLabel>You’re invited</ChoiceGroupLabel>
					<div className="grid gap-2">
						{pendingInvitations.map((invitation) => (
							<PendingInvitationChoice
								invitation={invitation}
								isPending={
									acceptPendingInvitationMutation.isPending &&
									acceptPendingInvitationMutation.variables?.id ===
										invitation.id
								}
								key={invitation.id}
								onAccept={() => {
									acceptPendingInvitationMutation
										.mutateAsync(invitation)
										.then(input.onOrganizationChosen)
										.catch(() => undefined);
								}}
							/>
						))}
					</div>
					{acceptPendingInvitationMutation.error ? (
						<p className="mt-2 text-destructive text-xs">
							{acceptPendingInvitationMutation.error.message}
						</p>
					) : null}
				</div>
			) : null}
			{userInvitationsQuery.isError ? (
				<p className="mb-4 text-muted-foreground text-xs">
					OpenMeld could not check pending email invitations. You can still join
					with an invite link.
				</p>
			) : null}
			{teamOrganizations.length > 0 ? (
				<div>
					<ChoiceGroupLabel>Organizations</ChoiceGroupLabel>
					<div className="grid gap-2">
						{teamOrganizations.map((organization) => (
							<OrganizationChoice
								current={organization.id === input.currentOrganization.id}
								key={organization.id}
								onClick={() => {
									input.onPreviewOrganizationChange(
										toOrganizationOnboardingPreview(organization)
									);
									input
										.onOrganizationChosen(organization)
										.catch((error: unknown) => {
											console.error("OpenMeld could not open onboarding.", {
												error,
												organizationId: organization.id,
											});
										});
								}}
								organization={organization}
							/>
						))}
					</div>
				</div>
			) : null}

			<div className="mt-4 grid gap-2 sm:grid-cols-2">
				<ActionChoice
					description="Set up OpenMeld for a team."
					icon={<PlusIcon aria-hidden="true" className="size-4" />}
					onClick={() => setMode("create")}
					title="Create an organization"
				/>
				<ActionChoice
					description="Use an invitation from your team."
					icon={<LinkIcon aria-hidden="true" className="size-4" />}
					onClick={() => setMode("join")}
					title="Join with an invite link"
				/>
			</div>
		</div>
	);
}

function ChoiceGroupLabel(input: { children: React.ReactNode }) {
	return (
		<p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-[0.14em]">
			{input.children}
		</p>
	);
}

function toOrganizationOnboardingPreview(
	organization: OrganizationSummary
): OrganizationOnboardingPreview {
	return {
		...organization,
		isPersonal: organization.isPersonal === true,
	};
}

function PendingInvitationChoice(input: {
	invitation: UserOrganizationInvitation;
	isPending: boolean;
	onAccept: () => void;
}) {
	return (
		<Card className="flex flex-row items-center gap-3 rounded-md bg-card/55 p-3.5">
			<span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
				<BuildingsIcon aria-hidden="true" className="size-4.5" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">
					{input.invitation.organizationName}
				</p>
				<p className="mt-0.5 text-muted-foreground text-xs">
					Join as {input.invitation.role ?? "member"}
				</p>
			</div>
			<Button
				disabled={input.isPending}
				onClick={input.onAccept}
				size="sm"
				type="button"
			>
				{input.isPending ? "Joining…" : "Join"}
			</Button>
		</Card>
	);
}

function OrganizationChoice(input: {
	current: boolean;
	description?: string;
	icon?: React.ReactNode;
	onClick: () => void;
	organization: OrganizationSummary;
	title?: string;
}) {
	return (
		<Card className="gap-0 overflow-visible rounded-md bg-card/35 py-0">
			<button
				className="group flex w-full items-center gap-3 rounded-md p-3.5 text-left transition-[background-color,transform] hover:-translate-y-px hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={input.onClick}
				type="button"
			>
				{input.icon ? (
					<span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-background">
						{input.icon}
					</span>
				) : (
					<OrganizationIdentityMark
						className="size-10 border border-border bg-background text-muted-foreground text-xs"
						organization={input.organization}
					/>
				)}
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-sm">
						{input.title ?? input.organization.name}
					</span>
					<span className="mt-0.5 block truncate text-muted-foreground text-xs">
						{input.description ?? `/${input.organization.slug}`}
					</span>
				</span>
				{input.current ? (
					<span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
						Current
					</span>
				) : null}
				<ArrowRightIcon
					aria-hidden="true"
					className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
				/>
			</button>
		</Card>
	);
}

function ActionChoice(input: {
	description: string;
	icon: React.ReactNode;
	onClick: () => void;
	title: string;
}) {
	return (
		<Card className="gap-0 overflow-visible rounded-md border border-border border-dashed bg-transparent py-0 ring-0">
			<button
				className="group flex min-h-24 flex-col items-start justify-between rounded-md p-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={input.onClick}
				type="button"
			>
				<span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
					{input.icon}
				</span>
				<span className="mt-3">
					<span className="block font-medium text-sm">{input.title}</span>
					<span className="mt-0.5 block text-muted-foreground text-xs">
						{input.description}
					</span>
				</span>
			</button>
		</Card>
	);
}

function OrganizationCreateForm(input: {
	error: Error | null;
	isPending: boolean;
	name: string;
	onBack: () => void;
	onNameChange: (value: string) => void;
	onSlugChange: (value: string) => void;
	onSubmit: () => Promise<void>;
	slug: string;
}) {
	const canSubmit =
		input.name.trim().length > 0 &&
		input.slug.trim().length > 0 &&
		!input.isPending;
	return (
		<form
			className="flex flex-1 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				if (canSubmit) {
					input.onSubmit().catch(() => undefined);
				}
			}}
		>
			<div className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="onboarding-organization-name">
						Organization name
					</Label>
					<Input
						autoFocus
						disabled={input.isPending}
						id="onboarding-organization-name"
						onChange={(event) => input.onNameChange(event.target.value)}
						placeholder="Acme"
						value={input.name}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="onboarding-organization-slug">URL slug</Label>
					<Input
						disabled={input.isPending}
						id="onboarding-organization-slug"
						onChange={(event) => input.onSlugChange(event.target.value)}
						placeholder="acme"
						value={input.slug}
					/>
				</div>
				<MutationError error={input.error} />
			</div>
			<div className="mt-auto flex items-center justify-between gap-3 pt-8">
				<Button onClick={input.onBack} type="button" variant="ghost">
					Back
				</Button>
				<Button disabled={!canSubmit} type="submit">
					{input.isPending ? "Creating…" : "Create and continue"}
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
		</form>
	);
}

type JoinLinkPreview =
	| { active: false; ok: true }
	| {
			active: true;
			ok: true;
			organizationName: string;
			organizationSlug: string;
	  };

function OrganizationJoinForm(input: {
	acceptError: Error | null;
	inviteLink: string;
	isAccepting: boolean;
	isPreviewing: boolean;
	onAccept: () => Promise<void>;
	onBack: () => void;
	onChange: (value: string) => void;
	onPreview: () => Promise<void>;
	preview: JoinLinkPreview | undefined;
	previewError: Error | null;
}) {
	const isBusy = input.isAccepting || input.isPreviewing;
	const activePreview = input.preview?.active ? input.preview : null;
	return (
		<form
			className="flex flex-1 flex-col"
			onSubmit={(event: FormEvent<HTMLFormElement>) => {
				event.preventDefault();
				const action = activePreview ? input.onAccept : input.onPreview;
				action().catch(() => undefined);
			}}
		>
			<div className="grid gap-2">
				<Label htmlFor="onboarding-invite-link">Invite link</Label>
				<Input
					autoFocus
					disabled={isBusy}
					id="onboarding-invite-link"
					onChange={(event) => input.onChange(event.target.value)}
					placeholder="https://app.openmeld.dev/join-organization?token=…"
					value={input.inviteLink}
				/>
				<p className="text-muted-foreground text-xs leading-5">
					We’ll check the organization before you join.
				</p>
			</div>

			{activePreview ? (
				<div className="mt-5 flex items-center gap-3 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] p-3.5">
					<span className="grid size-8 place-items-center rounded-md bg-emerald-500/10 text-emerald-500">
						<CheckIcon aria-hidden="true" className="size-4" />
					</span>
					<span>
						<span className="block font-medium text-sm">
							{activePreview.organizationName}
						</span>
						<span className="block text-muted-foreground text-xs">
							Ready to join
						</span>
					</span>
				</div>
			) : null}
			{!activePreview && input.preview?.active === false ? (
				<p className="mt-4 text-destructive text-sm" role="alert">
					This invite link is no longer active.
				</p>
			) : null}

			<MutationError error={input.previewError ?? input.acceptError} />
			<div className="mt-auto flex items-center justify-between gap-3 pt-8">
				<Button onClick={input.onBack} type="button" variant="ghost">
					Back
				</Button>
				<Button
					disabled={input.inviteLink.trim().length === 0 || isBusy}
					type="submit"
				>
					{resolveJoinButtonLabel({
						activePreview,
						isAccepting: input.isAccepting,
						isPreviewing: input.isPreviewing,
					})}
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
		</form>
	);
}

function resolveJoinButtonLabel(input: {
	activePreview: (JoinLinkPreview & { active: true }) | null;
	isAccepting: boolean;
	isPreviewing: boolean;
}): string {
	if (input.isAccepting) {
		return "Joining…";
	}
	if (input.isPreviewing) {
		return "Checking…";
	}
	if (input.activePreview) {
		return `Join ${input.activePreview.organizationName}`;
	}
	return "Check invite";
}

function MutationError(input: { error: Error | null }) {
	return input.error ? (
		<p className="mt-3 text-destructive text-sm" role="alert">
			{input.error.message}
		</p>
	) : null;
}

type OrganizationScopeSnapshot = [
	readonly unknown[],
	OrganizationScopeResolution | undefined,
];

async function addOptimisticOrganization(input: {
	organization: OrganizationSummary;
	queryClient: ReturnType<typeof useQueryClient>;
}): Promise<OrganizationScopeSnapshot[]> {
	await input.queryClient.cancelQueries({
		queryKey: organizationScopeQueryKeys.all,
	});
	const snapshots =
		input.queryClient.getQueriesData<OrganizationScopeResolution>({
			queryKey: organizationScopeQueryKeys.all,
		});
	input.queryClient.setQueriesData<OrganizationScopeResolution>(
		{ queryKey: organizationScopeQueryKeys.all },
		(scope) => {
			if (
				!scope ||
				scope.organizations.some(
					(organization) => organization.slug === input.organization.slug
				)
			) {
				return scope;
			}
			return {
				...scope,
				organizations: [...scope.organizations, input.organization],
			};
		}
	);
	return snapshots;
}

function replaceOptimisticOrganization(input: {
	optimisticId: string;
	organization: OrganizationSummary;
	queryClient: ReturnType<typeof useQueryClient>;
}) {
	input.queryClient.setQueriesData<OrganizationScopeResolution>(
		{ queryKey: organizationScopeQueryKeys.all },
		(scope) =>
			scope
				? {
						...scope,
						organizations: scope.organizations.map((organization) =>
							organization.id === input.optimisticId
								? input.organization
								: organization
						),
					}
				: scope
	);
}

function restoreOrganizationScopeSnapshots(
	queryClient: ReturnType<typeof useQueryClient>,
	snapshots: OrganizationScopeSnapshot[] | undefined
) {
	for (const [queryKey, value] of snapshots ?? []) {
		queryClient.setQueryData(queryKey, value);
	}
}

function extractJoinLinkToken(value: string): string {
	const normalized = value.trim();
	if (normalized.startsWith("joinlink_")) {
		return normalized;
	}
	try {
		const url = new URL(normalized);
		const token = url.searchParams.get("token");
		if (token) {
			return token;
		}
	} catch {
		// The server-owned schema returns the exact invalid-input message.
	}
	return normalized;
}

function deriveOrganizationSlug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}
