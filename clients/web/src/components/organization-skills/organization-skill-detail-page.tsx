"use client";

import { ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS } from "@openmeld/schemas";
import type {
	GetOrganizationSkillResponse,
	OrganizationSkill,
	OrganizationSkillBundle,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Label } from "@openmeld/ui/components/label";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Switch } from "@openmeld/ui/components/switch";
import {
	ArrowClockwiseIcon,
	ArrowLeftIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import {
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { APP_INLINE_BACK_LINK_CLASS_NAME } from "#/components/app/app-inline-navigation";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import { UnsavedChangesGuard } from "#/components/forms/unsaved-changes-guard";
import { OrganizationSkillFiles } from "#/components/organization-skills/organization-skill-files";
import { OrganizationSkillMaintainersDialog } from "#/components/organization-skills/organization-skill-maintainers-dialog";
import { OrganizationSkillPortableFields } from "#/components/organization-skills/organization-skill-portable-fields";
import { OrganizationSkillSourceHistory } from "#/components/organization-skills/organization-skill-source-history";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSkillsPath } from "#/lib/organizations/organization-routes";
import {
	deleteCurrentOrganizationSkill,
	type OrganizationSkillFailure,
	resolveOrganizationSkillErrorMessage,
	setCurrentOrganizationSkillEnabled,
	setCurrentOrganizationSkillMaintainers,
	updateCurrentOrganizationSkill,
} from "#/lib/organizations/organization-skills";
import {
	organizationSkillQueryKeys,
	organizationSkillQueryOptions,
} from "#/query/organizations/organization-skills";

const PORTABLE_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function OrganizationSkillDetailPage(input: { skillId: string }) {
	const { currentOrganization } = useAppOrganization();
	const skillQuery = useQuery(
		organizationSkillQueryOptions({
			organizationId: currentOrganization.id,
			skillId: input.skillId,
		})
	);

	return (
		<OrganizationSkillDetailContent
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
			orgSlug={currentOrganization.slug}
			query={skillQuery}
			skillId={input.skillId}
		/>
	);
}

function OrganizationSkillDetailContent(input: {
	orgSlug: string;
	organizationId: string;
	organizationName: string;
	query: UseQueryResult<GetOrganizationSkillResponse, OrganizationSkillFailure>;
	skillId: string;
}) {
	if (input.query.isPending) {
		return (
			<div className="grid gap-5">
				<Skeleton className="h-5 w-24" />
				<Skeleton className="h-12 w-72" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}
	if (input.query.isError) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-6">
				<h1 className="font-medium text-xl">Could not load Skill</h1>
				<p className="text-muted-foreground text-sm">
					OpenMeld could not load this Organization Skill. Try again.
				</p>
				<Button onClick={() => input.query.refetch()} variant="outline">
					<ArrowClockwiseIcon aria-hidden="true" /> Retry
				</Button>
			</div>
		);
	}
	if (!input.query.data?.skill) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border p-6">
				<h1 className="font-medium text-xl">Skill not found</h1>
				<p className="text-muted-foreground text-sm">
					This Skill may have been removed or belongs to another Organization.
				</p>
				<Link
					className={buttonVariants({ variant: "outline" })}
					to={buildOrganizationSkillsPath(input.orgSlug)}
				>
					<ArrowLeftIcon aria-hidden="true" /> All Skills
				</Link>
			</div>
		);
	}
	return (
		<OrganizationSkillEditor
			organizationId={input.organizationId}
			organizationName={input.organizationName}
			orgSlug={input.orgSlug}
			skill={input.query.data.skill}
		/>
	);
}

function OrganizationSkillEditor(input: {
	orgSlug: string;
	organizationId: string;
	organizationName: string;
	skill: OrganizationSkill;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [bundle, setBundle] = useState(input.skill.bundle);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [maintainersOpen, setMaintainersOpen] = useState(false);
	const [removed, setRemoved] = useState(false);
	const hasUnsavedChanges =
		!removed && canonicalBundle(bundle) !== canonicalBundle(input.skill.bundle);
	const bundleValid =
		PORTABLE_SKILL_NAME_PATTERN.test(bundle.portable.name.trim()) &&
		bundle.portable.description.trim().length > 0 &&
		Object.keys(bundle.portable.metadata).every(
			(key) => key.trim().length > 0
		) &&
		bundle.instructions.length <= ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS;
	const refresh = async (skill: OrganizationSkill) => {
		queryClient.setQueryData(
			organizationSkillQueryKeys.detail(input.organizationId, skill.id),
			{ skill }
		);
		await queryClient.invalidateQueries({
			queryKey: organizationSkillQueryKeys.list(input.organizationId),
		});
	};
	const saveMutation = useMutation({
		mutationFn: async () =>
			await updateCurrentOrganizationSkill({
				bundle,
				expectedActiveReleaseId: input.skill.activeRelease.id,
				expectedOrganizationId: input.organizationId,
				expectedVersion: input.skill.version,
				skillId: input.skill.id,
			}),
		onError: (error) => {
			setErrorMessage(resolveOrganizationSkillErrorMessage(error));
		},
		onMutate: () => {
			setErrorMessage(null);
		},
		onSuccess: async (response) => {
			await refresh(response.skill);
		},
	});
	const enabledMutation = useMutation({
		mutationFn: async (enabled: boolean) =>
			await setCurrentOrganizationSkillEnabled({
				enabled,
				expectedOrganizationId: input.organizationId,
				expectedVersion: input.skill.version,
				skillId: input.skill.id,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: async (response) => await refresh(response.skill),
	});
	const maintainersMutation = useMutation({
		mutationFn: async (maintainerUserIds: string[]) =>
			await setCurrentOrganizationSkillMaintainers({
				expectedOrganizationId: input.organizationId,
				expectedVersion: input.skill.version,
				maintainerUserIds,
				skillId: input.skill.id,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: async (response) => {
			setMaintainersOpen(false);
			await refresh(response.skill);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async () =>
			await deleteCurrentOrganizationSkill({
				expectedOrganizationId: input.organizationId,
				expectedVersion: input.skill.version,
				skillId: input.skill.id,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: async () => {
			setRemoved(true);
			setDeleteOpen(false);
			await queryClient.invalidateQueries({
				queryKey: organizationSkillQueryKeys.list(input.organizationId),
			});
			await navigate({
				ignoreBlocker: true,
				to: buildOrganizationSkillsPath(input.orgSlug),
			});
		},
	});
	const save = async (): Promise<boolean> => {
		if (!(bundleValid && hasUnsavedChanges) || saveMutation.isPending) {
			return false;
		}
		try {
			await saveMutation.mutateAsync();
			return true;
		} catch {
			return false;
		}
	};

	return (
		<div className="grid gap-6">
			<UnsavedChangesGuard
				description="Your changes to this skill haven't been saved."
				hasUnsavedChanges={hasUnsavedChanges}
				onSave={save}
				saving={saveMutation.isPending}
			/>
			<Link
				className={APP_INLINE_BACK_LINK_CLASS_NAME}
				to={buildOrganizationSkillsPath(input.orgSlug)}
			>
				<ArrowLeftIcon aria-hidden="true" /> All Skills
			</Link>
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={input.skill.enabled ? "secondary" : "outline"}>
							{input.skill.enabled ? "Enabled" : "Disabled"}
						</Badge>
						<span className="text-muted-foreground text-xs">
							{sourceSummary(input.skill)}
						</span>
					</div>
					<h1 className="mt-2 min-w-0 font-medium text-2xl max-lg:break-words lg:truncate">
						{bundle.portable.name}
					</h1>
					<p className="mt-1 max-w-3xl text-muted-foreground text-sm">
						{bundle.portable.description}
					</p>
				</div>
				{input.skill.permissions.canManage ? (
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex items-center gap-2">
							<Label htmlFor="organization-skill-enabled">Enabled</Label>
							<Switch
								aria-label="Enable Organization Skill"
								checked={input.skill.enabled}
								disabled={
									hasUnsavedChanges ||
									enabledMutation.isPending ||
									saveMutation.isPending
								}
								id="organization-skill-enabled"
								onCheckedChange={(enabled) => {
									setErrorMessage(null);
									enabledMutation.mutate(enabled);
								}}
							/>
						</div>
						<Button
							disabled={hasUnsavedChanges}
							onClick={() => setMaintainersOpen(true)}
							variant="outline"
						>
							Maintainers
						</Button>
						<Button
							disabled={hasUnsavedChanges}
							onClick={() => setDeleteOpen(true)}
							variant="outline"
						>
							<TrashIcon aria-hidden="true" /> Remove
						</Button>
					</div>
				) : null}
			</header>

			<section aria-labelledby="skill-details-heading" className="grid gap-4">
				<div>
					<h2 className="font-medium text-lg" id="skill-details-heading">
						Skill details
					</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						These fields stay portable in SKILL.md.
					</p>
				</div>
				<OrganizationSkillPortableFields
					bundle={bundle}
					disabled={!input.skill.permissions.canEdit || saveMutation.isPending}
					onChange={setBundle}
				/>
			</section>

			<section
				aria-labelledby="skill-instructions-heading"
				className="grid gap-3"
			>
				<div>
					<h2 className="font-medium text-lg" id="skill-instructions-heading">
						Instructions
					</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						The method Center Agent and local agents read when they activate
						this Skill.
					</p>
				</div>
				<MarkdownEditor
					disabled={!input.skill.permissions.canEdit || saveMutation.isPending}
					maxChars={ORGANIZATION_SKILL_INSTRUCTIONS_MAX_CHARS}
					onChange={(instructions) =>
						setBundle((current) => ({ ...current, instructions }))
					}
					value={bundle.instructions}
				/>
			</section>

			<OrganizationSkillFiles
				canEdit={input.skill.permissions.canEdit}
				files={bundle.files}
				onChange={(files) => setBundle((current) => ({ ...current, files }))}
				saving={saveMutation.isPending}
			/>

			<OrganizationSkillSourceHistory skill={input.skill} />

			{errorMessage ? (
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			) : null}
			{input.skill.permissions.canEdit ? (
				<div className="flex justify-end lg:sticky lg:bottom-4">
					<Button
						disabled={
							!(hasUnsavedChanges && bundleValid) || saveMutation.isPending
						}
						onClick={save}
					>
						{saveMutation.isPending ? "Saving…" : "Save"}
					</Button>
				</div>
			) : null}

			<OrganizationSkillMaintainersDialog
				onOpenChange={setMaintainersOpen}
				onSave={(maintainerUserIds) =>
					maintainersMutation.mutate(maintainerUserIds)
				}
				open={maintainersOpen}
				organizationId={input.organizationId}
				saving={maintainersMutation.isPending}
				selectedUserIds={input.skill.maintainerUserIds}
			/>
			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							Remove {input.skill.name} from {input.organizationName}?
						</DialogTitle>
						<DialogDescription>
							This removes the Skill from future Center Agent and local-agent
							work. OpenMeld retains its release and audit evidence.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteMutation.isPending}
							onClick={() => setDeleteOpen(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteMutation.isPending}
							onClick={() => {
								setErrorMessage(null);
								deleteMutation.mutate();
							}}
							variant="destructive"
						>
							{deleteMutation.isPending ? "Removing…" : "Remove Skill"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function sourceSummary(skill: OrganizationSkill): string {
	return skill.source.kind === "github"
		? `GitHub ${skill.source.commitSha.slice(0, 7)}`
		: "Created in OpenMeld";
}

function canonicalBundle(bundle: OrganizationSkillBundle): string {
	return JSON.stringify(bundle);
}
