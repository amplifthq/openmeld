import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	buildOrganizationDirectoryAddCandidates,
	filterAddMemberGroups,
	type SpaceAddMembersCandidateSummary,
	SpaceAddMembersCandidates,
} from "#/components/spaces/space-members-drawer";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { organizationSpaceProfileCandidatesQueryOptions } from "#/query/organizations/organization-directory";

export function DeskProfilePicker(input: {
	shownIds: readonly string[];
	onAdd: (profiles: readonly SpaceAddMembersCandidateSummary[]) => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const directory = useQuery(
		organizationSpaceProfileCandidatesQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const shown = new Set(input.shownIds);
	const groups = buildOrganizationDirectoryAddCandidates({
		directory: directory.data ?? null,
		organizationName: currentOrganization.name,
		snapshot: null,
	});
	const mark = (candidate: SpaceAddMembersCandidateSummary) => ({
		...candidate,
		alreadyMember: shown.has(candidate.profileId),
	});
	const candidates = {
		...groups,
		organizationCandidates: groups.organizationCandidates.map(mark),
		personGroups: groups.personGroups.map((group) => ({
			...group,
			humanCandidate: group.humanCandidate ? mark(group.humanCandidate) : null,
			agentCandidates: group.agentCandidates.map(mark),
		})),
	};
	const all = [
		...candidates.organizationCandidates,
		...candidates.personGroups.flatMap((g) => [
			...(g.humanCandidate ? [g.humanCandidate] : []),
			...g.agentCandidates,
		]),
	];
	const pending = all.filter(
		(p) => selected.has(p.profileId) && !shown.has(p.profileId)
	);
	return (
		<div className="space-y-4">
			<Input
				aria-label="Search people and agents"
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search people and agents"
				type="search"
				value={query}
			/>
			{directory.isPending && <output>Loading people and agents…</output>}
			{directory.isError && (
				<div role="alert">
					Couldn’t load people and agents.{" "}
					<Button onClick={() => directory.refetch()} variant="outline">
						Try again
					</Button>
				</div>
			)}
			{directory.data && (
				<SpaceAddMembersCandidates
					candidateGroups={filterAddMemberGroups(
						candidates,
						query.trim().toLocaleLowerCase()
					)}
					currentOwnerUserId={currentUserId}
					emptyMessage="No matching people or agents."
					isSubmitting={false}
					onToggle={(id) => {
						if (shown.has(id)) {
							return;
						}
						setSelected((current) => {
							const next = new Set(current);
							if (next.has(id)) {
								next.delete(id);
							} else {
								next.add(id);
							}
							return next;
						});
					}}
					searchActive={Boolean(query.trim())}
					selectedProfileIds={new Set([...selected, ...shown])}
					selectionScope="desk"
				/>
			)}
			<div className="flex justify-end">
				<Button
					disabled={pending.length === 0}
					onClick={() => input.onAdd(pending)}
				>
					Add selected{pending.length ? ` (${pending.length})` : ""}
				</Button>
			</div>
		</div>
	);
}
