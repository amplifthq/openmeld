"use client";

import { DrawerPreview as Drawer } from "@base-ui/react/drawer";
import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	ModelCatalog,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	buildSpaceMemberDirectory,
	buildSpaceProfileAddPlan,
	type SpaceMemberDirectoryEntry,
	type SpaceProfileAddPlan,
	type SpaceProfileAddProfile,
} from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { springs } from "@openmeld/ui/lib/springs";
import {
	resolveStatusToneIconClassName,
	resolveStatusToneWarningNoticeClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
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
import type { CSSProperties, RefObject } from "react";
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
import { SpacePickerCreateAgent } from "#/components/profiles/space-picker-create-agent";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { SPACE_PANEL_WIDTH_METRICS } from "#/lib/spaces/panel-width-storage";
import {
	buildSpaceMemberDirectoryForStatusOrder,
	filterSpaceMemberDirectory,
} from "#/lib/spaces/presentation";
import {
	organizationProfileDirectoryQueryOptions,
	organizationSpaceProfileCandidatesQueryOptions,
} from "#/query/organizations/organization-directory";
import { spaceStatusQueryOptions } from "#/query/spaces/status";
import { buildDirectMessageConversionDefaultName } from "./direct-message-conversion";
import { DirectMessageConversionDialog } from "./direct-message-conversion-dialog";
import { PeopleAgentPickerDialog } from "./people-agent-picker-dialog";
import {
	buildOrganizationDirectoryAddCandidates,
	buildPersonalAddMemberGroups,
	buildSelectableAddMemberProfileIds,
	filterAddMemberGroups,
	type OrganizationDirectoryAddCandidates,
	resolveEffectiveAddMemberProfileIds,
	type SpaceAddMembersCandidateGroups,
	type SpaceAddMembersCandidateSummary,
} from "./people-agent-picker-model";
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
import {
	buildSpaceMembersRoster,
	SpaceMembersRosterView,
} from "./space-members-roster";
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
	/** Bumped by the Get-set-up banner's "Add agents" to open the shared
	 * Add People or Agents dialog from the currently visible Members surface. */
	openAddMembersNonce?: number;
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
	const model = useSpaceMembersModel(input);
	const widthMetrics = SPACE_PANEL_WIDTH_METRICS.members;

	return (
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
						{input.onAddProfiles || input.onAddOrganizationDirectoryProfiles ? (
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
				accountProfiles={input.accountProfiles ?? []}
				activeWakeDisplayTargetProfileIds={
					input.activeWakeDisplayTargetProfileIds
				}
				activeWakeWaitingTargetProfileIds={
					input.activeWakeWaitingTargetProfileIds
				}
				addMembersDialogId={model.addMembersDialogId}
				addMembersTriggerRef={model.addMembersTriggerRef}
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
				onAddMembersOpenChange={model.setIsAddMembersOpen}
				onAddOrganizationDirectoryProfiles={
					input.onAddOrganizationDirectoryProfiles
				}
				onAddProfiles={input.onAddProfiles}
				onAgentRecoveryAction={input.onAgentRecoveryAction}
				onConvertDirectMessageToSpace={input.onConvertDirectMessageToSpace}
				onQueryChange={model.setQuery}
				onRefresh={input.onRefresh}
				onRemoveMember={input.onRemoveMember}
				orgSlug={input.orgSlug}
				prepareSetupHref={input.prepareSetupHref}
				query={model.query}
				searchOpen={model.isSearchOpen}
				snapshot={input.snapshot}
				spaceId={input.spaceId}
				spaceName={input.spaceName}
				viewState={{
					isAddMembersOpen: model.isAddMembersOpen,
					isAgentRecoveryPending: input.isAgentRecoveryPending,
					isLoading: input.isLoading,
				}}
			/>
		</SpaceInlineSidePanel>
	);
}

export function SpaceMembersDrawer(
	input: SpaceMembersSurfaceProps & {
		onOpenChange: (open: boolean) => void;
		open: boolean;
	}
) {
	const model = useSpaceMembersModel(input);

	return (
		<Drawer.Root
			onOpenChange={input.onOpenChange}
			open={input.open}
			swipeDirection="right"
		>
			<Drawer.Portal>
				<Drawer.Backdrop className="fixed inset-0 z-40 bg-background/60 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
				<Drawer.Viewport className="fixed inset-0 z-50 flex justify-end">
					<Drawer.Popup
						className="flex h-full translate-x-[var(--drawer-swipe-movement-x,0px)] border-border border-l bg-background outline-none transition-transform duration-200 ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full data-swiping:transition-none motion-reduce:translate-x-0 motion-reduce:transition-opacity motion-reduce:data-ending-style:translate-x-0 motion-reduce:data-starting-style:translate-x-0 motion-reduce:data-ending-style:opacity-0 motion-reduce:data-starting-style:opacity-0"
						id="space-members-drawer"
						style={
							{
								width: "min(24rem, calc(100vw - 1rem))",
							} as CSSProperties
						}
					>
						<Drawer.Content className="flex min-h-0 w-full flex-col">
							<div className="shrink-0 border-border border-b px-4 py-3">
								<div className="flex items-center justify-between gap-2">
									<div className="flex min-w-0 items-baseline gap-2">
										<Drawer.Title className="font-medium text-base">
											Members
										</Drawer.Title>
										<span
											aria-hidden="true"
											className="truncate text-muted-foreground text-xs tabular-nums"
										>
											{model.membersCountLabel}
										</span>
										<Drawer.Description className="sr-only">
											{model.membersCountDescription}
										</Drawer.Description>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										<SpaceMembersSearchHeaderButton
											onToggle={() =>
												model.setIsSearchOpen(!model.isSearchOpen)
											}
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
								accountProfiles={input.accountProfiles ?? []}
								activeWakeDisplayTargetProfileIds={
									input.activeWakeDisplayTargetProfileIds
								}
								activeWakeWaitingTargetProfileIds={
									input.activeWakeWaitingTargetProfileIds
								}
								addMembersDialogId={model.addMembersDialogId}
								addMembersTriggerRef={model.addMembersTriggerRef}
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
								onAddMembersOpenChange={model.setIsAddMembersOpen}
								onAddOrganizationDirectoryProfiles={
									input.onAddOrganizationDirectoryProfiles
								}
								onAddProfiles={input.onAddProfiles}
								onAgentRecoveryAction={input.onAgentRecoveryAction}
								onConvertDirectMessageToSpace={
									input.onConvertDirectMessageToSpace
								}
								onQueryChange={model.setQuery}
								onRefresh={input.onRefresh}
								onRemoveMember={input.onRemoveMember}
								orgSlug={input.orgSlug}
								prepareSetupHref={input.prepareSetupHref}
								query={model.query}
								searchOpen={model.isSearchOpen}
								snapshot={input.snapshot}
								spaceId={input.spaceId}
								spaceName={input.spaceName}
								viewState={{
									isAddMembersOpen: model.isAddMembersOpen,
									isAgentRecoveryPending: input.isAgentRecoveryPending,
									isLoading: input.isLoading,
								}}
							/>
						</Drawer.Content>
					</Drawer.Popup>
				</Drawer.Viewport>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

const SPACE_MEMBERS_SEARCH_REGION_ID = "space-members-search-region";

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

function useSpaceMembersModel(input: SpaceMembersSurfaceProps) {
	const addMembersDialogId = useId();
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
	addMembersTriggerRef: RefObject<HTMLElement | null>;
	accountProfiles: readonly AuthProfileView[];
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
	onAddMembersOpenChange: (open: boolean) => void;
	onAddOrganizationDirectoryProfiles?: (
		input: SpaceAddOrganizationDirectoryProfilesInput
	) => Promise<SpaceAddProfilesResult>;
	onAddProfiles?: (
		profileIds: readonly string[]
	) => Promise<SpaceAddProfilesResult>;
	onConvertDirectMessageToSpace?: (
		input: SpaceConvertDirectMessageInput
	) => Promise<SpaceAddProfilesResult>;
	onQueryChange: (query: string) => void;
	onRefresh: (input?: SpaceMembersRefreshInput) => Promise<void>;
	onRemoveMember?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	orgSlug: string;
	prepareSetupHref?: string;
	query: string;
	searchOpen: boolean;
	spaceId?: string;
	spaceName?: string | null;
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
						<SpaceAddProfilesSection
							accountProfiles={input.accountProfiles}
							currentOwnerUserId={input.currentOwnerUserId}
							currentProfileId={input.currentProfileId}
							dialogId={input.addMembersDialogId}
							finalFocus={input.addMembersTriggerRef}
							key={input.spaceId ?? "no-space"}
							onAddOrganizationDirectoryProfiles={
								input.onAddOrganizationDirectoryProfiles
							}
							onAddProfiles={input.onAddProfiles}
							onConvertDirectMessageToSpace={
								input.onConvertDirectMessageToSpace
							}
							onOpenChange={input.onAddMembersOpenChange}
							onRefresh={input.onRefresh}
							open={input.viewState.isAddMembersOpen}
							orgSlug={input.orgSlug}
							snapshot={input.snapshot}
							spaceId={input.spaceId}
							spaceName={input.spaceName}
						/>

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
		organization &&
			!organization.isPersonal &&
			input.onAddOrganizationDirectoryProfiles
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
	const waitsForDirectory =
		input.usesOrganizationDirectory && !input.directoryHasData;
	return (
		<PeopleAgentPickerDialog
			actions={
				input.spaceId ? (
					<div className="flex flex-wrap items-center gap-2">
						<Button onClick={() => setCreating(true)} size="xs">
							<PlusIcon aria-hidden="true" />
							New Agent
						</Button>
						{input.usesOrganizationDirectory ? (
							<SpaceInvitationsSection spaceId={input.spaceId} />
						) : null}
					</div>
				) : null
			}
			candidateGroups={input.candidateGroups}
			canSubmit={input.canSubmit}
			description={
				input.usesOrganizationDirectory
					? `Choose people and their agents from ${input.organizationName}.`
					: "Choose people and their agents to add to this Space."
			}
			emptyMessage={input.emptyMessage}
			emptySelectionLabel="Select members to add"
			errorMessage={
				input.errorMessage ??
				(waitsForDirectory && input.directoryIsError
					? "Couldn’t load the Organization Directory."
					: null)
			}
			finalFocus={input.finalFocus}
			id={input.dialogId}
			includeAgentOwners
			isLoading={
				!input.snapshot || (waitsForDirectory && input.directoryIsPending)
			}
			isSubmitting={busy || input.isSubmitting}
			notice={
				input.successMessage ? (
					<p className={cn("text-xs", resolveStatusToneIconClassName("ready"))}>
						{input.successMessage}
					</p>
				) : null
			}
			onClear={input.onClear}
			onOpenChange={(open) => {
				if (!open) {
					setCreating(false);
				}
				input.onOpenChange(open);
			}}
			onQueryChange={input.onAddQueryChange}
			onRetry={
				waitsForDirectory && input.directoryIsError
					? input.onRetryDirectory
					: undefined
			}
			onSubmit={() => {
				input.onSubmit().catch(input.onSubmitError);
			}}
			onToggle={input.onToggle}
			open={input.open}
			query={input.addQuery}
			selectedProfileIds={input.selectedProfileIds}
			submitLabel={resolveAddMembersSubmitLabel(input)}
			title="Add People or Agents"
		>
			{creating ? (
				<SpacePickerCreateAgent
					onBack={() => setCreating(false)}
					onBusyChange={setBusy}
					onCreated={input.onCreated}
				/>
			) : undefined}
		</PeopleAgentPickerDialog>
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

function useSpaceMemberAccessStatus(
	snapshot: SpaceMembersSnapshot | null,
	profileId: string
) {
	return useQuery(
		spaceStatusQueryOptions({
			spaceId: snapshot?.spaceId ?? "",
			openMeldProfileId: profileId,
			enabled: Boolean(snapshot),
		})
	);
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
	const organization = useOptionalAppOrganization();
	const profileDirectory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: Boolean(organization),
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	const [isRetryPending, setIsRetryPending] = useState(false);
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
				owners: profileDirectory.data?.members,
				searchActive: input.query.trim().length > 0,
			}),
		[
			input.centerAgentProfileId,
			directory,
			input.filteredDirectory,
			input.query,
			profileDirectory.data?.members,
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
	const accessStatus = useSpaceMemberAccessStatus(
		input.snapshot,
		input.currentProfileId
	);
	const ownerProfileIds = buildSpaceOwnerProfileIds(
		input.snapshot,
		accessStatus.data?.ownerUserIds
	);
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
			accessStatus.data?.ownerUserIds &&
			input.onRemoveMember &&
			canShowRemoveMemberAction({
				ownerProfileIds,
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
				<SpaceMembersRosterView
					renderMember={renderMemberRow}
					roster={roster}
					searchActive={input.query.trim().length > 0}
				/>
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

function buildSpaceOwnerProfileIds(
	snapshot: SpaceMembersSnapshot | null | undefined,
	ownerUserIds: readonly string[] | undefined
): Set<string> {
	const owners = new Set(ownerUserIds);
	return new Set(
		(snapshot?.humans ?? [])
			.filter((person) => person.ownerUserId && owners.has(person.ownerUserId))
			.map((person) => person.profileId)
	);
}

function canShowRemoveMemberAction(input: {
	ownerProfileIds: ReadonlySet<string>;
	currentProfileId: string;
	profileId: string;
	requiredAgentOwnerHumanProfileIds: ReadonlySet<string>;
}): boolean {
	return (
		input.profileId !== input.currentProfileId &&
		!input.ownerProfileIds.has(input.profileId) &&
		!input.requiredAgentOwnerHumanProfileIds.has(input.profileId)
	);
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
