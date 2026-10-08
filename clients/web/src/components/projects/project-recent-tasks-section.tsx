"use client";

import { Button } from "@openmeld/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatSpaceTaskPhase } from "#/components/spaces/space-task-presentation";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { projectRecentTasksQueryOptions } from "#/query/organizations/projects";

export function ProjectRecentTasksSection(input: {
	organizationId: string;
	organizationSlug: string;
	projectId: string;
}) {
	const query = useQuery(projectRecentTasksQueryOptions(input));
	return (
		<section
			aria-labelledby="project-recent-tasks-heading"
			className="grid gap-3 border-t pt-5"
		>
			<div>
				<p className="font-medium text-muted-foreground text-xs">
					Work and Agents
				</p>
				<h2 className="font-medium text-xl" id="project-recent-tasks-heading">
					Recent Tasks
				</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Up to 20 recently linked Tasks from Spaces you can access. Open a
					Space to view its Task board.
				</p>
			</div>
			{query.isPending ? (
				<p className="text-muted-foreground text-sm">Checking recent Tasks…</p>
			) : null}
			{query.isError ? (
				<div className="grid justify-items-start gap-2 text-sm" role="alert">
					<p>OpenMeld could not load recent Tasks.</p>
					<Button onClick={() => query.refetch()} size="sm" variant="outline">
						Try again
					</Button>
				</div>
			) : null}
			{query.data?.tasks.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No recent linked Tasks are visible here.
				</p>
			) : null}
			{query.data?.tasks.length ? (
				<ul className="grid gap-2">
					{query.data.tasks.map((task) => (
						<li
							className="rounded-md border p-3"
							key={`${task.spaceId}:${task.taskId}`}
						>
							<Link
								className="font-medium text-sm underline-offset-4 hover:underline"
								to={buildOrganizationSpacePath({
									orgSlug: input.organizationSlug,
									spaceId: task.spaceId,
								})}
							>
								{task.title}
							</Link>
							<p className="mt-1 text-muted-foreground text-xs">
								{formatSpaceTaskPhase(task.phase)}
							</p>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
