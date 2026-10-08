"use client";

import { projectIssueDestinationSchema } from "@openmeld/schemas";
import type { ProjectIssueDestination } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	resolveProjectErrorMessage,
	updateCurrentProjectIssueRouting,
} from "#/lib/organizations/projects";
import {
	projectIssueRoutingQueryOptions,
	projectQueryKeys,
} from "#/query/organizations/projects";

type Provider = "none" | "github" | "linear";

export function ProjectIssueRoutingSection(input: {
	canManage: boolean;
	organizationId: string;
	projectId: string;
}) {
	const queryClient = useQueryClient();
	const routingQuery = useQuery(projectIssueRoutingQueryOptions(input));
	const [editing, setEditing] = useState(false);
	const [provider, setProvider] = useState<Provider>("none");
	const [githubOwner, setGithubOwner] = useState("");
	const [githubRepo, setGithubRepo] = useState("");
	const [linearTeamId, setLinearTeamId] = useState("");
	const [linearProjectId, setLinearProjectId] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const routing = routingQuery.data?.routing;
	const save = useMutation({
		mutationFn: async (destination: ProjectIssueDestination | null) => {
			if (!routing) {
				throw new Error("Project issue routing is unavailable.");
			}
			return await updateCurrentProjectIssueRouting({
				destination,
				expectedOrganizationId: input.organizationId,
				expectedRevision: routing.revision,
				projectId: input.projectId,
			});
		},
		onError: (error) => {
			setFormError(resolveProjectErrorMessage(error, "update"));
		},
		onSuccess: async (response) => {
			queryClient.setQueryData(
				projectQueryKeys.issueRouting(input.organizationId, input.projectId),
				response
			);
			await queryClient.invalidateQueries({
				queryKey: projectQueryKeys.organization(input.organizationId),
			});
			setEditing(false);
			setFormError(null);
		},
	});

	const startEditing = () => {
		const destination = routing?.destination;
		setProvider(destination?.provider ?? "none");
		setGithubOwner(destination?.provider === "github" ? destination.owner : "");
		setGithubRepo(destination?.provider === "github" ? destination.repo : "");
		setLinearTeamId(
			destination?.provider === "linear" ? destination.teamId : ""
		);
		setLinearProjectId(
			destination?.provider === "linear" ? (destination.projectId ?? "") : ""
		);
		setFormError(null);
		setEditing(true);
	};
	const saveSettings = () => {
		let proposed: unknown = null;
		if (provider === "github") {
			proposed = { provider, owner: githubOwner, repo: githubRepo };
		} else if (provider === "linear") {
			proposed = {
				provider,
				teamId: linearTeamId,
				...(linearProjectId.trim()
					? { projectId: linearProjectId.trim() }
					: {}),
			};
		}
		const parsed = projectIssueDestinationSchema.nullable().safeParse(proposed);
		if (!parsed.success) {
			setFormError(
				parsed.error.issues[0]?.message ?? "Enter a valid issue destination."
			);
			return;
		}
		save.mutate(parsed.data);
	};

	return (
		<section
			aria-labelledby="project-issue-routing-heading"
			className="grid gap-3 border-t pt-5"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="font-medium text-muted-foreground text-xs">
						Work destination
					</p>
					<h2
						className="font-medium text-xl"
						id="project-issue-routing-heading"
					>
						Where new issues go
					</h2>
				</div>
				{input.canManage && routing && !editing ? (
					<Button onClick={startEditing} size="sm" variant="outline">
						Edit
					</Button>
				) : null}
			</div>
			{routingQuery.isPending ? (
				<p className="text-muted-foreground text-sm">
					Checking issue destination…
				</p>
			) : null}
			{routingQuery.isError ? (
				<div className="grid justify-items-start gap-2 text-sm" role="alert">
					<p>{resolveProjectErrorMessage(routingQuery.error, "list")}</p>
					<Button
						onClick={() => routingQuery.refetch()}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</div>
			) : null}
			{routing && !editing ? (
				<p className="text-sm">{describeDestination(routing.destination)}</p>
			) : null}
			{editing ? (
				<form
					className="grid max-w-lg gap-4 rounded-md border p-4"
					onSubmit={(event) => {
						event.preventDefault();
						saveSettings();
					}}
				>
					<label className="grid gap-1 text-sm">
						Default issue destination
						<select
							className="h-9 rounded-md border bg-background px-3"
							onChange={(event) => {
								setProvider(event.target.value as Provider);
								setFormError(null);
							}}
							value={provider}
						>
							<option value="none">No default</option>
							<option value="github">GitHub repository</option>
							<option value="linear">Linear team</option>
						</select>
					</label>
					{provider === "github" ? (
						<div className="grid gap-3 sm:grid-cols-2">
							<label
								className="grid gap-1 text-sm"
								htmlFor={`${input.projectId}-github-owner`}
							>
								Repository owner
								<Input
									id={`${input.projectId}-github-owner`}
									onChange={(event) => setGithubOwner(event.target.value)}
									value={githubOwner}
								/>
							</label>
							<label
								className="grid gap-1 text-sm"
								htmlFor={`${input.projectId}-github-repo`}
							>
								Repository name
								<Input
									id={`${input.projectId}-github-repo`}
									onChange={(event) => setGithubRepo(event.target.value)}
									value={githubRepo}
								/>
							</label>
						</div>
					) : null}
					{provider === "linear" ? (
						<div className="grid gap-3">
							<label
								className="grid gap-1 text-sm"
								htmlFor={`${input.projectId}-linear-team`}
							>
								Linear team ID
								<Input
									id={`${input.projectId}-linear-team`}
									onChange={(event) => setLinearTeamId(event.target.value)}
									value={linearTeamId}
								/>
							</label>
							<label
								className="grid gap-1 text-sm"
								htmlFor={`${input.projectId}-linear-project`}
							>
								Linear project ID (optional)
								<Input
									id={`${input.projectId}-linear-project`}
									onChange={(event) => setLinearProjectId(event.target.value)}
									value={linearProjectId}
								/>
							</label>
						</div>
					) : null}
					<p className="text-muted-foreground text-xs">
						This setting chooses a destination. OpenMeld checks access when an
						issue is created.
					</p>
					{formError ? (
						<p className="text-destructive text-sm" role="alert">
							{formError}
						</p>
					) : null}
					<div className="flex gap-2">
						<Button disabled={save.isPending} size="sm" type="submit">
							{save.isPending ? "Saving…" : "Save destination"}
						</Button>
						<Button
							disabled={save.isPending}
							onClick={() => {
								setEditing(false);
								setFormError(null);
							}}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
					</div>
				</form>
			) : null}
		</section>
	);
}

function describeDestination(
	destination: ProjectIssueDestination | null
): string {
	if (destination === null) {
		return "No default is set. A request can still name an exact issue destination.";
	}
	if (destination.provider === "github") {
		return `New issues go to GitHub · ${destination.owner}/${destination.repo}`;
	}
	return `New issues go to Linear · team ${destination.teamId}${destination.projectId ? ` · project ${destination.projectId}` : ""}`;
}
