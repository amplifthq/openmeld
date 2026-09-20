"use client";

import type { SpaceTask } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretRightIcon, RobotIcon, UserIcon } from "@phosphor-icons/react";
import {
	describeSpaceTaskAttention,
	formatSpaceTaskPhase,
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
					"w-full rounded-lg border border-border bg-card p-3 text-left shadow-xs transition-colors",
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
							<Badge className="shrink-0" variant="outline">
								{formatSpaceTaskPhase(task.phase)}
							</Badge>
						</div>
						<p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
							<AssigneeIcon aria-hidden="true" className="size-3.5 shrink-0" />
							<span className="truncate">
								{assigneeName}
								<span className="text-muted-foreground/80">
									{" "}
									· Requested by {task.requestedBy.profileName}
								</span>
							</span>
						</p>
						<p className="mt-1 truncate text-foreground/80 text-xs">
							{attention}
						</p>
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
