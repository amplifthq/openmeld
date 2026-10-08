"use client";

import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	resolveProjectErrorMessage,
	updateCurrentProjectCommonAgents,
} from "#/lib/organizations/projects";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	projectCommonAgentsQueryOptions,
	projectQueryKeys,
} from "#/query/organizations/projects";

export function ProjectCommonAgentsSection(input: {
	canManage: boolean;
	organizationId: string;
	projectId: string;
}) {
	const queryClient = useQueryClient();
	const query = useQuery(projectCommonAgentsQueryOptions(input));
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const agents =
		directory.data?.agentProfiles.filter(
			(profile) => profile.status === "active"
		) ?? [];
	const [editing, setEditing] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const commonAgents = query.data?.commonAgents;
	const save = useMutation({
		mutationFn: async () => {
			if (!commonAgents) {
				throw new Error("Common Agents are unavailable.");
			}
			return await updateCurrentProjectCommonAgents({
				agentProfileIds: selected,
				expectedOrganizationId: input.organizationId,
				expectedRevision: commonAgents.revision,
				projectId: input.projectId,
			});
		},
		onError: (failure) =>
			setError(resolveProjectErrorMessage(failure, "update")),
		onSuccess: (response) => {
			queryClient.setQueryData(
				projectQueryKeys.commonAgents(input.organizationId, input.projectId),
				response
			);
			setEditing(false);
			setError(null);
		},
	});
	return (
		<section
			aria-labelledby="project-common-agents-heading"
			className="grid gap-3 border-t pt-5"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="font-medium text-muted-foreground text-xs">
						Work and Agents
					</p>
					<h2
						className="font-medium text-xl"
						id="project-common-agents-heading"
					>
						Common Agents
					</h2>
				</div>
				{input.canManage &&
				commonAgents &&
				(agents.length > 0 || commonAgents.agentProfileIds.length > 0) &&
				!editing ? (
					<Button
						onClick={() => {
							setSelected(commonAgents.agentProfileIds);
							setError(null);
							setEditing(true);
						}}
						size="sm"
						variant="outline"
					>
						Edit
					</Button>
				) : null}
			</div>
			{query.isPending || directory.isPending ? (
				<p className="text-muted-foreground text-sm">Checking Agents…</p>
			) : null}
			{query.isError || directory.isError ? (
				<div className="grid justify-items-start gap-2 text-sm" role="alert">
					<p>OpenMeld could not load Common Agents.</p>
					<Button
						onClick={() => {
							query.refetch();
							directory.refetch();
						}}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</div>
			) : null}
			{commonAgents && !editing ? (
				<div className="grid gap-1 text-sm">
					{commonAgents.agentProfileIds.length === 0 ? (
						<p className="text-muted-foreground">
							No Common Agents configured yet.
						</p>
					) : (
						commonAgents.agentProfileIds.map((id) => {
							const agent = agents.find((profile) => profile.profileId === id);
							return (
								<p key={id}>
									{agent
										? `${agent.profileName} · ${agent.ownerName ?? "Organization Agent"}`
										: "Unavailable Agent"}
								</p>
							);
						})
					)}
					<p className="text-muted-foreground text-xs">
						A Common Agent is a selection suggestion. It does not join a Space,
						gain access, or start work.
					</p>
				</div>
			) : null}
			{editing ? (
				<form
					className="grid max-w-xl gap-3 rounded-md border p-4"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate();
					}}
				>
					{selected
						.filter((id) => !agents.some((agent) => agent.profileId === id))
						.map((id) => (
							<div
								className="flex items-center justify-between gap-2 text-sm"
								key={id}
							>
								<span>Unavailable Agent</span>
								<Button
									aria-label="Remove unavailable Agent"
									disabled={save.isPending}
									onClick={() =>
										setSelected((current) =>
											current.filter((profileId) => profileId !== id)
										)
									}
									size="sm"
									type="button"
									variant="outline"
								>
									Remove
								</Button>
							</div>
						))}
					{agents.map((agent) => (
						<label
							className="flex items-center gap-2 text-sm"
							key={agent.profileId}
						>
							<input
								checked={selected.includes(agent.profileId)}
								disabled={
									save.isPending ||
									(!selected.includes(agent.profileId) && selected.length >= 50)
								}
								onChange={(event) =>
									setSelected((current) =>
										event.target.checked
											? [...current, agent.profileId]
											: current.filter((id) => id !== agent.profileId)
									)
								}
								type="checkbox"
							/>
							{agent.profileName} · {agent.ownerName ?? "Organization Agent"}
						</label>
					))}
					{error ? (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
					<div className="flex gap-2">
						<Button disabled={save.isPending} size="sm" type="submit">
							{save.isPending ? "Saving…" : "Save Common Agents"}
						</Button>
						<Button
							disabled={save.isPending}
							onClick={() => setEditing(false)}
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
