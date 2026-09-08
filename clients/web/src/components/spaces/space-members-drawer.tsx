"use client";

import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { resolveAgentWakeAvailabilityDisplayCategory } from "@openmeld/agent-runtime";
import type {
	AuthProfileView,
	ModelCatalog,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	buildSpaceMemberDirectory,
	buildSpaceProfileAddPlan,
	type SpaceMemberDirectory,
	type SpaceMemberDirectoryEntry,
	type SpaceProfileAddCandidate,
	type SpaceProfileAddPlan,
	type SpaceProfileAddProfile,
} from "@openmeld/space";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { springs } from "@openmeld/ui/lib/springs";
import {
	resolveStatusToneIconClassName,
	resolveStatusToneWarningNoticeClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CaretDownIcon,
	CaretRightIcon,
	CloudIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	UsersThreeIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	AnimatePresence,
	domAnimation,
	LazyMotion,
	MotionConfig,
	m,
} from "motion/react";
import type { ReactNode, RefObject } from "react";
import {
	useDeferredValue,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { AgentProfileEditDialogContext } from "#/components/agents/agent-profile-edit-dialog-controller";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import { resolveDirectoryHumanProfileActivityLabel } from "#/components/directory/directory-human-profile-format";
import { SpacePickerCreateAgent } from "#/components/profiles/space-picker-create-agent";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { SPACE_PANEL_WIDTH_METRICS } from "#/lib/spaces/panel-width-storage";
import {
	buildSpaceMemberDirectoryForStatusOrder,
	filterSpaceMemberDirectory,
} from "#/lib/spaces/presentation";
import {
	type OrganizationSpaceProfileCandidates,
	organizationSpaceProfileCandidatesQueryOptions,
} from "#/query/organizations/organization-directory";
import { buildDirectMessageConversionDefaultName } from "./direct-message-conversion";
import { DirectMessageConversionDialog } from "./direct-message-conversion-dialog";
import type { SpaceAgentProfileBindingRecoveryPlan } from "./space-agent-recovery-action";
import { buildSpaceMemberDirectoryEntryByProfileId } from "./space-collaboration-profile";
import { SpaceInlineSidePanel } from "./space-inline-side-panel";
import { SpaceInvitationsSection } from "./space-invitations-section";
import { isSameOwnerUserId } from "./space-member-ownership";
import { SpaceMemberRow } from "./space-member-row";
import {
	SPACE_MEMBERS_LOAD_ERROR_MESSAGE,
	SPACE_MEMBERS_REFRESH_ERROR_MESSAGE,
} from "./space-members-error-copy";
import { SpaceProfileIcon } from "./space-profile-icon";
import {
	resolveSpaceWakeStatusTransientState,
	type SpaceWakeStatusTransientState,
} from "./space-wake-status-refresh";
import {
	applyWakeAvailabilityDisplayOverride,
	type WakeDisplayOverrideByProfileId,
} from "./use-wake-display-debounce";

export const SPACE_MEMBERS_SIDE_PANEL_QUERY = "(min-width: 1280px)";

const EMPTY_ACTIVE_WAKE_DISPLAY_TARGET_PROFILE_IDS: ReadonlySet<string> =
	new Set();

export type SpaceAddProfilesResult = {
	addedCount: number;
	alreadyMemberCount: number;
};

export type SpaceAddOrganizationDirectoryProfilesInput = {
	directoryProfileIds: readonly string[];
	expectedCenterAgentProfileId?: string;
};

export type SpaceConvertDirectMessageInput = {
	name: string;
	profileIds: readonly string[];
};

export type SpaceRemoveMemberResult = {
	removedCount: number;
	alreadyAbsentCount: number;
};

type SpaceMembersRefreshInput = {
	agentProfileIds?: readonly string[];
	forceNetwork?: boolean;
};

type SpaceMembersSurfaceProps = {
	accountProfiles?: readonly AuthProfileView[];
	agentProfileEditContext?: AgentProfileEditDialogContext;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	activeWakeDisplayTargetProfileIds?: ReadonlySet<string>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	activeWakeWaitingTargetProfileIds: ReadonlySet<string>;
	centerAgentProfileId?: string | null;
	currentOwnerUserId: string | null;
	currentProfileId: string;
	displayWakeOverrideByProfileId?: WakeDisplayOverrideByProfileId;
	isAgentRecoveryPending: (profileId: string) => boolean;
	isLoading: boolean;
	membersError: string | null;
	modelCatalog?: ModelCatalog | null;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAddOrganizationDirectoryProfiles?: (
		input: SpaceAddOrganizationDirectoryProfilesInput
	) => Promise<SpaceAddProfilesResult>;
	onAddProfiles?: (
		profileIds: readonly string[]
	) => Promise<SpaceAddProfilesResult>;
	onConvertDirectMessageToSpace?: (
		input: SpaceConvertDirectMessageInput
	) => Promise<SpaceAddProfilesResult>;
	onRefresh: (input?: SpaceMembersRefreshInput) => Promise<void>;
	onRemoveMember?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	orgSlug: string;
	/** Requests the shared picker without changing Members visibility. */
	openAddMembersNonce?: number;
	/** Selects the desktop or mobile owner for external picker requests. */
	handlesAddMembersRequest?: boolean;
	prepareSetupHref?: string;
	spaceId?: string;
	spaceName?: string | null;
	snapshot: SpaceMembersSnapshot | null;
};

export function SpaceMembersToggleButton(input: {
	controlsId: string;
	memberCount: number | null;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const memberLabel =
		input.memberCount === null
			? "Members"
			: `${String(input.memberCount)} member${input.memberCount === 1 ? "" : "s"}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-controls={input.controlsId}
						aria-expanded={input.open}
						aria-label={
							input.memberCount === null
								? "Members"
								: `Members, ${String(input.memberCount)} total`
						}
						onClick={() => input.onOpenChange(!input.open)}
						size="sm"
						type="button"
						variant="ghost"
					>
						<UsersThreeIcon
							aria-hidden="true"
							className="size-4"
							data-icon="users-three"
						/>
						{input.memberCount === null ? null : (
							<span className="tabular-nums">{input.memberCount}</span>
						)}
					</Button>
				}
			/>
			<TooltipContent side="bottom">{memberLabel}</TooltipContent>
		</Tooltip>
	);
}

export function SpaceMembersSidePanel(
	input: SpaceMembersSurfaceProps & {
		onOpenChange: (open: boolean) => void;
		onPanelWidthChange: (width: string) => void;
		open: boolean;
		panelWidth: string;
	}
) {
	const model = useSpaceMembersModel(
		input,
		input.handlesAddMembersRequest ?? input.open
	);
	const widthMetrics = SPACE_PANEL_WIDTH_METRICS.members;

	return (
		<>
			<SpaceMembersAddDialog input={input} model={model} />
			<SpaceInlineSidePanel
				ariaLabel="Members"
				className="hidden xl:flex"
				id="space-members-panel"
				maxWidth={widthMetrics.maxWidth}
				minWidth={widthMetrics.minWidth}
				onWidthChange={input.onPanelWidthChange}
				open={input.open}
				resizeHandleLabel="Resize Members panel"
				width={input.panelWidth}
			>
				<header className="shrink-0 border-border border-b px-4 py-3">
					<div className="flex items-center justify-between gap-2">
						<div className="flex min-w-0 items-baseline gap-2">
							<h2 className="min-w-0 whitespace-nowrap font-medium text-base">
								Members
							</h2>
							<span
								aria-hidden="true"
								className="truncate text-muted-foreground text-xs tabular-nums"
							>
								{model.membersCountLabel}
							</span>
							<span className="sr-only">{model.membersCountDescription}</span>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							<SpaceMembersSearchHeaderButton
								onToggle={() => model.setIsSearchOpen(!model.isSearchOpen)}
								open={model.isSearchOpen}
							/>
							{input.onAddProfiles ||
							input.onAddOrganizationDirectoryProfiles ? (
								<SpaceAddMembersHeaderButton
									controlsId={model.addMembersDialogId}
									onOpen={model.openAddMembers}
									open={model.isAddMembersOpen}
								/>
							) : null}
							<SpaceMembersCloseButton
								onClose={() => input.onOpenChange(false)}
							/>
						</div>
					</div>
				</header>

				<SpaceMembersBody
					activeWakeDisplayTargetProfileIds={
						input.activeWakeDisplayTargetProfileIds
					}
					activeWakeWaitingTargetProfileIds={
						input.activeWakeWaitingTargetProfileIds
					}
					addMembersDialogId={model.addMembersDialogId}
					agentProfileEditContext={input.agentProfileEditContext}
					agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
					autoRefreshExhaustedProfileIds={input.autoRefreshExhaustedProfileIds}
					centerAgentProfileId={input.centerAgentProfileId ?? null}
					currentOwnerUserId={input.currentOwnerUserId}
					currentProfileId={input.currentProfileId}
					displayWakeOverrideByProfileId={input.displayWakeOverrideByProfileId}
					filteredDirectory={model.filteredDirectory}
					membersError={input.membersError}
					modelCatalog={input.modelCatalog ?? null}
					onAddMembersOpen={model.openAddMembers}
					onAddOrganizationDirectoryProfiles={
						input.onAddOrganizationDirectoryProfiles
					}
					onAddProfiles={input.onAddProfiles}
					onAgentRecoveryAction={input.onAgentRecoveryAction}
					onQueryChange={model.setQuery}
					onRefresh={input.onRefresh}
					onRemoveMember={input.onRemoveMember}
					orgSlug={input.orgSlug}
					prepareSetupHref={input.prepareSetupHref}
					query={model.query}
					searchOpen={model.isSearchOpen}
					snapshot={input.snapshot}
					spaceId={input.spaceId}
					viewState={{
						isAddMembersOpen: model.isAddMembersOpen,
						isAgentRecoveryPending: input.isAgentRecoveryPending,
						isLoading: input.isLoading,
					}}
				/>
			</SpaceInlineSidePanel>
		</>
	);
}

export function SpaceMembersDrawer(
	input: SpaceMembersSurfaceProps & {
		onOpenChange: (open: boolean) => void;
		open: boolean;
	}
) {
	const model = useSpaceMembersModel(
		input,
		input.handlesAddMembersRequest ?? input.open
	);

	return (
		<>
			<SpaceMembersAddDialog input={input} model={model} />
			<Dialog onOpenChange={input.onOpenChange} open={input.open}>
				<DialogContent
					className="top-0 right-0 bottom-0 left-auto flex h-dvh max-h-none w-[min(24rem,calc(100vw-1rem))] max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-l p-0 motion-reduce:animate-none sm:max-w-none"
					id="space-members-drawer"
					showCloseButton={false}
				>
					<div className="flex min-h-0 w-full flex-col">
						<div className="shrink-0 border-border border-b px-4 py-3">
							<div className="flex items-center justify-between gap-2">
								<div className="flex min-w-0 items-baseline gap-2">
									<DialogTitle className="font-medium text-base">
										Members
									</DialogTitle>
									<span
										aria-hidden="true"
										className="truncate text-muted-foreground text-xs tabular-nums"
									>
										{model.membersCountLabel}
									</span>
									<DialogDescription className="sr-only">
										{model.membersCountDescription}
									</DialogDescription>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<SpaceMembersSearchHeaderButton
										onToggle={() => model.setIsSearchOpen(!model.isSearchOpen)}
										open={model.isSearchOpen}
									/>
									{input.onAddProfiles ||
									input.onAddOrganizationDirectoryProfiles ? (
										<SpaceAddMembersHeaderButton
											controlsId={model.addMembersDialogId}
											onOpen={model.openAddMembers}
											open={model.isAddMembersOpen}
										/>
									) : null}
									<SpaceMembersCloseButton
										onClose={() => input.onOpenChange(false)}
									/>
								</div>
							</div>
						</div>

						<SpaceMembersBody
							activeWakeDisplayTargetProfileIds={
								input.activeWakeDisplayTargetProfileIds
							}
							activeWakeWaitingTargetProfileIds={
								input.activeWakeWaitingTargetProfileIds
							}
							addMembersDialogId={model.addMembersDialogId}
							agentProfileEditContext={input.agentProfileEditContext}
							agentRecoveryPlansByProfileId={
								input.agentRecoveryPlansByProfileId
							}
							autoRefreshExhaustedProfileIds={
								input.autoRefreshExhaustedProfileIds
							}
							centerAgentProfileId={input.centerAgentProfileId ?? null}
							currentOwnerUserId={input.currentOwnerUserId}
							currentProfileId={input.currentProfileId}
							displayWakeOverrideByProfileId={
								input.displayWakeOverrideByProfileId
							}
							filteredDirectory={model.filteredDirectory}
							membersError={input.membersError}
							modelCatalog={input.modelCatalog ?? null}
							onAddMembersOpen={model.openAddMembers}
							onAddOrganizationDirectoryProfiles={
								input.onAddOrganizationDirectoryProfiles
							}
							onAddProfiles={input.onAddProfiles}
							onAgentRecoveryAction={input.onAgentRecoveryAction}
							onQueryChange={model.setQuery}
							onRefresh={input.onRefresh}
							onRemoveMember={input.onRemoveMember}
							orgSlug={input.orgSlug}
							prepareSetupHref={input.prepareSetupHref}
							query={model.query}
							searchOpen={model.isSearchOpen}
							snapshot={input.snapshot}
							spaceId={input.spaceId}
							viewState={{
								isAddMembersOpen: model.isAddMembersOpen,
								isAgentRecoveryPending: input.isAgentRecoveryPending,
								isLoading: input.isLoading,
							}}
						/>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

const SPACE_MEMBERS_SEARCH_REGION_ID = "space-members-search-region";

function SpaceMembersAddDialog({
	input,
	model,
}: {
	input: SpaceMembersSurfaceProps;
	model: ReturnType<typeof useSpaceMembersModel>;
}) {
	return (
		<SpaceAddProfilesSection
			accountProfiles={input.accountProfiles ?? []}
			currentOwnerUserId={input.currentOwnerUserId}
			currentProfileId={input.currentProfileId}
			dialogId={model.addMembersDialogId}
			finalFocus={model.addMembersTriggerRef}
			key={input.spaceId ?? "no-space"}
			onAddOrganizationDirectoryProfiles={
				input.onAddOrganizationDirectoryProfiles
			}
			onAddProfiles={input.onAddProfiles}
			onConvertDirectMessageToSpace={input.onConvertDirectMessageToSpace}
			onOpenChange={model.setIsAddMembersOpen}
			onRefresh={input.onRefresh}
			open={model.isAddMembersOpen}
			orgSlug={input.orgSlug}
			snapshot={input.snapshot}
			spaceId={input.spaceId}
			spaceName={input.spaceName}
		/>
	);
}

function SpaceMembersSearchHeaderButton(input: {
	onToggle: () => void;
	open: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-controls={SPACE_MEMBERS_SEARCH_REGION_ID}
						aria-expanded={input.open}
						aria-label="Search members"
						onClick={input.onToggle}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<MagnifyingGlassIcon />
					</Button>
				}
			/>
			<TooltipContent>Search members</TooltipContent>
		</Tooltip>
	);
}

function SpaceAddMembersHeaderButton(input: {
	controlsId: string;
	onOpen: (trigger: HTMLElement) => void;
	open: boolean;
}) {
	return (
		<LazyMotion features={domAnimation} strict>
			<MotionConfig reducedMotion="user">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-controls={input.controlsId}
								aria-expanded={input.open}
								aria-haspopup="dialog"
								aria-label="Add People or Agents"
								onClick={(event) => input.onOpen(event.currentTarget)}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<m.span
									animate={{
										transform: input.open ? "rotate(45deg)" : "rotate(0deg)",
									}}
									className="flex"
									transition={springs.moderate}
								>
									<PlusIcon />
								</m.span>
							</Button>
						}
					/>
					<TooltipContent>Add People or Agents</TooltipContent>
				</Tooltip>
			</MotionConfig>
		</LazyMotion>
	);
}

function SpaceMembersCloseButton(input: { onClose: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label="Close members"
						onClick={input.onClose}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<XIcon />
					</Button>
				}
			/>
			<TooltipContent>Close members</TooltipContent>
		</Tooltip>
	);
}

function useSpaceMembersModel(
	input: SpaceMembersSurfaceProps,
	handlesAddMembersRequest: boolean
) {
	const addMembersDialogId = useId();
	const lastOpenNonceRef = useRef(input.openAddMembersNonce);
	const addMembersTriggerRef = useRef<HTMLElement | null>(null);
	const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [query, setQuery] = useState("");
	const setSearchOpen = (open: boolean) => {
		setIsSearchOpen(open);
		if (!open) {
			setQuery("");
		}
	};

	// Both desktop and mobile Members surfaces stay mounted. Consume every
	// external request in both models, but open the dialog only from the surface
	// for the current viewport, independently of whether Members is open.
	useEffect(() => {
		const nonce = input.openAddMembersNonce;
		if (nonce === undefined || nonce === lastOpenNonceRef.current) {
			return;
		}
		lastOpenNonceRef.current = nonce;
		if (!handlesAddMembersRequest) {
			return;
		}
		addMembersTriggerRef.current = null;
		setIsAddMembersOpen(true);
	}, [input.openAddMembersNonce, handlesAddMembersRequest]);
	const deferredQuery = useDeferredValue(query);
	const directory = useMemo(
		() =>
			input.snapshot
				? buildSpaceMemberDirectoryForStatusOrder(
						buildSpaceMemberDirectory(input.snapshot)
					)
				: null,
		[input.snapshot]
	);
	const filteredDirectory = useMemo(
		() =>
			directory
				? filterSpaceMemberDirectory({
						directory,
						query: deferredQuery,
					})
				: null,
		[directory, deferredQuery]
	);
	const totalMembersCount = input.snapshot?.summary.totalCount ?? null;
	const membersCountDescription = resolveMembersCountDescription({
		hasLoadError: Boolean(input.membersError && !input.snapshot),
		isLoading: input.isLoading,
		totalMembersCount,
	});

	return {
		addMembersDialogId,
		addMembersTriggerRef,
		filteredDirectory,
		isAddMembersOpen,
		isSearchOpen,
		membersCountDescription,
		membersCountLabel: resolveMembersCountLabel({
			hasLoadError: Boolean(input.membersError && !input.snapshot),
			isLoading: input.isLoading,
			totalMembersCount,
		}),
		openAddMembers: (trigger: HTMLElement) => {
			addMembersTriggerRef.current = trigger;
			setIsAddMembersOpen(true);
		},
		query,
		setIsAddMembersOpen,
		setQuery,
		setIsSearchOpen: setSearchOpen,
	};
}

type SpaceMembersBodyProps = {
	addMembersDialogId: string;
	agentProfileEditContext?: AgentProfileEditDialogContext;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	activeWakeDisplayTargetProfileIds?: ReadonlySet<string>;
	activeWakeWaitingTargetProfileIds: ReadonlySet<string>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	centerAgentProfileId: string | null;
	currentOwnerUserId: string | null;
	currentProfileId: string;
	displayWakeOverrideByProfileId?: WakeDisplayOverrideByProfileId;
	filteredDirectory: ReturnType<typeof filterSpaceMemberDirectory> | null;
	membersError: string | null;
	modelCatalog: ModelCatalog | null;
	onAddMembersOpen: (trigger: HTMLElement) => void;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAddOrganizationDirectoryProfiles?: (
		input: SpaceAddOrganizationDirectoryProfilesInput
	) => Promise<SpaceAddProfilesResult>;
	onAddProfiles?: (
		profileIds: readonly string[]
	) => Promise<SpaceAddProfilesResult>;
	onQueryChange: (query: string) => void;
	onRefresh: (input?: SpaceMembersRefreshInput) => Promise<void>;
	onRemoveMember?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	orgSlug: string;
	prepareSetupHref?: string;
	query: string;
	searchOpen: boolean;
	spaceId?: string;
	snapshot: SpaceMembersSnapshot | null;
	viewState: {
		isAddMembersOpen: boolean;
		isAgentRecoveryPending: (profileId: string) => boolean;
		isLoading: boolean;
	};
};

function SpaceMembersBody(input: SpaceMembersBodyProps) {
	const shouldShowAddMembersEmptyCta =
		Boolean(input.onAddProfiles || input.onAddOrganizationDirectoryProfiles) &&
		input.snapshot?.summary.totalCount === 1;
	const [
		checkingAgentWakeAvailabilityProfileId,
		setCheckingAgentWakeAvailabilityProfileId,
	] = useState<string | null>(null);
	const handleCheckAgentWakeAvailability = async (profileId: string) => {
		setCheckingAgentWakeAvailabilityProfileId(profileId);
		try {
			await input.onRefresh({
				agentProfileIds: [profileId],
				forceNetwork: true,
			});
		} catch (error) {
			console.error("Failed to check agent connection.", error);
			toast.error(
				"OpenMeld could not check this agent's connection. It is still offline — try again."
			);
		} finally {
			setCheckingAgentWakeAvailabilityProfileId(null);
		}
	};

	return (
		<LazyMotion features={domAnimation} strict>
			<MotionConfig reducedMotion="user">
				<ScrollArea
					className="min-h-0 flex-1"
					contentClassName="px-3 pt-2 pb-3"
					orientation="vertical"
				>
					<div className="flex flex-col gap-3">
						{shouldShowAddMembersEmptyCta ? (
							<button
								aria-controls={input.addMembersDialogId}
								aria-expanded={input.viewState.isAddMembersOpen}
								aria-haspopup="dialog"
								className="flex flex-col items-center gap-2 rounded-md border border-border border-dashed px-3 py-4 text-center transition-colors hover:bg-muted/40"
								onClick={(event) => input.onAddMembersOpen(event.currentTarget)}
								type="button"
							>
								<span className="text-muted-foreground text-xs">
									It is just you here so far.
								</span>
								<span className="flex items-center gap-1.5 font-medium text-sm">
									<PlusIcon aria-hidden className="size-3.5" />
									Add People or Agents
								</span>
							</button>
						) : null}

						<SpaceMembersSearchField
							onQueryChange={input.onQueryChange}
							open={input.searchOpen}
							query={input.query}
						/>

						<SpaceMembersList
							activeWakeDisplayTargetProfileIds={
								input.activeWakeDisplayTargetProfileIds
							}
							activeWakeWaitingTargetProfileIds={
								input.activeWakeWaitingTargetProfileIds
							}
							agentRecoveryPlansByProfileId={
								input.agentRecoveryPlansByProfileId
							}
							autoRefreshExhaustedProfileIds={
								input.autoRefreshExhaustedProfileIds
							}
							centerAgentProfileId={input.centerAgentProfileId}
							currentOwnerUserId={input.currentOwnerUserId}
							currentProfileId={input.currentProfileId}
							displayWakeOverrideByProfileId={
								input.displayWakeOverrideByProfileId
							}
							filteredDirectory={input.filteredDirectory}
							isAgentRecoveryPending={input.viewState.isAgentRecoveryPending}
							isAgentWakeAvailabilityCheckPending={(profileId) =>
								checkingAgentWakeAvailabilityProfileId === profileId
							}
							isLoading={input.viewState.isLoading}
							membersError={input.membersError}
							modelCatalog={input.modelCatalog}
							onAgentRecoveryAction={input.onAgentRecoveryAction}
							onCheckAgentWakeAvailability={handleCheckAgentWakeAvailability}
							onRefresh={input.onRefresh}
							onRemoveMember={input.onRemoveMember}
							orgSlug={input.orgSlug}
							prepareSetupHref={input.prepareSetupHref}
							query={input.query}
							snapshot={input.snapshot}
						/>
					</div>
				</ScrollArea>
			</MotionConfig>
		</LazyMotion>
	);
}

function SpaceMembersSearchField(input: {
	onQueryChange: (query: string) => void;
	open: boolean;
	query: string;
}) {
	return (
		<AnimatePresence initial={false} mode="popLayout">
			{input.open ? (
				<m.div
					animate={{ opacity: 1, transform: "scaleY(1)" }}
					className="overflow-hidden"
					exit={{
						opacity: 0,
						transform: "scaleY(0.96)",
						transition: { ...springs.moderate, bounce: 0 },
					}}
					id={SPACE_MEMBERS_SEARCH_REGION_ID}
					initial={{ opacity: 0, transform: "scaleY(0.96)" }}
					style={{ transformOrigin: "top" }}
					transition={springs.moderate}
				>
					<Input
						aria-label="Search members"
						autoComplete="off"
						autoFocus
						name="space-members-search"
						onChange={(event) => input.onQueryChange(event.target.value)}
						placeholder="Search members"
						spellCheck={false}
						value={input.query}
					/>
				</m.div>
			) : null}
		</AnimatePresence>
	);
}

type SpaceAddProfilesSectionProps = {
	accountProfiles: readonly AuthProfileView[];
	currentOwnerUserId: string | null;
	currentProfileId: string;
	dialogId: string;
	finalFocus: RefObject<HTMLElement | null>;
	onAddOrganizationDirectoryProfiles?: (
		input: SpaceAddOrganizationDirectoryProfilesInput
	) => Promise<SpaceAddProfilesResult>;
	onAddProfiles?: (
		profileIds: readonly string[]
	) => Promise<SpaceAddProfilesResult>;
	onConvertDirectMessageToSpace?: (
		input: SpaceConvertDirectMessageInput
	) => Promise<SpaceAddProfilesResult>;
	onOpenChange: (open: boolean) => void;
	onRefresh: (input?: SpaceMembersRefreshInput) => Promise<void>;
	open: boolean;
	orgSlug: string;
	spaceId?: string;
	spaceName?: string | null;
	snapshot: SpaceMembersSnapshot | null;
};

export function SpaceAddMembersLauncher(input: SpaceMembersSurfaceProps) {
	const [open, setOpen] = useState(false);
	const dialogId = useId();
	const finalFocus = useRef<HTMLElement | null>(null);
	const lastNonce = useRef(input.openAddMembersNonce);
	useEffect(() => {
		if (input.openAddMembersNonce === lastNonce.current) {
			return;
		}
		lastNonce.current = input.openAddMembersNonce;
		finalFocus.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setOpen(true);
	}, [input.openAddMembersNonce]);
	return (
		<SpaceAddProfilesSection
			{...input}
			accountProfiles={input.accountProfiles ?? []}
			dialogId={dialogId}
			finalFocus={finalFocus}
			onOpenChange={setOpen}
			open={open}
		/>
	);
}

function SpaceAddProfilesSection(input: SpaceAddProfilesSectionProps) {
	const model = useSpaceAddProfilesSectionModel(input);
	if (!(input.onAddProfiles || input.onAddOrganizationDirectoryProfiles)) {
		return null;
	}
	return <SpaceAddProfilesSectionView input={input} model={model} />;
}

function useSpaceAddProfilesSectionModel(input: SpaceAddProfilesSectionProps) {
	const [selectedProfileIds, setSelectedProfileIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [conversionRequest, setConversionRequest] = useState<{
		defaultName: string;
		profileIds: readonly string[];
		selectedNames: readonly string[];
		spaceId: string | null;
	} | null>(null);
	const [addQuery, setAddQuery] = useState("");
	const activeSpaceId = input.spaceId ?? null;
	const organizationContext = useOptionalAppOrganization();
	const organization = organizationContext?.currentOrganization ?? null;
	const usesOrganizationDirectory = Boolean(
		organization && input.onAddOrganizationDirectoryProfiles
	);
	const directoryQuery = useQuery(
		organizationSpaceProfileCandidatesQueryOptions({
			enabled: usesOrganizationDirectory || Boolean(input.open && organization),
			organizationId: organization?.id ?? "",
		})
	);

	const personalProfilesPlan = useMemo(
		() =>
			buildSpaceProfileAddPlan({
				actingProfileId: input.currentProfileId,
				currentMembers: input.snapshot
					? [...input.snapshot.humans, ...input.snapshot.agents]
					: [],
				currentOwnerUserId: input.currentOwnerUserId,
				mode: "profiles",
				profiles: input.accountProfiles.map(toSpaceProfileAddProfile),
				selector: { kind: "none" },
			}),
		[
			input.accountProfiles,
			input.currentOwnerUserId,
			input.currentProfileId,
			input.snapshot,
		]
	);
	const organizationDirectoryCandidates = useMemo(
		() =>
			buildOrganizationDirectoryAddCandidates({
				directory: directoryQuery.data ?? null,
				organizationName: organization?.name ?? "Organization",
				snapshot: input.snapshot,
			}),
		[directoryQuery.data, input.snapshot, organization?.name]
	);
	const candidateGroups = useMemo(
		() =>
			usesOrganizationDirectory
				? organizationDirectoryCandidates
				: buildPersonalAddMemberGroups({
						directory: directoryQuery.data ?? null,
						alreadyJoinedCandidates:
							personalProfilesPlan.alreadyJoinedCandidates,
						selectableCandidates: personalProfilesPlan.selectableCandidates,
					}),
		[
			organizationDirectoryCandidates,
			directoryQuery.data,
			personalProfilesPlan.alreadyJoinedCandidates,
			personalProfilesPlan.selectableCandidates,
			usesOrganizationDirectory,
		]
	);
	const allCandidates = useMemo(
		() => [
			...candidateGroups.personGroups.flatMap((group) => [
				...(group.humanCandidate ? [group.humanCandidate] : []),
				...group.agentCandidates,
			]),
			...candidateGroups.organizationCandidates,
		],
		[candidateGroups]
	);
	const normalizedAddQuery = addQuery.trim().toLocaleLowerCase();
	const visibleCandidateGroups = useMemo(
		() => filterAddMemberGroups(candidateGroups, normalizedAddQuery),
		[candidateGroups, normalizedAddQuery]
	);
	const selectableProfileIds = useMemo(() => {
		return buildSelectableAddMemberProfileIds(allCandidates);
	}, [allCandidates]);
	const activeSelectedProfileIds = useMemo(() => {
		if (selectedProfileIds.size === 0) {
			return selectedProfileIds;
		}
		const activeSelection = new Set(
			[...selectedProfileIds].filter((profileId) =>
				selectableProfileIds.has(profileId)
			)
		);
		return activeSelection.size === selectedProfileIds.size
			? selectedProfileIds
			: activeSelection;
	}, [selectableProfileIds, selectedProfileIds]);
	const effectiveSelectedProfileIds = resolveEffectiveAddMemberProfileIds({
		candidateGroups,
		selectedProfileIds: activeSelectedProfileIds,
	});
	const selectedCount = effectiveSelectedProfileIds.size;
	const canRunAddMutation = usesOrganizationDirectory
		? Boolean(input.onAddOrganizationDirectoryProfiles)
		: Boolean(input.onAddProfiles);
	const canSubmit =
		canRunAddMutation &&
		input.snapshot !== null &&
		selectedCount > 0 &&
		!isSubmitting;
	const handleOpenChange = (open: boolean) => {
		if (!open) {
			setSelectedProfileIds(new Set());
			setErrorMessage(null);
			setSuccessMessage(null);
			setConversionRequest(null);
			setAddQuery("");
		}
		input.onOpenChange(open);
	};

	const handleSubmit = () => {
		if (!canSubmit) {
			return Promise.resolve();
		}
		const profileIds = [...activeSelectedProfileIds];
		if (input.onConvertDirectMessageToSpace) {
			const selectedNames: string[] = [];
			for (const candidate of allCandidates) {
				if (effectiveSelectedProfileIds.has(candidate.profileId)) {
					selectedNames.push(candidate.profileName);
				}
			}
			const currentMemberNames = input.snapshot
				? [...input.snapshot.humans, ...input.snapshot.agents].map(
						(member) => member.profileName
					)
				: [];
			setConversionRequest({
				defaultName: buildDirectMessageConversionDefaultName({
					currentMemberNames,
					currentSpaceName: input.spaceName,
					selectedNames,
				}),
				profileIds,
				selectedNames,
				spaceId: activeSpaceId,
			});
			return Promise.resolve();
		}
		setIsSubmitting(true);
		setErrorMessage(null);
		setSuccessMessage(null);
		return executeSpaceAddProfilesMutation({
			allCandidates,
			onAddOrganizationDirectoryProfiles:
				input.onAddOrganizationDirectoryProfiles,
			onAddProfiles: input.onAddProfiles,
			profileIds,
			selectedProfileIds: activeSelectedProfileIds,
			usesOrganizationDirectory,
		})
			.then((result) => {
				setSuccessMessage(formatAddProfilesSuccess(result));
				setSelectedProfileIds(new Set());
				handleOpenChange(false);
			})
			.catch((error: unknown) => {
				setErrorMessage(formatAddProfilesError(error));
			})
			.finally(() => {
				setIsSubmitting(false);
			});
	};
	const handleConfirmConversion = async (name: string) => {
		if (!(conversionRequest && input.onConvertDirectMessageToSpace)) {
			return;
		}
		if (conversionRequest.spaceId !== activeSpaceId) {
			setConversionRequest(null);
			return;
		}
		setIsSubmitting(true);
		setErrorMessage(null);
		try {
			const result = await input.onConvertDirectMessageToSpace({
				name,
				profileIds: conversionRequest.profileIds,
			});
			setSuccessMessage(formatAddProfilesSuccess(result));
			setSelectedProfileIds(new Set());
			setConversionRequest(null);
			handleOpenChange(false);
		} catch (error) {
			setErrorMessage(formatAddProfilesError(error));
			setConversionRequest(null);
		} finally {
			setIsSubmitting(false);
		}
	};

	const clearMessages = () => {
		setErrorMessage(null);
		setSuccessMessage(null);
	};
	const toggleProfile = (profileId: string) => {
		if (isSubmitting) {
			return;
		}
		clearMessages();
		setConversionRequest(null);
		setSelectedProfileIds((current) => {
			const next = new Set(
				[...current].filter((selectedId) =>
					selectableProfileIds.has(selectedId)
				)
			);
			const personGroup = candidateGroups.personGroups.find(
				(group) => group.humanCandidate?.profileId === profileId
			);
			if (personGroup && effectiveSelectedProfileIds.has(profileId)) {
				next.delete(profileId);
				for (const agent of personGroup.agentCandidates) {
					if (agent.ownerHumanProfileId === profileId) {
						next.delete(agent.profileId);
					}
				}
			} else if (next.has(profileId)) {
				next.delete(profileId);
			} else {
				next.add(profileId);
			}
			return next;
		});
	};

	return {
		activeSelectedProfileIds,
		effectiveSelectedProfileIds,
		addQuery,
		allCandidates,
		canSubmit,
		candidateGroups: visibleCandidateGroups,
		clearMessages,
		conversionRequest,
		directoryQuery,
		errorMessage,
		handleConfirmConversion,
		handleOpenChange,
		handleSubmit,
		isSubmitting,
		organization,
		organizationDirectoryCandidates,
		personalProfilesPlan,
		setAddQuery,
		setConversionRequest,
		setErrorMessage,
		setSelectedProfileIds,
		successMessage,
		selectedCount,
		toggleProfile,
		usesOrganizationDirectory,
	};
}

function SpaceAddProfilesSectionView({
	input,
	model,
}: {
	input: SpaceAddProfilesSectionProps;
	model: ReturnType<typeof useSpaceAddProfilesSectionModel>;
}) {
	return (
		<>
			<SpaceAddProfilesDialog
				addQuery={model.addQuery}
				candidateGroups={model.candidateGroups}
				canSubmit={model.canSubmit}
				currentOwnerUserId={input.currentOwnerUserId}
				dialogId={input.dialogId}
				directoryHasData={Boolean(model.directoryQuery.data)}
				directoryIsError={model.directoryQuery.isError}
				directoryIsPending={model.directoryQuery.isPending}
				emptyMessage={resolveAddMembersEmptyMessage({
					addQuery: model.addQuery,
					organizationDirectoryCandidates:
						model.organizationDirectoryCandidates,
					organizationName: model.organization?.name ?? "Organization",
					personalProfilesPlan: model.personalProfilesPlan,
					usesOrganizationDirectory: model.usesOrganizationDirectory,
				})}
				errorMessage={model.errorMessage}
				finalFocus={input.finalFocus}
				isSubmitting={model.isSubmitting}
				onAddQueryChange={model.setAddQuery}
				onClear={() => {
					model.setSelectedProfileIds(new Set());
					model.clearMessages();
				}}
				onCreated={async (profileId) => {
					try {
						await model.directoryQuery.refetch({ throwOnError: true });
						await input.onRefresh({ agentProfileIds: [profileId] });
						model.setAddQuery("");
						model.setSelectedProfileIds(
							(current) => new Set([...current, profileId])
						);
					} catch (error) {
						model.setErrorMessage(
							`Agent created, but the member list could not refresh. Reopen this picker to select it. ${formatAddProfilesError(error)}`
						);
					}
				}}
				onOpenChange={model.handleOpenChange}
				onRetryDirectory={() => {
					model.directoryQuery.refetch().catch((error) => {
						console.error(
							"Failed to reload the Organization Directory.",
							error
						);
					});
				}}
				onSubmit={model.handleSubmit}
				onSubmitError={(error) =>
					model.setErrorMessage(formatAddProfilesError(error))
				}
				onToggle={model.toggleProfile}
				open={input.open}
				organizationName={model.organization?.name ?? "Organization"}
				orgSlug={input.orgSlug}
				selectedCount={model.selectedCount}
				selectedProfileIds={model.effectiveSelectedProfileIds}
				snapshot={input.snapshot}
				spaceId={input.spaceId}
				spaceName={input.spaceName}
				successMessage={model.successMessage}
				usesOrganizationDirectory={model.usesOrganizationDirectory}
			/>
			<DirectMessageConversionDialog
				defaultName={model.conversionRequest?.defaultName ?? ""}
				isPending={model.isSubmitting}
				onConfirm={model.handleConfirmConversion}
				onOpenChange={(open) => {
					if (!open) {
						model.setConversionRequest(null);
					}
				}}
				open={model.conversionRequest !== null}
				selectedNames={model.conversionRequest?.selectedNames ?? []}
			/>
		</>
	);
}

type SpaceAddMembersCandidateSummary = {
	alreadyMember?: boolean;
	agentControllerRef?: string | null;
	availabilityCategory?: "available" | "checking" | "offline" | "unavailable";
	availabilityLabel?: string | null;
	avatarImageUrl?: string | null;
	createdAt?: string | null;
	description?: string;
	isCenterAgent?: boolean;
	lastUsedAt?: string | null;
	operationalStatus?: "checking" | "idle" | "paused" | "working";
	ownerHumanProfileId?: string | null;
	ownerUserId?: string;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
	searchText: string;
};

type SpaceAddMembersPersonGroup = {
	agentCandidates: readonly SpaceAddMembersCandidateSummary[];
	avatarImageUrl?: string | null;
	humanAlreadyMember: boolean;
	humanCandidate: SpaceAddMembersCandidateSummary | null;
	id: string;
	lastActiveAt: string | null;
	name: string;
	searchText: string;
};

type SpaceAddMembersCandidateGroups = {
	alreadyJoinedCount: number;
	organizationCandidates: readonly SpaceAddMembersCandidateSummary[];
	personGroups: readonly SpaceAddMembersPersonGroup[];
};

async function executeSpaceAddProfilesMutation(input: {
	allCandidates: readonly SpaceAddMembersCandidateSummary[];
	onAddOrganizationDirectoryProfiles?: (
		input: SpaceAddOrganizationDirectoryProfilesInput
	) => Promise<SpaceAddProfilesResult>;
	onAddProfiles?: (
		profileIds: readonly string[]
	) => Promise<SpaceAddProfilesResult>;
	profileIds: readonly string[];
	selectedProfileIds: ReadonlySet<string>;
	usesOrganizationDirectory: boolean;
}): Promise<SpaceAddProfilesResult> {
	if (!input.usesOrganizationDirectory) {
		if (!input.onAddProfiles) {
			throw new Error("Profile selection is unavailable.");
		}
		return await input.onAddProfiles(input.profileIds);
	}
	if (!input.onAddOrganizationDirectoryProfiles) {
		throw new Error("Organization Directory is unavailable.");
	}
	const selectedCenterAgent = input.allCandidates.find(
		(candidate) =>
			candidate.isCenterAgent === true &&
			input.selectedProfileIds.has(candidate.profileId)
	);
	return await input.onAddOrganizationDirectoryProfiles({
		directoryProfileIds: input.profileIds,
		...(selectedCenterAgent
			? { expectedCenterAgentProfileId: selectedCenterAgent.profileId }
			: {}),
	});
}

type SpaceAddProfilesDialogProps = {
	currentOwnerUserId: string | null;
	onCreated: (profileId: string) => Promise<void>;
	addQuery: string;
	canSubmit: boolean;
	candidateGroups: SpaceAddMembersCandidateGroups;
	directoryHasData: boolean;
	directoryIsError: boolean;
	directoryIsPending: boolean;
	dialogId: string;
	emptyMessage: string;
	errorMessage: string | null;
	finalFocus: RefObject<HTMLElement | null>;
	isSubmitting: boolean;
	onAddQueryChange: (query: string) => void;
	onClear: () => void;
	onOpenChange: (open: boolean) => void;
	onRetryDirectory: () => void;
	onSubmit: () => Promise<void>;
	onSubmitError: (error: unknown) => void;
	onToggle: (profileId: string) => void;
	open: boolean;
	organizationName: string;
	orgSlug: string;
	selectedProfileIds: ReadonlySet<string>;
	selectedCount: number;
	snapshot: SpaceMembersSnapshot | null;
	spaceId?: string;
	spaceName?: string | null;
	successMessage: string | null;
	usesOrganizationDirectory: boolean;
};

function SpaceAddProfilesDialog(input: SpaceAddProfilesDialogProps) {
	const [creating, setCreating] = useState(false);
	const [busy, setBusy] = useState(false);
	return (
		<Dialog
			onOpenChange={(open) => {
				if (busy) {
					return;
				}
				if (!open) {
					setCreating(false);
				}
				input.onOpenChange(open);
			}}
			open={input.open}
		>
			<DialogContent
				className="@container flex max-h-[min(46rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-2xl"
				finalFocus={input.finalFocus}
				id={input.dialogId}
			>
				{creating ? (
					<SpacePickerCreateAgent
						onBack={() => setCreating(false)}
						onBusyChange={setBusy}
						onCreated={input.onCreated}
					/>
				) : (
					<SpaceAddProfilesDialogContent
						input={input}
						onCreate={() => setCreating(true)}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function SpaceAddProfilesDialogContent({
	input,
	onCreate,
}: {
	input: SpaceAddProfilesDialogProps;
	onCreate: () => void;
}) {
	const searchLabel = "Search people and agents";
	const description = input.usesOrganizationDirectory
		? `Choose people and their agents from ${input.organizationName}.`
		: "Choose people and their agents to add to this Space.";
	const waitsForDirectory =
		input.usesOrganizationDirectory && !input.directoryHasData;
	const showCandidates = Boolean(
		input.snapshot &&
			(!input.usesOrganizationDirectory || input.directoryHasData)
	);
	return (
		<div className="flex flex-col gap-3">
			<SpaceAddProfilesDialogHeader />
			<DialogDescription>{description}</DialogDescription>
			{input.spaceId && input.usesOrganizationDirectory ? (
				<SpaceInvitationsSection spaceId={input.spaceId} />
			) : null}
			<div className="relative">
				<MagnifyingGlassIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					aria-label={searchLabel}
					autoComplete="off"
					autoFocus
					className="pl-9"
					onChange={(event) => input.onAddQueryChange(event.target.value)}
					placeholder={searchLabel}
					type="search"
					value={input.addQuery}
				/>
			</div>
			<SpaceAddProfilesStatus
				errorMessage={input.errorMessage}
				snapshot={input.snapshot}
				successMessage={input.successMessage}
			/>
			<SpaceAddProfilesDirectoryState
				isError={waitsForDirectory && input.directoryIsError}
				isPending={waitsForDirectory && input.directoryIsPending}
				onRetry={input.onRetryDirectory}
				organizationName={input.organizationName}
			/>
			{showCandidates ? (
				<SpaceAddProfilesCandidateList input={input} onCreate={onCreate} />
			) : null}
			<SpaceAddProfilesFooter
				canSubmit={input.canSubmit}
				isSubmitting={input.isSubmitting}
				onClear={input.onClear}
				onSubmit={input.onSubmit}
				onSubmitError={input.onSubmitError}
				selectedCount={input.selectedCount}
			/>
		</div>
	);
}

function SpaceAddProfilesDialogHeader() {
	return (
		<DialogHeader>
			<DialogTitle>Add People or Agents</DialogTitle>
		</DialogHeader>
	);
}

function SpaceAddProfilesCandidateList({
	input,
	onCreate,
}: {
	input: SpaceAddProfilesDialogProps;
	onCreate: () => void;
}) {
	return (
		<SpaceAddMembersCandidates
			candidateGroups={input.candidateGroups}
			currentOwnerUserId={input.currentOwnerUserId}
			emptyMessage={input.emptyMessage}
			isSubmitting={input.isSubmitting}
			onCreate={input.spaceId ? onCreate : undefined}
			onToggle={input.onToggle}
			searchActive={input.addQuery.trim().length > 0}
			selectedProfileIds={input.selectedProfileIds}
		/>
	);
}

function SpaceAddProfilesDirectoryState(input: {
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
	organizationName: string;
}) {
	if (input.isPending) {
		return (
			<p className="text-muted-foreground text-sm">
				Loading {input.organizationName} Directory…
			</p>
		);
	}
	if (!input.isError) {
		return null;
	}
	return (
		<div className="flex items-center justify-between gap-3">
			<p className="text-muted-foreground text-sm">
				Couldn&apos;t load the Organization Directory.
			</p>
			<Button onClick={input.onRetry} size="xs" type="button" variant="outline">
				Try again
			</Button>
		</div>
	);
}

function SpaceAddProfilesFooter(input: {
	canSubmit: boolean;
	isSubmitting: boolean;
	onClear: () => void;
	onSubmit: () => Promise<void>;
	onSubmitError: (error: unknown) => void;
	selectedCount: number;
}) {
	return (
		<div className="flex @min-[20rem]:flex-row flex-col @min-[20rem]:items-center items-stretch @min-[20rem]:justify-between gap-2">
			<span className="@min-[20rem]:w-auto w-full text-muted-foreground text-xs">
				{input.selectedCount === 0
					? "Select members to add"
					: `${String(input.selectedCount)} selected`}
			</span>
			<span className="flex @min-[20rem]:w-auto w-full items-center gap-2">
				{input.selectedCount > 0 ? (
					<Button
						disabled={input.isSubmitting}
						onClick={input.onClear}
						size="xs"
						type="button"
						variant="ghost"
					>
						Clear
					</Button>
				) : null}
				<Button
					className="min-w-0 @min-[20rem]:flex-none flex-1"
					disabled={!input.canSubmit}
					onClick={() => {
						input.onSubmit().catch(input.onSubmitError);
					}}
					size="sm"
					type="button"
				>
					{resolveAddMembersSubmitLabel(input)}
				</Button>
			</span>
		</div>
	);
}

function SpaceAddMembersCandidates(input: {
	currentOwnerUserId: string | null;
	onCreate?: () => void;
	candidateGroups: SpaceAddMembersCandidateGroups;
	emptyMessage: string;
	isSubmitting: boolean;
	onToggle: (profileId: string) => void;
	searchActive: boolean;
	selectedProfileIds: ReadonlySet<string>;
}) {
	const [collapsedGroupIds, setCollapsedGroupIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const candidateCount =
		input.candidateGroups.personGroups.reduce(
			(count, group) => count + group.agentCandidates.length + 1,
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
									key={group.id}
									onCreate={
										group.id === input.currentOwnerUserId
											? input.onCreate
											: undefined
									}
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
	onCreate?: () => void;
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
	} else if (selectedAgentCount > 0) {
		humanDescription = `Joins with ${selectedAgentCount === 1 ? "selected Agent" : `${String(selectedAgentCount)} selected Agents`}`;
	}
	return (
		<SpacePersonAgentGroup
			agentsId={`space-add-members-person-${input.group.id}-agents`}
			expanded={input.expanded}
			header={
				<div className="flex min-w-0 flex-1 items-center gap-2">
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
					{input.onCreate ? (
						<Button
							className="shrink-0"
							onClick={input.onCreate}
							size="xs"
							type="button"
						>
							<PlusIcon aria-hidden="true" />
							New Agent
						</Button>
					) : null}
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

function SpacePersonAgentGroup(input: {
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
								<Badge
									className="bg-surface-2 px-1.5 text-[10px] shadow-surface-2"
									variant="outline"
								>
									<CloudIcon aria-hidden="true" />
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

function resolveAddMembersSubmitLabel(input: {
	isSubmitting: boolean;
	selectedCount: number;
}): string {
	if (input.isSubmitting) {
		return "Adding...";
	}
	if (input.selectedCount === 0) {
		return "Add selected";
	}
	return input.selectedCount === 1
		? "Add 1 member"
		: `Add ${String(input.selectedCount)} members`;
}

function SpaceAddProfilesStatus(input: {
	errorMessage: string | null;
	snapshot: SpaceMembersSnapshot | null;
	successMessage: string | null;
}) {
	return (
		<div aria-live="polite">
			{input.errorMessage ? (
				<p className="text-destructive text-xs">{input.errorMessage}</p>
			) : null}
			{input.successMessage ? (
				<p className={cn("text-xs", resolveStatusToneIconClassName("ready"))}>
					{input.successMessage}
				</p>
			) : null}
			{input.errorMessage || input.successMessage || input.snapshot ? null : (
				<p className="text-muted-foreground text-xs">
					Members are still loading.
				</p>
			)}
		</div>
	);
}

function toSpaceProfileAddProfile(
	profile: AuthProfileView
): SpaceProfileAddProfile {
	return {
		createdAt: profile.createdAt,
		isDefault: profile.isDefault,
		lastUsedAt: profile.lastUsedAt,
		ownerName: profile.ownerName,
		ownerUserId: profile.ownerUserId,
		profileId: profile.openMeldProfileId,
		profileKind: profile.profileKind,
		profileName: profile.profileName,
		status: profile.status,
	};
}

type OrganizationDirectoryAddCandidates = SpaceAddMembersCandidateGroups;

function buildOrganizationDirectoryAddCandidates(input: {
	directory: OrganizationSpaceProfileCandidates | null;
	organizationName: string;
	snapshot: SpaceMembersSnapshot | null;
}): OrganizationDirectoryAddCandidates {
	const joinedProfileIds = new Set([
		...(input.snapshot?.humans.map((member) => member.profileId) ?? []),
		...(input.snapshot?.agents.map((member) => member.profileId) ?? []),
	]);
	let alreadyJoinedCount = 0;
	const visibleAgents = (input.directory?.agentProfiles ?? []).flatMap(
		(agent): readonly SpaceAddMembersCandidateSummary[] => {
			if (agent.status !== "active") {
				return [];
			}
			const alreadyMember = joinedProfileIds.has(agent.profileId);
			if (alreadyMember) {
				alreadyJoinedCount += 1;
			}
			const availabilityCategory = resolveAgentWakeAvailabilityDisplayCategory(
				agent.readiness.agentWakeAvailability
			);
			return [
				{
					alreadyMember,
					agentControllerRef: agent.agentControllerRef,
					availabilityCategory,
					availabilityLabel: agent.readiness.agentWakeAvailability.badgeLabel,
					avatarImageUrl: agent.avatarUrl,
					createdAt: agent.createdAt,
					description: agent.isCenterAgent
						? `Center Agent for ${input.organizationName}`
						: undefined,
					isCenterAgent: agent.isCenterAgent === true,
					lastUsedAt: agent.lastUsedAt,
					operationalStatus: agent.operationalContext?.status,
					profileId: agent.profileId,
					profileKind: "agent",
					profileName: agent.profileName,
					ownerUserId: agent.ownerUserId,
					searchText: normalizeAddMembersSearchText([
						agent.profileName,
						agent.profileHandle,
						agent.ownerName,
						agent.readiness.agentWakeAvailability.badgeLabel,
					]),
				},
			];
		}
	);
	const organizationCandidates = visibleAgents
		.filter((agent) => agent.isCenterAgent)
		.sort(compareAddMembersCandidates);
	const agentsByOwnerUserId = new Map<
		string,
		SpaceAddMembersCandidateSummary[]
	>();
	for (const agent of visibleAgents) {
		if (agent.isCenterAgent || !agent.ownerUserId) {
			continue;
		}
		const ownerAgents = agentsByOwnerUserId.get(agent.ownerUserId) ?? [];
		ownerAgents.push(agent);
		agentsByOwnerUserId.set(agent.ownerUserId, ownerAgents);
	}
	const personGroups = (input.directory?.members ?? [])
		.flatMap((member): readonly SpaceAddMembersPersonGroup[] => {
			const profile = member.humanProfile;
			const agentCandidates = (
				agentsByOwnerUserId.get(member.userId) ?? []
			).sort(compareAddMembersCandidates);
			if (profile?.status !== "active" && agentCandidates.length === 0) {
				return [];
			}
			const humanAlreadyMember = Boolean(
				profile && joinedProfileIds.has(profile.profileId)
			);
			if (humanAlreadyMember) {
				alreadyJoinedCount += 1;
			}
			const humanCandidate =
				profile?.status === "active" && !humanAlreadyMember
					? {
							avatarImageUrl: member.avatarImageUrl,
							profileId: profile.profileId,
							profileKind: "human" as const,
							profileName: profile.profileName,
							searchText: normalizeAddMembersSearchText([
								profile.profileName,
								profile.profileHandle,
								member.memberName,
							]),
						}
					: null;
			if (
				!(humanCandidate || humanAlreadyMember || agentCandidates.length > 0)
			) {
				return [];
			}
			for (const agent of agentCandidates) {
				agent.ownerHumanProfileId = profile?.profileId ?? null;
			}
			return [
				{
					agentCandidates,
					avatarImageUrl: member.avatarImageUrl,
					humanAlreadyMember,
					humanCandidate,
					id: member.userId,
					lastActiveAt: member.lastActiveAt,
					name: member.memberName,
					searchText: normalizeAddMembersSearchText([
						member.memberName,
						profile?.profileName,
						profile?.profileHandle,
					]),
				},
			];
		})
		.sort(compareAddMembersPeople);
	return {
		alreadyJoinedCount,
		organizationCandidates,
		personGroups,
	};
}

function toAddMembersCandidateSummary(
	candidate: SpaceProfileAddCandidate
): SpaceAddMembersCandidateSummary {
	if (!candidate.profileKind) {
		throw new Error(`Unsupported profile kind for ${candidate.profileId}.`);
	}
	const ownerName = candidate.profile.ownerName?.trim();
	return {
		createdAt: candidate.profile.createdAt,
		lastUsedAt: candidate.profile.lastUsedAt,
		ownerUserId: candidate.profile.ownerUserId ?? undefined,
		profileId: candidate.profileId,
		profileKind: candidate.profileKind,
		profileName: candidate.profileName,
		searchText: normalizeAddMembersSearchText([
			candidate.profileName,
			ownerName,
		]),
	};
}

function normalizeAddMembersSearchText(
	values: readonly (string | null | undefined)[]
): string {
	return values
		.filter((value): value is string => Boolean(value?.trim()))
		.join(" ")
		.toLocaleLowerCase();
}

function buildSelectableAddMemberProfileIds(
	candidates: readonly SpaceAddMembersCandidateSummary[]
): ReadonlySet<string> {
	const profileIds = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate.alreadyMember) {
			profileIds.add(candidate.profileId);
		}
	}
	return profileIds;
}

function compareAddMembersCandidates(
	left: SpaceAddMembersCandidateSummary,
	right: SpaceAddMembersCandidateSummary
): number {
	if (left.alreadyMember !== right.alreadyMember) {
		return left.alreadyMember ? -1 : 1;
	}
	if (left.isCenterAgent !== right.isCenterAgent) {
		return left.isCenterAgent ? -1 : 1;
	}
	const availabilityOrder = {
		available: 0,
		checking: 1,
		offline: 2,
		unavailable: 3,
	} as const;
	const leftAvailability = left.availabilityCategory
		? availabilityOrder[left.availabilityCategory]
		: 4;
	const rightAvailability = right.availabilityCategory
		? availabilityOrder[right.availabilityCategory]
		: 4;
	if (leftAvailability !== rightAvailability) {
		return leftAvailability - rightAvailability;
	}
	const activeWorkOrder = { working: 0, paused: 1, idle: 2, checking: 3 };
	const leftWork = left.operationalStatus
		? activeWorkOrder[left.operationalStatus]
		: 4;
	const rightWork = right.operationalStatus
		? activeWorkOrder[right.operationalStatus]
		: 4;
	if (leftWork !== rightWork) {
		return leftWork - rightWork;
	}
	const recency = compareOptionalDatesDescending(
		left.lastUsedAt,
		right.lastUsedAt
	);
	if (recency !== 0) {
		return recency;
	}
	return left.profileName.localeCompare(right.profileName);
}

function compareAddMembersPeople(
	left: SpaceAddMembersPersonGroup,
	right: SpaceAddMembersPersonGroup
): number {
	const activity = compareOptionalDatesDescending(
		left.lastActiveAt,
		right.lastActiveAt
	);
	return activity || left.name.localeCompare(right.name);
}

function compareOptionalDatesDescending(
	left: string | null | undefined,
	right: string | null | undefined
): number {
	const leftTime = left ? Date.parse(left) : 0;
	const rightTime = right ? Date.parse(right) : 0;
	return rightTime - leftTime;
}

function buildPersonalAddMemberGroups(input: {
	directory: OrganizationSpaceProfileCandidates | null;
	alreadyJoinedCandidates: readonly SpaceProfileAddCandidate[];
	selectableCandidates: readonly SpaceProfileAddCandidate[];
}): SpaceAddMembersCandidateGroups {
	const groupsByOwner = new Map<string, SpaceAddMembersPersonGroup>();
	for (const { alreadyMember, candidate } of [
		...input.alreadyJoinedCandidates.map((candidate) => ({
			alreadyMember: true,
			candidate,
		})),
		...input.selectableCandidates.map((candidate) => ({
			alreadyMember: false,
			candidate,
		})),
	]) {
		const summary = {
			...toAddMembersCandidateSummary(candidate),
			agentControllerRef:
				input.directory?.agentProfiles.find(
					(profile) => profile.profileId === candidate.profile.profileId
				)?.agentControllerRef ?? null,
			alreadyMember,
		};
		const ownerId = candidate.profile.ownerUserId ?? "personal";
		const ownerName = candidate.profile.ownerName?.trim() || "You";
		const current = groupsByOwner.get(ownerId) ?? {
			agentCandidates: [],
			humanAlreadyMember: false,
			humanCandidate: null,
			id: ownerId,
			lastActiveAt: null,
			name: ownerName,
			searchText: normalizeAddMembersSearchText([ownerName]),
		};
		if (summary.profileKind === "human") {
			current.humanAlreadyMember = alreadyMember;
			current.humanCandidate = alreadyMember ? null : summary;
			current.name = summary.profileName;
			current.searchText = normalizeAddMembersSearchText([
				summary.profileName,
				ownerName,
			]);
		} else {
			(current.agentCandidates as SpaceAddMembersCandidateSummary[]).push(
				summary
			);
		}
		groupsByOwner.set(ownerId, current);
	}
	return {
		alreadyJoinedCount: input.alreadyJoinedCandidates.length,
		organizationCandidates: [],
		personGroups: [...groupsByOwner.values()].map((group) => ({
			...group,
			agentCandidates: [...group.agentCandidates].sort(
				compareAddMembersCandidates
			),
		})),
	};
}

function filterAddMemberGroups(
	groups: SpaceAddMembersCandidateGroups,
	query: string
): SpaceAddMembersCandidateGroups {
	if (!query) {
		return groups;
	}
	return {
		...groups,
		organizationCandidates: groups.organizationCandidates.filter((candidate) =>
			candidate.searchText.includes(query)
		),
		personGroups: groups.personGroups.flatMap((group) => {
			if (group.searchText.includes(query)) {
				return [group];
			}
			const agentCandidates = group.agentCandidates.filter((candidate) =>
				candidate.searchText.includes(query)
			);
			return agentCandidates.length > 0 ? [{ ...group, agentCandidates }] : [];
		}),
	};
}

function resolveEffectiveAddMemberProfileIds(input: {
	candidateGroups: SpaceAddMembersCandidateGroups;
	selectedProfileIds: ReadonlySet<string>;
}): ReadonlySet<string> {
	const effectiveIds = new Set(input.selectedProfileIds);
	for (const group of input.candidateGroups.personGroups) {
		if (
			group.humanCandidate &&
			group.agentCandidates.some(
				(agent) =>
					input.selectedProfileIds.has(agent.profileId) &&
					agent.ownerHumanProfileId === group.humanCandidate?.profileId
			)
		) {
			effectiveIds.add(group.humanCandidate.profileId);
		}
	}
	return effectiveIds;
}

function resolvePersonActivityLabel(
	lastActiveAt: string | null
): string | undefined {
	return (
		resolveDirectoryHumanProfileActivityLabel({
			lastActiveAt,
			profileStatus: "active",
		}) ?? undefined
	);
}

function resolveAgentCandidateDescription(
	candidate: SpaceAddMembersCandidateSummary
): string | undefined {
	if (candidate.alreadyMember) {
		return "In this Space";
	}
	if (candidate.description) {
		return candidate.description;
	}
	if (candidate.operationalStatus === "working") {
		return "Working now";
	}
	if (candidate.operationalStatus === "paused") {
		return "Paused";
	}
	return candidate.availabilityLabel ?? undefined;
}

function resolveAddMembersEmptyMessage(input: {
	addQuery: string;
	organizationDirectoryCandidates: OrganizationDirectoryAddCandidates;
	organizationName: string;
	personalProfilesPlan: SpaceProfileAddPlan;
	usesOrganizationDirectory: boolean;
}): string {
	if (input.addQuery.trim().length > 0) {
		return `No members or agents match “${input.addQuery.trim()}”.`;
	}
	if (!input.usesOrganizationDirectory) {
		return resolveAddProfilesEmptyMessage(input.personalProfilesPlan);
	}
	if (input.organizationDirectoryCandidates.alreadyJoinedCount > 0) {
		return `Everyone available from ${input.organizationName} is already in this Space.`;
	}
	return `No members or agents are available to add from ${input.organizationName}.`;
}

function formatAddProfilesSuccess(result: SpaceAddProfilesResult): string {
	if (result.addedCount > 0) {
		return result.addedCount === 1
			? "Member added to this Space."
			: `${String(result.addedCount)} members added to this Space.`;
	}
	if (result.alreadyMemberCount > 0) {
		return result.alreadyMemberCount === 1
			? "That member is already in this Space."
			: "Those members are already in this Space.";
	}
	return "No members were added to this Space.";
}

function formatAddProfilesError(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return "OpenMeld could not add profiles to this Space.";
}

function resolveAddProfilesEmptyMessage(plan: SpaceProfileAddPlan): string {
	if (plan.alreadyJoinedCandidates.length > 0) {
		return "All eligible profiles are already in this Space.";
	}
	if (plan.excludedCandidates.length > 0) {
		return "No matching profiles are available to add.";
	}
	return "No profiles are available to add.";
}

function SpaceMembersList(input: {
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	activeWakeDisplayTargetProfileIds?: ReadonlySet<string>;
	activeWakeWaitingTargetProfileIds: ReadonlySet<string>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	centerAgentProfileId: string | null;
	currentOwnerUserId: string | null;
	currentProfileId: string;
	displayWakeOverrideByProfileId?: WakeDisplayOverrideByProfileId;
	filteredDirectory: ReturnType<typeof filterSpaceMemberDirectory> | null;
	isLoading: boolean;
	isAgentWakeAvailabilityCheckPending: (profileId: string) => boolean;
	isAgentRecoveryPending: (profileId: string) => boolean;
	membersError: string | null;
	modelCatalog: ModelCatalog | null;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onCheckAgentWakeAvailability: (profileId: string) => Promise<void>;
	onRefresh: (input?: SpaceMembersRefreshInput) => Promise<void>;
	onRemoveMember?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	orgSlug: string;
	prepareSetupHref?: string;
	query: string;
	snapshot: SpaceMembersSnapshot | null;
}) {
	const [isRetryPending, setIsRetryPending] = useState(false);
	const [collapsedPersonProfileIds, setCollapsedPersonProfileIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const entriesByProfileId = useMemo(
		() => buildSpaceMemberDirectoryEntryByProfileId(input.snapshot),
		[input.snapshot]
	);
	const directory = useMemo(
		() =>
			input.snapshot
				? buildSpaceMemberDirectoryForStatusOrder(
						buildSpaceMemberDirectory(input.snapshot)
					)
				: null,
		[input.snapshot]
	);
	const roster = useMemo(
		() =>
			buildSpaceMembersRoster({
				centerAgentProfileId: input.centerAgentProfileId,
				directory,
				filteredDirectory: input.filteredDirectory,
				searchActive: input.query.trim().length > 0,
			}),
		[
			input.centerAgentProfileId,
			directory,
			input.filteredDirectory,
			input.query,
		]
	);
	const activeWakeDisplayTargetProfileIds =
		input.activeWakeDisplayTargetProfileIds ??
		EMPTY_ACTIVE_WAKE_DISPLAY_TARGET_PROFILE_IDS;
	const memberTransientStatesByProfileId =
		resolveMemberTransientStatesByProfileId({
			activeWakeWaitingTargetProfileIds:
				input.activeWakeWaitingTargetProfileIds,
			agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
			autoRefreshExhaustedProfileIds: input.autoRefreshExhaustedProfileIds,
			currentOwnerUserId: input.currentOwnerUserId,
			isAgentRecoveryPending: input.isAgentRecoveryPending,
			snapshot: input.snapshot,
		});
	const creatorProfileIds = buildSpaceCreatorProfileIds(input.snapshot);
	const requiredAgentOwnerHumanProfileIds =
		buildRequiredAgentOwnerHumanProfileIds({
			centerAgentProfileId: input.centerAgentProfileId,
			snapshot: input.snapshot,
		});
	const renderMemberRow = (entry: SpaceMemberDirectoryEntry) => {
		const recoveryPlan =
			input.agentRecoveryPlansByProfileId.get(entry.profileId) ?? null;
		// Display-only Wake smoothing. Skip it while a recovery plan is active so
		// the real recovery state is never masked.
		const wakeDisplayOverride =
			recoveryPlan && recoveryPlan.kind !== "none"
				? undefined
				: input.displayWakeOverrideByProfileId?.get(entry.profileId);
		const wakeDisplayEntry = wakeDisplayOverride
			? applyWakeAvailabilityDisplayOverride(entry, wakeDisplayOverride)
			: undefined;
		const removeMemberAction =
			input.onRemoveMember &&
			canShowRemoveMemberAction({
				creatorProfileIds,
				currentProfileId: input.currentProfileId,
				profileId: entry.profileId,
				requiredAgentOwnerHumanProfileIds,
			})
				? input.onRemoveMember
				: undefined;
		return (
			<SpaceMemberRow
				agentRecoveryPlan={recoveryPlan}
				centerAgentProfileId={input.centerAgentProfileId}
				currentOwnerUserId={input.currentOwnerUserId}
				currentProfileId={input.currentProfileId}
				density="compact"
				entriesByProfileId={entriesByProfileId}
				entry={entry}
				isAgentRecoveryPending={input.isAgentRecoveryPending(entry.profileId)}
				isAgentWakeAvailabilityCheckPending={input.isAgentWakeAvailabilityCheckPending(
					entry.profileId
				)}
				memberTransientState={resolveEntryMemberTransientState({
					activeWakeDisplayTargetProfileIds,
					entry,
					memberTransientStatesByProfileId,
				})}
				modelCatalog={input.modelCatalog}
				onAgentRecoveryAction={input.onAgentRecoveryAction}
				onCheckAgentWakeAvailability={input.onCheckAgentWakeAvailability}
				onRemoveFromSpace={removeMemberAction}
				orgSlug={input.orgSlug}
				prepareSetupHref={input.prepareSetupHref}
				showAgentConnectionDetail={false}
				variant="full"
				wakeDisplayEntry={wakeDisplayEntry}
			/>
		);
	};

	if (input.isLoading && !input.snapshot) {
		return (
			<div className="flex flex-col gap-2">
				{Array.from({ length: 5 }).map((_, index) => (
					<Skeleton
						className="h-10 w-full"
						key={`space-members-drawer-skeleton-${String(index)}`}
					/>
				))}
			</div>
		);
	}

	const shouldShowBlockingError = Boolean(
		input.membersError && !input.snapshot
	);
	const membersErrorNotice = input.membersError ? (
		<div
			className={cn(
				"flex flex-col items-start gap-3 rounded-md border p-3 text-sm",
				shouldShowBlockingError
					? "border-destructive bg-destructive/10 text-destructive"
					: resolveStatusToneWarningNoticeClassName()
			)}
		>
			<p>
				{shouldShowBlockingError
					? SPACE_MEMBERS_LOAD_ERROR_MESSAGE
					: SPACE_MEMBERS_REFRESH_ERROR_MESSAGE}
			</p>
			<Button
				disabled={isRetryPending}
				onClick={() => {
					if (isRetryPending) {
						return;
					}
					setIsRetryPending(true);
					input
						.onRefresh({ forceNetwork: true })
						.catch((error) => {
							console.error("Failed to retry member loading.", error);
							toast.error(SPACE_MEMBERS_REFRESH_ERROR_MESSAGE);
						})
						.finally(() => {
							setIsRetryPending(false);
						});
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				Retry
			</Button>
		</div>
	) : null;
	if (shouldShowBlockingError) {
		return membersErrorNotice;
	}

	if (
		roster.organizationEntries.length > 0 ||
		roster.personGroups.length > 0 ||
		roster.ungroupedAgentEntries.length > 0
	) {
		return (
			<div className="flex flex-col gap-3">
				{membersErrorNotice}
				{roster.organizationEntries.length > 0 ? (
					<section className="flex flex-col gap-1">
						<h2 className="font-medium text-muted-foreground text-xs">
							Organization
						</h2>
						<div className="flex flex-col">
							{roster.organizationEntries.map((entry) => (
								<div key={entry.id}>{renderMemberRow(entry)}</div>
							))}
						</div>
					</section>
				) : null}
				{roster.personGroups.length > 0 ? (
					<section className="flex flex-col gap-1">
						<h2 className="font-medium text-muted-foreground text-xs">
							People &amp; Agents
						</h2>
						<div className="flex flex-col gap-1">
							{roster.personGroups.map((group) => {
								const expanded =
									input.query.trim().length > 0 ||
									!collapsedPersonProfileIds.has(group.humanEntry.profileId);
								return (
									<SpacePersonAgentGroup
										agentsId={`space-members-person-${group.humanEntry.profileId}-agents`}
										expanded={expanded}
										header={
											<div className="min-w-0 flex-1">
												{renderMemberRow(group.humanEntry)}
											</div>
										}
										key={group.humanEntry.profileId}
										name={group.humanEntry.profileName}
										onExpandedChange={(nextExpanded) => {
											setCollapsedPersonProfileIds((current) => {
												const next = new Set(current);
												if (nextExpanded) {
													next.delete(group.humanEntry.profileId);
												} else {
													next.add(group.humanEntry.profileId);
												}
												return next;
											});
										}}
										showToggle={group.agentEntries.length > 0}
										toggleClassName="mt-1.5"
									>
										<div className="ml-7 flex flex-col">
											{group.agentEntries.map((entry) => (
												<div key={entry.id}>{renderMemberRow(entry)}</div>
											))}
										</div>
									</SpacePersonAgentGroup>
								);
							})}
						</div>
					</section>
				) : null}
				{roster.ungroupedAgentEntries.length > 0 ? (
					<section className="flex flex-col gap-1">
						<h2 className="font-medium text-muted-foreground text-xs">
							Agents
						</h2>
						<div className="flex flex-col">
							{roster.ungroupedAgentEntries.map((entry) => (
								<div key={entry.id}>{renderMemberRow(entry)}</div>
							))}
						</div>
					</section>
				) : null}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{membersErrorNotice}
			<div className="border border-border px-3 py-6 text-center text-muted-foreground text-sm">
				{input.query.trim().length > 0
					? "No matching members found."
					: "No members are visible in this space yet."}
			</div>
		</div>
	);
}

function canShowRemoveMemberAction(input: {
	creatorProfileIds: ReadonlySet<string>;
	currentProfileId: string;
	profileId: string;
	requiredAgentOwnerHumanProfileIds: ReadonlySet<string>;
}): boolean {
	return (
		input.profileId !== input.currentProfileId &&
		!input.creatorProfileIds.has(input.profileId) &&
		!input.requiredAgentOwnerHumanProfileIds.has(input.profileId)
	);
}

type SpaceMembersPersonGroup = {
	agentEntries: readonly SpaceMemberDirectoryEntry[];
	humanEntry: SpaceMemberDirectoryEntry;
};

type SpaceMembersRoster = {
	organizationEntries: readonly SpaceMemberDirectoryEntry[];
	personGroups: readonly SpaceMembersPersonGroup[];
	ungroupedAgentEntries: readonly SpaceMemberDirectoryEntry[];
};

function buildSpaceMembersRoster(input: {
	centerAgentProfileId: string | null;
	directory: SpaceMemberDirectory | null;
	filteredDirectory: SpaceMemberDirectory | null;
	searchActive: boolean;
}): SpaceMembersRoster {
	const emptyRoster: SpaceMembersRoster = {
		organizationEntries: [],
		personGroups: [],
		ungroupedAgentEntries: [],
	};
	if (!(input.directory && input.filteredDirectory)) {
		return emptyRoster;
	}
	const allHumanEntries =
		input.directory.sections.find((section) => section.id === "humans")
			?.entries ?? [];
	const allAgentEntries =
		input.directory.sections.find((section) => section.id === "agents")
			?.entries ?? [];
	const visibleProfileIds = new Set(
		input.filteredDirectory.sections.flatMap((section) =>
			section.entries.map((entry) => entry.profileId)
		)
	);
	const regularAgentEntries = allAgentEntries.filter(
		(entry) => entry.profileId !== input.centerAgentProfileId
	);
	const assignedAgentProfileIds = new Set<string>();
	const personGroups = allHumanEntries.flatMap(
		(humanEntry): readonly SpaceMembersPersonGroup[] => {
			const ownedAgentEntries = regularAgentEntries.filter(
				(agentEntry) =>
					humanEntry.ownerUserId !== null &&
					agentEntry.ownerUserId === humanEntry.ownerUserId
			);
			for (const agentEntry of ownedAgentEntries) {
				assignedAgentProfileIds.add(agentEntry.profileId);
			}
			const humanMatches = visibleProfileIds.has(humanEntry.profileId);
			const visibleAgentEntries = humanMatches
				? ownedAgentEntries
				: ownedAgentEntries.filter((entry) =>
						visibleProfileIds.has(entry.profileId)
					);
			if (
				input.searchActive &&
				!humanMatches &&
				visibleAgentEntries.length === 0
			) {
				return [];
			}
			return [
				{
					agentEntries: visibleAgentEntries,
					humanEntry,
				},
			];
		}
	);
	const organizationEntries = allAgentEntries.filter(
		(entry) =>
			entry.profileId === input.centerAgentProfileId &&
			(!input.searchActive || visibleProfileIds.has(entry.profileId))
	);
	const ungroupedAgentEntries = regularAgentEntries.filter(
		(entry) =>
			!assignedAgentProfileIds.has(entry.profileId) &&
			(!input.searchActive || visibleProfileIds.has(entry.profileId))
	);
	return {
		organizationEntries,
		personGroups,
		ungroupedAgentEntries,
	};
}

function buildRequiredAgentOwnerHumanProfileIds(input: {
	centerAgentProfileId: string | null;
	snapshot: SpaceMembersSnapshot | null;
}): ReadonlySet<string> {
	const requiredOwnerUserIds = new Set<string>();
	for (const agent of input.snapshot?.agents ?? []) {
		const ownerUserId = agent.ownerUserId?.trim();
		if (
			agent.status === "active" &&
			agent.profileId !== input.centerAgentProfileId &&
			ownerUserId
		) {
			requiredOwnerUserIds.add(ownerUserId);
		}
	}
	const requiredHumanProfileIds = new Set<string>();
	for (const human of input.snapshot?.humans ?? []) {
		const ownerUserId = human.ownerUserId?.trim();
		if (
			human.status === "active" &&
			ownerUserId &&
			requiredOwnerUserIds.has(ownerUserId)
		) {
			requiredHumanProfileIds.add(human.profileId);
		}
	}
	return requiredHumanProfileIds;
}

function buildSpaceCreatorProfileIds(
	snapshot: SpaceMembersSnapshot | null
): ReadonlySet<string> {
	const creatorProfileIds = new Set<string>();
	for (const member of [
		...(snapshot?.humans ?? []),
		...(snapshot?.agents ?? []),
	]) {
		if (member.status === "active" && member.memberSource === "space_creator") {
			creatorProfileIds.add(member.profileId);
		}
	}
	return creatorProfileIds;
}

function resolveEntryMemberTransientState(input: {
	activeWakeDisplayTargetProfileIds?: ReadonlySet<string>;
	entry: {
		profileId: string;
		profileKind: string;
		presenceStatus?: string | null;
	};
	memberTransientStatesByProfileId: ReadonlyMap<
		string,
		SpaceWakeStatusTransientState
	>;
}): SpaceWakeStatusTransientState | null {
	if (input.entry.profileKind !== "agent") {
		return null;
	}
	const memberTransientState =
		input.memberTransientStatesByProfileId.get(input.entry.profileId) ?? null;
	if (memberTransientState) {
		return memberTransientState;
	}
	if (
		input.entry.presenceStatus !== "wakeable" &&
		input.activeWakeDisplayTargetProfileIds?.has(input.entry.profileId)
	) {
		return "active_wake_in_progress";
	}
	return null;
}

function resolveMemberTransientStatesByProfileId(input: {
	activeWakeWaitingTargetProfileIds: ReadonlySet<string>;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	currentOwnerUserId: string | null;
	isAgentRecoveryPending: (profileId: string) => boolean;
	snapshot: SpaceMembersSnapshot | null;
}): ReadonlyMap<string, SpaceWakeStatusTransientState> {
	const statesByProfileId = new Map<string, SpaceWakeStatusTransientState>();
	for (const agent of input.snapshot?.agents ?? []) {
		if (
			!isOwnedByCurrentUser({
				currentOwnerUserId: input.currentOwnerUserId,
				ownerUserId: agent.ownerUserId,
			})
		) {
			continue;
		}
		const transientState = resolveSpaceWakeStatusTransientState({
			activeWakeWaitingTargetProfileIds:
				input.activeWakeWaitingTargetProfileIds,
			agent,
			autoRefreshExhaustedProfileIds: input.autoRefreshExhaustedProfileIds,
			isAgentRecoveryPending: input.isAgentRecoveryPending(agent.profileId),
			plan: input.agentRecoveryPlansByProfileId.get(agent.profileId),
		});
		if (transientState) {
			statesByProfileId.set(agent.profileId, transientState);
		}
	}
	return statesByProfileId;
}

function isOwnedByCurrentUser(input: {
	currentOwnerUserId: string | null;
	ownerUserId: string | null | undefined;
}): boolean {
	return isSameOwnerUserId(input);
}

function resolveMembersCountDescription(input: {
	hasLoadError: boolean;
	isLoading: boolean;
	totalMembersCount: number | null;
}): string {
	if (input.totalMembersCount === null) {
		return input.hasLoadError || !input.isLoading
			? "Members unavailable"
			: "Loading members";
	}

	const totalMembersCount = input.totalMembersCount;
	return `${String(totalMembersCount)} member${totalMembersCount === 1 ? "" : "s"} in this space`;
}

function resolveMembersCountLabel(input: {
	hasLoadError: boolean;
	isLoading: boolean;
	totalMembersCount: number | null;
}): string {
	if (input.totalMembersCount === null) {
		return input.hasLoadError || !input.isLoading ? "Unavailable" : "Loading";
	}
	return String(input.totalMembersCount);
}
