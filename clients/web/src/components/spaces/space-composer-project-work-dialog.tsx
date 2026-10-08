"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	projectRepositorySettingsQueryOptions,
	projectsQueryOptions,
} from "#/query/organizations/projects";

export type SelectedProjectWork = {
	projectId: string;
	projectName: string;
	repositoryFingerprint: string;
	repositoryLabel: string;
};

export function SpaceComposerProjectWorkDialog(input: {
	initialProjectId?: string;
	onOpenChange: (open: boolean) => void;
	onSelect: (selection: SelectedProjectWork) => void;
	open: boolean;
	organizationId: string;
}) {
	const [projectId, setProjectId] = useState(input.initialProjectId ?? "");
	const [selectedFingerprint, setSelectedFingerprint] = useState("");
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: input.organizationId })
	);
	const repositoriesQuery = useQuery({
		...projectRepositorySettingsQueryOptions({
			organizationId: input.organizationId,
			projectId,
		}),
		enabled: Boolean(projectId),
	});
	const project = projectsQuery.data?.projects.find(
		(candidate) => candidate.id === projectId
	);
	const settings = repositoriesQuery.data?.settings;
	const repositories = [
		...(settings?.repositories.map((repository) => ({
			fingerprint: repository.repositoryFingerprint,
			label: repository.repositoryUrl,
			isDefault: repository.isDefault,
		})) ?? []),
		...(settings?.legacyDefaultFingerprint
			? [
					{
						fingerprint: settings.legacyDefaultFingerprint,
						label: "Legacy connected repository",
						isDefault: true,
					},
				]
			: []),
	];
	const fingerprint =
		selectedFingerprint ||
		repositories.find((repository) => repository.isDefault)?.fingerprint ||
		(repositories.length === 1 ? repositories[0]?.fingerprint : "") ||
		"";
	const repository = repositories.find(
		(candidate) => candidate.fingerprint === fingerprint
	);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Choose Project and repository</DialogTitle>
					<DialogDescription>
						This task will use one repository. The Agent's computer must have a
						matching local Project connection.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<label className="grid gap-2 text-sm">
						<span>Project</span>
						<select
							className="h-9 rounded-md border bg-background px-3"
							disabled={projectsQuery.isPending || projectsQuery.isError}
							onChange={(event) => {
								setProjectId(event.target.value);
								setSelectedFingerprint("");
							}}
							value={projectId}
						>
							<option value="">Choose a Project</option>
							{projectsQuery.data?.projects.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>
									{candidate.name}
								</option>
							))}
						</select>
					</label>
					{projectsQuery.isError ? (
						<p className="text-destructive text-sm" role="alert">
							Projects couldn't load. Try again after refreshing this Space.
						</p>
					) : null}
					{projectId ? (
						<label className="grid gap-2 text-sm">
							<span>Repository for this task</span>
							<select
								className="h-9 rounded-md border bg-background px-3"
								disabled={
									repositoriesQuery.isPending || repositoriesQuery.isError
								}
								onChange={(event) => setSelectedFingerprint(event.target.value)}
								value={fingerprint}
							>
								<option value="">Choose a repository</option>
								{repositories.map((candidate) => (
									<option
										key={candidate.fingerprint}
										value={candidate.fingerprint}
									>
										{candidate.label}
										{candidate.isDefault ? " (default)" : ""}
									</option>
								))}
							</select>
						</label>
					) : null}
					{projectId && repositoriesQuery.isError ? (
						<p className="text-destructive text-sm" role="alert">
							Repository settings couldn't load. Refresh and try again.
						</p>
					) : null}
					{projectId && settings && repositories.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							This Project has no code repository. It can still be linked to a
							Space Task.
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						onClick={() => input.onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!(project && repository)}
						onClick={() => {
							if (!(project && repository)) {
								return;
							}
							input.onSelect({
								projectId: project.id,
								projectName: project.name,
								repositoryFingerprint: repository.fingerprint,
								repositoryLabel: repository.label,
							});
							input.onOpenChange(false);
						}}
						type="button"
					>
						Use for new task
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
