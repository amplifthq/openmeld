import { buildTargetWakeLifecycleId } from "@openmeld/schemas";
import type { ExecutionContextSelection } from "@openmeld/schemas/types";
import {
	DropdownMenuRadioGroup,
	DropdownMenuSeparator,
	DropdownMenuSub,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuGroup,
	FluidDropdownMenuRadioItem,
	FluidDropdownMenuSubContent,
	FluidDropdownMenuSubTrigger,
} from "@openmeld/ui/fluid/dropdown-menu";
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
				label: item.text.trim().slice(0, 72) || "File request",
			}))
		);
}

/** Execution settings belong to the recipient's existing mention menu. */
export function SpaceComposerAgentOptions(input: {
	targetProfileId: string;
	supportsCurrentFolder: boolean;
	sources: readonly SpaceTaskSource[];
	choice?: SpaceComposerTaskChoice;
	onChange: (choice: SpaceComposerTaskChoice | undefined) => void;
}) {
	const selection = input.choice?.selection;
	const sources = input.sources.filter(
		(source) => source.targetProfileId === input.targetProfileId
	);
	const choose = (next: ExecutionContextSelection, label: string) =>
		input.onChange({
			selection: next,
			label,
			targetProfileId: input.targetProfileId,
		});
	const sessionValue =
		selection?.mode === "resume" || selection?.mode === "fork"
			? `${selection.mode}:${selection.sourceWakeId}`
			: (selection?.mode ?? "auto");
	const accessValue =
		selection && selection.mode !== "resume" && selection.access
			? `${selection.access}:${selection.workspace ?? "isolated"}`
			: "defaults";
	const accessLabels: Record<string, string> = {
		defaults: "Agent defaults",
		"space_context:isolated": "Space only",
		"workspace:isolated": "Isolated worktree",
		"read_only:current": "Read current folder",
		"workspace:current": "Current folder",
	};
	return (
		<>
			<DropdownMenuSeparator />
			<FluidDropdownMenuGroup>
				<DropdownMenuSub>
					<FluidDropdownMenuSubTrigger index={0}>
						<span className="min-w-0 flex-1">Session</span>
						<span className="max-w-36 truncate text-muted-foreground">
							{input.choice?.label ?? "Automatic"}
						</span>
					</FluidDropdownMenuSubTrigger>
					<FluidDropdownMenuSubContent className="w-64">
						<DropdownMenuRadioGroup
							onValueChange={(value) => {
								if (value === "auto" || value === "new") {
									const restrictions =
										selection && selection.mode !== "resume"
											? {
													access: selection.access,
													workspace: selection.workspace,
												}
											: {};
									choose(
										{ mode: value, ...restrictions },
										value === "auto" ? "Automatic" : "Start new"
									);
								} else {
									const source = sources.find(
										(item) => value === `resume:${item.sourceWakeId}`
									);
									if (source) {
										choose(
											{ mode: "resume", sourceWakeId: source.sourceWakeId },
											source.label
										);
									}
								}
							}}
							value={sessionValue}
						>
							<FluidDropdownMenuRadioItem closeOnClick index={0} value="auto">
								Automatic
							</FluidDropdownMenuRadioItem>
							<FluidDropdownMenuRadioItem closeOnClick index={1} value="new">
								Start new
							</FluidDropdownMenuRadioItem>
							{sources.length ? (
								<>
									<DropdownMenuSeparator />
									<p className="px-2 py-1 text-muted-foreground text-xs">
										Continue previous
									</p>
									<FluidDropdownMenuGroup>
										{sources.map((source, index) => (
											<FluidDropdownMenuRadioItem
												closeOnClick
												index={index}
												key={source.sourceWakeId}
												value={`resume:${source.sourceWakeId}`}
											>
												<span className="truncate">{source.label}</span>
											</FluidDropdownMenuRadioItem>
										))}
									</FluidDropdownMenuGroup>
								</>
							) : null}
						</DropdownMenuRadioGroup>
					</FluidDropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<FluidDropdownMenuSubTrigger
						disabled={selection?.mode === "resume"}
						index={1}
					>
						<span className="min-w-0 flex-1">Access &amp; workspace</span>
						<span className="text-muted-foreground">
							{selection?.mode === "resume"
								? "From session"
								: accessLabels[accessValue]}
						</span>
					</FluidDropdownMenuSubTrigger>
					<FluidDropdownMenuSubContent className="w-56">
						<DropdownMenuRadioGroup
							onValueChange={(value) => {
								if (selection?.mode === "resume") {
									return;
								}
								const next = selection ?? { mode: "auto" as const };
								if (value === "defaults") {
									const {
										access: _access,
										workspace: _workspace,
										...rest
									} = next;
									choose(rest, input.choice?.label ?? "Automatic");
									return;
								}
								const [access, workspace] = value.split(":") as [
									"space_context" | "read_only" | "workspace",
									"current" | "isolated",
								];
								choose(
									{ ...next, access, workspace },
									input.choice?.label ?? "Automatic"
								);
							}}
							value={accessValue}
						>
							{Object.entries(accessLabels)
								.filter(
									([key]) =>
										input.supportsCurrentFolder || !key.endsWith(":current")
								)
								.map(([key, label], index) => (
									<FluidDropdownMenuRadioItem
										closeOnClick
										index={index}
										key={key}
										value={key}
									>
										{label}
									</FluidDropdownMenuRadioItem>
								))}
						</DropdownMenuRadioGroup>
					</FluidDropdownMenuSubContent>
				</DropdownMenuSub>
			</FluidDropdownMenuGroup>
		</>
	);
}
