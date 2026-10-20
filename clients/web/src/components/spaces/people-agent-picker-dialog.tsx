import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	lazy,
	type ReactNode,
	type RefObject,
	Suspense,
	useEffect,
	useRef,
	useState,
} from "react";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import { agentProfileCreationRequestQueryOptions } from "#/query/profiles/agent-profile-creation-requests";
import { SpaceAddMembersCandidates } from "./people-agent-picker-candidates";
import {
	filterAddMemberGroups,
	type SpaceAddMembersCandidateGroups,
	type SpaceAddMembersCandidateSummary,
} from "./people-agent-picker-model";

const PeopleAgentPickerCreateAgent = lazy(() =>
	import("../profiles/people-agent-picker-create-agent").then((module) => ({
		default: module.PeopleAgentPickerCreateAgent,
	}))
);

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
	tutorialAction?: "create" | "select" | "submit";
	secondaryAction?: ReactNode;
	isSubmitting: boolean;
	selectionDisabled?: boolean;
	isLoading: boolean;
	errorMessage?: string | null;
	onRetry?: () => void;
	emptyMessage: string;
	includeAgentOwners?: boolean;
	// Set when choosing another member's Agent asks its owner.
	agentRequestsFor?: string | null;
	onAgentCreated?: (
		agent: SpaceAddMembersCandidateSummary,
		selected: boolean
	) => void;
	actions?: ReactNode;
	notice?: ReactNode;
	id?: string;
	finalFocus?: RefObject<HTMLElement | null>;
}) {
	const [creating, setCreating] = useState(false);
	const [creationBusy, setCreationBusy] = useState(false);
	const {
		creationProgress,
		creationError,
		failCreation,
		setAcceptedCreation,
		pendingCreation,
		pendingSelected,
		setPendingSelected,
		startCreation,
	} = usePickerAgentCreation(input.onAgentCreated);
	const selectedProfileIds = new Set([
		...input.selectedProfileIds,
		...pendingSelectionIds(pendingCreation, pendingSelected),
	]);
	const candidateGroups = withPendingCreation(
		input.candidateGroups,
		pendingCreation
	);
	const isSubmitting = input.isSubmitting;
	const tutorialAction = pickerTutorialAction(
		creating,
		input.tutorialAction,
		isSubmitting
	);
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!isSubmitting) {
					if (!open) {
						setCreating(false);
					}
					input.onOpenChange(open);
				}
			}}
			open={input.open}
		>
			<DialogContent
				// Keep the same containing block through progress changes and exit.
				// A closing scale/translate would move the nested fixed tutorial.
				className="@container translate-none inset-0 m-auto flex h-fit max-h-[min(46rem,calc(100dvh-2rem))] flex-col overflow-hidden data-closed:animate-none data-open:animate-none sm:max-w-2xl"
				data-tutorial-action={tutorialAction}
				data-tutorial-description={input.description}
				data-walkthrough="people-agent-picker"
				finalFocus={input.finalFocus}
				id={input.id}
			>
				{creating && input.onAgentCreated ? (
					<div>
						<Suspense
							fallback={
								<div className="flex flex-col gap-3">
									<DialogHeader>
										<DialogTitle>Create an Agent</DialogTitle>
									</DialogHeader>
									<SkeletonRows label="Loading Agent creation" />
								</div>
							}
						>
							<PeopleAgentPickerCreateAgent
								onAccepted={setAcceptedCreation}
								onBack={() => setCreating(false)}
								onBusyChange={setCreationBusy}
								onFailed={failCreation}
								onStarted={(creation) => {
									startCreation(creation);
									input.onQueryChange("");
									setCreating(false);
								}}
							/>
						</Suspense>
					</div>
				) : null}
				{!creating && (
					<div className="flex min-h-0 flex-col gap-3">
						<DialogHeader>
							<DialogTitle>{input.title}</DialogTitle>
						</DialogHeader>
						<DialogDescription>{input.description}</DialogDescription>
						{(input.onAgentCreated || input.actions) && (
							<div className="flex flex-wrap items-center gap-2">
								{input.onAgentCreated && (
									<Button
										data-tutorial-target="create"
										disabled={
											isSubmitting ||
											input.isLoading ||
											input.candidateGroups.personGroups.length === 0 ||
											creationBusy ||
											Boolean(creationProgress) ||
											input.selectionDisabled
										}
										onClick={() => setCreating(true)}
										size="xs"
										variant={newAgentVariant(input.tutorialAction)}
									>
										<PlusIcon aria-hidden="true" />
										New Agent
									</Button>
								)}
								{input.actions}
							</div>
						)}
						<div className="relative">
							<MagnifyingGlassIcon
								aria-hidden="true"
								className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								aria-label="Search people and agents"
								autoComplete="off"
								autoFocus={!input.tutorialAction}
								className="pl-9"
								disabled={input.isSubmitting || input.selectionDisabled}
								onChange={(event) => input.onQueryChange(event.target.value)}
								placeholder="Search people and agents"
								type="search"
								value={input.query}
							/>
						</div>
						<div aria-live="polite">
							{creationError && (
								<p className="text-destructive text-sm">{creationError}</p>
							)}
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
							<SkeletonRows label="Loading people and agents" />
						) : (
							<div data-tutorial-target="select">
								<SpaceAddMembersCandidates
									agentRequestsFor={input.agentRequestsFor}
									candidateGroups={filterAddMemberGroups(
										candidateGroups,
										input.query.trim().toLocaleLowerCase(),
										selectedProfileIds
									)}
									emptyMessage={input.emptyMessage}
									includeAgentOwners={input.includeAgentOwners}
									isSubmitting={
										input.isSubmitting || input.selectionDisabled === true
									}
									onToggle={(id) => {
										if (!(input.isSubmitting || input.selectionDisabled)) {
											if (
												id === pendingCreation?.id &&
												pendingCreation.status === "creating"
											) {
												setPendingSelected((selected) => !selected);
											} else if (id !== pendingCreation?.id) {
												input.onToggle(id);
											}
										}
									}}
									searchActive={input.query.trim().length > 0}
									selectedProfileIds={selectedProfileIds}
								/>
							</div>
						)}
						<div className="flex @min-[20rem]:flex-row flex-col @min-[20rem]:items-center items-stretch @min-[20rem]:justify-between gap-2">
							<span className="@min-[20rem]:w-auto w-full text-muted-foreground text-xs">
								{selectedProfileIds.size === 0
									? (input.emptySelectionLabel ?? "Select people or agents")
									: `${selectedProfileIds.size} selected`}
							</span>
							<span className="flex @min-[20rem]:w-auto w-full items-center gap-2">
								{input.secondaryAction ??
									(selectedProfileIds.size > 0 && (
										<Button
											disabled={input.isSubmitting || input.selectionDisabled}
											onClick={() => {
												setPendingSelected(false);
												input.onClear();
											}}
											size="xs"
											variant="secondary"
										>
											Clear
										</Button>
									))}
								<Button
									className="min-w-0 @min-[20rem]:flex-none flex-1"
									data-tutorial-target="submit"
									disabled={
										!input.canSubmit ||
										input.isSubmitting ||
										Boolean(
											pendingCreation?.status === "creating" && pendingSelected
										)
									}
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

function usePickerAgentCreation(
	onCreated?: (
		agent: SpaceAddMembersCandidateSummary,
		selected: boolean
	) => void
) {
	const [pendingCreation, setPendingCreation] =
		useState<OptimisticAgentProfileCreation | null>(null);
	const [pendingSelected, setPendingSelected] = useState(true);
	const [acceptedCreation, setAcceptedCreation] =
		useState<AgentProfileCreationRequest | null>(null);
	const delivered = useRef<string | null>(null);
	const creationQuery = useQuery(
		agentProfileCreationRequestQueryOptions({
			enabled: Boolean(acceptedCreation),
			organizationId: acceptedCreation?.organizationId ?? "",
			requestId: acceptedCreation?.id ?? "",
		})
	);
	const request = creationQuery.data ?? acceptedCreation;
	useEffect(() => {
		if (!request || delivered.current === request.id) {
			return;
		}
		if (request.createdAgentProfileId) {
			delivered.current = request.id;
			onCreated?.(
				{
					profileId: request.createdAgentProfileId,
					profileName: request.profileName,
					profileKind: "agent",
					agentControllerRef: request.configuration.agentControllerRef,
					ownerUserId: request.targetOwnerUserId,
					searchText: request.profileName.toLocaleLowerCase(),
				},
				pendingSelected
			);
			setPendingCreation(null);
		} else if (
			request.status === "failed" ||
			request.status === "declined" ||
			request.status === "cancelled"
		) {
			delivered.current = request.id;
			setPendingCreation((current) =>
				current
					? {
							...current,
							status: "failed",
							failureMessage:
								request.failureMessage ??
								"Agent creation did not complete. Check creation history.",
						}
					: null
			);
		}
	}, [request, onCreated, pendingSelected]);
	return {
		pendingCreation,
		pendingSelected,
		setPendingSelected,
		startCreation: (creation: OptimisticAgentProfileCreation) => {
			setPendingCreation(creation);
			setPendingSelected(true);
			setAcceptedCreation(null);
		},
		creationProgress:
			pendingCreation?.status === "creating"
				? pendingCreation.profileName
				: null,
		creationError: pendingCreation?.failureMessage,
		failCreation: (message: string) =>
			setPendingCreation((current) =>
				current
					? { ...current, status: "failed", failureMessage: message }
					: null
			),
		setAcceptedCreation,
	};
}

function withPendingCreation(
	groups: SpaceAddMembersCandidateGroups,
	creation: OptimisticAgentProfileCreation | null
): SpaceAddMembersCandidateGroups {
	if (!creation) {
		return groups;
	}
	return {
		...groups,
		personGroups: groups.personGroups.map((group) =>
			group.id === creation.targetOwnerUserId
				? {
						...group,
						agentCandidates: [
							{
								profileId: creation.id,
								profileName: creation.profileName,
								profileKind: "agent",
								agentControllerRef: creation.configuration.agentControllerRef,
								ownerUserId: creation.targetOwnerUserId,
								ownerHumanProfileId: group.humanCandidate?.profileId,
								searchText: creation.profileName.toLocaleLowerCase(),
								description:
									creation.status === "failed"
										? "Creation failed"
										: "Creating…",
								selectionDisabled: creation.status === "failed",
							},
							...group.agentCandidates,
						],
					}
				: group
		),
	};
}

function pendingSelectionIds(
	creation: OptimisticAgentProfileCreation | null,
	selected: boolean
) {
	return creation?.status === "creating" && selected ? [creation.id] : [];
}

function newAgentVariant(action: string | undefined) {
	return action === "create" ? ("default" as const) : ("outline" as const);
}

function pickerTutorialAction(
	creating: boolean,
	action: string | undefined,
	isSubmitting: boolean
) {
	const nextAction = action && isSubmitting ? "submit" : action;
	return creating ? undefined : nextAction;
}
