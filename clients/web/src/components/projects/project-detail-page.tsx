"use client";

import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	resolveStatusToneStrongTextClassName,
	resolveStatusToneSurfaceClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { APP_INLINE_BACK_LINK_CLASS_NAME } from "#/components/app/app-inline-navigation";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationProjectActivityPath,
	buildOrganizationProjectsPath,
} from "#/lib/organizations/organization-routes";
import {
	archiveCurrentProject,
	resolveProjectErrorMessage,
	updateCurrentProject,
} from "#/lib/organizations/projects";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	projectQueryKeys,
	projectsQueryOptions,
} from "#/query/organizations/projects";
import { ProjectComputerSection } from "./project-computer-section";
import {
	ProjectFormDialog,
	type ProjectFormSubmission,
} from "./project-form-dialog";

export function ProjectDetailPage(input: { projectId: string }) {
	const { currentOrganization } = useAppOrganization();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: currentOrganization.id })
	);
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const project = projectsQuery.data?.projects.find(
		(candidate) => candidate.id === input.projectId
	);
	const creator = directoryQuery.data?.members.find(
		(member) => member.user.id === project?.createdByUserId
	)?.user;
	const [editOpen, setEditOpen] = useState(false);
	const [removeOpen, setRemoveOpen] = useState(false);
	const [mutationError, setMutationError] = useState<string | null>(null);
	const updateMutation = useMutation({
		mutationFn: async (submission: ProjectFormSubmission) => {
			if (!project) {
				throw new Error("Project is unavailable.");
			}
			return await updateCurrentProject({
				expectedOrganizationId: currentOrganization.id,
				projectId: project.id,
				...submission,
			});
		},
		onError: (error, submission) => {
			setMutationError(
				resolveProjectErrorMessage(error, "update", {
					explicitSlug: submission.slug !== undefined,
				})
			);
		},
		onSuccess: async () => {
			setEditOpen(false);
			setMutationError(null);
			await queryClient.invalidateQueries({
				queryKey: projectQueryKeys.organization(currentOrganization.id),
			});
		},
	});
	const archiveMutation = useMutation({
		mutationFn: async () => {
			if (!project) {
				throw new Error("Project is unavailable.");
			}
			return await archiveCurrentProject({
				expectedOrganizationId: currentOrganization.id,
				projectId: project.id,
			});
		},
		onError: (error) => {
			setMutationError(resolveProjectErrorMessage(error, "archive"));
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectQueryKeys.organization(currentOrganization.id),
			});
			await navigate({
				to: buildOrganizationProjectsPath(currentOrganization.slug),
			});
		},
	});

	if (projectsQuery.isPending) {
		return (
			<div className="grid gap-4">
				<Skeleton className="h-7 w-48" />
				<Skeleton className="h-44 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}
	if (projectsQuery.isError) {
		return (
			<div
				className={cn(
					"grid gap-3 rounded-md border p-5",
					resolveStatusToneSurfaceClassName("danger", "subtle")
				)}
				role="alert"
			>
				<h1 className="font-medium text-xl">Projects could not be loaded</h1>
				<p className={resolveStatusToneStrongTextClassName("danger")}>
					{resolveProjectErrorMessage(projectsQuery.error, "list")}
				</p>
				<Button
					className="justify-self-start"
					onClick={() => projectsQuery.refetch()}
				>
					Try again
				</Button>
			</div>
		);
	}
	if (!project) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border p-6">
				<h1 className="font-medium text-xl">Project not found</h1>
				<p className="text-muted-foreground text-sm">
					This Project may have been removed or belongs to another workspace.
				</p>
				<Link
					className={buttonVariants({ variant: "outline" })}
					to={buildOrganizationProjectsPath(currentOrganization.slug)}
				>
					<ArrowLeftIcon aria-hidden="true" /> All Projects
				</Link>
			</div>
		);
	}

	return (
		<div className="grid gap-6">
			<div>
				<Link
					className={APP_INLINE_BACK_LINK_CLASS_NAME}
					to={buildOrganizationProjectsPath(currentOrganization.slug)}
				>
					<ArrowLeftIcon aria-hidden="true" /> All Projects
				</Link>
			</div>

			<section aria-labelledby="project-heading" className="grid gap-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p className="font-medium text-muted-foreground text-xs">Project</p>
						<h1 className="font-medium text-2xl" id="project-heading">
							{project.name}
						</h1>
						<code className="font-mono text-muted-foreground text-sm">
							/{project.slug}
						</code>
					</div>
					{project.canManage ? (
						<Button
							onClick={() => {
								setMutationError(null);
								setEditOpen(true);
							}}
							variant="outline"
						>
							<PencilSimpleIcon aria-hidden="true" /> Edit
						</Button>
					) : null}
				</div>
				<dl className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2">
					<div>
						<dt className="text-muted-foreground text-xs">Repository</dt>
						<dd className="mt-1 font-medium">
							{project.repositoryUrl ? (
								<a
									className="break-all underline underline-offset-4"
									href={project.repositoryUrl}
									rel="noreferrer"
									target="_blank"
								>
									{project.repositoryUrl}
								</a>
							) : (
								resolveRepositoryFallbackLabel(project.repositoryFingerprint)
							)}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground text-xs">Created by</dt>
						<dd className="mt-1 font-medium">
							{creator?.name ?? "Workspace member"}
						</dd>
					</div>
				</dl>
			</section>

			<ProjectComputerSection
				organizationId={currentOrganization.id}
				project={project}
				projects={projectsQuery.data.projects}
			/>

			<section
				aria-labelledby="project-related-heading"
				className="grid gap-3 border-t pt-5"
			>
				<div>
					<p className="font-medium text-muted-foreground text-xs">Related</p>
					<h2 className="font-medium text-xl" id="project-related-heading">
						Project Activity
					</h2>
				</div>
				<Link
					className={cn(
						buttonVariants({ variant: "outline" }),
						"justify-self-start"
					)}
					to={buildOrganizationProjectActivityPath({
						orgSlug: currentOrganization.slug,
						projectId: project.id,
					})}
				>
					View Activity for this Project <ArrowRightIcon aria-hidden="true" />
				</Link>
			</section>

			<section
				aria-labelledby="project-danger-heading"
				className={cn(
					"grid gap-3 rounded-md border p-4",
					resolveStatusToneSurfaceClassName("danger", "subtle")
				)}
			>
				<div>
					<p className="font-medium text-muted-foreground text-xs">
						Danger zone
					</p>
					<h2 className="font-medium text-base" id="project-danger-heading">
						Remove Project
					</h2>
				</div>
				{project.canArchive ? (
					<Button
						className="justify-self-start"
						onClick={() => {
							setMutationError(null);
							setRemoveOpen(true);
						}}
						variant="destructive"
					>
						<TrashIcon aria-hidden="true" /> Remove Project
					</Button>
				) : (
					<p className="text-muted-foreground text-sm">
						Only the organization owner can remove this Project.
					</p>
				)}
			</section>

			{editOpen ? (
				<ProjectFormDialog
					errorMessage={mutationError}
					key={`edit-${project.id}`}
					onOpenChange={(open) => {
						if (!updateMutation.isPending) {
							setEditOpen(open);
						}
					}}
					onSubmit={async (submission) => {
						await updateMutation.mutateAsync(submission);
					}}
					open={true}
					project={project}
					submitting={updateMutation.isPending}
				/>
			) : null}

			<Dialog
				onOpenChange={(open) => {
					if (!(open || archiveMutation.isPending)) {
						setRemoveOpen(false);
					}
				}}
				open={removeOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove {project.name}?</DialogTitle>
						<DialogDescription>
							New Activity for this Project will be rejected. Existing Activity
							remains available until its normal retention window ends.
						</DialogDescription>
					</DialogHeader>
					{mutationError ? (
						<p
							className={resolveStatusToneStrongTextClassName("danger")}
							role="alert"
						>
							{mutationError}
						</p>
					) : null}
					<DialogFooter>
						<Button onClick={() => setRemoveOpen(false)} variant="outline">
							Cancel
						</Button>
						<Button
							disabled={archiveMutation.isPending}
							onClick={() => archiveMutation.mutate()}
							variant="destructive"
						>
							Remove Project
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function resolveRepositoryFallbackLabel(
	repositoryFingerprint: string | null
): string {
	return repositoryFingerprint
		? "Configured · URL unavailable"
		: "Not configured";
}
