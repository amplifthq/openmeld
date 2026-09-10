import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import {
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
	selectedProfileIds: ReadonlySet<string>;
}) {
	const [collapsedGroupIds, setCollapsedGroupIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const candidateCount =
		input.candidateGroups.personGroups.reduce(
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
		<div
			className={cn(
				"-mx-1 flex max-h-[min(32rem,calc(100dvh-18rem))] min-h-40 flex-col gap-4 overflow-y-auto px-1",
				input.isSubmitting && "pointer-events-none opacity-70"
			)}
		>
			<SpaceAddMembersCandidateGroup
				candidates={input.candidateGroups.organizationCandidates}
				label="Organization"
				onToggle={input.onToggle}
				selectedProfileIds={input.selectedProfileIds}
			/>
			{input.candidateGroups.personGroups.length > 0 ? (
				<section aria-labelledby="space-add-members-people-heading">
					<h3
						className="px-2 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider"
						id="space-add-members-people-heading"
					>
						People &amp; Agents
					</h3>
					<div className="flex flex-col gap-1">
						{input.candidateGroups.personGroups.map((group) => {
							const expanded =
								input.searchActive || !collapsedGroupIds.has(group.id);
							return (
								<SpaceAddMembersPersonGroupView
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
									onToggle={input.onToggle}
									selectedProfileIds={input.selectedProfileIds}
								/>
							);
						})}
					</div>
				</section>
			) : null}
		</div>
	);
}

function SpaceAddMembersPersonGroupView(input: {
	includeAgentOwners?: boolean;
	expanded: boolean;
	group: SpaceAddMembersPersonGroup;
	onExpandedChange: (expanded: boolean) => void;
	onToggle: (profileId: string) => void;
	selectedProfileIds: ReadonlySet<string>;
}) {
	const selectedAgentCount = input.group.agentCandidates.filter(
		(candidate) =>
			candidate.ownerHumanProfileId === input.group.humanCandidate?.profileId &&
			input.selectedProfileIds.has(candidate.profileId)
	).length;
	let humanDescription = resolvePersonActivityLabel(input.group.lastActiveAt);
	if (input.group.humanAlreadyMember) {
		humanDescription = "In this Space";
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
}) {
	if (input.candidates.length === 0) {
		return null;
	}
	const headingId = input.label
		? `space-add-members-group-${input.label.toLowerCase()}`
		: undefined;
	const checkedIndices = new Set<number>();
	for (const [index, candidate] of input.candidates.entries()) {
		if (
			candidate.alreadyMember ||
			input.selectedProfileIds.has(candidate.profileId)
		) {
			checkedIndices.add(index);
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
				{input.candidates.map((candidate, index) => (
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
						checked={
							candidate.alreadyMember ||
							input.selectedProfileIds.has(candidate.profileId)
						}
						description={resolveAgentCandidateDescription(candidate)}
						disabled={candidate.alreadyMember}
						index={index}
						key={candidate.profileId}
						label={candidate.profileName}
						labelAdornment={
							candidate.isCenterAgent ? (
								<Badge className="h-4 px-1.5 text-[10px]" variant="secondary">
									Remote
								</Badge>
							) : (
								<RemoteAgentIndicator
									agentControllerRef={candidate.agentControllerRef ?? null}
								/>
							)
						}
						onToggle={() => input.onToggle(candidate.profileId)}
					/>
				))}
			</CheckboxGroup>
		</div>
	);
}
