import type { LocalProjectControlCandidate } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { GitBranchIcon } from "@phosphor-icons/react";

export function ProjectCandidatePicker(input: {
	candidates: readonly LocalProjectControlCandidate[];
	disabled?: boolean;
	onSelectionChange: (candidateIds: ReadonlySet<string>) => void;
	selectedCandidateIds: ReadonlySet<string>;
	selectionMode: "multiple" | "single";
}) {
	if (input.selectionMode === "single") {
		const selectedIndex = input.candidates.findIndex((candidate) =>
			input.selectedCandidateIds.has(candidate.candidateId)
		);
		return (
			<RadioGroup
				aria-label="Matching folders"
				className={cn(
					"w-full",
					input.disabled && "pointer-events-none opacity-60"
				)}
				selectedIndex={selectedIndex}
			>
				{input.candidates.map((candidate, index) => (
					<RadioItem
						aria-disabled={input.disabled}
						cornerAdornment={<CandidateKind candidate={candidate} />}
						description="Repository verified on this computer."
						index={index}
						key={candidate.candidateId}
						label={candidate.canonicalPath}
						labelClassName="break-all pr-24 font-mono"
						onSelect={() => {
							if (!input.disabled) {
								input.onSelectionChange(new Set([candidate.candidateId]));
							}
						}}
					/>
				))}
			</RadioGroup>
		);
	}

	const checkedIndices = new Set<number>();
	for (const [index, candidate] of input.candidates.entries()) {
		if (input.selectedCandidateIds.has(candidate.candidateId)) {
			checkedIndices.add(index);
		}
	}
	return (
		<CheckboxGroup
			aria-label="Matching folders"
			checkedIndices={checkedIndices}
			className={cn(
				"w-full",
				input.disabled && "pointer-events-none opacity-60"
			)}
		>
			{input.candidates.map((candidate, index) => (
				<CheckboxItem
					aria-disabled={input.disabled}
					checked={input.selectedCandidateIds.has(candidate.candidateId)}
					cornerAdornment={<CandidateKind candidate={candidate} />}
					description="Repository verified on this computer."
					index={index}
					key={candidate.candidateId}
					label={candidate.canonicalPath}
					labelClassName="break-all pr-24 font-mono"
					onToggle={() => {
						if (input.disabled) {
							return;
						}
						const nextSelection = new Set(input.selectedCandidateIds);
						if (nextSelection.has(candidate.candidateId)) {
							nextSelection.delete(candidate.candidateId);
						} else {
							nextSelection.add(candidate.candidateId);
						}
						input.onSelectionChange(nextSelection);
					}}
				/>
			))}
		</CheckboxGroup>
	);
}

function CandidateKind(input: { candidate: LocalProjectControlCandidate }) {
	if (input.candidate.candidateKind !== "worktree") {
		return null;
	}
	return (
		<Badge className="rounded-md" variant="outline">
			<GitBranchIcon aria-hidden="true" /> Worktree
		</Badge>
	);
}
