import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import type { ReactNode, RefObject } from "react";
import { SpaceAddMembersCandidates } from "./people-agent-picker-candidates";
import type { SpaceAddMembersCandidateGroups } from "./people-agent-picker-model";

export function PeopleAgentPickerDialog(input: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	query: string;
	onQueryChange: (query: string) => void;
	candidateGroups: SpaceAddMembersCandidateGroups;
	selectedProfileIds: ReadonlySet<string>;
	onToggle: (profileId: string) => void;
	onClear: () => void;
	onSubmit: () => void;
	submitLabel: string;
	emptySelectionLabel?: string;
	canSubmit: boolean;
	isSubmitting: boolean;
	selectionDisabled?: boolean;
	isLoading: boolean;
	errorMessage?: string | null;
	onRetry?: () => void;
	emptyMessage: string;
	includeAgentOwners?: boolean;
	actions?: ReactNode;
	notice?: ReactNode;
	children?: ReactNode;
	id?: string;
	finalFocus?: RefObject<HTMLElement | null>;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!input.isSubmitting) {
					input.onOpenChange(open);
				}
			}}
			open={input.open}
		>
			<DialogContent
				className="@container flex max-h-[min(46rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-2xl"
				finalFocus={input.finalFocus}
				id={input.id}
			>
				{input.children ?? (
					<div className="flex min-h-0 flex-col gap-3">
						<DialogHeader>
							<DialogTitle>{input.title}</DialogTitle>
						</DialogHeader>
						<DialogDescription>{input.description}</DialogDescription>
						{input.actions}
						<div className="relative">
							<MagnifyingGlassIcon
								aria-hidden="true"
								className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								aria-label="Search people and agents"
								autoComplete="off"
								autoFocus
								className="pl-9"
								disabled={input.isSubmitting || input.selectionDisabled}
								onChange={(event) => input.onQueryChange(event.target.value)}
								placeholder="Search people and agents"
								type="search"
								value={input.query}
							/>
						</div>
						<div aria-live="polite">
							{input.errorMessage && (
								<div className="flex items-center justify-between gap-3">
									<p className="text-destructive text-sm">
										{input.errorMessage}
									</p>
									{input.onRetry && (
										<Button onClick={input.onRetry} size="xs" variant="outline">
											Try again
										</Button>
									)}
								</div>
							)}
							{input.notice}
						</div>
						{input.isLoading ? (
							<p className="text-muted-foreground text-sm">
								Loading people and agents…
							</p>
						) : (
							<SpaceAddMembersCandidates
								candidateGroups={input.candidateGroups}
								emptyMessage={input.emptyMessage}
								includeAgentOwners={input.includeAgentOwners}
								isSubmitting={
									input.isSubmitting || input.selectionDisabled === true
								}
								onToggle={(id) => {
									if (!(input.isSubmitting || input.selectionDisabled)) {
										input.onToggle(id);
									}
								}}
								searchActive={input.query.trim().length > 0}
								selectedProfileIds={input.selectedProfileIds}
							/>
						)}
						<div className="flex @min-[20rem]:flex-row flex-col @min-[20rem]:items-center items-stretch @min-[20rem]:justify-between gap-2">
							<span className="@min-[20rem]:w-auto w-full text-muted-foreground text-xs">
								{input.selectedProfileIds.size === 0
									? (input.emptySelectionLabel ?? "Select people or agents")
									: `${input.selectedProfileIds.size} selected`}
							</span>
							<span className="flex @min-[20rem]:w-auto w-full items-center gap-2">
								{input.selectedProfileIds.size > 0 && (
									<Button
										disabled={input.isSubmitting || input.selectionDisabled}
										onClick={input.onClear}
										size="xs"
										variant="ghost"
									>
										Clear
									</Button>
								)}
								<Button
									className="min-w-0 @min-[20rem]:flex-none flex-1"
									disabled={!input.canSubmit || input.isSubmitting}
									onClick={input.onSubmit}
									size="sm"
								>
									{input.submitLabel}
								</Button>
							</span>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
