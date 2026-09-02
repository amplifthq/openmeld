"use client";

import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	ModelCatalog,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
	buildSpaceMemberDirectory,
	buildSpaceProfileAddPlan,
	type SpaceProfileAddCandidate,
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
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { springs } from "@openmeld/ui/lib/springs";
import {
	resolveStatusToneIconClassName,
	resolveStatusToneWarningNoticeClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	UsersThreeIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import type { CSSProperties } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import {
	type AgentProfileEditDialogContext,
	AgentProfileEditDialogController,
} from "#/components/agents/agent-profile-edit-dialog-controller";
import { SpaceCreateProfileButton } from "#/components/profiles/space-create-profile-button";
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
import { buildEditableSpaceAgentProfilesById } from "./space-agent-profile-edit-access";
import type { SpaceAgentProfileBindingRecoveryPlan } from "./space-agent-recovery-action";
import { SpaceInlineSidePanel } from "./space-inline-side-panel";
import { isSameOwnerUserId } from "./space-member-ownership";
import { SpaceMemberRow } from "./space-member-row";
import {
	SPACE_MEMBERS_LOAD_ERROR_MESSAGE,
	SPACE_MEMBERS_REFRESH_ERROR_MESSAGE,
} from "./space-members-error-copy";
import {
	resolveSpaceWakeStatusTransientState,
	type SpaceWakeStatusTransientState,
} from "./space-wake-status-refresh";
import {
	applyWakeAvailabilityDisplayOverride,
	type WakeDisplayOverrideByProfileId,
} from "./use-wake-display-debounce";

export const SPACE_MEMBERS_SIDE_PANEL_QUERY = "(min-width: 1280px)";

// The Add-members card flash runs ~1.6s; clear the flag a touch later so a
// later normal panel open doesn't replay it.
const ADD_MEMBERS_FLASH_MS = 1700;
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
	isLoading: boolean;
	isAgentRecoveryPending: (profileId: string) => boolean;
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
	/** Bumped by the Get-set-up banner's "Add agents" to open + flash the
	 * Add-members card so a new user sees exactly where to act. */
	openAddMembersNonce?: number;
	prepareSetupHref?: string;
	spaceId?: string;
	spaceName?: string | null;
	snapshot: SpaceMembersSnapshot | null;
};

export function SpaceMembersToggleButton(input: {
	controlsId: string;
	memberCount: number;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const memberLabel = `${String(input.memberCount)} member${input.memberCount === 1 ? "" : "s"}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-controls={input.controlsId}
						aria-expanded={input.open}
						aria-label={`Members, ${String(input.memberCount)} total`}
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
						<span className="tabular-nums">{input.memberCount}</span>
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
			<header className="flex shrink-0 flex-col gap-1 border-border border-b px-4 py-3.5">
				<div className="flex items-start justify-between gap-2">
					<h2 className="min-w-0 whitespace-nowrap font-medium text-base">
						Members
					</h2>
					<div className="flex shrink-0 items-center gap-1">
						<SpaceMembersSearchHeaderButton
							onToggle={() => model.setIsSearchOpen(!model.isSearchOpen)}
							open={model.isSearchOpen}
						/>
						{input.onAddProfiles || input.onAddOrganizationDirectoryProfiles ? (
							<SpaceAddMembersHeaderButton
								onToggle={() =>
									model.setIsAddMembersOpen(!model.isAddMembersOpen)
								}
								open={model.isAddMembersOpen}
							/>
						) : null}
						<SpaceMembersRefreshButton
							onRefresh={() => input.onRefresh({ forceNetwork: true })}
						/>
						<SpaceMembersCloseButton
							onClose={() => input.onOpenChange(false)}
						/>
					</div>
				</div>
				<p className="w-full text-muted-foreground text-sm">
					{model.membersCountDescription}
				</p>
			</header>

			<SpaceMembersBody
				accountProfiles={input.accountProfiles ?? []}
				activeWakeDisplayTargetProfileIds={
					input.activeWakeDisplayTargetProfileIds
				}
				activeWakeWaitingTargetProfileIds={
					input.activeWakeWaitingTargetProfileIds
				}
				agentProfileEditContext={input.agentProfileEditContext}
				agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
				autoRefreshExhaustedProfileIds={input.autoRefreshExhaustedProfileIds}
				centerAgentProfileId={input.centerAgentProfileId ?? null}
				currentOwnerUserId={input.currentOwnerUserId}
				currentProfileId={input.currentProfileId}
				displayWakeOverrideByProfileId={input.displayWakeOverrideByProfileId}
				filteredDirectory={model.filteredDirectory}
				isAddMembersFlashing={model.isAddMembersFlashing}
				isAddMembersOpen={model.isAddMembersOpen}
				isAgentRecoveryPending={input.isAgentRecoveryPending}
				isLoading={input.isLoading}
				membersError={input.membersError}
				modelCatalog={input.modelCatalog ?? null}
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
			direction="right"
			onOpenChange={input.onOpenChange}
			open={input.open}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-40 bg-background/60" />
				<Drawer.Content
					className="fixed top-0 right-0 bottom-0 z-50 flex border-border border-l bg-background outline-none"
					id="space-members-drawer"
					style={
						{
							"--initial-transform": "calc(100% + 1px)",
							width: "min(24rem, calc(100vw - 1rem))",
						} as CSSProperties
					}
				>
					<div className="flex min-h-0 w-full flex-col">
						<div className="flex shrink-0 flex-col gap-1 border-border border-b px-4 py-3.5">
							<div className="flex items-start justify-between gap-2">
								<Drawer.Title className="font-medium text-base">
									Members
								</Drawer.Title>
								<div className="flex shrink-0 items-center gap-1">
									<SpaceMembersSearchHeaderButton
										onToggle={() => model.setIsSearchOpen(!model.isSearchOpen)}
										open={model.isSearchOpen}
									/>
									{input.onAddProfiles ||
									input.onAddOrganizationDirectoryProfiles ? (
										<SpaceAddMembersHeaderButton
											onToggle={() =>
												model.setIsAddMembersOpen(!model.isAddMembersOpen)
											}
											open={model.isAddMembersOpen}
										/>
									) : null}
									<SpaceMembersRefreshButton
										onRefresh={() => input.onRefresh({ forceNetwork: true })}
									/>
									<SpaceMembersCloseButton
										onClose={() => input.onOpenChange(false)}
									/>
								</div>
							</div>
							<Drawer.Description className="w-full text-muted-foreground text-sm">
								{model.membersCountDescription}
							</Drawer.Description>
						</div>

						<SpaceMembersBody
							accountProfiles={input.accountProfiles ?? []}
							activeWakeDisplayTargetProfileIds={
								input.activeWakeDisplayTargetProfileIds
							}
							activeWakeWaitingTargetProfileIds={
								input.activeWakeWaitingTargetProfileIds
							}
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
							isAddMembersFlashing={model.isAddMembersFlashing}
							isAddMembersOpen={model.isAddMembersOpen}
							isAgentRecoveryPending={input.isAgentRecoveryPending}
							isLoading={input.isLoading}
							membersError={input.membersError}
							modelCatalog={input.modelCatalog ?? null}
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
						/>
					</div>
				</Drawer.Content>
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
	onToggle: () => void;
	open: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-controls={SPACE_ADD_MEMBERS_REGION_ID}
						aria-expanded={input.open}
						aria-label="Add members"
						id={SPACE_ADD_MEMBERS_TRIGGER_ID}
						onClick={input.onToggle}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<motion.span
							animate={{ rotate: input.open ? 45 : 0 }}
							className="flex"
							transition={springs.moderate}
						>
							<PlusIcon />
						</motion.span>
					</Button>
				}
			/>
			<TooltipContent>Add members</TooltipContent>
		</Tooltip>
	);
}

function SpaceMembersRefreshButton(input: { onRefresh: () => Promise<void> }) {
	const [isManualRefreshPending, setIsManualRefreshPending] = useState(false);

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label="Refresh members"
						disabled={isManualRefreshPending}
						onClick={() => {
							if (isManualRefreshPending) {
								return;
							}
							setIsManualRefreshPending(true);
							input
								.onRefresh()
								.catch((error) => {
									console.error("Failed to refresh members.", error);
									toast.error(SPACE_MEMBERS_REFRESH_ERROR_MESSAGE);
								})
								.finally(() => {
									setIsManualRefreshPending(false);
								});
						}}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ArrowsClockwiseIcon />
					</Button>
				}
			/>
			<TooltipContent>Refresh members</TooltipContent>
		</Tooltip>
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
	const [isAddMembersOpen, setIsAddMembersOpen] = useState(false);
	const [isAddMembersFlashing, setIsAddMembersFlashing] = useState(false);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const lastOpenNonceRef = useRef(input.openAddMembersNonce);
	const [query, setQuery] = useState("");
	const setSearchOpen = (open: boolean) => {
		setIsSearchOpen(open);
		if (!open) {
			setQuery("");
		}
	};

	// An external "Add agents" click (Get-set-up banner) opens the Add-members
	// card and flashes it once. The flag lives here (this model stays mounted)
	// rather than in the card, which unmounts with the closed panel — so the
	// flash survives the panel opening, and self-clears so a later normal open
	// doesn't replay it.
	useEffect(() => {
		const nonce = input.openAddMembersNonce;
		if (nonce === undefined || nonce === lastOpenNonceRef.current) {
			return;
		}
		lastOpenNonceRef.current = nonce;
		setIsAddMembersOpen(true);
		setIsAddMembersFlashing(true);
		const timer = window.setTimeout(
			() => setIsAddMembersFlashing(false),
			ADD_MEMBERS_FLASH_MS
		);
		return () => window.clearTimeout(timer);
	}, [input.openAddMembersNonce]);
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
		filteredDirectory,
		isAddMembersFlashing,
		isAddMembersOpen,
		isSearchOpen,
		membersCountDescription,
		query,
		setIsAddMembersOpen,
		setQuery,
		setIsSearchOpen: setSearchOpen,
	};
}

function SpaceMembersBody(input: {
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
	isLoading: boolean;
	isAgentRecoveryPending: (profileId: string) => boolean;
	membersError: string | null;
	modelCatalog: ModelCatalog | null;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	isAddMembersFlashing?: boolean;
	isAddMembersOpen: boolean;
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
}) {
	const shouldShowAddMembersEmptyCta =
		Boolean(input.onAddProfiles || input.onAddOrganizationDirectoryProfiles) &&
		!input.isAddMembersOpen &&
		input.snapshot?.summary.totalCount === 1;
	const [
		checkingAgentWakeAvailabilityProfileId,
		setCheckingAgentWakeAvailabilityProfileId,
	] = useState<string | null>(null);
	const [editingAgentProfileId, setEditingAgentProfileId] = useState<
		string | null
	>(null);
	const editableAgentProfilesById = useMemo(() => {
		return buildEditableSpaceAgentProfilesById({
			accountProfiles: input.accountProfiles,
			currentOwnerUserId: input.currentOwnerUserId,
			editContextAvailable: Boolean(input.agentProfileEditContext),
		});
	}, [
		input.accountProfiles,
		input.agentProfileEditContext,
		input.currentOwnerUserId,
	]);
	const editingAgentProfile = editingAgentProfileId
		? (editableAgentProfilesById.get(editingAgentProfileId) ?? null)
		: null;
	const editableAgentProfileIds = useMemo(
		() => new Set(editableAgentProfilesById.keys()),
		[editableAgentProfilesById]
	);
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
		<>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
				<div className="flex flex-col gap-4">
					<div
						className={
							input.isAddMembersFlashing
								? "add-members-recall-flash"
								: undefined
						}
					>
						<SpaceAddProfilesSection
							accountProfiles={input.accountProfiles}
							currentOwnerUserId={input.currentOwnerUserId}
							currentProfileId={input.currentProfileId}
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
							open={input.isAddMembersOpen}
							orgSlug={input.orgSlug}
							snapshot={input.snapshot}
							spaceId={input.spaceId}
							spaceName={input.spaceName}
						/>
					</div>

					{shouldShowAddMembersEmptyCta ? (
						<button
							className="flex flex-col items-center gap-2 rounded-md border border-border border-dashed px-3 py-4 text-center transition-colors hover:bg-muted/40"
							onClick={() => input.onAddMembersOpenChange(true)}
							type="button"
						>
							<span className="text-muted-foreground text-xs">
								It is just you here so far.
							</span>
							<span className="flex items-center gap-1.5 font-medium text-sm">
								<PlusIcon aria-hidden className="size-3.5" />
								Add members
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
						agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
						autoRefreshExhaustedProfileIds={
							input.autoRefreshExhaustedProfileIds
						}
						centerAgentProfileId={input.centerAgentProfileId}
						currentOwnerUserId={input.currentOwnerUserId}
						currentProfileId={input.currentProfileId}
						displayWakeOverrideByProfileId={
							input.displayWakeOverrideByProfileId
						}
						editableAgentProfileIds={editableAgentProfileIds}
						filteredDirectory={input.filteredDirectory}
						isAgentRecoveryPending={input.isAgentRecoveryPending}
						isAgentWakeAvailabilityCheckPending={(profileId) =>
							checkingAgentWakeAvailabilityProfileId === profileId
						}
						isLoading={input.isLoading}
						membersError={input.membersError}
						modelCatalog={input.modelCatalog}
						onAgentRecoveryAction={input.onAgentRecoveryAction}
						onCheckAgentWakeAvailability={handleCheckAgentWakeAvailability}
						onEditAgentProfile={
							input.agentProfileEditContext
								? setEditingAgentProfileId
								: undefined
						}
						onRefresh={input.onRefresh}
						onRemoveMember={input.onRemoveMember}
						orgSlug={input.orgSlug}
						prepareSetupHref={input.prepareSetupHref}
						query={input.query}
						snapshot={input.snapshot}
					/>
				</div>
			</div>
			{editingAgentProfile && input.agentProfileEditContext ? (
				<AgentProfileEditDialogController
					context={input.agentProfileEditContext}
					modelCatalog={input.modelCatalog}
					onOpenChange={(open) => {
						if (!open) {
							setEditingAgentProfileId(null);
						}
					}}
					open={true}
					profile={editingAgentProfile}
				/>
			) : null}
		</>
	);
}

function SpaceMembersSearchField(input: {
	onQueryChange: (query: string) => void;
	open: boolean;
	query: string;
}) {
	return (
		<AnimatePresence initial={false}>
			{input.open ? (
				<motion.div
					animate={{ height: "auto", marginBottom: "0rem", opacity: 1 }}
					className="overflow-hidden"
					exit={{
						height: 0,
						marginBottom: "-1rem",
						opacity: 0,
						transition: { ...springs.moderate, bounce: 0 },
					}}
					id={SPACE_MEMBERS_SEARCH_REGION_ID}
					initial={{ height: 0, marginBottom: "-1rem", opacity: 0 }}
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
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

const SPACE_ADD_MEMBERS_REGION_ID = "space-add-members-region";
const SPACE_ADD_MEMBERS_TRIGGER_ID = "space-add-members-trigger";

function SpaceAddProfilesSection(input: {
	accountProfiles: readonly AuthProfileView[];
	currentOwnerUserId: string | null;
	currentProfileId: string;
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
}) {
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
	const regionRef = useRef<HTMLDivElement | null>(null);
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
			enabled: usesOrganizationDirectory,
			organizationId: organization?.id ?? "",
		})
	);

	// On open: start from a clean message slate and move focus into the panel
	// so keyboard users land on the search field or first selectable row.
	useEffect(() => {
		if (!input.open) {
			return;
		}
		setErrorMessage(null);
		setSuccessMessage(null);
		setAddQuery("");
		const region = regionRef.current;
		const firstControl =
			region?.querySelector<HTMLInputElement>("input[type='search']") ??
			region?.querySelector<HTMLElement>('[role="checkbox"]');
		firstControl?.focus();
	}, [input.open]);

	// Escape closes the panel while focus is inside it. Captured at the
	// document so it runs before the drawer's own Escape handling, and kept
	// off the panel element itself, which is non-interactive.
	const onOpenChange = input.onOpenChange;
	useEffect(() => {
		if (!input.open) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			const region = regionRef.current;
			if (!region?.contains(document.activeElement)) {
				return;
			}
			event.stopPropagation();
			onOpenChange(false);
			document.getElementById(SPACE_ADD_MEMBERS_TRIGGER_ID)?.focus();
		};
		document.addEventListener("keydown", handleKeyDown, true);
		return () => document.removeEventListener("keydown", handleKeyDown, true);
	}, [input.open, onOpenChange]);
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
	const allCandidates = useMemo(
		() =>
			usesOrganizationDirectory
				? [
						...organizationDirectoryCandidates.memberCandidates,
						...organizationDirectoryCandidates.agentCandidates,
					]
				: personalProfilesPlan.selectableCandidates.map(
						toAddMembersCandidateSummary
					),
		[
			organizationDirectoryCandidates,
			personalProfilesPlan.selectableCandidates,
			usesOrganizationDirectory,
		]
	);
	const normalizedAddQuery = addQuery.trim().toLocaleLowerCase();
	const visibleCandidates = useMemo(
		() =>
			normalizedAddQuery.length === 0
				? allCandidates
				: allCandidates.filter((candidate) =>
						candidate.searchText.includes(normalizedAddQuery)
					),
		[allCandidates, normalizedAddQuery]
	);
	const agentCandidates = useMemo(
		() =>
			visibleCandidates.filter(
				(candidate) => candidate.profileKind === "agent"
			),
		[visibleCandidates]
	);
	const humanCandidates = useMemo(
		() =>
			visibleCandidates.filter(
				(candidate) => candidate.profileKind === "human"
			),
		[visibleCandidates]
	);
	const selectableProfileIds = useMemo(() => {
		return new Set(allCandidates.map((candidate) => candidate.profileId));
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
	const selectedCount = activeSelectedProfileIds.size;
	const canRunAddMutation = usesOrganizationDirectory
		? Boolean(input.onAddOrganizationDirectoryProfiles)
		: Boolean(input.onAddProfiles);
	const canSubmit =
		canRunAddMutation &&
		input.snapshot !== null &&
		selectedCount > 0 &&
		!isSubmitting;

	if (!(input.onAddProfiles || input.onAddOrganizationDirectoryProfiles)) {
		return null;
	}

	const handleSubmit = () => {
		if (!canSubmit) {
			return Promise.resolve();
		}
		const profileIds = [...activeSelectedProfileIds];
		if (input.onConvertDirectMessageToSpace) {
			const selectedNames: string[] = [];
			for (const candidate of allCandidates) {
				if (activeSelectedProfileIds.has(candidate.profileId)) {
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
				input.onOpenChange(false);
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
			input.onOpenChange(false);
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
	const setRegionNode = (node: HTMLDivElement | null) => {
		regionRef.current = node;
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
			if (next.has(profileId)) {
				next.delete(profileId);
			} else {
				next.add(profileId);
			}
			return next;
		});
	};

	return (
		<>
			<SpaceAddProfilesPanel
				addQuery={addQuery}
				agentCandidates={agentCandidates}
				canSubmit={canSubmit}
				directoryHasData={Boolean(directoryQuery.data)}
				directoryIsError={directoryQuery.isError}
				directoryIsPending={directoryQuery.isPending}
				emptyMessage={resolveAddMembersEmptyMessage({
					addQuery,
					organizationDirectoryCandidates,
					organizationName: organization?.name ?? "Organization",
					personalProfilesPlan,
					usesOrganizationDirectory,
				})}
				errorMessage={errorMessage}
				humanCandidates={humanCandidates}
				isSubmitting={isSubmitting}
				onAddQueryChange={setAddQuery}
				onAddSuccess={() => input.onOpenChange(false)}
				onClear={() => {
					setSelectedProfileIds(new Set());
					clearMessages();
				}}
				onRefresh={input.onRefresh}
				onRetryDirectory={() => {
					directoryQuery.refetch().catch((error) => {
						console.error(
							"Failed to reload the Organization Directory.",
							error
						);
					});
				}}
				onSubmit={handleSubmit}
				onSubmitError={(error) =>
					setErrorMessage(formatAddProfilesError(error))
				}
				onToggle={toggleProfile}
				open={input.open}
				organizationName={organization?.name ?? "Organization"}
				orgSlug={input.orgSlug}
				selectedProfileIds={activeSelectedProfileIds}
				setRegionNode={setRegionNode}
				snapshot={input.snapshot}
				spaceId={input.spaceId}
				spaceName={input.spaceName}
				successMessage={successMessage}
				usesOrganizationDirectory={usesOrganizationDirectory}
			/>
			<DirectMessageConversionDialog
				defaultName={conversionRequest?.defaultName ?? ""}
				isPending={isSubmitting}
				onConfirm={handleConfirmConversion}
				onOpenChange={(open) => {
					if (!open) {
						setConversionRequest(null);
					}
				}}
				open={conversionRequest !== null}
				selectedNames={conversionRequest?.selectedNames ?? []}
			/>
		</>
	);
}

type SpaceAddMembersCandidateSummary = {
	description?: string;
	isCenterAgent?: boolean;
	profileId: string;
	profileKind: "agent" | "human";
	profileName: string;
	searchText: string;
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

function SpaceAddProfilesPanel(input: {
	addQuery: string;
	agentCandidates: readonly SpaceAddMembersCandidateSummary[];
	canSubmit: boolean;
	directoryHasData: boolean;
	directoryIsError: boolean;
	directoryIsPending: boolean;
	emptyMessage: string;
	errorMessage: string | null;
	humanCandidates: readonly SpaceAddMembersCandidateSummary[];
	isSubmitting: boolean;
	onAddQueryChange: (query: string) => void;
	onAddSuccess: () => void;
	onClear: () => void;
	onRefresh: (input?: SpaceMembersRefreshInput) => Promise<void>;
	onRetryDirectory: () => void;
	onSubmit: () => Promise<void>;
	onSubmitError: (error: unknown) => void;
	onToggle: (profileId: string) => void;
	open: boolean;
	organizationName: string;
	orgSlug: string;
	setRegionNode: (node: HTMLDivElement | null) => void;
	selectedProfileIds: ReadonlySet<string>;
	snapshot: SpaceMembersSnapshot | null;
	spaceId?: string;
	spaceName?: string | null;
	successMessage: string | null;
	usesOrganizationDirectory: boolean;
}) {
	const { setRegionNode } = input;
	const searchLabel = input.usesOrganizationDirectory
		? "Search members and agents"
		: "Search profiles";
	const description = input.usesOrganizationDirectory
		? `Choose people and agents from ${input.organizationName}.`
		: "Choose profiles to add to this Space.";
	const waitsForDirectory =
		input.usesOrganizationDirectory && !input.directoryHasData;
	const showCandidates = Boolean(
		input.snapshot &&
			(!input.usesOrganizationDirectory || input.directoryHasData)
	);

	return (
		<AnimatePresence initial={false}>
			{input.open ? (
				// The wrapper owns the collapse so the section's full layout
				// footprint reaches exactly zero before unmount: the border lives
				// on the inner section (clipped at height 0 instead of leaving a
				// 2px sliver), the negative bottom margin cancels the parent's
				// gap-4 inside the same spring, and the exit spring drops bounce
				// so AnimatePresence unmounts the moment the value settles.
				<motion.div
					animate={{ height: "auto", marginBottom: "0rem", opacity: 1 }}
					className="overflow-hidden"
					exit={{
						height: 0,
						marginBottom: "-1rem",
						opacity: 0,
						transition: { ...springs.moderate, bounce: 0 },
					}}
					initial={{ height: 0, marginBottom: "-1rem", opacity: 0 }}
					transition={springs.moderate}
				>
					<div
						className="@container rounded-lg border border-border bg-card"
						id={SPACE_ADD_MEMBERS_REGION_ID}
						ref={setRegionNode}
					>
						<div className="flex flex-col gap-3 p-3">
							<div className="flex @min-[20rem]:flex-row flex-col @min-[20rem]:items-start @min-[20rem]:justify-between gap-2">
								<h3 className="font-medium text-sm">Add members</h3>
								{input.spaceId ? (
									<SpaceCreateProfileButton
										className="@min-[20rem]:w-auto w-full"
										label="Create Agent"
										onAfterJoin={async (profile) => {
											input.onAddSuccess();
											await input.onRefresh(
												profile.profileKind === "agent"
													? { agentProfileIds: [profile.openMeldProfileId] }
													: undefined
											);
										}}
										orgSlug={input.orgSlug}
										spaceId={input.spaceId}
										spaceName={input.spaceName ?? null}
									/>
								) : null}
							</div>
							<p className="w-full text-muted-foreground text-xs">
								{description}
							</p>
							<Input
								aria-label={searchLabel}
								autoComplete="off"
								onChange={(event) => input.onAddQueryChange(event.target.value)}
								placeholder={searchLabel}
								type="search"
								value={input.addQuery}
							/>
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
								<SpaceAddMembersCandidates
									agentCandidates={input.agentCandidates}
									emptyMessage={input.emptyMessage}
									humanCandidates={input.humanCandidates}
									humanGroupLabel={
										input.usesOrganizationDirectory ? "Members" : "Humans"
									}
									isSubmitting={input.isSubmitting}
									onToggle={input.onToggle}
									selectedProfileIds={input.selectedProfileIds}
								/>
							) : null}
							<SpaceAddProfilesFooter
								canSubmit={input.canSubmit}
								isSubmitting={input.isSubmitting}
								onClear={input.onClear}
								onSubmit={input.onSubmit}
								onSubmitError={input.onSubmitError}
								selectedCount={input.selectedProfileIds.size}
							/>
						</div>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
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
	agentCandidates: readonly SpaceAddMembersCandidateSummary[];
	emptyMessage: string;
	humanCandidates: readonly SpaceAddMembersCandidateSummary[];
	humanGroupLabel: string;
	isSubmitting: boolean;
	onToggle: (profileId: string) => void;
	selectedProfileIds: ReadonlySet<string>;
}) {
	if (input.agentCandidates.length + input.humanCandidates.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">{input.emptyMessage}</p>
		);
	}

	return (
		<div className="-mx-1 flex max-h-72 flex-col gap-3 overflow-y-auto">
			<SpaceAddMembersCandidateGroup
				candidates={input.agentCandidates}
				isSubmitting={input.isSubmitting}
				label="Agents"
				onToggle={input.onToggle}
				selectedProfileIds={input.selectedProfileIds}
			/>
			<SpaceAddMembersCandidateGroup
				candidates={input.humanCandidates}
				isSubmitting={input.isSubmitting}
				label={input.humanGroupLabel}
				onToggle={input.onToggle}
				selectedProfileIds={input.selectedProfileIds}
			/>
		</div>
	);
}

function SpaceAddMembersCandidateGroup(input: {
	candidates: readonly SpaceAddMembersCandidateSummary[];
	isSubmitting: boolean;
	label: string;
	onToggle: (profileId: string) => void;
	selectedProfileIds: ReadonlySet<string>;
}) {
	if (input.candidates.length === 0) {
		return null;
	}
	const headingId = `space-add-members-group-${input.label.toLowerCase()}`;
	const checkedIndices = new Set<number>();
	for (const [index, candidate] of input.candidates.entries()) {
		if (input.selectedProfileIds.has(candidate.profileId)) {
			checkedIndices.add(index);
		}
	}

	return (
		<div className={cn(input.isSubmitting && "pointer-events-none opacity-70")}>
			<h3
				className="px-3 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider"
				id={headingId}
			>
				{input.label}
			</h3>
			<CheckboxGroup
				aria-labelledby={headingId}
				checkedIndices={checkedIndices}
				className="w-full"
			>
				{input.candidates.map((candidate, index) => (
					<CheckboxItem
						checked={input.selectedProfileIds.has(candidate.profileId)}
						description={candidate.description}
						index={index}
						key={candidate.profileId}
						label={candidate.profileName}
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

type OrganizationDirectoryAddCandidates = {
	agentCandidates: readonly SpaceAddMembersCandidateSummary[];
	alreadyJoinedCount: number;
	memberCandidates: readonly SpaceAddMembersCandidateSummary[];
};

function buildOrganizationDirectoryAddCandidates(input: {
	directory: OrganizationSpaceProfileCandidates | null;
	organizationName: string;
	snapshot: SpaceMembersSnapshot | null;
}): OrganizationDirectoryAddCandidates {
	const joinedProfileIds = new Set([
		...(input.snapshot?.humans.map((member) => member.profileId) ?? []),
		...(input.snapshot?.agents.map((member) => member.profileId) ?? []),
	]);
	const joinedHumanOwnerUserIds = new Set(
		input.snapshot?.humans
			.map((member) => member.ownerUserId?.trim())
			.filter((ownerUserId): ownerUserId is string => Boolean(ownerUserId)) ??
			[]
	);
	let alreadyJoinedCount = 0;
	const memberCandidates = (input.directory?.members ?? []).flatMap(
		(member): readonly SpaceAddMembersCandidateSummary[] => {
			const profile = member.humanProfile;
			if (profile?.status !== "active") {
				return [];
			}
			if (joinedProfileIds.has(profile.profileId)) {
				alreadyJoinedCount += 1;
				return [];
			}
			return [
				{
					description: `@${profile.profileHandle} · ${member.memberName}`,
					profileId: profile.profileId,
					profileKind: "human",
					profileName: profile.profileName,
					searchText: normalizeAddMembersSearchText([
						profile.profileName,
						profile.profileHandle,
						member.memberName,
					]),
				},
			];
		}
	);
	const agentCandidates = (input.directory?.agentProfiles ?? []).flatMap(
		(agent): readonly SpaceAddMembersCandidateSummary[] => {
			if (agent.status !== "active") {
				return [];
			}
			if (joinedProfileIds.has(agent.profileId)) {
				alreadyJoinedCount += 1;
				return [];
			}
			const description = resolveOrganizationAgentDescription({
				isCenterAgent: agent.isCenterAgent === true,
				organizationName: input.organizationName,
				ownerAlreadyJoined: joinedHumanOwnerUserIds.has(agent.ownerUserId),
				ownerName: agent.ownerName,
			});
			return [
				{
					description,
					isCenterAgent: agent.isCenterAgent === true,
					profileId: agent.profileId,
					profileKind: "agent",
					profileName: agent.profileName,
					searchText: normalizeAddMembersSearchText([
						agent.profileName,
						agent.profileHandle,
						agent.ownerName,
						description,
					]),
				},
			];
		}
	);
	return {
		agentCandidates: [...agentCandidates].sort(compareAddMembersCandidates),
		alreadyJoinedCount,
		memberCandidates: [...memberCandidates].sort(compareAddMembersCandidates),
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
		...(ownerName ? { description: `Owned by ${ownerName}` } : {}),
		profileId: candidate.profileId,
		profileKind: candidate.profileKind,
		profileName: candidate.profileName,
		searchText: normalizeAddMembersSearchText([
			candidate.profileName,
			ownerName,
		]),
	};
}

function resolveOrganizationAgentDescription(input: {
	isCenterAgent: boolean;
	organizationName: string;
	ownerAlreadyJoined: boolean;
	ownerName?: string;
}): string {
	if (input.isCenterAgent) {
		return `Center Agent for ${input.organizationName}`;
	}
	if (input.ownerName) {
		return input.ownerAlreadyJoined
			? `Owned by ${input.ownerName}`
			: `${input.ownerName} will join too`;
	}
	return "Organization Agent";
}

function normalizeAddMembersSearchText(
	values: readonly (string | null | undefined)[]
): string {
	return values
		.filter((value): value is string => Boolean(value?.trim()))
		.join(" ")
		.toLocaleLowerCase();
}

function compareAddMembersCandidates(
	left: SpaceAddMembersCandidateSummary,
	right: SpaceAddMembersCandidateSummary
): number {
	if (left.isCenterAgent !== right.isCenterAgent) {
		return left.isCenterAgent ? -1 : 1;
	}
	return left.profileName.localeCompare(right.profileName);
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
	editableAgentProfileIds: ReadonlySet<string>;
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
	onEditAgentProfile?: (profileId: string) => void;
	onRefresh: (input?: SpaceMembersRefreshInput) => Promise<void>;
	onRemoveMember?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	orgSlug: string;
	prepareSetupHref?: string;
	query: string;
	snapshot: SpaceMembersSnapshot | null;
}) {
	const [isRetryPending, setIsRetryPending] = useState(false);
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

	if (input.isLoading && !input.snapshot) {
		return (
			<div className="flex flex-col gap-3">
				{Array.from({ length: 5 }).map((_, index) => (
					<Skeleton
						className="h-14 w-full"
						key={`space-members-drawer-skeleton-${String(index)}`}
					/>
				))}
			</div>
		);
	}

	const shouldShowBlockingError = Boolean(
		input.membersError && !input.snapshot
	);
	const shouldShowRefreshError = Boolean(input.membersError && input.snapshot);

	if (shouldShowBlockingError) {
		return (
			<div className="flex flex-col gap-3 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
				<p>{SPACE_MEMBERS_LOAD_ERROR_MESSAGE}</p>
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
		);
	}

	if (input.filteredDirectory && input.filteredDirectory.sections.length > 0) {
		return (
			<div className="flex flex-col gap-5">
				{shouldShowRefreshError ? (
					<div
						className={cn(
							"rounded-md border p-3 text-sm",
							resolveStatusToneWarningNoticeClassName()
						)}
					>
						{SPACE_MEMBERS_REFRESH_ERROR_MESSAGE}
					</div>
				) : null}
				{input.filteredDirectory.sections.map((section) => (
					<section className="flex flex-col gap-2" key={section.id}>
						<h2 className="font-medium text-muted-foreground text-xs">
							{section.title}
						</h2>
						<div className="flex flex-col">
							{section.entries.map((entry) => {
								const recoveryPlan =
									input.agentRecoveryPlansByProfileId.get(entry.profileId) ??
									null;
								// Display-only Wake smoothing. Skip it while a recovery plan is
								// active so the real recovery state is never masked; terminal
								// offline/unavailable already bypass the debounce upstream.
								const wakeDisplayOverride =
									recoveryPlan && recoveryPlan.kind !== "none"
										? undefined
										: input.displayWakeOverrideByProfileId?.get(
												entry.profileId
											);
								// Project only into the narrow display-only prop. entry stays
								// raw so the details dialog / recovery / Check-again / sorting
								// never see the replayed Available snapshot (Codex M1).
								const wakeDisplayEntry = wakeDisplayOverride
									? applyWakeAvailabilityDisplayOverride(
											entry,
											wakeDisplayOverride
										)
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
										entry={entry}
										isAgentRecoveryPending={input.isAgentRecoveryPending(
											entry.profileId
										)}
										isAgentWakeAvailabilityCheckPending={input.isAgentWakeAvailabilityCheckPending(
											entry.profileId
										)}
										key={entry.id}
										memberTransientState={resolveEntryMemberTransientState({
											activeWakeDisplayTargetProfileIds,
											entry,
											memberTransientStatesByProfileId,
										})}
										modelCatalog={input.modelCatalog}
										onAgentRecoveryAction={input.onAgentRecoveryAction}
										onCheckAgentWakeAvailability={
											input.onCheckAgentWakeAvailability
										}
										onEditAgentProfile={
											input.onEditAgentProfile &&
											input.editableAgentProfileIds.has(entry.profileId)
												? input.onEditAgentProfile
												: undefined
										}
										onRemoveFromSpace={removeMemberAction}
										orgSlug={input.orgSlug}
										prepareSetupHref={input.prepareSetupHref}
										variant="full"
										wakeDisplayEntry={wakeDisplayEntry}
									/>
								);
							})}
						</div>
					</section>
				))}
			</div>
		);
	}

	return (
		<div className="border border-border px-3 py-6 text-center text-muted-foreground text-sm">
			{input.query.trim().length > 0
				? "No matching members found."
				: "No members are visible in this space yet."}
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

function buildRequiredAgentOwnerHumanProfileIds(input: {
	centerAgentProfileId: string | null;
	snapshot: SpaceMembersSnapshot | null;
}): ReadonlySet<string> {
	const requiredOwnerUserIds = new Set(
		(input.snapshot?.agents ?? [])
			.filter(
				(agent) =>
					agent.status === "active" &&
					agent.profileId !== input.centerAgentProfileId
			)
			.map((agent) => agent.ownerUserId?.trim())
			.filter((ownerUserId): ownerUserId is string => Boolean(ownerUserId))
	);
	return new Set(
		(input.snapshot?.humans ?? [])
			.filter(
				(human) =>
					human.status === "active" &&
					Boolean(
						human.ownerUserId &&
							requiredOwnerUserIds.has(human.ownerUserId.trim())
					)
			)
			.map((human) => human.profileId)
	);
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
