"use client";

import type { Project } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import {
	ADD_CARD_PICKER_CLASS_NAME,
	CARD_PICKER_GRID_CLASS_NAME,
	cardPickerCardClassName,
} from "@openmeld/ui/lib/card-picker-contract";
import {
	resolveStatusToneBadgeClassName,
	resolveStatusToneStrongTextClassName,
	resolveStatusToneSurfaceClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	ArrowRightIcon,
	FolderOpenIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationProjectPath } from "#/lib/organizations/organization-routes";
import {
	createCurrentProject,
	resolveProjectErrorMessage,
} from "#/lib/organizations/projects";
import {
	projectQueryKeys,
	projectsQueryOptions,
} from "#/query/organizations/projects";
import {
	ProjectCheckAgainButton,
	ProjectRefreshStatus,
} from "./project-check-again-button";
import {
	ProjectFormDialog,
	type ProjectFormSubmission,
} from "./project-form-dialog";
import type { ProjectComputerView } from "./use-project-discovery";
import { useProjectDiscovery } from "./use-project-discovery";

export function ProjectsPage() {
	const { currentOrganization } = useAppOrganization();
	const queryClient = useQueryClient();
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: currentOrganization.id })
	);
	const projects = projectsQuery.data?.projects ?? [];
	const discovery = useProjectDiscovery({
		organizationId: currentOrganization.id,
		projects,
	});
	const projectCheckStatus = projects[0]
		? discovery.projectView(projects[0].id).status
		: null;
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const createMutation = useMutation({
		mutationFn: async (submission: ProjectFormSubmission) => {
			if (!submission.name) {
				throw new Error("Project name is required.");
			}
			return await createCurrentProject({
				expectedOrganizationId: currentOrganization.id,
				name: submission.name,
				...(submission.repositoryFingerprint
					? { repositoryFingerprint: submission.repositoryFingerprint }
					: {}),
				...(submission.slug ? { slug: submission.slug } : {}),
			});
		},
		onError: (error, submission) => {
			setCreateError(
				resolveProjectErrorMessage(error, "create", {
					explicitSlug: submission.slug !== undefined,
				})
			);
		},
		onSuccess: async () => {
			setCreateDialogOpen(false);
			setCreateError(null);
			await queryClient.invalidateQueries({
				queryKey: projectQueryKeys.organization(currentOrganization.id),
			});
		},
	});

	return (
		<div className="grid gap-5">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="font-medium text-muted-foreground text-xs">
						{currentOrganization.isPersonal
							? "Personal workspace"
							: "Organization"}
					</p>
					<h1 className="font-medium text-2xl">Projects</h1>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
						Choose where agents should work for each Project on this computer.
					</p>
				</div>
				{projects.length > 0 ? (
					<ProjectCheckAgainButton
						initialChecking={projectCheckStatus === "checking"}
						isRefreshing={discovery.isRefreshing}
						onCheck={discovery.refresh}
					/>
				) : null}
			</header>
			<ProjectRefreshStatus message={discovery.refreshErrorMessage} />

			{projectsQuery.isPending ? (
				<div className={CARD_PICKER_GRID_CLASS_NAME}>
					<Skeleton className="h-52 w-full" />
					<Skeleton className="h-52 w-full" />
				</div>
			) : null}
			{projectsQuery.isError ? (
				<div
					className={cn(
						"flex flex-wrap items-center justify-between gap-3 rounded-md border p-4",
						resolveStatusToneSurfaceClassName("danger", "subtle")
					)}
					role="alert"
				>
					<p className={resolveStatusToneStrongTextClassName("danger")}>
						{resolveProjectErrorMessage(projectsQuery.error, "list")}
					</p>
					<Button
						onClick={() => projectsQuery.refetch()}
						size="sm"
						variant="outline"
					>
						<ArrowClockwiseIcon aria-hidden="true" /> Retry
					</Button>
				</div>
			) : null}
			{projectsQuery.isSuccess ? (
				<FluidCardGroup>
					<ul aria-label="Projects" className={CARD_PICKER_GRID_CLASS_NAME}>
						{projects.map((project) => (
							<li key={project.id}>
								<FluidCardItem itemId={project.id}>
									<ProjectCard
										computerView={discovery.projectView(project.id)}
										orgSlug={currentOrganization.slug}
										project={project}
									/>
								</FluidCardItem>
							</li>
						))}
						<li>
							<FluidCardItem className="bg-transparent" itemId="add-project">
								<button
									className={cn(
										ADD_CARD_PICKER_CLASS_NAME,
										"h-full min-h-52 w-full bg-transparent hover:bg-transparent"
									)}
									onClick={() => {
										setCreateError(null);
										setCreateDialogOpen(true);
									}}
									type="button"
								>
									<span className="grid size-9 place-items-center rounded-md border bg-background">
										<PlusIcon aria-hidden="true" className="size-4" />
									</span>
									<span className="font-medium">Add a Project</span>
									<span className="max-w-52 text-center text-muted-foreground text-xs leading-5">
										Create a shared Project, then connect folders on this
										computer.
									</span>
								</button>
							</FluidCardItem>
						</li>
					</ul>
				</FluidCardGroup>
			) : null}

			{createDialogOpen ? (
				<ProjectFormDialog
					errorMessage={createError}
					key="create-project"
					onOpenChange={(open) => {
						if (!createMutation.isPending) {
							setCreateDialogOpen(open);
						}
					}}
					onSubmit={async (submission) => {
						await createMutation.mutateAsync(submission);
					}}
					open={true}
					project={null}
					submitting={createMutation.isPending}
				/>
			) : null}
		</div>
	);
}

function ProjectCard(input: {
	computerView: ProjectComputerView;
	orgSlug: string;
	project: Project;
}) {
	const state = resolveProjectCardState(input.computerView);
	const defaultConnection = input.computerView.connections.find(
		(connection) => connection.isDefault
	);
	return (
		<article
			className={cn(
				cardPickerCardClassName({ muted: false }),
				"flex h-full min-h-52 flex-col bg-transparent p-4 hover:bg-transparent"
			)}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="truncate font-medium text-base">
						{input.project.name}
					</h2>
					<code className="font-mono text-muted-foreground text-xs">
						/{input.project.slug}
					</code>
				</div>
				<FolderOpenIcon
					aria-hidden="true"
					className="size-5 text-muted-foreground"
				/>
			</div>
			<dl className="mt-4 grid gap-2 text-xs">
				<div className="flex items-center justify-between gap-3">
					<dt className="text-muted-foreground">Repository</dt>
					<dd>
						{input.project.repositoryFingerprint
							? "Configured"
							: "Not configured"}
					</dd>
				</div>
				<div className="flex items-center justify-between gap-3">
					<dt className="text-muted-foreground">This computer</dt>
					<dd>
						<Badge
							className={cn(
								"rounded-md",
								resolveStatusToneBadgeClassName(state.tone)
							)}
							variant="outline"
						>
							{state.label}
						</Badge>
					</dd>
				</div>
				{defaultConnection ? (
					<div className="grid gap-1 border-t pt-2">
						<dt className="text-muted-foreground">Default folder</dt>
						<dd className="truncate font-mono" title={defaultConnection.path}>
							{defaultConnection.path}
						</dd>
					</div>
				) : null}
			</dl>
			<div className="mt-auto pt-4">
				<Link
					className={cn(
						buttonVariants({ size: "sm", variant: "outline" }),
						"w-full"
					)}
					to={buildOrganizationProjectPath({
						orgSlug: input.orgSlug,
						projectId: input.project.id,
					})}
				>
					View details <ArrowRightIcon aria-hidden="true" />
				</Link>
			</div>
		</article>
	);
}

function resolveProjectCardState(view: ProjectComputerView): {
	label: string;
	tone: "checking" | "muted" | "ready" | "warning";
} {
	if (view.status === "checking") {
		return { label: "Checking", tone: "checking" };
	}
	if (view.status === "service_unavailable") {
		return { label: "Service unavailable", tone: "warning" };
	}
	switch (view.discovery?.status) {
		case "connected":
			return { label: "Connected", tone: "ready" };
		case "connected_folder_missing":
			return { label: "Folder missing", tone: "warning" };
		case "found":
			return { label: "Found", tone: "checking" };
		case "verification_unavailable":
			return { label: "Git unavailable", tone: "warning" };
		default:
			return { label: "Not found", tone: "muted" };
	}
}
