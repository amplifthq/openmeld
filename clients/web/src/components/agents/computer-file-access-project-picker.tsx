"use client";

import type { PeopleComputerTarget, Project } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { useProjectDiscovery } from "../projects/use-project-discovery";

type ProjectFolderOption = {
	description: string;
	path: string;
};

export function ComputerFileAccessProjectPicker(input: {
	target: PeopleComputerTarget;
	currentFolders: readonly string[];
	disabled: boolean;
	onAddFolders: (folders: readonly string[]) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const { currentOrganization } = useAppOrganization();
	const projectsQuery = useQuery(
		projectsQueryOptions({
			enabled: input.open,
			organizationId: currentOrganization.id,
		})
	);
	const projects = projectsQuery.data?.projects ?? [];
	const discovery = useProjectDiscovery({
		target: input.target,
		enabled: input.open && projectsQuery.isSuccess && projects.length > 0,
		organizationId: currentOrganization.id,
		projects,
	});
	const options = buildProjectFolderOptions({
		currentFolders: input.currentFolders,
		discovery,
		projects,
	});
	const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(
		new Set()
	);
	const checkedIndices = new Set<number>();
	for (const [index, option] of options.entries()) {
		if (selectedPaths.has(option.path)) {
			checkedIndices.add(index);
		}
	}
	const selectedOptions = options.filter((option) =>
		selectedPaths.has(option.path)
	);
	const remainingFolderCount = Math.max(0, 128 - input.currentFolders.length);
	const status = projects[0]
		? discovery.projectView(projects[0].id).status
		: null;
	const isChecking =
		projectsQuery.isPending ||
		(projectsQuery.isSuccess && projects.length > 0 && status === "checking");

	const close = () => {
		setSelectedPaths(new Set());
		input.onOpenChange(false);
	};

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					setSelectedPaths(new Set());
				}
				input.onOpenChange(open);
			}}
			open={input.open}
		>
			<DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Add folders from Projects</DialogTitle>
					<DialogDescription>
						Choose folders OpenMeld already found on this computer. No files are
						uploaded.
					</DialogDescription>
				</DialogHeader>

				{isChecking ? <ProjectFoldersLoading /> : null}
				{projectsQuery.isError ? (
					<ProjectFolderMessage>
						OpenMeld couldn’t load Projects. Enter a folder path instead.
					</ProjectFolderMessage>
				) : null}
				{projectsQuery.isSuccess && projects.length === 0 ? (
					<ProjectFolderMessage>
						No Projects are available in this workspace yet. Enter a folder path
						instead.
					</ProjectFolderMessage>
				) : null}
				{projectsQuery.isSuccess &&
				projects.length > 0 &&
				status !== "checking" &&
				status !== "ready" ? (
					<ProjectFolderMessage>
						OpenMeld couldn’t check Project folders on this computer. Enter a
						folder path instead.
					</ProjectFolderMessage>
				) : null}
				{status === "ready" && options.length === 0 ? (
					<ProjectFolderMessage>
						No additional Project folders were found on this computer. You can
						enter a folder path instead.
					</ProjectFolderMessage>
				) : null}
				{status === "ready" && options.length > 0 ? (
					<ScrollArea className="max-h-80 w-full">
						<CheckboxGroup
							aria-label="Project folders on this computer"
							checkedIndices={checkedIndices}
						>
							{options.map((option, index) => {
								const selected = selectedPaths.has(option.path);
								const atLimit =
									!selected && selectedOptions.length >= remainingFolderCount;
								return (
									<CheckboxItem
										aria-disabled={input.disabled || atLimit}
										checked={selected}
										description={option.description}
										index={index}
										key={option.path}
										label={option.path}
										labelClassName="break-all font-mono"
										onToggle={() => {
											if (input.disabled || atLimit) {
												return;
											}
											const nextSelection = new Set(selectedPaths);
											if (selected) {
												nextSelection.delete(option.path);
											} else {
												nextSelection.add(option.path);
											}
											setSelectedPaths(nextSelection);
										}}
									/>
								);
							})}
						</CheckboxGroup>
					</ScrollArea>
				) : null}

				<DialogFooter>
					<Button onClick={close} type="button" variant="outline">
						Cancel
					</Button>
					<Button
						disabled={input.disabled || selectedOptions.length === 0}
						onClick={() => {
							input.onAddFolders(selectedOptions.map((option) => option.path));
							close();
						}}
						type="button"
					>
						{resolveAddLabel(selectedOptions.length)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function buildProjectFolderOptions(input: {
	currentFolders: readonly string[];
	discovery: ReturnType<typeof useProjectDiscovery>;
	projects: readonly Project[];
}): readonly ProjectFolderOption[] {
	const currentFolders = new Set(
		input.currentFolders.map((folder) => folder.trim())
	);
	const optionsByPath = new Map<string, ProjectFolderOption>();
	for (const project of input.projects) {
		const view = input.discovery.projectView(project.id);
		for (const connection of view.connections) {
			if (
				connection.status !== "available" ||
				currentFolders.has(connection.path)
			) {
				continue;
			}
			optionsByPath.set(connection.path, {
				description: `${project.name} · Connected Project folder`,
				path: connection.path,
			});
		}
		for (const candidate of view.discovery?.candidates ?? []) {
			if (
				currentFolders.has(candidate.canonicalPath) ||
				optionsByPath.has(candidate.canonicalPath)
			) {
				continue;
			}
			optionsByPath.set(candidate.canonicalPath, {
				description: `${project.name} · Found on this computer`,
				path: candidate.canonicalPath,
			});
		}
	}
	return [...optionsByPath.values()];
}

function ProjectFoldersLoading() {
	return (
		<output aria-label="Checking Project folders" className="grid gap-2">
			<Skeleton className="h-14 w-full" />
			<Skeleton className="h-14 w-full" />
		</output>
	);
}

function ProjectFolderMessage(input: { children: string }) {
	return (
		<p className="rounded-md border bg-muted/30 p-3 text-muted-foreground text-xs/relaxed">
			{input.children}
		</p>
	);
}

function resolveAddLabel(count: number): string {
	if (count === 1) {
		return "Add 1 folder";
	}
	return `Add ${String(count)} folders`;
}
