"use client";

import { Button } from "@openmeld/ui/components/button";
import { Card, CardContent } from "@openmeld/ui/components/card";
import { FolderSimplePlusIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
	ProjectFormDialog,
	type ProjectFormSubmission,
} from "#/components/projects/project-form-dialog";
import {
	createCurrentProject,
	resolveProjectErrorMessage,
} from "#/lib/organizations/projects";
import { AgentActivityEmptySetup } from "./agent-activity-empty-setup";
import { useAgentActivityData } from "./agent-activity-page";

export function AgentActivityNoProjectsSetup(input: { canManage: boolean }) {
	const data = useAgentActivityData();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const createMutation = useMutation({
		mutationFn: async (submission: ProjectFormSubmission) => {
			if (!submission.name) {
				throw new Error("Project name is required.");
			}
			return await createCurrentProject({
				expectedOrganizationId: data.organizationId,
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
			await Promise.all([
				data.projectsQuery.refetch(),
				data.snapshotQuery.refetch(),
			]);
		},
	});

	return (
		<>
			<section className="flex min-h-64 flex-col items-center justify-center rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-10 text-center">
				<span className="grid size-10 place-items-center rounded-md border border-border/70 bg-background/45 text-muted-foreground">
					<FolderSimplePlusIcon aria-hidden="true" className="size-5" />
				</span>
				<h2 className="mt-3 font-medium text-lg">Create your first Project</h2>
				<p className="mt-1 max-w-xl text-muted-foreground text-sm leading-6">
					Create a Project before OpenMeld can organize and report agent
					sessions.
				</p>
				{input.canManage ? (
					<Button
						className="mt-4"
						onClick={() => {
							setCreateError(null);
							setCreateDialogOpen(true);
						}}
					>
						<FolderSimplePlusIcon aria-hidden="true" /> Create Project
					</Button>
				) : (
					<p className="mt-4 text-muted-foreground text-sm leading-6">
						Ask an organization administrator to create the first Project.
					</p>
				)}
			</section>
			{createDialogOpen ? (
				<ProjectFormDialog
					errorMessage={createError}
					key="create-activity-project"
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
		</>
	);
}

export function AgentActivityAwaitingFirstSession() {
	return (
		<Card className="rounded-md py-0">
			<CardContent className="py-4 text-center text-muted-foreground text-sm leading-6">
				<AgentActivityEmptySetup setupState="awaiting_first_session" />
			</CardContent>
		</Card>
	);
}
