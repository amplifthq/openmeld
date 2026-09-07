"use client";

import type { ListProjectsResponse, Project } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
	createCurrentProject,
	listCurrentProjects,
	resolveProjectErrorMessage,
	updateCurrentProject,
} from "#/lib/organizations/projects";
import { projectQueryKeys } from "#/query/organizations/projects";
import { ProjectComputerSection } from "./project-computer-section";
import {
	ProjectFormDialog,
	type ProjectFormSubmission,
} from "./project-form-dialog";

export function ProjectPickerActions(input: {
	disabled: boolean;
	organizationId: string;
	projectId: string;
	projects: readonly Project[];
	onProjectSelected: (id: string) => void;
}) {
	const queryClient = useQueryClient();
	const [form, setForm] = useState<"create" | "edit" | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [duplicate, setDuplicate] = useState<Project | null>(null);
	const operation = useRef<{ signature: string; id: string } | null>(null);
	const selected =
		input.projects.find((project) => project.id === input.projectId) ?? null;
	const publishProject = (project: Project) => {
		queryClient.setQueryData<ListProjectsResponse>(
			projectQueryKeys.organization(input.organizationId),
			(current) => ({
				organizationId: input.organizationId,
				projects: [
					...(current?.projects ?? input.projects).filter(
						(item) => item.id !== project.id
					),
					project,
				],
			})
		);
		input.onProjectSelected(project.id);
	};
	const createProject = async (
		values: ProjectFormSubmission
	): Promise<boolean> => {
		const current = await listCurrentProjects({
			organizationId: input.organizationId,
		});
		const existing = values.repositoryFingerprint
			? current.projects.find(
					(project) =>
						project.repositoryFingerprint === values.repositoryFingerprint
				)
			: null;
		if (existing) {
			setDuplicate(existing);
			return false;
		}
		const signature = JSON.stringify(values);
		if (operation.current?.signature !== signature) {
			operation.current = { signature, id: crypto.randomUUID() };
		}
		const result = await createCurrentProject({
			expectedOrganizationId: input.organizationId,
			name: values.name ?? "",
			operationId: operation.current.id,
			...(values.repositoryUrl ? { repositoryUrl: values.repositoryUrl } : {}),
			...(values.repositoryFingerprint
				? { repositoryFingerprint: values.repositoryFingerprint }
				: {}),
			...(values.slug ? { slug: values.slug } : {}),
		});
		publishProject(result.project);
		return true;
	};
	const submit = async (values: ProjectFormSubmission) => {
		setPending(true);
		setError(null);
		setDuplicate(null);
		try {
			if (form === "edit" && selected) {
				const result = await updateCurrentProject({
					...values,
					expectedOrganizationId: input.organizationId,
					projectId: selected.id,
				});
				publishProject(result.project);
			} else if (!(await createProject(values))) {
				return;
			}
			setForm(null);
		} catch (failure) {
			setError(
				resolveProjectErrorMessage(
					failure,
					form === "edit" ? "update" : "create"
				)
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					disabled={input.disabled}
					onClick={() => {
						setForm("create");
						setError(null);
						setDuplicate(null);
						operation.current = null;
					}}
					size="sm"
					variant="ghost"
				>
					Create project
				</Button>
				{selected ? (
					<Button
						disabled={input.disabled}
						onClick={() => setDetailsOpen(true)}
						size="sm"
						variant="ghost"
					>
						Project details
					</Button>
				) : null}
			</div>
			{form ? (
				<ProjectFormDialog
					errorMessage={error}
					existingProject={duplicate}
					key={`${form}:${selected?.id ?? "new"}`}
					onOpenChange={(open) => {
						if (!(open || pending)) {
							setForm(null);
						}
					}}
					onSubmit={submit}
					onUseExistingProject={(project) => {
						publishProject(project);
						setForm(null);
					}}
					open
					project={form === "edit" ? selected : null}
					submitting={pending}
				/>
			) : null}
			<Dialog
				onOpenChange={setDetailsOpen}
				open={detailsOpen && selected !== null}
			>
				<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>{selected?.name}</DialogTitle>
						<DialogDescription>
							Shared in this workspace. Local folders stay private to their
							owner.
						</DialogDescription>
					</DialogHeader>
					{selected ? (
						<>
							{selected.repositoryUrl ? (
								<a
									className="break-all text-sm underline"
									href={selected.repositoryUrl}
									rel="noreferrer"
									target="_blank"
								>
									{selected.repositoryUrl}
								</a>
							) : (
								<p className="text-muted-foreground text-sm">
									No repository linked.
								</p>
							)}
							{selected.canManage ? (
								<Button
									className="justify-self-start"
									onClick={() => {
										setDetailsOpen(false);
										setForm("edit");
										setError(null);
									}}
									size="sm"
									variant="outline"
								>
									Edit project
								</Button>
							) : null}
							<ProjectComputerSection
								organizationId={input.organizationId}
								project={selected}
								projects={input.projects}
							/>
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}
