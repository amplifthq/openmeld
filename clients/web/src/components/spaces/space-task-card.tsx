"use client";

import type { SpaceTask } from "@openmeld/schemas/types";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretRightIcon, RobotIcon, UserIcon } from "@phosphor-icons/react";
import {
	describeSpaceTaskAttention,
	formatSpaceTaskGitHubIssueRefs,
} from "./space-task-presentation";

export type SpaceTaskCardProps = {
	onOpen: () => void;
	selected?: boolean;
	selfProfileId?: string;
	task: SpaceTask;
};

export function SpaceTaskCard(input: SpaceTaskCardProps) {
	const task = input.task;
	const attention = describeSpaceTaskAttention({
		selfProfileId: input.selfProfileId,
		task,
	});
	const githubIssueRefs = formatSpaceTaskGitHubIssueRefs(task);
	const assigneeName = task.assignee?.profileName ?? "Unassigned";
	const AssigneeIcon =
		task.assignee?.profileKind === "agent" ? RobotIcon : UserIcon;

	return (
		<article>
			<button
				aria-expanded={input.selected === true}
				aria-haspopup="dialog"
				aria-label={`Open details for ${task.title}`}
				className={cn(
					"w-full rounded-md border border-border bg-card p-3 text-left transition-colors motion-reduce:transition-none",
					"hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					input.selected === true && "border-foreground/20 bg-muted/30"
				)}
				onClick={input.onOpen}
				type="button"
			>
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<div className="flex items-start justify-between gap-2">
							<h3 className="line-clamp-2 font-medium text-sm leading-5">
								{task.title}
							</h3>
						</div>
						<p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
							<AssigneeIcon aria-hidden="true" className="size-3.5 shrink-0" />
							<span className="truncate">{assigneeName}</span>
						</p>
						{task.needsHumanDecision || task.phase === "in_review" ? (
							<p className="mt-1 text-xs">{attention}</p>
						) : null}
						{githubIssueRefs.length > 0 ? (
							<p className="mt-1 truncate text-muted-foreground text-xs">
								{githubIssueRefs.join(" · ")}
							</p>
						) : null}
					</div>
					<CaretRightIcon
						aria-hidden="true"
						className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
					/>
				</div>
			</button>
		</article>
	);
}
