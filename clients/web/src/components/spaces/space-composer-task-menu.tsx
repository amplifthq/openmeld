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
import {
	type ComposerFolderOption,
	chooseComposerFolder,
	selectedComposerFolderId,
} from "./space-composer-folder-choice";
import { SpaceComposerProjectWorkDialog } from "./space-composer-project-work-dialog";

/**
 * An earlier request the Agent finished with a published reply. Only these
 * can be continued or forked: a failed or unanswered request has no finished
 * turn to continue from.
 */
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
	// Agents that published a final reply to each request. A plain Direct
	// Message wakes the peer without activation targets, so the published
	// reply, not the request's wake targets, says who answered it.
	const answeredBy = new Map<string, Set<string>>();
	for (const item of items) {
		if (
			item.isAgentFinalReply &&
			// A live stream is still running; only a published reply finished.
			!item.agentStreamState &&
			item.deliveryState === "sent" &&
			item.replyToSignalId
		) {
			const agents = answeredBy.get(item.replyToSignalId) ?? new Set();
			agents.add(item.actorProfileId);
			answeredBy.set(item.replyToSignalId, agents);
		}
	}
	return items
		.filter(
			(item) =>
				item.actorProfileId === requesterProfileId &&
				item.deliveryState === "sent" &&
				item.signalType === "signal.text" &&
				!item.recalledAt
		)
		.reverse()
		.flatMap((item) => {
			const answered = answeredBy.get(item.id);
			if (!answered) {
				return [];
			}
			// Woken targets first, in the request's order; then any other answerer.
			const targets = [
				...item.wakeTargetProfileIds.filter((id) => answered.has(id)),
				...[...answered].filter(
					(id) => !item.wakeTargetProfileIds.includes(id)
				),
			];
			return targets.map((targetProfileId) => ({
				targetProfileId,
				sourceWakeId: buildTargetWakeLifecycleId({
					spaceId: item.spaceId,
					sourceSignalId: item.id,
					targetProfileId,
				}),
				label: item.text.trim().slice(0, 72) || "File request",
			}));
		});
}

/** Execution settings belong to the recipient's existing mention menu. */
export function SpaceComposerAgentOptions(input: {
	organizationId?: string | null;
	targetProfileId: string;
	supportsCurrentFolder: boolean;
	supportsFork?: boolean;
	supportsAccessRestrictions?: boolean;
	projectName?: string | null;
	/** The owner's folders for this Agent; empty for everyone else. */
	folders?: readonly ComposerFolderOption[];
	/** The Computer did not answer; the list is the last one it reported. */
	foldersRecorded?: boolean;
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
	const sessionValue = inheritsSession
		? `${selection.mode}:${selection.sourceWakeId}`
		: (selection?.mode ?? "auto");
	const preferences = selection?.mode === "resume" ? undefined : selection;
	const workspace = preferences?.workspace ?? "current";
	const spaceOnly = preferences?.access === "space_context";
	const hasProject = Boolean(input.projectName || preferences?.projectWork);
	const accessValue = preferences?.access ?? "defaults";
	const accessOptions = fileAccessOptions(
		hasProject,
		input.supportsCurrentFolder,
		workspace,
		input.supportsAccessRestrictions
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
						<SessionGuidance
							supportsAccessRestrictions={input.supportsAccessRestrictions}
						/>
						<DropdownMenuRadioGroup
							onValueChange={(value) => {
								if (value === "auto" || value === "new") {
									choose(
										{
											mode: value,
											...(value === "new" ? restrictions : {}),
										},
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
							<FluidDropdownMenuRadioItem closeOnClick index={0} value="auto">
								Automatic
							</FluidDropdownMenuRadioItem>
							<FluidDropdownMenuRadioItem closeOnClick index={1} value="new">
								Start new
							</FluidDropdownMenuRadioItem>
							<TaskHistoryChoices
								sources={sources}
								supportsFork={input.supportsFork}
							/>
						</DropdownMenuRadioGroup>
					</FluidDropdownMenuSubContent>
				</DropdownMenuSub>
				<WorkingCopyMenu
					canUseCurrentFolder={
						input.supportsCurrentFolder || preferences?.access !== "workspace"
					}
					disabled={inheritsSession || spaceOnly}
					hasProject={hasProject}
					label={workingCopyLabel(inheritsSession, spaceOnly, workspace)}
					onChange={(workspace) =>
						choose({ mode: "new", ...restrictions, workspace }, "Start new")
					}
					onChooseProject={
						input.organizationId ? () => setProjectWorkOpen(true) : undefined
					}
					projectName={input.projectName}
					workspace={workspace}
				/>
				<DropdownMenuSub>
					<FluidDropdownMenuSubTrigger disabled={inheritsSession} index={2}>
						<span className="min-w-0 flex-1">Access</span>
						<span className="text-muted-foreground">
							{inheritsSession
								? "From session"
								: (selectedAccess?.label ?? "Custom")}
						</span>
					</FluidDropdownMenuSubTrigger>
					<FluidDropdownMenuSubContent className="w-64">
						<DropdownMenuRadioGroup
							onValueChange={(value) => {
								if (inheritsSession) {
									return;
								}
								choose(
									newTaskAccessSelection(
										value,
										spaceOnly ? "current" : workspace,
										preferences?.projectWork,
										preferences?.folderId
									),
									"Start new"
								);
							}}
							value={accessValue}
						>
							{accessOptions.map((option, index) => (
								<TooltipHint content={option.hint} key={option.key}>
									<FluidDropdownMenuRadioItem
										closeOnClick
										disabled={option.disabled}
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
					</FluidDropdownMenuSubContent>
				</DropdownMenuSub>
				<FolderMenu
					disabled={spaceOnly || Boolean(preferences?.projectWork)}
					folders={input.folders ?? []}
					inheritsSession={inheritsSession}
					onChoose={(folder) => {
						const next = chooseComposerFolder({ folder, selection });
						choose(next.selection, next.label);
					}}
					recorded={input.foldersRecorded === true}
					selectedFolderId={selectedComposerFolderId(selection)}
				/>
			</FluidDropdownMenuGroup>
			{projectWorkOpen &&
			input.organizationId &&
			!spaceOnly &&
			!inheritsSession ? (
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
								...withoutFolder(restrictions),
								workspace: preferences?.workspace ?? "isolated",
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
				folderId: selection.folderId,
				workspace: selection.workspace,
				projectWork: selection.projectWork,
			}
		: {};
}

/** A Project repository and a folder choice are exclusive. */
function withoutFolder<T extends { folderId?: string }>(
	restrictions: T
): Omit<T, "folderId"> {
	const { folderId: _folderId, ...rest } = restrictions;
	return rest;
}

function workingCopyLabel(
	inheritsSession: boolean,
	spaceOnly: boolean,
	workspace: "current" | "isolated"
) {
	if (inheritsSession) {
		return "From session";
	}
	if (spaceOnly) {
		return "Scratch folder";
	}
	return workspace === "isolated" ? "Separate copy" : "Current folder";
}

function newTaskAccessSelection(
	value: string,
	workspace: "current" | "isolated",
	projectWork: Extract<
		ExecutionContextSelection,
		{ mode: "new" }
	>["projectWork"],
	folderId?: string
): ExecutionContextSelection {
	const access =
		value === "defaults"
			? undefined
			: (value as "space_context" | "read_only" | "workspace");
	return {
		mode: "new",
		...(access ? { access } : {}),
		workspace: access === "space_context" ? "isolated" : workspace,
		...(access !== "space_context" && projectWork ? { projectWork } : {}),
		// Space-only work has no user folder to choose.
		...(access !== "space_context" && folderId ? { folderId } : {}),
	};
}

function FolderMenu(input: {
	disabled: boolean;
	folders: readonly ComposerFolderOption[];
	inheritsSession: boolean;
	onChoose: (folder: ComposerFolderOption) => void;
	recorded: boolean;
	selectedFolderId?: string;
}) {
	// One folder leaves nothing to choose; non-owners get no folders at all.
	if (input.folders.length < 2) {
		return null;
	}
	const defaultFolder = input.folders.find((folder) => folder.isDefault);
	const selected = input.folders.find(
		(folder) => folder.folderId === input.selectedFolderId
	);
	let label = "Default folder";
	if (selected) {
		label = selected.displayName;
	} else if (input.inheritsSession) {
		label = "From session";
	} else if (defaultFolder) {
		label = defaultFolder.displayName;
	}
	return (
		<DropdownMenuSub>
			<FluidDropdownMenuSubTrigger disabled={input.disabled} index={3}>
				<span className="min-w-0 flex-1">Folder</span>
				<span className="max-w-36 truncate text-muted-foreground">{label}</span>
			</FluidDropdownMenuSubTrigger>
			<FluidDropdownMenuSubContent className="w-64">
				<p className="px-2 py-1 text-muted-foreground text-xs">
					{input.inheritsSession
						? "Choose a folder to continue this session there as a fork."
						: "Choose where this Agent works for this task."}
					{input.recorded
						? " The Agent’s computer didn’t answer, so this is its last reported folder list."
						: ""}
				</p>
				<DropdownMenuRadioGroup
					onValueChange={(value) => {
						const folder = input.folders.find(
							(item) => item.folderId === value
						);
						if (folder && !input.disabled) {
							input.onChoose(folder);
						}
					}}
					value={input.selectedFolderId ?? ""}
				>
					{input.folders.map((folder, index) => (
						<FluidDropdownMenuRadioItem
							closeOnClick
							index={index}
							key={folder.folderId}
							value={folder.folderId}
						>
							<span className="min-w-0 flex-1 truncate">
								{folder.displayName}
							</span>
							{folder.isDefault ? (
								<span className="text-muted-foreground text-xs">Default</span>
							) : null}
						</FluidDropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</FluidDropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function fileAccessOptions(
	hasProject: boolean,
	supportsCurrentFolder: boolean,
	workspace: "current" | "isolated",
	supportsAccessRestrictions = true
) {
	return [
		{
			key: "defaults",
			label: "Use agent settings",
			hint: "Keep the agent's native permissions and tools. Computer policy still applies.",
			disabled: false,
		},
		{
			key: "space_context",
			label: "No project files",
			hint: "Use a restricted scratch folder without project files.",
			disabled: false,
		},
		...(hasProject
			? [
					...(supportsCurrentFolder
						? [
								{
									key: "read_only",
									label: "Read files only",
									hint: "Read the selected working copy without editing files.",
									disabled: false,
								},
							]
						: []),
					{
						key: "workspace",
						label: "Project files only",
						hint: supportsCurrentFolder
							? "Limit reads and edits to the selected working copy."
							: "Restrict a separate copy using Docker or Podman. Project commands cannot access the network.",
						disabled: !supportsCurrentFolder && workspace !== "isolated",
					},
				]
			: []),
	].filter((option) => supportsAccessRestrictions || option.key === "defaults");
}

function WorkingCopyMenu(input: {
	disabled: boolean;
	label: string;
	projectName?: string | null;
	workspace: "current" | "isolated";
	hasProject: boolean;
	canUseCurrentFolder: boolean;
	onChange: (workspace: "current" | "isolated") => void;
	onChooseProject?: () => void;
}) {
	return (
		<DropdownMenuSub>
			<FluidDropdownMenuSubTrigger disabled={input.disabled} index={1}>
				<span className="min-w-0 flex-1">Working copy</span>
				<span className="text-muted-foreground">{input.label}</span>
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
						if (!input.disabled) {
							input.onChange(value as "current" | "isolated");
						}
					}}
					value={input.workspace}
				>
					<FluidDropdownMenuRadioItem
						closeOnClick
						disabled={!input.canUseCurrentFolder}
						index={0}
						value="current"
					>
						Current folder
					</FluidDropdownMenuRadioItem>
					<TooltipHint
						content={
							input.hasProject
								? "Use a copy of committed code. Agent settings and computer policy still apply."
								: "Choose a Project to create a separate copy."
						}
					>
						<FluidDropdownMenuRadioItem
							closeOnClick
							disabled={!input.hasProject}
							index={1}
							value="isolated"
						>
							Separate copy
						</FluidDropdownMenuRadioItem>
					</TooltipHint>
				</DropdownMenuRadioGroup>
				{input.onChooseProject && (
					<>
						<DropdownMenuSeparator />
						<FluidDropdownMenuGroup>
							<FluidDropdownMenuItem
								closeOnClick={false}
								index={0}
								onClick={input.onChooseProject}
							>
								Choose Project…
							</FluidDropdownMenuItem>
						</FluidDropdownMenuGroup>
					</>
				)}
			</FluidDropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

function SessionGuidance({
	supportsAccessRestrictions,
}: {
	supportsAccessRestrictions?: boolean;
}) {
	return (
		<p className="px-2 py-1 text-muted-foreground text-xs">
			{supportsAccessRestrictions === false ? (
				"Antigravity ACP supports new and continued sessions using Agent settings. A new session does not restrict file access. History forks and extra access limits are not supported. Select the official ACP installation and sign in first."
			) : (
				<>
					Automatic continuation keeps an earlier session's restrictions,
					including Space-only access. Choosing Automatic clears the
					working-copy, Project, and access choices below. To use the agent's
					current settings, choose Start new and Access → Use agent settings.
				</>
			)}
		</p>
	);
}

function TaskHistoryChoices({
	sources,
	supportsFork,
}: {
	sources: readonly SpaceTaskSource[];
	supportsFork?: boolean;
}) {
	return (
		<>
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
					{supportsFork !== false ? (
						<>
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
				</>
			) : null}
		</>
	);
}
