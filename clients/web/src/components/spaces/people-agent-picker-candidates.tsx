import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import {
	isAgentRequestCandidate,
	resolveAgentCandidateDescription,
	resolvePersonActivityLabel,
	type SpaceAddMembersCandidateGroups,
	type SpaceAddMembersCandidateSummary,
	type SpaceAddMembersPersonGroup,
} from "./people-agent-picker-model";
import { SpaceProfileIcon } from "./space-profile-icon";
export function SpaceAddMembersCandidates(input: {
	candidateGroups: SpaceAddMembersCandidateGroups;
	emptyMessage: string;
	isSubmitting: boolean;
	onToggle: (profileId: string) => void;
	searchActive: boolean;
	includeAgentOwners?: boolean;
	agentRequestsFor?: string | null;
	selectedProfileIds: ReadonlySet<string>;
	selectionScope?: "space" | "desk";
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const onToggle = input.onToggle;
	const previousSelection = useRef(input.selectedProfileIds);
	useEffect(() => {
		const addedId = [...input.selectedProfileIds].find(
			(id) => !previousSelection.current.has(id)
		);
		if (addedId) {
			const rows =
				viewportRef.current?.querySelectorAll<HTMLElement>("[data-profile-id]");
			Array.from(rows ?? [])
				.find((row) => row.dataset.profileId === addedId)
				?.scrollIntoView?.({ block: "nearest" });
		}
		previousSelection.current = input.selectedProfileIds;
	}, [input.selectedProfileIds]);
	const [collapsedGroupIds, setCollapsedGroupIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const personGroups = input.candidateGroups.personGroups.filter(
		(group) => group.humanCandidate || group.agentCandidates.length > 0
	);
	const candidateCount =
		personGroups.reduce(
			(count, group) =>
				count + group.agentCandidates.length + (group.humanCandidate ? 1 : 0),
			0
		) + input.candidateGroups.organizationCandidates.length;
	if (candidateCount === 0) {
		return (
			<p className="text-muted-foreground text-sm">{input.emptyMessage}</p>
		);
	}

	return (
		<ScrollArea
			className={cn(
				"-mx-1 max-h-[min(32rem,calc(100dvh-18rem))] min-h-40",
				input.isSubmitting && "pointer-events-none opacity-70"
			)}
			contentClassName="flex flex-col gap-4 px-1"
			viewportRef={viewportRef}
		>
			<SpaceAddMembersCandidateGroup
				candidates={input.candidateGroups.organizationCandidates}
				label="Organization"
				onToggle={onToggle}
				selectedProfileIds={input.selectedProfileIds}
				selectionScope={input.selectionScope}
			/>
			{personGroups.length > 0 ? (
				<section aria-labelledby="space-add-members-people-heading">
					<h3
						className="px-2 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider"
						id="space-add-members-people-heading"
					>
						People &amp; Agents
					</h3>
					<div className="flex flex-col gap-1">
						{personGroups.map((group) => {
							const expanded =
								input.searchActive || !collapsedGroupIds.has(group.id);
							return (
								<SpaceAddMembersPersonGroupView
									agentRequestsFor={input.agentRequestsFor}
									expanded={expanded}
									group={group}
									includeAgentOwners={input.includeAgentOwners}
									key={group.id}
									onExpandedChange={(nextExpanded) => {
										setCollapsedGroupIds((current) => {
											const next = new Set(current);
											if (nextExpanded) {
												next.delete(group.id);
											} else {
												next.add(group.id);
											}
											return next;
										});
									}}
									onToggle={onToggle}
									selectedProfileIds={input.selectedProfileIds}
									selectionScope={input.selectionScope}
								/>
							);
						})}
					</div>
				</section>
			) : null}
		</ScrollArea>
	);
}

function SpaceAddMembersPersonGroupView(input: {
	agentRequestsFor?: string | null;
	includeAgentOwners?: boolean;
	expanded: boolean;
	group: SpaceAddMembersPersonGroup;
	onExpandedChange: (expanded: boolean) => void;
	onToggle: (profileId: string) => void;
	selectedProfileIds: ReadonlySet<string>;
	selectionScope?: "space" | "desk";
}) {
	const selectedAgents = input.group.agentCandidates.filter(
		(candidate) =>
			candidate.ownerHumanProfileId === input.group.humanCandidate?.profileId &&
			input.selectedProfileIds.has(candidate.profileId)
	);
	const requestsOwner =
		input.agentRequestsFor !== undefined &&
		selectedAgents.some((candidate) =>
			isAgentRequestCandidate(candidate, input.agentRequestsFor)
		);
	const selectedAgentCount = selectedAgents.length;
	let humanDescription = resolvePersonActivityLabel(input.group.lastActiveAt);
	if (
		input.group.humanAlreadyMember ||
		input.group.humanCandidate?.alreadyMember
	) {
		humanDescription =
			input.selectionScope === "desk" ? "On your Desk" : "In this Space";
	} else if (requestsOwner) {
		humanDescription = `${input.group.name} decides whether the Agent joins`;
	} else if (input.includeAgentOwners && selectedAgentCount > 0) {
		humanDescription = `Joins with ${selectedAgentCount === 1 ? "selected Agent" : `${String(selectedAgentCount)} selected Agents`}`;
	}
	return (
		<SpacePersonAgentGroup
			agentsId={`space-add-members-person-${input.group.id}-agents`}
			expanded={input.expanded}
			header={
				<div className="min-w-0 flex-1">
					{input.group.humanCandidate ? (
						<CheckboxGroup
							checkedIndices={
								input.selectedProfileIds.has(
									input.group.humanCandidate.profileId
								)
									? new Set([0])
									: new Set()
							}
							className="w-full"
						>
							<CheckboxItem
								adornment={
									<SpaceProfileIcon
										agentControllerRef={null}
										avatarImageUrl={input.group.avatarImageUrl}
										profileId={input.group.humanCandidate.profileId}
										profileKind="human"
										profileName={input.group.name}
										size="sm"
									/>
								}
								checked={input.selectedProfileIds.has(
									input.group.humanCandidate.profileId
								)}
								description={humanDescription}
								index={0}
								label={input.group.name}
								onToggle={() =>
									input.onToggle(input.group.humanCandidate?.profileId ?? "")
								}
							/>
						</CheckboxGroup>
					) : (
						<div className="flex min-h-11 items-center gap-3 px-3 py-2">
							<SpaceProfileIcon
								agentControllerRef={null}
								avatarImageUrl={input.group.avatarImageUrl}
								profileId={input.group.id}
								profileKind="human"
								profileName={input.group.name}
								size="sm"
							/>
							<div className="min-w-0">
								<p className="truncate text-sm">{input.group.name}</p>
								<p className="text-muted-foreground text-xs">
									{humanDescription}
								</p>
							</div>
						</div>
					)}
				</div>
			}
			name={input.group.name}
			onExpandedChange={input.onExpandedChange}
			showToggle={input.group.agentCandidates.length > 0}
			toggleClassName="mt-1"
		>
			{input.group.agentCandidates.length > 0 ? (
				<div className="ml-9">
					<SpaceAddMembersCandidateGroup
						candidates={input.group.agentCandidates}
						onToggle={input.onToggle}
						selectedProfileIds={input.selectedProfileIds}
						selectionScope={input.selectionScope}
					/>
				</div>
			) : null}
		</SpacePersonAgentGroup>
	);
}

export function SpacePersonAgentGroup(input: {
	agentsId: string;
	children: ReactNode;
	expanded: boolean;
	header: ReactNode;
	name: string;
	onExpandedChange: (expanded: boolean) => void;
	showToggle: boolean;
	toggleClassName?: string;
}) {
	return (
		<div>
			<div className="flex items-start gap-1">
				{input.header}
				{input.showToggle ? (
					<Button
						aria-controls={input.agentsId}
						aria-expanded={input.expanded}
						aria-label={`${input.expanded ? "Collapse" : "Expand"} ${input.name}`}
						className={cn("shrink-0", input.toggleClassName)}
						onClick={() => input.onExpandedChange(!input.expanded)}
						size="icon-xs"
						type="button"
						variant="ghost"
					>
						{input.expanded ? <CaretDownIcon /> : <CaretRightIcon />}
					</Button>
				) : null}
			</div>
			{input.expanded && input.showToggle ? (
				<div id={input.agentsId}>{input.children}</div>
			) : null}
		</div>
	);
}

function SpaceAddMembersCandidateGroup(input: {
	candidates: readonly SpaceAddMembersCandidateSummary[];
	label?: string;
	onToggle: (profileId: string) => void;
	selectedProfileIds: ReadonlySet<string>;
	selectionScope?: "space" | "desk";
}) {
	if (input.candidates.length === 0) {
		return null;
	}
	const headingId = input.label
		? `space-add-members-group-${input.label.toLowerCase().replaceAll(" ", "-")}`
		: undefined;
	let nextSelectableIndex = 0;
	const selectionOrder = [...input.selectedProfileIds];
	const candidates = [...input.candidates].sort(
		(a, b) =>
			selectionOrder.indexOf(b.profileId) - selectionOrder.indexOf(a.profileId)
	);
	const rows = candidates.map((candidate) => ({
		candidate,
		selectableIndex: candidate.alreadyMember ? null : nextSelectableIndex++,
	}));
	const checkedIndices = new Set<number>();
	for (const row of rows) {
		if (
			row.selectableIndex !== null &&
			input.selectedProfileIds.has(row.candidate.profileId)
		) {
			checkedIndices.add(row.selectableIndex);
		}
	}

	return (
		<div>
			{input.label ? (
				<h3
					className="px-2 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider"
					id={headingId}
				>
					{input.label}
				</h3>
			) : null}
			<CheckboxGroup
				aria-labelledby={headingId}
				checkedIndices={checkedIndices}
				className="w-full"
			>
				{rows.map(({ candidate, selectableIndex }) =>
					selectableIndex === null ? (
						<SpaceAlreadyAddedMemberRow
							candidate={candidate}
							key={candidate.profileId}
							selectionScope={input.selectionScope}
						/>
					) : (
						<CheckboxItem
							adornment={
								<SpaceProfileIcon
									agentControllerRef={candidate.agentControllerRef ?? null}
									avatarImageUrl={candidate.avatarImageUrl}
									isCenterAgent={candidate.isCenterAgent}
									profileId={candidate.profileId}
									profileKind={candidate.profileKind}
									profileName={candidate.profileName}
								/>
							}
							checked={input.selectedProfileIds.has(candidate.profileId)}
							data-profile-id={candidate.profileId}
							description={resolveAgentCandidateDescription(candidate)}
							disabled={candidate.selectionDisabled}
							index={selectableIndex}
							key={candidate.profileId}
							label={candidate.profileName}
							labelAdornment={
								<SpaceAddMembersCandidateAdornment candidate={candidate} />
							}
							onToggle={() => input.onToggle(candidate.profileId)}
						/>
					)
				)}
			</CheckboxGroup>
		</div>
	);
}

function SpaceAlreadyAddedMemberRow(input: {
	candidate: SpaceAddMembersCandidateSummary;
	selectionScope?: "space" | "desk";
}) {
	return (
		<div className="relative z-10 flex min-h-11 items-start gap-2.5 px-3 py-1.5">
			<span aria-hidden="true" className="h-[15px] w-[15px] shrink-0" />
			<span className="mt-0.5 flex shrink-0">
				<SpaceProfileIcon
					agentControllerRef={input.candidate.agentControllerRef ?? null}
					avatarImageUrl={input.candidate.avatarImageUrl}
					isCenterAgent={input.candidate.isCenterAgent}
					profileId={input.candidate.profileId}
					profileKind={input.candidate.profileKind}
					profileName={input.candidate.profileName}
				/>
			</span>
			<span className="grid min-w-0 flex-1 gap-1">
				<span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
					<span className="truncate">{input.candidate.profileName}</span>
					<SpaceAddMembersCandidateAdornment candidate={input.candidate} />
				</span>
				<span className="text-muted-foreground text-xs leading-5">
					{input.selectionScope === "desk" ? "On your Desk" : "In this Space"}
				</span>
			</span>
		</div>
	);
}

function SpaceAddMembersCandidateAdornment(input: {
	candidate: SpaceAddMembersCandidateSummary;
}) {
	return input.candidate.isCenterAgent ? (
		<Badge className="h-4 px-1.5 text-[10px]" variant="secondary">
			Remote
		</Badge>
	) : (
		<RemoteAgentIndicator
			agentControllerRef={input.candidate.agentControllerRef ?? null}
		/>
	);
}
