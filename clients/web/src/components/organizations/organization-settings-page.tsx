"use client";

import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { OrganizationInformationProtectionSection } from "#/components/organizations/organization-information-protection-section";
import { OrganizationLogoSection } from "#/components/organizations/organization-logo-section";
import {
	deleteOrganization,
	type OrganizationInviteRole,
	removeOrganizationMember,
	updateOrganization,
	updateOrganizationMemberRole,
} from "#/lib/organizations/auth-organizations";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	buildOrganizationOrgSettingsPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import {
	organizationDirectoryQueryFilters,
	organizationDirectoryQueryOptions,
	organizationMemberRoleQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { applyOrganizationDeletionToScopeCache } from "#/query/organizations/organization-scope";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import { OrganizationInvitationRecords } from "./organization-invitation-records";
import { OrganizationInviteControls } from "./organization-invite-controls";

const MEMBER_ROLE_OPTIONS = [
	{ label: "Member", value: "member" },
	{ label: "Admin", value: "admin" },
] as const satisfies readonly {
	label: string;
	value: OrganizationInviteRole;
}[];

type DirectoryMember = OrganizationDirectoryResponse["members"][number];

export function OrganizationSettingsPage({
	section = "general",
}: {
	section?: "general" | "members" | "invitations" | "security";
}) {
	const { currentOrganization, currentUserId, organizations } =
		useAppOrganization();
	return (
		<OrganizationSettingsContent
			currentOrganization={currentOrganization}
			currentUserId={currentUserId}
			organizations={organizations}
			section={section}
		/>
	);
}

function OrganizationSettingsContent(input: {
	section: "general" | "members" | "invitations" | "security";
	currentOrganization: OrganizationSummary;
	currentUserId: string;
	organizations: OrganizationSummary[];
}) {
	const organization = input.currentOrganization;
	const personal = organization.isPersonal === true;
	const role = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !personal,
			organizationId: organization.id,
			userId: input.currentUserId,
		})
	);
	const canManage =
		personal ||
		canManageOrganizationArea(role.data, { organization: ["update"] });
	const titles = {
		general: "General",
		members: "Members",
		invitations: "Invitations",
		security: "Security",
	};
	const descriptions = {
		general: "Manage your organization’s name, logo, and URL.",
		members: "Manage members and their roles.",
		invitations: "Manage invitations and view approval history.",
		security: "Manage information protection for your organization.",
	};
	let content: ReactNode;
	if (!personal && role.isPending) {
		content = (
			<p className="text-muted-foreground text-sm">Loading settings…</p>
		);
	} else if (!personal && role.error) {
		content = <p role="alert">{role.error.message}</p>;
	} else if (personal && input.section !== "general") {
		content = <p>This setting is available in team organizations.</p>;
	} else {
		switch (input.section) {
			case "members":
				content = (
					<OrganizationMembersSettings
						canManage={canManage}
						canRemoveMembers={canManageOrganizationArea(role.data, {
							member: ["delete"],
						})}
						currentUserId={input.currentUserId}
						organizationId={organization.id}
					/>
				);
				break;
			case "invitations":
				content = (
					<>
						<OrganizationInviteControls
							canManage={canManage}
							organizationId={organization.id}
						/>
						<OrganizationInvitationRecords
							canReview={canManage}
							organizationId={organization.id}
						/>
					</>
				);
				break;
			case "security":
				content = canManageOrganizationArea(role.data, {
					informationProtection: ["manage"],
				}) ? (
					<OrganizationInformationProtectionSection
						organizationId={organization.id}
					/>
				) : (
					<p>Only organization owners and admins can manage these settings.</p>
				);
				break;
			default:
				content = (
					<OrganizationGeneralSettings
						{...input}
						canDelete={canManageOrganizationArea(role.data, {
							organization: ["delete"],
						})}
						canManage={canManage}
						canManageLogo={
							role.isSuccess
								? canManageOrganizationArea(role.data, {
										organizationLogo: ["update"],
									})
								: null
						}
						roleError={role.error?.message ?? null}
					/>
				);
		}
	}
	return (
		<>
			<section className="flex flex-col gap-1">
				<p className="font-medium text-muted-foreground text-xs">
					{organization.name}
				</p>
				<h1 className="font-medium text-2xl text-foreground">
					{titles[input.section]}
				</h1>
				<p className="max-w-2xl text-muted-foreground text-sm leading-6">
					{descriptions[input.section]}
				</p>
			</section>
			{content}
		</>
	);
}

function OrganizationMembersSettings(input: {
	organizationId: string;
	currentUserId: string;
	canManage: boolean;
	canRemoveMembers: boolean;
}) {
	const directory = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	return (
		<OrganizationMembersSection
			{...input}
			directory={directory.data ?? null}
			errorMessage={directory.error?.message ?? null}
			isPending={directory.isPending}
		/>
	);
}

function OrganizationGeneralSettings(input: {
	currentOrganization: OrganizationSummary;
	currentUserId: string;
	organizations: OrganizationSummary[];
	canManage: boolean;
	canDelete: boolean;
	canManageLogo: boolean | null;
	roleError: string | null;
}) {
	const organization = input.currentOrganization;
	return (
		<>
			{organization.isPersonal ? null : (
				<OrganizationLogoSection
					canManage={input.canManageLogo}
					organization={organization}
					roleError={input.roleError}
				/>
			)}
			<OrganizationIdentitySection
				canManage={input.canManage}
				organization={organization}
				ownerAccountId={input.currentUserId}
			/>
			{organization.isPersonal ? (
				<PersonalWorkspaceLifecycleSection />
			) : (
				<DeleteOrganizationSection
					canDelete={input.canDelete}
					organization={organization}
					ownerAccountId={input.currentUserId}
					personalOrganization={
						input.organizations.find((item) => item.isPersonal) ?? null
					}
				/>
			)}
		</>
	);
}

function PersonalWorkspaceLifecycleSection() {
	return (
		<SettingsSection
			description="Your personal workspace stays with your OpenMeld account."
			id="personal-workspace-lifecycle"
			title="Workspace lifecycle"
		>
			<p className="text-muted-foreground text-sm">
				Delete and leave actions are not available for your personal workspace.
			</p>
		</SettingsSection>
	);
}

function DeleteOrganizationSection(input: {
	canDelete: boolean;
	organization: OrganizationSummary;
	ownerAccountId: string;
	personalOrganization: OrganizationSummary | null;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [confirmationText, setConfirmationText] = useState("");
	const canConfirm = confirmationText === "DELETE";
	const deletionAvailable =
		input.canDelete && input.personalOrganization !== null;
	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!input.personalOrganization) {
				throw new Error(
					"OpenMeld could not find your personal workspace. The organization was not deleted."
				);
			}
			await deleteOrganization({
				organizationId: input.organization.id,
			});
		},
		onSuccess: async () => {
			if (!input.personalOrganization) {
				return;
			}
			try {
				await resolveAppQueryPersistenceController().clearOrganization(
					input.ownerAccountId,
					input.organization.id
				);
			} catch (error) {
				// The server-side deletion already succeeded. Keep the user moving to
				// their personal workspace while preserving the local cleanup failure.
				console.error(
					"Failed to clear deleted organization browser data.",
					error
				);
			}
			applyOrganizationDeletionToScopeCache({
				deletedOrganizationId: input.organization.id,
				deletedOrganizationSlug: input.organization.slug,
				nextActiveOrganization: input.personalOrganization,
				queryClient,
			});
			queryClient.removeQueries({
				queryKey: organizationQueryKeys.organization(input.organization.id),
			});
			await navigate({
				to: buildOrganizationSpacesPath(input.personalOrganization.slug),
			});
		},
	});

	const handleOpenChange = (nextOpen: boolean) => {
		if (deleteMutation.isPending) {
			return;
		}
		setOpen(nextOpen);
		if (!nextOpen) {
			setConfirmationText("");
			deleteMutation.reset();
		}
	};

	return (
		<SettingsSection
			description="This action permanently removes the organization."
			id="delete-organization"
			title="Delete organization"
		>
			<div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
				<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
					<div className="min-w-0">
						<p className="font-medium text-destructive text-sm">
							Delete {input.organization.name}
						</p>
						<p className="mt-1 text-muted-foreground text-xs leading-5">
							Deletes this organization, its members, invitations, and
							organization record. This cannot be undone.
						</p>
						{input.canDelete ? null : (
							<p className="mt-2 text-muted-foreground text-xs">
								Only the organization owner can delete this organization.
							</p>
						)}
						{input.canDelete && !input.personalOrganization ? (
							<p className="mt-2 text-destructive text-xs">
								OpenMeld could not find your personal workspace. Deletion is not
								available right now.
							</p>
						) : null}
					</div>
					<Button
						disabled={!deletionAvailable}
						onClick={() => handleOpenChange(true)}
						type="button"
						variant="destructive"
					>
						Delete organization
					</Button>
				</div>
			</div>
			<Dialog onOpenChange={handleOpenChange} open={open}>
				<DialogContent className="gap-5 p-6 sm:max-w-lg">
					<DialogHeader>
						<DialogTitle className="text-base">
							Delete {input.organization.name}?
						</DialogTitle>
						<DialogDescription>
							This permanently deletes the organization. Type{" "}
							<strong className="font-medium text-foreground">DELETE</strong> to
							confirm.
						</DialogDescription>
					</DialogHeader>
					<form
						className="space-y-5"
						onSubmit={(event) => {
							event.preventDefault();
							if (!(canConfirm && !deleteMutation.isPending)) {
								return;
							}
							deleteMutation.mutate();
						}}
					>
						<div className="grid gap-2">
							<Label htmlFor="delete-organization-confirmation">
								Confirmation
							</Label>
							<Input
								autoComplete="off"
								disabled={deleteMutation.isPending}
								id="delete-organization-confirmation"
								onChange={(event) => setConfirmationText(event.target.value)}
								placeholder="Type DELETE to confirm"
								value={confirmationText}
							/>
						</div>
						{deleteMutation.isError ? (
							<p className="text-destructive text-xs" role="alert">
								{deleteMutation.error.message}
							</p>
						) : null}
						<DialogFooter>
							<Button
								disabled={!canConfirm || deleteMutation.isPending}
								type="submit"
								variant="destructive"
							>
								{deleteMutation.isPending ? "Deleting" : "Delete organization"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</SettingsSection>
	);
}

function OrganizationIdentitySection(input: {
	canManage: boolean;
	organization: OrganizationSummary;
	ownerAccountId: string;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [name, setName] = useState(input.organization.name);
	const [slug, setSlug] = useState(input.organization.slug);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const normalizedName = name.trim();
	const normalizedSlug = slug.trim();
	const hasChanges =
		normalizedName !== input.organization.name ||
		normalizedSlug !== input.organization.slug;
	const updateMutation = useMutation({
		mutationFn: async () => {
			if (!(normalizedName && normalizedSlug && hasChanges)) {
				return;
			}
			await updateOrganization({
				data: {
					name: normalizedName,
					slug: normalizedSlug,
				},
				organizationId: input.organization.id,
			});
		},
		onSuccess: async () => {
			if (normalizedSlug !== input.organization.slug) {
				try {
					await resolveAppQueryPersistenceController().clearOrganization(
						input.ownerAccountId,
						input.organization.id
					);
				} catch (error) {
					console.error(
						"Failed to clear renamed organization browser data.",
						error
					);
				}
			}
			await queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.all,
			});
			setSavedMessage("Workspace updated.");
			if (normalizedSlug !== input.organization.slug) {
				await navigate({
					to: buildOrganizationOrgSettingsPath(normalizedSlug),
				});
			}
		},
	});

	useEffect(() => {
		setName(input.organization.name);
		setSlug(input.organization.slug);
		setSavedMessage(null);
	}, [input.organization.name, input.organization.slug]);

	const canSubmit =
		input.canManage &&
		normalizedName.length > 0 &&
		normalizedSlug.length > 0 &&
		hasChanges &&
		!updateMutation.isPending;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit) {
			return;
		}
		setSavedMessage(null);
		updateMutation.mutate();
	};

	return (
		<SettingsSection
			description="The name and URL slug identify this workspace."
			id="organization-identity"
			title="Workspace identity"
		>
			<form className="space-y-4" onSubmit={handleSubmit}>
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="grid gap-2">
						<Label htmlFor="organization-name">Name</Label>
						<Input
							disabled={!input.canManage || updateMutation.isPending}
							id="organization-name"
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="organization-slug">Slug</Label>
						<Input
							disabled={!input.canManage || updateMutation.isPending}
							id="organization-slug"
							onChange={(event) => setSlug(event.target.value)}
							value={slug}
						/>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button disabled={!canSubmit} type="submit" variant="outline">
						{updateMutation.isPending ? "Saving" : "Save changes"}
					</Button>
					{input.canManage ? null : (
						<p className="text-muted-foreground text-xs">
							Only workspace owners and admins can edit identity.
						</p>
					)}
					{updateMutation.isError ? (
						<p className="text-destructive text-xs">
							{updateMutation.error.message}
						</p>
					) : null}
					{savedMessage ? (
						<p className="text-muted-foreground text-xs">{savedMessage}</p>
					) : null}
				</div>
			</form>
		</SettingsSection>
	);
}

function OrganizationMembersSection(input: {
	canManage: boolean;
	canRemoveMembers: boolean;
	currentUserId: string;
	directory: OrganizationDirectoryResponse | null;
	errorMessage: string | null;
	isPending: boolean;
	organizationId: string;
}) {
	return (
		<SettingsSection
			description="Manage members and their organization roles."
			id="organization-members"
			title="Members and roles"
		>
			{input.isPending ? (
				<p className="text-muted-foreground text-sm">Loading members.</p>
			) : null}
			{input.errorMessage ? (
				<p className="text-destructive text-sm">{input.errorMessage}</p>
			) : null}
			{input.directory ? (
				<ul className="overflow-hidden rounded-md border border-border/70">
					{input.directory.members.map((member) => (
						<OrganizationMemberRoleRow
							canManage={input.canManage}
							canRemove={input.canRemoveMembers}
							currentUserId={input.currentUserId}
							key={member.memberId}
							member={member}
							organizationId={input.organizationId}
						/>
					))}
				</ul>
			) : null}
			<div className="mt-3 space-y-1 text-muted-foreground text-xs leading-5">
				<p>Owner — Full control, including deleting the organization.</p>
				<p>
					Admin — Manage members, channels, apps, memory, and the Center Agent.
				</p>
				<p>
					Member — Use spaces and create routines; organization settings are
					read-only.
				</p>
			</div>
		</SettingsSection>
	);
}

function OrganizationMemberRoleRow(input: {
	canManage: boolean;
	canRemove: boolean;
	currentUserId: string;
	member: DirectoryMember;
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const initialRole = normalizeEditableMemberRole(input.member.role);
	const [role, setRole] = useState<OrganizationInviteRole>(initialRole);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const roleMutation = useMutation({
		mutationFn: async () =>
			await updateOrganizationMemberRole({
				memberId: input.member.memberId,
				organizationId: input.organizationId,
				role,
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries(
				organizationDirectoryQueryFilters({
					organizationId: input.organizationId,
				})
			);
			setSavedMessage("Role updated.");
		},
	});
	const removeMutation = useMutation({
		mutationFn: async () =>
			await removeOrganizationMember({
				memberIdOrEmail: input.member.memberId,
				organizationId: input.organizationId,
			}),
		onError: () => {
			setRemoveDialogOpen(false);
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries(
				organizationDirectoryQueryFilters({
					organizationId: input.organizationId,
				})
			);
			setRemoveDialogOpen(false);
		},
	});

	useEffect(() => {
		setRole(initialRole);
		setSavedMessage(null);
	}, [initialRole]);

	const memberName =
		input.member.humanProfile?.profileName ?? input.member.user.name;
	const isOwner = input.member.role === "owner";
	const canEdit = input.canManage && !isOwner;
	const canRemove =
		input.canRemove && !isOwner && input.member.userId !== input.currentUserId;
	const hasChanges = canEdit && role !== input.member.role;
	const isMutating = roleMutation.isPending || removeMutation.isPending;

	return (
		<li className="grid min-w-0 gap-3 border-border/70 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="min-w-0">
				<p className="truncate font-medium text-foreground text-sm">
					{memberName}
				</p>
				<p className="truncate text-muted-foreground text-xs">
					{input.member.user.email}
				</p>
				{roleMutation.isError ? (
					<p className="mt-1 text-destructive text-xs">
						{roleMutation.error.message}
					</p>
				) : null}
				{removeMutation.isError ? (
					<p className="mt-1 text-destructive text-xs" role="alert">
						{removeMutation.error.message}
					</p>
				) : null}
				{savedMessage ? (
					<p className="mt-1 text-muted-foreground text-xs">{savedMessage}</p>
				) : null}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{canEdit ? (
					<Select
						disabled={isMutating}
						onValueChange={(value) =>
							setRole(value === "admin" ? "admin" : "member")
						}
						value={role}
					>
						<SelectTrigger
							aria-label={`Role for ${memberName}`}
							className="w-32"
							displayValue={resolveMemberRoleLabel(role)}
						/>
						<SelectContent>
							{MEMBER_ROLE_OPTIONS.map((option, index) => (
								<SelectItem
									index={index}
									key={option.value}
									value={option.value}
								>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<span className="shrink-0 rounded-sm border border-border px-2 py-1 text-muted-foreground text-xs capitalize">
						{input.member.role}
					</span>
				)}
				{canEdit ? (
					<Button
						disabled={!hasChanges || isMutating}
						onClick={() => {
							setSavedMessage(null);
							roleMutation.mutate();
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						{roleMutation.isPending ? "Saving" : "Save role"}
					</Button>
				) : null}
				{canRemove ? (
					<Button
						aria-label={`Remove ${memberName}`}
						disabled={isMutating}
						onClick={() => {
							setSavedMessage(null);
							removeMutation.reset();
							setRemoveDialogOpen(true);
						}}
						size="sm"
						type="button"
						variant="destructive"
					>
						Remove
					</Button>
				) : null}
			</div>
			<AlertDialog
				onOpenChange={(open) => {
					if (!removeMutation.isPending) {
						setRemoveDialogOpen(open);
						if (!(open || removeMutation.isError)) {
							removeMutation.reset();
						}
					}
				}}
				open={removeDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {memberName}?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. {memberName} will immediately lose
							access to this organization.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={removeMutation.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={removeMutation.isPending}
							onClick={() => removeMutation.mutate()}
							type="button"
							variant="destructive"
						>
							{removeMutation.isPending ? "Removing" : "Remove member"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</li>
	);
}

function normalizeEditableMemberRole(role: string): OrganizationInviteRole {
	return role === "admin" ? "admin" : "member";
}

function resolveMemberRoleLabel(role: OrganizationInviteRole): string {
	return (
		MEMBER_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
	);
}
