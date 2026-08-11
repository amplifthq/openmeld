"use client";

import type { CenterAgentTaskReference } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { resolveStatusToneBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentTaskPath } from "#/lib/organizations/organization-routes";
import { centerAgentTaskDetailQueryOptions } from "#/query/organizations/center-agent-tasks";
import {
	formatTaskOrigin,
	formatTaskRequester,
	resolveTaskStatusPresentation,
} from "../organizations/center-agent-task-presentation";

export function SpaceMessageCenterAgentTaskReferences(input: {
	references: readonly CenterAgentTaskReference[];
}) {
	const organizationContext = useOptionalAppOrganization();
	const organization = organizationContext?.currentOrganization;
	const queries = useQueries({
		queries: input.references.map((reference) =>
			centerAgentTaskDetailQueryOptions({
				enabled: organization !== undefined,
				organizationId: organization?.id ?? "unavailable",
				taskId: reference.taskId,
			})
		),
	});

	if (!organization || input.references.length === 0) {
		return null;
	}

	return (
		<section aria-label="Center Agent Tasks" className="px-px">
			<SharedLayoutGroup className="space-y-2">
				{input.references.map((reference, index) => {
					const query = queries[index];
					if (!query || query.isPending) {
						return (
							<output
								aria-label="Loading Task"
								className="block rounded-md border border-border/70 bg-card p-3"
								key={reference.taskId}
							>
								<Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
								<Skeleton className="mt-2 h-3 w-1/3 motion-reduce:animate-none" />
							</output>
						);
					}
					if (!query.data) {
						return null;
					}
					const task = query.data.task;
					const status = resolveTaskStatusPresentation(task);
					const source = [formatTaskRequester(task), formatTaskOrigin(task)]
						.filter((value): value is string => value !== null)
						.join(" · ");
					return (
						<SharedLayoutItem
							className="rounded-md bg-card"
							itemId={task.id}
							key={reference.taskId}
						>
							<Link
								className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
								to={buildOrganizationCenterAgentTaskPath({
									orgSlug: organization.slug,
									taskId: task.id,
								})}
							>
								<Card
									className="gap-2 border border-border/70 bg-transparent ring-0"
									size="sm"
								>
									<CardHeader className="flex-row items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="text-muted-foreground text-xs">
												Center Agent Task
											</p>
											<CardTitle className="mt-1 line-clamp-2">
												{task.title}
											</CardTitle>
											<p className="mt-1 line-clamp-1 text-muted-foreground text-xs">
												{source}
											</p>
										</div>
										<Badge
											className={resolveStatusToneBadgeClassName(status.tone)}
											variant="outline"
										>
											{status.label}
										</Badge>
									</CardHeader>
									<CardContent className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
										<span className="line-clamp-1">{task.goal}</span>
										<span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
											Open Task
											<ArrowSquareOutIcon aria-hidden="true" />
										</span>
									</CardContent>
								</Card>
							</Link>
						</SharedLayoutItem>
					);
				})}
			</SharedLayoutGroup>
		</section>
	);
}
