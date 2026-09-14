import { buildTargetWakeLifecycleId } from "@openmeld/schemas";
import type { ExecutionContextSelection } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
	FluidDropdownMenuSubContent,
} from "@openmeld/ui/fluid/dropdown-menu";
import { GitBranchIcon } from "@phosphor-icons/react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export type SpaceTaskSource = {
	sourceWakeId: string;
	targetProfileId: string;
	label: string;
};
export type SpaceComposerTaskChoice = {
	selection: ExecutionContextSelection;
	targetProfileId: string;
	label: string;
};

export function buildSpaceTaskSources(
	items: readonly SpaceTimelineItem[],
	requesterProfileId: string
): SpaceTaskSource[] {
	return items
		.filter(
			(item) =>
				item.actorProfileId === requesterProfileId &&
				item.deliveryState === "sent" &&
				item.signalType === "signal.text" &&
				!item.recalledAt
		)
		.reverse()
		.flatMap((item) =>
			item.wakeTargetProfileIds.map((targetProfileId) => ({
				targetProfileId,
				sourceWakeId: buildTargetWakeLifecycleId({
					spaceId: item.spaceId,
					sourceSignalId: item.id,
					targetProfileId,
				}),
				label: item.text.trim().slice(0, 72) || "File task",
			}))
		);
}

export function SpaceComposerTaskMenu(input: {
	supportsLocalFiles: boolean;
	targetProfileId: string;
	disabled: boolean;
	sources: readonly SpaceTaskSource[];
	choice?: SpaceComposerTaskChoice;
	onChange: (choice: SpaceComposerTaskChoice | undefined) => void;
}) {
	const choose = (selection: ExecutionContextSelection, label: string) =>
		input.onChange({
			selection,
			label,
			targetProfileId: input.targetProfileId,
		});
	const sources = input.sources.filter(
		(source) => source.targetProfileId === input.targetProfileId
	);
	const selection = input.choice?.selection;
	const changeAccess = (
		access: "space_context" | "read_only" | "workspace",
		workspace: "current" | "isolated"
	) => {
		const next =
			selection && selection.mode !== "resume"
				? selection
				: { mode: "new" as const };
		choose({ ...next, access, workspace }, input.choice?.label ?? "New task");
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label="Task context"
						disabled={input.disabled}
						size="sm"
						type="button"
						variant="ghost"
					/>
				}
			>
				<GitBranchIcon aria-hidden="true" />
				<span className="max-w-36 truncate">
					{input.choice?.label ?? "Task"}
				</span>
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent
				align="start"
				className="w-80 max-w-[calc(100vw-2rem)]"
			>
				<FluidDropdownMenuItem
					index={0}
					onClick={() => input.onChange(undefined)}
				>
					Continue automatically
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					index={1}
					onClick={() => choose({ mode: "new" }, "New task")}
				>
					New task
				</FluidDropdownMenuItem>
				<p className="px-2 py-1 text-muted-foreground text-xs">
					Independent tasks can run together, up to three per Agent.
				</p>
				{sources.length > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>
								Tasks from this conversation
							</DropdownMenuLabel>
							{sources.map((source) => (
								<DropdownMenuSub key={source.sourceWakeId}>
									<DropdownMenuSubTrigger className="max-w-xs">
										<span className="truncate">{source.label}</span>
									</DropdownMenuSubTrigger>
									<FluidDropdownMenuSubContent>
										<FluidDropdownMenuItem
											index={0}
											onClick={() =>
												choose(
													{ mode: "resume", sourceWakeId: source.sourceWakeId },
													`Continue: ${source.label}`
												)
											}
										>
											Continue task
										</FluidDropdownMenuItem>
										<FluidDropdownMenuItem
											index={1}
											onClick={() =>
												choose(
													{ mode: "fork", sourceWakeId: source.sourceWakeId },
													`Fork: ${source.label}`
												)
											}
										>
											Fork from completed history
										</FluidDropdownMenuItem>
									</FluidDropdownMenuSubContent>
								</DropdownMenuSub>
							))}
						</DropdownMenuGroup>
					</>
				) : null}
				{selection?.mode !== "resume" ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>Task files</DropdownMenuLabel>
							<FluidDropdownMenuItem
								index={2}
								onClick={() => changeAccess("space_context", "isolated")}
							>
								Space context only
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								disabled={!input.supportsLocalFiles}
								index={3}
								onClick={() => changeAccess("workspace", "isolated")}
							>
								Independent project worktree · Codex
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								disabled={!input.supportsLocalFiles}
								index={4}
								onClick={() => changeAccess("read_only", "current")}
							>
								Read current folder · Codex
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								disabled={!input.supportsLocalFiles}
								index={5}
								onClick={() => changeAccess("workspace", "current")}
							>
								Work in current folder · Codex
							</FluidDropdownMenuItem>
							<p className="px-2 py-1 text-muted-foreground text-xs">
								Project worktrees start from the connected repository's current
								commit. Unsaved changes and local configuration are not copied.
								Current-folder work waits for conflicting local tasks.
							</p>
						</DropdownMenuGroup>
					</>
				) : null}
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}
