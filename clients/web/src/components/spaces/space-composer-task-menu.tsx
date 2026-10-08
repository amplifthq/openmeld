import { buildTargetWakeLifecycleId } from "@openmeld/schemas";
import type { ExecutionContextSelection } from "@openmeld/schemas/types";
import {
	DropdownMenuRadioGroup,
	DropdownMenuSeparator,
	DropdownMenuSub,
} from "@openmeld/ui/components/dropdown-menu";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
	FluidDropdownMenuRadioItem,
	FluidDropdownMenuSubContent,
	FluidDropdownMenuSubTrigger,
} from "@openmeld/ui/fluid/dropdown-menu";
import { InfoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { SpaceComposerProjectWorkDialog } from "./space-composer-project-work-dialog";

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
	organizationId?: string | null;
	targetProfileId: string;
	supportsCurrentFolder: boolean;
	projectName?: string | null;
	sources: readonly SpaceTaskSource[];
	choice?: SpaceComposerTaskChoice;
	onChange: (choice: SpaceComposerTaskChoice | undefined) => void;
}) {
	const [projectWorkOpen, setProjectWorkOpen] = useState(false);
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
	const restrictions = executionRestrictions(selection);
	const inheritsSession =
		selection?.mode === "resume" || selection?.mode === "fork";
	const sessionValue =
		selection?.mode === "resume" || selection?.mode === "fork"
			? `${selection.mode}:${selection.sourceWakeId}`
			: (selection?.mode ?? "auto");
	const accessValue =
		selection && selection.mode !== "resume" && selection.access
			? `${selection.access}:${selection.workspace ?? "isolated"}`
			: "defaults";
	const accessOptions = fileAccessOptions(
		input.projectName,
		input.supportsCurrentFolder
	);
	const selectedAccess = accessOptions.find(
		(option) => option.key === accessValue
	);

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
									choose(
										{ mode: value, ...restrictions },
										value === "auto" ? "Automatic" : "Start new"
									);
									return;
								}
								const source = sources.find(
									(item) =>
										value === `resume:${item.sourceWakeId}` ||
										value === `fork:${item.sourceWakeId}`
								);
								if (source) {
									choose(
										{
											mode: value.startsWith("fork:") ? "fork" : "resume",
											sourceWakeId: source.sourceWakeId,
										},
										value.startsWith("fork:")
											? `Fork: ${source.label}`
											: source.label
									);
								}
							}}
							value={sessionValue}
						>
							<FluidDropdownMenuRadioItem
								closeOnClick
								disabled={accessValue !== "defaults"}
								index={0}
								value="auto"
							>
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
									<DropdownMenuSeparator />
									<p className="px-2 py-1 text-muted-foreground text-xs">
										Fork previous
									</p>
									<FluidDropdownMenuGroup>
										{sources.map((source, index) => (
											<TooltipHint
												content="Start an independent session with this history."
												key={source.sourceWakeId}
											>
												<FluidDropdownMenuRadioItem
													closeOnClick
													index={index}
													value={`fork:${source.sourceWakeId}`}
												>
													<span className="truncate">{source.label}</span>
												</FluidDropdownMenuRadioItem>
											</TooltipHint>
										))}
									</FluidDropdownMenuGroup>
								</>
							) : null}
						</DropdownMenuRadioGroup>
					</FluidDropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSub>
					<FluidDropdownMenuSubTrigger disabled={inheritsSession} index={1}>
						<span className="min-w-0 flex-1">Files</span>
						<span className="text-muted-foreground">
							{inheritsSession
								? "From session"
								: (selectedAccess?.label ?? "Custom")}
						</span>
					</FluidDropdownMenuSubTrigger>
					<FluidDropdownMenuSubContent className="w-64">
						{input.projectName && (
							<div
								className="truncate px-2 py-1.5 text-muted-foreground text-xs"
								title={input.projectName}
							>
								{input.projectName}
							</div>
						)}
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
										projectWork: _projectWork,
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
									selection?.mode === "fork"
										? {
												...selection,
												access,
												workspace,
												projectWork:
													access === "space_context"
														? undefined
														: selection.projectWork,
											}
										: {
												mode: "new",
												access,
												workspace,
												projectWork:
													access === "space_context"
														? undefined
														: selection?.projectWork,
											},
									selection?.mode === "fork"
										? (input.choice?.label ?? "Fork previous")
										: "Start new"
								);
							}}
							value={accessValue}
						>
							{accessOptions.map((option, index) => (
								<TooltipHint content={option.hint} key={option.key}>
									<FluidDropdownMenuRadioItem
										closeOnClick
										index={index}
										value={option.key}
									>
										<span>{option.label}</span>
										<InfoIcon
											aria-hidden="true"
											className="size-3.5 text-muted-foreground"
										/>
									</FluidDropdownMenuRadioItem>
								</TooltipHint>
							))}
						</DropdownMenuRadioGroup>
						{input.organizationId && (
							<>
								<DropdownMenuSeparator />
								<FluidDropdownMenuGroup>
									<FluidDropdownMenuItem
										closeOnClick={false}
										index={0}
										onClick={() => setProjectWorkOpen(true)}
									>
										Choose Project…
									</FluidDropdownMenuItem>
								</FluidDropdownMenuGroup>
							</>
						)}
					</FluidDropdownMenuSubContent>
				</DropdownMenuSub>
			</FluidDropdownMenuGroup>
			{projectWorkOpen && input.organizationId ? (
				<SpaceComposerProjectWorkDialog
					initialProjectId={
						selection && "projectWork" in selection
							? selection.projectWork?.projectId
							: undefined
					}
					onOpenChange={setProjectWorkOpen}
					onSelect={(selected) =>
						choose(
							{
								mode: "new",
								access: "workspace",
								workspace: "isolated",
								projectWork: {
									projectId: selected.projectId,
									repositoryFingerprint: selected.repositoryFingerprint,
								},
							},
							`${selected.projectName} · ${selected.repositoryLabel.replace("https://github.com/", "")}`
						)
					}
					open
					organizationId={input.organizationId}
				/>
			) : null}
		</>
	);
}

function executionRestrictions(
	selection: ExecutionContextSelection | undefined
) {
	return selection && selection.mode !== "resume"
		? {
				access: selection.access,
				workspace: selection.workspace,
				projectWork: selection.projectWork,
			}
		: {};
}

function fileAccessOptions(
	projectName: string | null | undefined,
	supportsCurrentFolder: boolean
) {
	return [
		{
			key: "defaults",
			label: "Use agent settings",
			hint: "Use this agent’s saved file access and working folder.",
		},
		{
			key: "space_context:isolated",
			label: "No project files",
			hint: "Work without access to your local project files.",
		},
		...(projectName
			? [
					{
						key: "workspace:isolated",
						label: "Edit a separate copy",
						hint: "Edit a copy of committed code. Uncommitted changes stay behind.",
					},
					...(supportsCurrentFolder
						? [
								{
									key: "read_only:current",
									label: "Read files only",
									hint: "Read the project, including uncommitted changes, without editing files.",
								},
								{
									key: "workspace:current",
									label: "Edit project files",
									hint: "Edit the project directly, alongside your existing changes.",
								},
							]
						: []),
				]
			: []),
	];
}
