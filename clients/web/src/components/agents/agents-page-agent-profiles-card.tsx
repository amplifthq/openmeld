"use client";

import {
	type AgentProfileOperationalContextInput,
	buildProfileDetailsSnapshotFromAuthProfile,
} from "@openmeld/agent-profile";
import {
	type AgentWakeAvailabilityCategory,
	formatModelRetirementNotice,
	getAgentControllerModelCatalogId,
	getAgentControllerPermissionModeDisplayMetadata,
	parseAgentControllerRef,
	resolveAgentControllerPermissionModeForController,
	resolveAgentProfileEditApplicationTiming,
	resolveAgentProfileEditCapabilities,
	resolveAgentWakeAvailabilityDisplayCategory,
	resolveNativeAgentControllerCollaborationModeForController,
} from "@openmeld/agent-runtime";
import {
	isHostedAgentControllerRef,
	resolvePublicAgentFailureRecovery,
} from "@openmeld/schemas";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AgentProfileBindingTarget,
	AgentWakeAvailability,
	AuthProfileView,
	ExecuteAgentProfileWorkRecoveryBody,
	GetAgentExecutionReadinessResponse,
	GetAgentProfilePrimaryBindingResponse,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	ModelCatalog,
	PeopleComputerTarget,
	ProfileDetailsRecoveryAction,
	ProfileDetailsSnapshot,
	ProfileDetailsViewerScope,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { SettingsAddComputerCardContent } from "@openmeld/ui/components/settings-computers";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonForm } from "@openmeld/ui/components/skeleton-content";
import {
	Tooltip,
	TooltipContent,
	TooltipHint,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidContextMenuContent,
	useFluidContextMenuOpen,
} from "@openmeld/ui/fluid/context-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { ADD_CARD_PICKER_CLASS_NAME } from "@openmeld/ui/lib/card-picker-contract";
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	BrainIcon,
	ChatCircleTextIcon,
	DesktopTowerIcon,
	DotsThreeIcon,
	FolderOpenIcon,
	HandIcon,
	InfoIcon,
	LockKeyIcon,
	RobotIcon,
	TrashIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	type ReactNode,
	type Ref,
	useEffect,
	useId,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	invalidateAgentProfileListCaches,
	optimisticallyRemoveAgentProfileFromListCaches,
	restoreAgentProfileListCaches,
} from "#/components/agents/agent-profile-delete-cache";
import {
	type AgentProfileControllerChangeOption,
	type AgentProfileControllerCollaborationModeEditState,
	type AgentProfileControllerPermissionModeEditState,
	type AgentProfileEditState,
	type AgentProfileModelSelectionEditState,
	type AgentProfileOpenCodePermissionEditState,
	resolveAgentProfileControllerChangeOptions,
	resolveAgentProfileEditState,
	resolveLocalAgentEntryControllerRef,
} from "#/components/agents/agent-profile-edit-state";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { ObjectMenuItems } from "#/components/app/object-menu-items";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
	DirectoryOwnerGroup,
} from "#/components/directory/directory-card-grid";
import {
	MemberAgentHarnessLock,
	useMemberAgentHarnessLocked,
	useMemberAgentProfileNameLocked,
} from "#/components/member-agents/member-agent-harness-lock";
import { useMemberAgentIndex } from "#/components/member-agents/use-member-agents";
import {
	AgentConfigurationCard,
	AgentConfigurationEditorCard,
	AgentConfigurationGrid,
} from "#/components/profiles/agent-configuration-card";
import {
	AgentControllerPermissionModeOutcome,
	getAgentControllerPermissionModeOutcomeDescriptionId,
} from "#/components/profiles/agent-controller-permission-mode-outcome";
import { AgentProfileFoldersDialog } from "#/components/profiles/agent-profile-folders-dialog";
import { shouldShowAgentProfileProjectSettings } from "#/components/profiles/agent-profile-project-settings";
import { AgentProfileUsage } from "#/components/profiles/agent-profile-usage";
import { AgentProfileWorkingFolderRecoveryAction } from "#/components/profiles/agent-profile-working-folder-recovery-action";
import {
	type AgentProfileModelCompatibilityContext,
	AgentProfileModelSelectionFields,
} from "#/components/profiles/create-profile-form";
import { resolveModelRetirementDisplay } from "#/components/profiles/create-profile-form-logic";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import {
	formatOpenCodePermissionJson,
	isOpenCodeAgentControllerRef,
	OpenCodePermissionsField,
	openCodePermissionEquals,
} from "#/components/profiles/open-code-permissions-field";
import { AgentProfileMoreDetailsDialog } from "#/components/profiles/profile-details-dialog";
import { ProfileCard } from "#/components/profiles/profile-list-item";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentActivitySessionsPath,
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationDirectMessagePath,
} from "#/lib/organizations/organization-routes";
import { buildAgentProfilePath } from "#/lib/profile-routes";
import { resolveWebAgentControllerPermissionModeDisplayFromBinding } from "#/lib/profiles/agent-controller-permission-mode-display";
import {
	resolveAgentProfileControllerModelDetail,
	resolveAgentProfileModelCardValue,
} from "#/lib/profiles/agent-profile-model-display";
import {
	disableAgentProfilePrimaryBinding,
	projectAgentProfileBindingTarget,
} from "#/lib/profiles/agent-profile-primary-binding";
import { executeAgentProfileWorkRecovery } from "#/lib/profiles/agent-profile-work-recovery";
import { deleteStartAgentProfile } from "#/lib/profiles/delete-agent-profile";
import { resolveProfileBindingCatalogExecutionTarget } from "#/lib/profiles/profile-binding-target";
import { formatProfileDate } from "#/lib/profiles/profile-date-format";
import { buildComputerSettingsPath } from "#/lib/settings-routes";
import { isAgentExecutionSelfHealingReadiness } from "#/lib/spaces/agent-route-status";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { readRememberedChatOrNull } from "#/lib/spaces/use-open-direct-message";
import {
	refreshWebAgentReadinessFacts,
	refreshWebAgentReadinessSharedCaches,
} from "#/query/agents/execution-readiness";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import { agentActivitySessionsQueryOptions } from "#/query/organizations/agent-activity";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { projectsQueryOptions } from "#/query/organizations/projects";
import {
	agentProfileControllerChangeEligibilityQueryOptions,
	agentProfilePrimaryBindingQueryKeys,
} from "#/query/profiles/primary-binding";
import {
	agentProfileWorkingFolderQueryOptions,
	describeSavedWorkingFolder,
} from "#/query/profiles/working-folder";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { AGENT_PROFILE_ROUTE_REFRESH_WINDOW_MS } from "#/strategy-constants";
import type { AgentProfileActivityNavigation } from "./agent-profile-activity-preview";
import {
	refreshSavedAgentProfileConnections,
	saveAgentProfileConnection,
} from "./agent-profile-connection-recovery";
import {
	type AgentProfileControllerChangeUpdate,
	type AgentProfileEditActionContext,
	type AgentProfileModelSelectionUpdate,
	changeAgentProfileController,
	formatAgentProfileRuntimeSettingsSavedMessage,
	invalidateAgentProfilePrimaryBindingEditQueries,
	renameAgentProfile,
	updateAgentProfileControllerCollaborationMode,
	updateAgentProfileControllerPermissionMode,
	updateAgentProfileListCaches,
	updateAgentProfileModelSelection,
	updateAgentProfileOpenCodePermission,
} from "./agent-profile-edit-actions";
import { AgentConfigurationSkeletonCard } from "./agent-profile-skeleton";
import { AgentProfileWorkspaceDetail } from "./agent-profile-workspace-detail";
import {
	type AgentProfileAvailabilityFilter,
	type AgentProfileRepairAction,
	type AgentProfileSetupAction,
	type AgentProfileVisualTone,
	buildAgentProfileRepairActionKey,
	buildDuplicateConversationProfileNamesByProfileId,
	canManuallyRefreshAgentProfileConnection,
	formatAgentProfileExecutionComputerDetail,
	formatAgentWakeAvailabilityCheckedAt,
	hasAgentExecutionReason,
	isAgentExecutionDisplayProjectionRefreshing,
	isAgentExecutionSelfHealing,
	isCurrentRuntimeServiceProjectionRefreshing,
	replaceSetIfChanged,
	resolveAgentExecutionRuntimeDeviceLabel,
	resolveAgentProfileAutoRefreshDelayMs,
	resolveAgentProfileAvailabilityFilterState,
	resolveAgentProfileAvailabilityTone,
	resolveAgentProfileIconAgentId,
	resolveAgentProfileLocalAgentEntry,
	resolveAgentProfileRepairActions,
	resolveAgentProfileRowWakeAvailability,
	resolveAgentProfileSetupAction,
	resolveAutoRefreshingAgentProfileIds,
	resolveCurrentLocalAgentCatalogEntries,
	resolveFocusedAgentProfileClassName,
	sortAgentProfilesForDisplay,
} from "./agents-page-agent-profile-helpers";
import {
	formatListForSentence,
	formatMutationError,
	isAgentProfileAlreadyRemovedError,
	isAgentProfileWorkAwaitingOriginalStopError,
} from "./agents-page-formatters";
import { useAgentWakeAvailabilityDisplayDebounce } from "./use-agent-wake-availability-display-debounce";

const AGENT_PROFILE_CHANGE_TIMING_SUMMARY =
	"Saved changes are used for future Wakes. Some controllers can also apply Permission Mode changes to a Wake already in progress; the field explains when.";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;
type DeviceAgentCatalog = LocalRuntimeExecutionTarget["localAgentCatalog"];
type DeviceAgentCatalogEntry = DeviceAgentCatalog["entries"][number];
type PrimaryBindingDisplayState = {
	bindingByProfileId: ReadonlyMap<
		string,
		NonNullable<GetAgentExecutionReadinessResponse["primaryBinding"]>
	>;
	storageScope: string;
};

function resolveProfileDetailsViewerScope(
	canManage: boolean
): ProfileDetailsViewerScope {
	return canManage ? "owner_self" : "observer";
}

function formatAgentProfileWorkRecoverySuccess(
	recoveryAction: ProfileDetailsRecoveryAction,
	profileName: string
): string {
	switch (recoveryAction.kind) {
		case "continue_interrupted_work":
			return `Continuing ${profileName}'s interrupted work.`;
		case "approve_queued_work":
			return `Starting ${profileName}'s queued work.`;
		case "skip_interrupted_work":
			return `Skipped ${profileName}'s interrupted work.`;
		case "fork_interrupted_work":
			return `Continuing ${profileName}'s work on a new branch of the conversation.`;
		default:
			return assertNeverProfileDetailsRecoveryActionKind(recoveryAction.kind);
	}
}

function formatAgentProfileWorkRecoveryFailureAction(
	recoveryAction: ProfileDetailsRecoveryAction
): string {
	switch (recoveryAction.kind) {
		case "continue_interrupted_work":
			return "continue the interrupted work";
		case "approve_queued_work":
			return "start the queued work";
		case "skip_interrupted_work":
			return "skip the interrupted work";
		case "fork_interrupted_work":
			return "continue the work on a new branch";
		default:
			return assertNeverProfileDetailsRecoveryActionKind(recoveryAction.kind);
	}
}

function assertNeverProfileDetailsRecoveryActionKind(value: never): never {
	throw new Error(
		`Unsupported Agent Profile recovery action: ${String(value)}`
	);
}

export type {
	AgentProfileControllerChangeUpdate,
	AgentProfileModelSelectionUpdate,
} from "./agent-profile-edit-actions";

type AgentProfileEditDraft = {
	confirmed: boolean;
	key: string;
	profileName: string;
	selectedAgentControllerRef: string | null;
	selectedCollaborationMode: AgentControllerCollaborationMode | null;
	selectedModelId: string;
	selectedOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	selectedPolicy: AgentControllerPermissionMode | null;
	selectedReasoningLevel: string;
};
type CreateAgentProfileEditDraftInput = {
	currentCollaborationMode: AgentControllerCollaborationMode | null;
	currentModelId: string;
	currentOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	currentPermissionMode: AgentControllerPermissionMode | null;
	currentReasoningLevel: string;
	draftKey: string;
	profileName: string;
};
type AgentProfileEditDialogState = {
	collaborationModeChanged: boolean;
	controllerChanged: boolean;
	hasChanges: boolean;
	normalizedDraftProfileName: string;
	permissionModeChanged: boolean;
	permissionModeState: ReturnType<
		typeof resolveAgentProfileEditPermissionModeState
	>;
	openCodePermissionChanged: boolean;
	profileNameChanged: boolean;
	profileNameIsValid: boolean;
	saveButtonDisabled: boolean;
	saveControllerRef: string | null;
	saveModelId: string | null;
	saveOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	selectedCollaborationMode: AgentControllerCollaborationMode | null;
	selectedPolicy: AgentControllerPermissionMode | null;
	selectedReasoningLevel: string;
	modelSelectionChanged: boolean;
};
const EMPTY_PRIMARY_BINDING_BY_PROFILE_ID: ReadonlyMap<
	string,
	NonNullable<GetAgentExecutionReadinessResponse["primaryBinding"]>
> = new Map();
const EMPTY_AGENT_PROFILE_OPERATIONAL_CONTEXT_BY_PROFILE_ID: ReadonlyMap<
	string,
	AgentProfileOperationalContextInput
> = new Map();
const AGENT_PROFILE_ROW_SKELETON_IDS = [
	"first",
	"second",
	"third",
	"fourth",
] as const;
const PROFILE_FOOTER_TRAILING_PERIOD_PATTERN = /\.$/;

function pruneInactiveProfileIds(
	profileIds: Iterable<string>,
	activeProfileIds: readonly string[],
	deleteProfileId: (profileId: string) => void
) {
	const activeProfileIdSet = new Set(activeProfileIds);
	for (const profileId of [...profileIds]) {
		if (!activeProfileIdSet.has(profileId)) {
			deleteProfileId(profileId);
		}
	}
}

export type AgentProfilesCardProps = {
	agentControllerRefByProfileId?: ReadonlyMap<string, string | null>;
	availabilityFilter: AgentProfileAvailabilityFilter;
	agentProfileActivityNavigationByProfileId?: ReadonlyMap<
		string,
		AgentProfileActivityNavigation
	>;
	agentProfileOperationalContextByProfileId?: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	agentExecutionReadinessByProfileId?: ReadonlyMap<
		string,
		GetAgentExecutionReadinessResponse
	>;
	agentExecutionReadinessErrorByProfileId?: ReadonlyMap<string, string>;
	agentExecutionReadinessIsRefreshing?: boolean;
	agentExecutionReadinessPendingProfileIds?: ReadonlySet<string>;
	agentProfiles?: readonly AuthProfileView[];
	agentProfilesQueryState?: {
		isError: boolean;
		isPending: boolean;
	};
	canManageProfile?: (profile: AuthProfileView) => boolean;
	fallbackOwnerLabel?: string;
	focusProfileId: string | null;
	isCurrentComputer: boolean;
	ownerAvatarUrlByUserId?: ReadonlyMap<string, string | null>;
	onCreateProfile?: () => void;
	onFocusProfileConsumed?: () => void;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	presentation?: "cards" | "controller" | "detail";
	queryClient: QueryClient;
	recovery: AgentsPageController;
	serviceUpdatePath: string;
	showOwnerGroups?: boolean;
	setupPath: string;
	wakeAvailabilityNowMs: number;
};

export function AgentProfilesCard(input: AgentProfilesCardProps) {
	const controller = useAgentProfilesCardController(input);
	return <AgentProfilesCardView controller={controller} input={input} />;
}

function useAgentProfilesCardController(input: AgentProfilesCardProps) {
	const navigate = useNavigate();
	const { currentOrganization } = useAppOrganization();
	const defaultHumanProfileId =
		useMemberAgentIndex().humanProfileId ?? undefined;
	const agentProfiles = input.agentProfiles ?? input.recovery.agentProfiles;
	const agentProfileOperationalContextByProfileId =
		input.agentProfileOperationalContextByProfileId ??
		EMPTY_AGENT_PROFILE_OPERATIONAL_CONTEXT_BY_PROFILE_ID;
	const agentExecutionReadinessByProfileId =
		input.agentExecutionReadinessByProfileId ??
		input.recovery.agentExecutionReadinessByProfileId;
	const agentExecutionReadinessErrorByProfileId =
		input.agentExecutionReadinessErrorByProfileId ??
		input.recovery.agentExecutionReadinessErrorByProfileId;
	const agentExecutionReadinessPendingProfileIds =
		input.agentExecutionReadinessPendingProfileIds ??
		input.recovery.agentExecutionReadinessPendingProfileIds;
	const agentProfilesQueryState =
		input.agentProfilesQueryState ?? input.recovery.agentProfilesQuery;
	const wakeAvailabilityDisplayInputs = useMemo(
		() =>
			agentProfiles.map((profile) => ({
				agentWakeAvailability:
					agentExecutionReadinessByProfileId.get(profile.openMeldProfileId)
						?.agentWakeAvailability ?? null,
				profileId: profile.openMeldProfileId,
			})),
		[agentExecutionReadinessByProfileId, agentProfiles]
	);
	const wakeAvailabilityDisplayOverrideByProfileId =
		useAgentWakeAvailabilityDisplayDebounce(wakeAvailabilityDisplayInputs);
	const canManageProfile = input.canManageProfile ?? (() => true);
	const [pendingRemoveProfileId, setPendingRemoveProfileId] = useState<
		string | null
	>(null);
	const sortedAgentProfiles = useMemo(
		() =>
			sortAgentProfilesForDisplay({
				profiles: agentProfiles,
				readinessByProfileId: agentExecutionReadinessByProfileId,
			}),
		[agentExecutionReadinessByProfileId, agentProfiles]
	);
	const visibleAgentProfiles = useMemo(() => {
		return sortedAgentProfiles.filter((profile) => {
			if (profile.openMeldProfileId === pendingRemoveProfileId) {
				return false;
			}
			if (input.availabilityFilter === "all") {
				return true;
			}
			return (
				resolveAgentProfileAvailabilityFilterState({
					errorByProfileId: agentExecutionReadinessErrorByProfileId,
					pendingProfileIds: agentExecutionReadinessPendingProfileIds,
					profileId: profile.openMeldProfileId,
					readinessByProfileId: agentExecutionReadinessByProfileId,
				}) === input.availabilityFilter
			);
		});
	}, [
		agentExecutionReadinessByProfileId,
		agentExecutionReadinessErrorByProfileId,
		agentExecutionReadinessPendingProfileIds,
		input.availabilityFilter,
		pendingRemoveProfileId,
		sortedAgentProfiles,
	]);
	const visibleAgentProfileGroups = useMemo(
		() =>
			groupAgentProfilesByOwner({
				fallbackOwnerLabel: input.fallbackOwnerLabel ?? "This member",
				profiles: visibleAgentProfiles,
			}),
		[input.fallbackOwnerLabel, visibleAgentProfiles]
	);
	const [pendingRepairProfileIds, setPendingRepairProfileIds] = useState<
		ReadonlySet<string>
	>(new Set());
	const [pendingCheckProfileId, setPendingCheckProfileId] = useState<
		string | null
	>(null);
	const [
		pendingDisablePrimaryBindingProfileId,
		setPendingDisablePrimaryBindingProfileId,
	] = useState<string | null>(null);
	const [pendingRenameProfileId, setPendingRenameProfileId] = useState<
		string | null
	>(null);
	const [pendingDirectMessageProfileId, setPendingDirectMessageProfileId] =
		useState<string | null>(null);
	const [pendingRecoveryActionProfileId, setPendingRecoveryActionProfileId] =
		useState<string | null>(null);
	const [
		pendingControllerPermissionModeProfileId,
		setPendingControllerPermissionModeProfileId,
	] = useState<string | null>(null);
	const [
		pendingControllerCollaborationModeProfileId,
		setPendingControllerCollaborationModeProfileId,
	] = useState<string | null>(null);
	const [
		pendingControllerChangeProfileId,
		setPendingControllerChangeProfileId,
	] = useState<string | null>(null);
	const [pendingModelSelectionProfileId, setPendingModelSelectionProfileId] =
		useState<string | null>(null);
	const [
		pendingOpenCodePermissionProfileId,
		setPendingOpenCodePermissionProfileId,
	] = useState<string | null>(null);
	const [autoRefreshExhaustedProfileIds, setAutoRefreshExhaustedProfileIds] =
		useState<ReadonlySet<string>>(() => new Set());
	const localAgentCatalogEntries = resolveCurrentLocalAgentCatalogEntries(
		input.recovery
	);
	const bindingCatalogExecutionTarget =
		resolveProfileBindingCatalogExecutionTarget(input.recovery);
	const controllerChangeOptions = resolveAgentProfileControllerChangeOptions(
		bindingCatalogExecutionTarget
	);
	const currentLocalRuntimeReplyReadiness =
		input.recovery.currentLocalRuntimeReplyReadinessQuery.data ?? null;
	const currentLocalRuntimeCanReply =
		currentLocalRuntimeReplyReadiness?.canReplyFromThisComputer ?? null;
	const autoRefreshingProfileIds = useMemo(
		() =>
			resolveAutoRefreshingAgentProfileIds({
				profiles: sortedAgentProfiles,
				readinessByProfileId: agentExecutionReadinessByProfileId,
				currentLocalRuntimeCanReply,
			}),
		[
			agentExecutionReadinessByProfileId,
			currentLocalRuntimeCanReply,
			sortedAgentProfiles,
		]
	);
	const duplicateConversationProfileNamesByProfileId = useMemo(
		() =>
			buildDuplicateConversationProfileNamesByProfileId({
				profiles: sortedAgentProfiles,
				readinessByProfileId: agentExecutionReadinessByProfileId,
			}),
		[agentExecutionReadinessByProfileId, sortedAgentProfiles]
	);
	const autoRefreshingProfileKey = autoRefreshingProfileIds.join("|");
	const autoRefreshingProfileStateKey = useMemo(
		() =>
			autoRefreshingProfileIds
				.map((profileId) => {
					const readiness = agentExecutionReadinessByProfileId.get(profileId);
					const executionReadiness = readiness?.agentExecutionReadiness;
					const wakeAvailability = readiness?.agentWakeAvailability;
					return [
						profileId,
						executionReadiness?.displayState ?? "missing",
						executionReadiness?.primaryAction ?? "missing",
						executionReadiness?.reasonCodes.join(",") ?? "",
						wakeAvailability?.status ?? "missing",
						wakeAvailability?.reasonCode ?? "",
					].join(":");
				})
				.join("|"),
		[agentExecutionReadinessByProfileId, autoRefreshingProfileIds]
	);
	const autoRefreshAttemptsRef = useRef(new Map<string, number>());
	const autoRefreshStartedAtMsRef = useRef(new Map<string, number>());
	const routeCatalogSyncProfileIdsRef = useRef(new Set<string>());
	const previousAutoRefreshingProfileStateKeyRef = useRef("");
	const consumedFocusProfileIdRef = useRef<string | null>(null);
	const profileRowElementsRef = useRef(new Map<string, HTMLElement>());
	const readinessByProfileIdRef = useRef(agentExecutionReadinessByProfileId);
	const highlightedProfileId =
		input.focusProfileId ?? consumedFocusProfileIdRef.current;
	const [primaryBindingDisplayState, setPrimaryBindingDisplayState] =
		useState<PrimaryBindingDisplayState>(() => ({
			bindingByProfileId: new Map(),
			storageScope: input.recovery.storageScope,
		}));
	const [modelCatalog, setModelCatalog] = useState<ModelCatalog | null>(null);
	const readinessPrimaryBindingByProfileId = useMemo(() => {
		const next = new Map<
			string,
			NonNullable<GetAgentExecutionReadinessResponse["primaryBinding"]>
		>();
		for (const profile of sortedAgentProfiles) {
			const readiness = agentExecutionReadinessByProfileId.get(
				profile.openMeldProfileId
			);
			const binding = readiness?.primaryBinding ?? null;
			if (binding) {
				// Readiness carries collaboration mode in its public configuration,
				// not in the compact primaryBinding projection.
				next.set(profile.openMeldProfileId, {
					...binding,
					...(readiness?.publicProfileConfiguration
						? {
								agentControllerCollaborationMode:
									readiness.publicProfileConfiguration
										.agentControllerCollaborationMode ?? undefined,
							}
						: {}),
				});
			}
		}
		return next;
	}, [agentExecutionReadinessByProfileId, sortedAgentProfiles]);
	const primaryBindingByProfileId = useMemo(() => {
		const next = new Map(readinessPrimaryBindingByProfileId);
		if (
			primaryBindingDisplayState.storageScope !== input.recovery.storageScope
		) {
			return next;
		}
		for (const [
			profileId,
			binding,
		] of primaryBindingDisplayState.bindingByProfileId) {
			next.set(profileId, binding);
		}
		return next;
	}, [
		input.recovery.storageScope,
		primaryBindingDisplayState,
		readinessPrimaryBindingByProfileId,
	]);

	useEffect(() => {
		readinessByProfileIdRef.current = agentExecutionReadinessByProfileId;
	}, [agentExecutionReadinessByProfileId]);

	useEffect(() => {
		let isStale = false;
		input.queryClient
			.fetchQuery(modelCatalogQueryOptions())
			.then((catalog) => {
				if (!isStale) {
					setModelCatalog(catalog);
				}
			})
			.catch((error: unknown) => {
				console.error("Failed to load model catalog for display.", error);
			});
		return () => {
			isStale = true;
		};
	}, [input.queryClient]);

	useEffect(() => {
		if (!input.focusProfileId) {
			return;
		}
		if (consumedFocusProfileIdRef.current === input.focusProfileId) {
			return;
		}
		if (
			!sortedAgentProfiles.some(
				(profile) => profile.openMeldProfileId === input.focusProfileId
			)
		) {
			return;
		}
		const focusedRow = profileRowElementsRef.current.get(input.focusProfileId);
		if (!focusedRow) {
			return;
		}
		if (typeof focusedRow.scrollIntoView !== "function") {
			return;
		}
		consumedFocusProfileIdRef.current = input.focusProfileId;
		focusedRow.scrollIntoView({
			behavior: "smooth",
			block: "center",
		});
		input.onFocusProfileConsumed?.();
	}, [input.focusProfileId, input.onFocusProfileConsumed, sortedAgentProfiles]);

	useEffect(() => {
		if (autoRefreshingProfileKey.length === 0) {
			autoRefreshAttemptsRef.current.clear();
			autoRefreshStartedAtMsRef.current.clear();
			routeCatalogSyncProfileIdsRef.current.clear();
			previousAutoRefreshingProfileStateKeyRef.current = "";
			setAutoRefreshExhaustedProfileIds((current) =>
				current.size === 0 ? current : new Set()
			);
			return;
		}
		if (
			previousAutoRefreshingProfileStateKeyRef.current !==
			autoRefreshingProfileStateKey
		) {
			autoRefreshAttemptsRef.current.clear();
			autoRefreshStartedAtMsRef.current.clear();
			routeCatalogSyncProfileIdsRef.current.clear();
			previousAutoRefreshingProfileStateKeyRef.current =
				autoRefreshingProfileStateKey;
			setAutoRefreshExhaustedProfileIds((current) =>
				current.size === 0 ? current : new Set()
			);
		}

		const activeProfileIds = autoRefreshingProfileKey.split("|");
		pruneInactiveProfileIds(
			autoRefreshAttemptsRef.current.keys(),
			activeProfileIds,
			(profileId) => autoRefreshAttemptsRef.current.delete(profileId)
		);
		pruneInactiveProfileIds(
			autoRefreshStartedAtMsRef.current.keys(),
			activeProfileIds,
			(profileId) => autoRefreshStartedAtMsRef.current.delete(profileId)
		);
		pruneInactiveProfileIds(
			routeCatalogSyncProfileIdsRef.current,
			activeProfileIds,
			(profileId) => routeCatalogSyncProfileIdsRef.current.delete(profileId)
		);

		let timeoutId: number | null = null;
		let disposed = false;

		const scheduleNextAutoRefresh = () => {
			if (disposed || document.hidden) {
				return;
			}
			const nextAttempt = activeProfileIds.reduce(
				(minimumAttempt, profileId) => {
					const attempts = autoRefreshAttemptsRef.current.get(profileId) ?? 0;
					return Math.min(minimumAttempt, attempts + 1);
				},
				Number.POSITIVE_INFINITY
			);
			const delayMs = resolveAgentProfileAutoRefreshDelayMs(
				Number.isFinite(nextAttempt) ? nextAttempt : 1
			);
			timeoutId = window.setTimeout(() => {
				runAutoRefresh()
					.catch((error: unknown) => {
						console.error(
							"Failed to refresh Agent Profile Wake availability.",
							error
						);
					})
					.finally(scheduleNextAutoRefresh);
			}, delayMs);
		};

		const runAutoRefresh = async () => {
			const profileIdsToRefresh = activeProfileIds.filter((profileId) => {
				const startedAtMs = autoRefreshStartedAtMsRef.current.get(profileId);
				return (
					startedAtMs === undefined ||
					Date.now() - startedAtMs < AGENT_PROFILE_ROUTE_REFRESH_WINDOW_MS
				);
			});
			const exhaustedProfileIds = activeProfileIds.filter((profileId) => {
				const startedAtMs = autoRefreshStartedAtMsRef.current.get(profileId);
				return (
					startedAtMs !== undefined &&
					Date.now() - startedAtMs >= AGENT_PROFILE_ROUTE_REFRESH_WINDOW_MS
				);
			});
			setAutoRefreshExhaustedProfileIds((current) =>
				replaceSetIfChanged(current, exhaustedProfileIds)
			);
			if (profileIdsToRefresh.length === 0) {
				return;
			}

			for (const profileId of profileIdsToRefresh) {
				const attempts = autoRefreshAttemptsRef.current.get(profileId) ?? 0;
				autoRefreshAttemptsRef.current.set(profileId, attempts + 1);
				if (!autoRefreshStartedAtMsRef.current.has(profileId)) {
					autoRefreshStartedAtMsRef.current.set(profileId, Date.now());
				}
			}

			const profileIdsNeedingRouteRefresh = profileIdsToRefresh.filter(
				(profileId) =>
					!routeCatalogSyncProfileIdsRef.current.has(profileId) &&
					isAgentExecutionSelfHealing(
						readinessByProfileIdRef.current.get(profileId) ?? null
					)
			);
			for (const profileId of profileIdsNeedingRouteRefresh) {
				routeCatalogSyncProfileIdsRef.current.add(profileId);
			}
			if (profileIdsNeedingRouteRefresh.length > 0) {
				await refreshWebAgentReadinessFacts({
					agentProfileIds: profileIdsNeedingRouteRefresh,
					includeLocalRuntimeCaches: false,
					organizationId: currentOrganization.id,
					queryClient: input.queryClient,
					storageScope: input.recovery.storageScope,
				});
			}
			await refreshWebAgentReadinessSharedCaches({
				agentProfileIds: profileIdsToRefresh,
				includeLocalRuntimeCaches: false,
				organizationId: currentOrganization.id,
				queryClient: input.queryClient,
				storageScope: input.recovery.storageScope,
			});
		};

		const handleVisibilityChange = () => {
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
				timeoutId = null;
			}
			if (document.hidden) {
				return;
			}
			runAutoRefresh()
				.catch((error: unknown) => {
					console.error(
						"Failed to refresh Agent Profile Wake availability.",
						error
					);
				})
				.finally(scheduleNextAutoRefresh);
		};

		if (!document.hidden) {
			runAutoRefresh()
				.catch((error: unknown) => {
					console.error(
						"Failed to refresh Agent Profile Wake availability.",
						error
					);
				})
				.finally(scheduleNextAutoRefresh);
		}
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			disposed = true;
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
			}
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [
		autoRefreshingProfileKey,
		autoRefreshingProfileStateKey,
		currentOrganization.id,
		input.queryClient,
		input.recovery.storageScope,
	]);

	const saveProfileConnection = async (
		profile: AuthProfileView,
		action: AgentProfileRepairAction
	) =>
		await saveAgentProfileConnection({
			action,
			actorProfileId: input.recovery.selectedHumanProfileId,
			deviceId: input.recovery.deviceId,
			organizationId: currentOrganization.id,
			profile,
			runtimeLane: input.recovery.runtimeLane,
		});

	const refreshProfileConnections = async (profileIds: readonly string[]) =>
		await refreshSavedAgentProfileConnections({
			onPrimaryBinding: (profileId, binding) => {
				setPrimaryBindingDisplayState((current) => {
					const currentBindingByProfileId =
						current.storageScope === input.recovery.storageScope
							? current.bindingByProfileId
							: EMPTY_PRIMARY_BINDING_BY_PROFILE_ID;
					const next = new Map(currentBindingByProfileId);
					next.set(profileId, binding);
					return {
						bindingByProfileId: next,
						storageScope: input.recovery.storageScope,
					};
				});
			},
			profileIds,
			organizationId: currentOrganization.id,
			queryClient: input.queryClient,
			storageScope: input.recovery.storageScope,
		});

	const handleConnectProfileToComputer = async (
		profile: AuthProfileView,
		action: AgentProfileRepairAction
	) => {
		setPendingRepairProfileIds(
			(current) => new Set([...current, profile.openMeldProfileId])
		);
		try {
			await saveProfileConnection(profile, action);
			try {
				await refreshProfileConnections([profile.openMeldProfileId]);
			} catch (refreshError) {
				console.error(
					"Agent Profile connection was saved, but its status refresh failed.",
					refreshError
				);
				toast.warning(
					`${profile.profileName} was connected, but OpenMeld could not refresh its status. Refresh this page to check it again.`
				);
				return;
			}
			toast.success(
				`Local agent connection saved for ${profile.profileName}. OpenMeld is checking whether it can reply from this computer.`
			);
		} catch (error) {
			toast.error(
				formatMutationError(
					error,
					`OpenMeld could not connect ${profile.profileName} to this computer.`
				)
			);
		} finally {
			setPendingRepairProfileIds((current) => {
				if (!current.has(profile.openMeldProfileId)) {
					return current;
				}
				const next = new Set(current);
				next.delete(profile.openMeldProfileId);
				return next;
			});
		}
	};

	const createAgentProfileEditActionContext = (
		profile: AuthProfileView
	): AgentProfileEditActionContext => ({
		actorProfileId: input.recovery.selectedHumanProfileId,
		deviceId: input.recovery.deviceId,
		executionTarget: bindingCatalogExecutionTarget,
		onBindingUpdated: (binding) => {
			setPrimaryBindingDisplayState((current) => {
				const currentBindingByProfileId =
					current.storageScope === input.recovery.storageScope
						? current.bindingByProfileId
						: EMPTY_PRIMARY_BINDING_BY_PROFILE_ID;
				const next = new Map(currentBindingByProfileId);
				next.set(profile.openMeldProfileId, binding);
				return {
					bindingByProfileId: next,
					storageScope: input.recovery.storageScope,
				};
			});
		},
		profile,
		queryClient: input.queryClient,
		organizationId: currentOrganization.id,
		runtimeLane: input.recovery.runtimeLane,
		storageScope: input.recovery.storageScope,
	});
	const handleChangeProfileController = async (
		profile: AuthProfileView,
		update: AgentProfileControllerChangeUpdate
	) => {
		setPendingControllerChangeProfileId(profile.openMeldProfileId);
		let updateError: unknown = null;
		try {
			await changeAgentProfileController({
				context: createAgentProfileEditActionContext(profile),
				update,
			});
			toast.success(
				formatAgentProfileRuntimeSettingsSavedMessage(profile.profileName)
			);
		} catch (error) {
			updateError = error;
		} finally {
			setPendingControllerChangeProfileId(null);
		}
		if (updateError) {
			toast.error(
				formatMutationError(
					updateError,
					`OpenMeld could not change the controller for ${profile.profileName}.`
				)
			);
			return Promise.reject(updateError);
		}
	};
	const handleUpdateProfileControllerCollaborationMode = async (
		profile: AuthProfileView,
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) => {
		setPendingControllerCollaborationModeProfileId(profile.openMeldProfileId);
		let updateError: unknown = null;
		try {
			await updateAgentProfileControllerCollaborationMode({
				agentControllerCollaborationMode,
				context: createAgentProfileEditActionContext(profile),
			});
			toast.success(
				formatAgentProfileRuntimeSettingsSavedMessage(profile.profileName)
			);
		} catch (error) {
			updateError = error;
		} finally {
			setPendingControllerCollaborationModeProfileId(null);
		}
		if (updateError) {
			toast.error(
				formatMutationError(
					updateError,
					`OpenMeld could not update ${profile.profileName}.`
				)
			);
			return Promise.reject(updateError);
		}
	};
	const handleUpdateProfileControllerPermissionMode = async (
		profile: AuthProfileView,
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => {
		setPendingControllerPermissionModeProfileId(profile.openMeldProfileId);
		let updateError: unknown = null;
		try {
			await updateAgentProfileControllerPermissionMode({
				agentControllerPermissionMode,
				context: createAgentProfileEditActionContext(profile),
			});
			toast.success(
				formatAgentProfileRuntimeSettingsSavedMessage(profile.profileName)
			);
		} catch (error) {
			updateError = error;
		} finally {
			setPendingControllerPermissionModeProfileId(null);
		}
		if (updateError) {
			toast.error(
				formatMutationError(
					updateError,
					`OpenMeld could not update ${profile.profileName}.`
				)
			);
			return Promise.reject(updateError);
		}
	};
	const handleUpdateProfileModelSelection = async (
		profile: AuthProfileView,
		modelSelection: AgentProfileModelSelectionUpdate
	) => {
		setPendingModelSelectionProfileId(profile.openMeldProfileId);
		let updateError: unknown = null;
		try {
			await updateAgentProfileModelSelection({
				context: createAgentProfileEditActionContext(profile),
				modelSelection,
			});
			toast.success(
				formatAgentProfileRuntimeSettingsSavedMessage(profile.profileName)
			);
		} catch (error) {
			updateError = error;
		} finally {
			setPendingModelSelectionProfileId(null);
		}
		if (updateError) {
			toast.error(
				formatMutationError(
					updateError,
					`OpenMeld could not update ${profile.profileName}.`
				)
			);
			return Promise.reject(updateError);
		}
	};
	const handleUpdateProfileOpenCodePermission = async (
		profile: AuthProfileView,
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) => {
		setPendingOpenCodePermissionProfileId(profile.openMeldProfileId);
		let updateError: unknown = null;
		try {
			await updateAgentProfileOpenCodePermission({
				context: createAgentProfileEditActionContext(profile),
				openCodePermission,
			});
			toast.success(
				formatAgentProfileRuntimeSettingsSavedMessage(profile.profileName)
			);
		} catch (error) {
			updateError = error;
		} finally {
			setPendingOpenCodePermissionProfileId(null);
		}
		if (updateError) {
			toast.error(
				formatMutationError(
					updateError,
					`OpenMeld could not update the OpenCode permissions for ${profile.profileName}.`
				)
			);
			return Promise.reject(updateError);
		}
	};
	const handleRenameProfile = async (
		profile: AuthProfileView,
		profileName: string
	) => {
		setPendingRenameProfileId(profile.openMeldProfileId);
		let updateError: unknown = null;
		try {
			const updatedProfile = await renameAgentProfile({
				context: createAgentProfileEditActionContext(profile),
				profileName,
			});
			toast.success(`Agent renamed to ${updatedProfile.profileName}.`);
		} catch (error) {
			updateError = error;
		} finally {
			setPendingRenameProfileId(null);
		}
		if (updateError) {
			toast.error(
				formatMutationError(
					updateError,
					`OpenMeld could not rename ${profile.profileName}.`
				)
			);
			return Promise.reject(updateError);
		}
	};
	const handleCheckProfileAgain = async (profile: AuthProfileView) => {
		setPendingCheckProfileId(profile.openMeldProfileId);
		try {
			await refreshWebAgentReadinessFacts({
				agentProfileIds: [profile.openMeldProfileId],
				organizationId: currentOrganization.id,
				queryClient: input.queryClient,
				storageScope: input.recovery.storageScope,
			});
		} catch (error) {
			toast.error(
				formatMutationError(
					error,
					`OpenMeld could not check ${profile.profileName} again.`
				)
			);
		} finally {
			setPendingCheckProfileId(null);
		}
	};
	const handleDisableProfilePrimaryBinding = async (
		profile: AuthProfileView
	) => {
		setPendingDisablePrimaryBindingProfileId(profile.openMeldProfileId);
		try {
			const response = await disableAgentProfilePrimaryBinding({
				actorProfileId: input.recovery.selectedHumanProfileId,
				agentProfileId: profile.openMeldProfileId,
				organizationId: currentOrganization.id,
			});
			if (!(response.disabled || response.status === "missing")) {
				if (
					response.reasonCodes.includes(
						"agent_profile_binding.controller_change_blocked_active_execution"
					)
				) {
					throw new Error(
						"This Agent is still working. Wait for the current Wake to finish before unbinding its Controller."
					);
				}
				if (
					response.reasonCodes.includes(
						"agent_profile_binding.controller_change_eligibility_unavailable"
					)
				) {
					throw new Error(
						"OpenMeld couldn’t confirm whether this Agent is working. Try unbinding its Controller again."
					);
				}
				throw new Error("OpenMeld could not unbind this controller.");
			}
			const missingResponse = createMissingAgentProfilePrimaryBindingResponse({
				agentProfileId: profile.openMeldProfileId,
				reasonCode:
					response.reasonCodes[0] ??
					"agent_profile_binding.primary_binding_disabled",
			});
			const queryKey = agentProfilePrimaryBindingQueryKeys.profile(
				input.recovery.storageScope,
				profile.openMeldProfileId
			);
			input.queryClient.setQueryData<GetAgentProfilePrimaryBindingResponse>(
				queryKey,
				missingResponse
			);
			setPrimaryBindingDisplayState((current) => {
				const currentBindingByProfileId =
					current.storageScope === input.recovery.storageScope
						? current.bindingByProfileId
						: EMPTY_PRIMARY_BINDING_BY_PROFILE_ID;
				const next = new Map(currentBindingByProfileId);
				next.set(profile.openMeldProfileId, missingResponse.binding);
				return {
					bindingByProfileId: next,
					storageScope: input.recovery.storageScope,
				};
			});
			await Promise.all([
				invalidateAgentProfilePrimaryBindingEditQueries({
					queryClient: input.queryClient,
					queryKey,
					storageScope: input.recovery.storageScope,
				}),
				refreshWebAgentReadinessFacts({
					agentProfileIds: [profile.openMeldProfileId],
					organizationId: currentOrganization.id,
					queryClient: input.queryClient,
					storageScope: input.recovery.storageScope,
				}),
			]);
			toast.success(
				`Controller unbound for ${profile.profileName}. It cannot run until you connect a local agent again.`
			);
		} catch (error) {
			toast.error(
				formatMutationError(
					error,
					`OpenMeld could not unbind the controller for ${profile.profileName}.`
				)
			);
			return Promise.reject(error);
		} finally {
			setPendingDisablePrimaryBindingProfileId(null);
		}
	};
	const handleRemoveProfile = async (profile: AuthProfileView) => {
		setPendingRemoveProfileId(profile.openMeldProfileId);
		let cacheSnapshot:
			| Awaited<
					ReturnType<typeof optimisticallyRemoveAgentProfileFromListCaches>
			  >
			| undefined;
		try {
			cacheSnapshot = await optimisticallyRemoveAgentProfileFromListCaches({
				agentProfileId: profile.openMeldProfileId,
				queryClient: input.queryClient,
				storageScope: input.recovery.storageScope,
			});
			await deleteStartAgentProfile({ data: profile.openMeldProfileId });
			toast.success(`${profile.profileName} was removed from Local Agents.`);
		} catch (error) {
			if (isAgentProfileAlreadyRemovedError(error)) {
				toast.success(
					`${profile.profileName} was already removed from Local Agents.`
				);
			} else {
				restoreAgentProfileListCaches(input.queryClient, cacheSnapshot);
				console.error(
					"Failed to remove Agent Profile. The optimistic cache update was rolled back.",
					error
				);
				toast.error(
					`OpenMeld could not remove ${profile.profileName}. The Agent was restored to Local Agents.`
				);
				setPendingRemoveProfileId(null);
				return;
			}
		}
		try {
			await Promise.all([
				invalidateAgentProfileListCaches({
					queryClient: input.queryClient,
					storageScope: input.recovery.storageScope,
				}),
				refreshWebAgentReadinessSharedCaches({
					agentProfileIds: [profile.openMeldProfileId],
					organizationId: currentOrganization.id,
					queryClient: input.queryClient,
					storageScope: input.recovery.storageScope,
				}),
			]);
		} catch (refreshError) {
			console.error(
				"Failed to refresh Agent Profile caches after removal.",
				refreshError
			);
			toast.warning(
				`${profile.profileName} was removed, but OpenMeld could not refresh every related status. The lists will check again automatically.`
			);
		}
		setPendingRemoveProfileId(null);
	};

	const handleOpenDirectMessage = async (profile: AuthProfileView) => {
		setPendingDirectMessageProfileId(profile.openMeldProfileId);
		try {
			const response =
				(await readRememberedChatOrNull({
					queryClient: input.queryClient,
					organizationId: currentOrganization.id,
					humanProfileId: defaultHumanProfileId,
					agentProfileId: profile.openMeldProfileId,
				})) ??
				(await openCurrentDirectMessageSpace({
					organizationId: currentOrganization.id,
					targetProfileId: profile.openMeldProfileId,
				}));
			await input.queryClient.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
				refetchType: "none",
			});
			await navigate({
				to: buildOrganizationDirectMessagePath({
					orgSlug: currentOrganization.slug,
					search: { profileId: response.memberProfileId },
					spaceId: response.spaceId,
				}),
			});
		} catch (error) {
			console.error("Failed to open Direct Message Space.", error);
			toast.error(resolveDirectMessageOpenErrorMessage(error));
		} finally {
			setPendingDirectMessageProfileId(null);
		}
	};

	const handleAgentProfileWorkRecovery = async (
		profile: AuthProfileView,
		recoveryAction: ProfileDetailsRecoveryAction
	) => {
		const expectedInterruptedTargetWakeLifecycleId =
			recoveryAction.expectedInterruptedTargetWakeLifecycleId;
		if (!expectedInterruptedTargetWakeLifecycleId) {
			toast.error(
				"Refresh this page to review the Agent’s current paused work."
			);
			return;
		}
		const recoveryRequest: ExecuteAgentProfileWorkRecoveryBody = {
			action: recoveryAction.kind,
			expectedInterruptedTargetWakeLifecycleId,
		};
		const refreshRecovery = () =>
			Promise.all([
				input.queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.agentRuntimeOverview(
						currentOrganization.id
					),
				}),
				input.queryClient.invalidateQueries({
					queryKey: inboxQueryKeys.organization(currentOrganization.id),
				}),
			]);
		setPendingRecoveryActionProfileId(profile.openMeldProfileId);
		try {
			await executeAgentProfileWorkRecovery({
				agentProfileId: profile.openMeldProfileId,
				organizationId: currentOrganization.id,
				...recoveryRequest,
			});
			try {
				await refreshRecovery();
			} catch (refreshError) {
				console.error(
					"Agent work recovery was accepted, but its status refresh failed.",
					refreshError
				);
				toast.warning(
					"The action was accepted, but OpenMeld could not refresh its status. Refresh this page to check it again."
				);
				return;
			}
			toast.success(
				formatAgentProfileWorkRecoverySuccess(
					recoveryAction,
					profile.profileName
				)
			);
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"upstreamCode" in error &&
				error.upstreamCode === "agent_profile_work_recovery.not_pending"
			) {
				try {
					await refreshRecovery();
				} catch (refreshError) {
					console.error(
						"Could not refresh the Agent’s changed recovery state.",
						refreshError
					);
				}
				toast.info(
					"This Agent’s paused work has changed. Review its current work before trying again."
				);
				return;
			}
			if (isAgentProfileWorkAwaitingOriginalStopError(error)) {
				toast.info(
					`OpenMeld kept your choice for ${profile.profileName} and is checking whether the original request stopped on your computer. Nothing new has started yet.`
				);
				return;
			}
			console.error("Failed to recover Agent Profile work.", error);
			toast.error(
				formatMutationError(
					error,
					`OpenMeld could not ${formatAgentProfileWorkRecoveryFailureAction(
						recoveryAction
					)} for ${profile.profileName}.`
				)
			);
		} finally {
			setPendingRecoveryActionProfileId(null);
		}
	};

	return {
		agentProfileOperationalContextByProfileId,
		agentExecutionReadinessByProfileId,
		agentExecutionReadinessErrorByProfileId,
		agentExecutionReadinessPendingProfileIds,
		agentProfiles,
		agentProfilesQueryState,
		autoRefreshExhaustedProfileIds,
		canManageProfile,
		controllerChangeOptions,
		currentLocalRuntimeCanReply,
		currentOrganization,
		duplicateConversationProfileNamesByProfileId,
		handleChangeProfileController,
		handleCheckProfileAgain,
		handleConnectProfileToComputer,
		handleDisableProfilePrimaryBinding,
		handleAgentProfileWorkRecovery,
		handleOpenDirectMessage,
		handleRemoveProfile,
		handleRenameProfile,
		handleUpdateProfileControllerCollaborationMode,
		handleUpdateProfileControllerPermissionMode,
		handleUpdateProfileModelSelection,
		handleUpdateProfileOpenCodePermission,
		highlightedProfileId,
		localAgentCatalogEntries,
		modelCatalog,
		pendingCheckProfileId,
		pendingControllerChangeProfileId,
		pendingControllerCollaborationModeProfileId,
		pendingControllerPermissionModeProfileId,
		pendingDirectMessageProfileId,
		pendingDisablePrimaryBindingProfileId,
		pendingModelSelectionProfileId,
		pendingOpenCodePermissionProfileId,
		pendingRemoveProfileId,
		pendingRecoveryActionProfileId,
		pendingRenameProfileId,
		pendingRepairProfileIds,
		primaryBindingByProfileId,
		profileRowElementsRef,
		visibleAgentProfileGroups,
		visibleAgentProfiles,
		wakeAvailabilityDisplayOverrideByProfileId,
	};
}

type AgentProfilesCardController = ReturnType<
	typeof useAgentProfilesCardController
>;

function AgentProfilesCardView(input: {
	controller: AgentProfilesCardController;
	input: AgentProfilesCardProps;
}) {
	const {
		agentProfiles,
		agentProfilesQueryState,
		pendingRemoveProfileId,
		visibleAgentProfiles,
	} = input.controller;
	const cardInput = input.input;
	const presentation = cardInput.presentation ?? "cards";

	if (presentation === "controller") {
		return null;
	}

	if (agentProfilesQueryState.isPending) {
		return <AgentProfilesLoadingRows />;
	}

	if (agentProfilesQueryState.isError) {
		return (
			<AgentProfilesInlineState message="OpenMeld could not load your Agents right now." />
		);
	}

	const focusedProfileId =
		cardInput.focusProfileId ?? agentProfiles[0]?.openMeldProfileId ?? null;
	if (
		presentation === "detail" &&
		pendingRemoveProfileId !== null &&
		pendingRemoveProfileId === focusedProfileId
	) {
		const pendingProfile = agentProfiles.find(
			(profile) => profile.openMeldProfileId === pendingRemoveProfileId
		);
		return (
			<AgentProfilesInlineState
				message={
					pendingProfile
						? `Removing ${pendingProfile.profileName}…`
						: "Removing Agent…"
				}
			/>
		);
	}

	if (agentProfiles.length === 0) {
		return (
			<EmptyAgentProfilesState onCreateProfile={cardInput.onCreateProfile} />
		);
	}

	if (visibleAgentProfiles.length === 0) {
		return <AgentProfilesInlineState message="No Agents match this filter." />;
	}

	return (
		<AgentProfilesPopulatedView
			cardInput={cardInput}
			controller={input.controller}
			presentation={presentation}
		/>
	);
}

function AgentProfilesPopulatedView(input: {
	cardInput: AgentProfilesCardProps;
	controller: AgentProfilesCardController;
	presentation: "cards" | "detail";
}) {
	const { visibleAgentProfileGroups, visibleAgentProfiles } = input.controller;
	const renderAgentProfileRow = (profile: AuthProfileView) => (
		<AgentProfileDirectoryRow
			cardInput={input.cardInput}
			controller={input.controller}
			presentation={input.presentation}
			profile={profile}
		/>
	);
	if (input.presentation === "detail") {
		const selectedProfile =
			visibleAgentProfiles.find(
				(profile) =>
					profile.openMeldProfileId === input.cardInput.focusProfileId
			) ?? visibleAgentProfiles[0];
		return selectedProfile ? renderAgentProfileRow(selectedProfile) : null;
	}

	if (!input.cardInput.showOwnerGroups) {
		return (
			<DirectoryCardGrid>
				{visibleAgentProfiles.map((profile) => (
					<DirectoryCardItem
						itemId={profile.openMeldProfileId}
						key={profile.openMeldProfileId}
					>
						{renderAgentProfileRow(profile)}
					</DirectoryCardItem>
				))}
			</DirectoryCardGrid>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			{visibleAgentProfileGroups.map((group) => (
				<DirectoryOwnerGroup
					countLabel={
						group.profiles.length === 1
							? "1 Agent"
							: `${group.profiles.length} Agents`
					}
					key={group.ownerUserId}
					ownerLabel={group.ownerLabel}
				>
					<DirectoryCardGrid>
						{group.profiles.map((profile) => (
							<DirectoryCardItem
								itemId={profile.openMeldProfileId}
								key={profile.openMeldProfileId}
							>
								{renderAgentProfileRow(profile)}
							</DirectoryCardItem>
						))}
					</DirectoryCardGrid>
				</DirectoryOwnerGroup>
			))}
		</div>
	);
}

function AgentProfileDirectoryRow(input: {
	cardInput: AgentProfilesCardProps;
	controller: AgentProfilesCardController;
	presentation: "cards" | "detail";
	profile: AuthProfileView;
}) {
	const { controller, profile } = input;
	const canManage = controller.canManageProfile(profile);
	const readiness =
		controller.agentExecutionReadinessByProfileId.get(
			profile.openMeldProfileId
		) ?? null;
	const localAgentEntry = resolveOptionalAgentProfileLocalAgentEntry({
		entries: controller.localAgentCatalogEntries,
		readiness,
	});
	const primaryBinding =
		controller.primaryBindingByProfileId.get(profile.openMeldProfileId) ?? null;
	const directoryAgentControllerRef =
		input.cardInput.agentControllerRefByProfileId?.get(
			profile.openMeldProfileId
		) ?? null;
	const modelCompatibilityContext =
		resolveAgentProfileModelCompatibilityContext({
			agentControllerRef:
				primaryBinding?.executionTarget?.agentControllerRef ?? null,
			controllerChangeOptions: controller.controllerChangeOptions,
			localRuntimes:
				input.cardInput.recovery.localRuntimesQuery.data?.localRuntimes ?? [],
			orgSlug: controller.currentOrganization.slug,
			readiness,
		});
	const actions = buildAgentProfileDirectoryRowActions({
		cardInput: input.cardInput,
		controller,
		profile,
	});
	const configuration = buildAgentProfileDirectoryRowConfiguration({
		canManage,
		cardInput: input.cardInput,
		controller,
		localAgentEntry,
		profile,
		readiness,
	});

	return (
		<AgentProfileExecutionReadinessRow
			activityNavigation={
				input.cardInput.agentProfileActivityNavigationByProfileId?.get(
					profile.openMeldProfileId
				) ?? null
			}
			actorProfileId={input.cardInput.recovery.selectedHumanProfileId}
			controllerChangeOptions={controller.controllerChangeOptions}
			directoryAgentControllerRef={directoryAgentControllerRef}
			duplicateConversationProfileNames={
				controller.duplicateConversationProfileNamesByProfileId.get(
					profile.openMeldProfileId
				) ?? []
			}
			errorMessage={
				controller.agentExecutionReadinessErrorByProfileId.get(
					profile.openMeldProfileId
				) ?? null
			}
			localAgentCatalogEntries={controller.localAgentCatalogEntries}
			modelCatalog={controller.modelCatalog}
			modelCompatibilityContext={modelCompatibilityContext}
			onCheckAgain={actions.onCheckAgain}
			onControllerChange={actions.onControllerChange}
			onControllerCollaborationModeUpdate={
				actions.onControllerCollaborationModeUpdate
			}
			onControllerPermissionModeUpdate={
				actions.onControllerPermissionModeUpdate
			}
			onDisablePrimaryBinding={actions.onDisablePrimaryBinding}
			onModelSelectionUpdate={actions.onModelSelectionUpdate}
			onOpenCodePermissionUpdate={actions.onOpenCodePermissionUpdate}
			onOpenDirectMessage={actions.onOpenDirectMessage}
			onProfileUpdated={actions.onProfileUpdated}
			onRecoveryAction={actions.onRecoveryAction}
			onRemoveProfile={actions.onRemoveProfile}
			onRenameProfile={actions.onRenameProfile}
			onRepairAction={actions.onRepairAction}
			operationalContext={
				controller.agentProfileOperationalContextByProfileId.get(
					profile.openMeldProfileId
				) ?? null
			}
			organizationId={controller.currentOrganization.id}
			ownerAvatarUrl={
				profile.ownerUserId
					? (input.cardInput.ownerAvatarUrlByUserId?.get(profile.ownerUserId) ??
						null)
					: null
			}
			ownerProfile={
				input.cardInput.recovery.selectedHumanProfile?.ownerUserId ===
				profile.ownerUserId
					? input.cardInput.recovery.selectedHumanProfile
					: null
			}
			pendingState={{
				checkAgain:
					controller.pendingCheckProfileId === profile.openMeldProfileId,
				controllerChange:
					controller.pendingControllerChangeProfileId ===
					profile.openMeldProfileId,
				controllerCollaborationMode:
					controller.pendingControllerCollaborationModeProfileId ===
					profile.openMeldProfileId,
				controllerPermissionMode:
					controller.pendingControllerPermissionModeProfileId ===
					profile.openMeldProfileId,
				directMessage:
					controller.pendingDirectMessageProfileId ===
					profile.openMeldProfileId,
				disablePrimaryBinding:
					controller.pendingDisablePrimaryBindingProfileId ===
					profile.openMeldProfileId,
				modelSelection:
					controller.pendingModelSelectionProfileId ===
					profile.openMeldProfileId,
				openCodePermission:
					controller.pendingOpenCodePermissionProfileId ===
					profile.openMeldProfileId,
				remove: controller.pendingRemoveProfileId !== null,
				rename: controller.pendingRenameProfileId === profile.openMeldProfileId,
				recoveryAction:
					controller.pendingRecoveryActionProfileId ===
					profile.openMeldProfileId,
				repair: controller.pendingRepairProfileIds.has(
					profile.openMeldProfileId
				),
			}}
			presentation={input.presentation}
			primaryBinding={primaryBinding}
			profile={profile}
			readiness={readiness}
			repairActions={configuration.repairActions}
			rowRef={(node) => {
				if (node) {
					controller.profileRowElementsRef.current.set(
						profile.openMeldProfileId,
						node
					);
				} else {
					controller.profileRowElementsRef.current.delete(
						profile.openMeldProfileId
					);
				}
			}}
			rowState={{
				autoRefreshExhausted: controller.autoRefreshExhaustedProfileIds.has(
					profile.openMeldProfileId
				),
				canManage,
				currentLocalRuntimeCanReply: controller.currentLocalRuntimeCanReply,
				isFocused:
					controller.highlightedProfileId === profile.openMeldProfileId,
				isReadinessPending:
					controller.agentExecutionReadinessPendingProfileIds.has(
						profile.openMeldProfileId
					),
				isReadinessRefreshing:
					input.cardInput.agentExecutionReadinessIsRefreshing === true,
			}}
			setupAction={configuration.setupAction}
			storageScope={input.cardInput.recovery.storageScope}
			wakeAvailabilityDisplayOverride={
				controller.wakeAvailabilityDisplayOverrideByProfileId.get(
					profile.openMeldProfileId
				) ?? null
			}
			wakeAvailabilityNowMs={input.cardInput.wakeAvailabilityNowMs}
		/>
	);
}

type AgentProfileDirectoryRowActionProps = Pick<
	AgentProfileExecutionReadinessRowProps,
	| "onCheckAgain"
	| "onControllerChange"
	| "onControllerCollaborationModeUpdate"
	| "onControllerPermissionModeUpdate"
	| "onDisablePrimaryBinding"
	| "onModelSelectionUpdate"
	| "onOpenCodePermissionUpdate"
	| "onOpenDirectMessage"
	| "onProfileUpdated"
	| "onRecoveryAction"
	| "onRemoveProfile"
	| "onRenameProfile"
	| "onRepairAction"
>;

function buildAgentProfileDirectoryRowActions(input: {
	cardInput: AgentProfilesCardProps;
	controller: AgentProfilesCardController;
	profile: AuthProfileView;
}): AgentProfileDirectoryRowActionProps {
	return {
		onCheckAgain: async () => {
			await input.controller.handleCheckProfileAgain(input.profile);
		},
		onControllerChange: async (update) => {
			await input.controller.handleChangeProfileController(
				input.profile,
				update
			);
		},
		onControllerCollaborationModeUpdate: async (
			agentControllerCollaborationMode
		) => {
			await input.controller.handleUpdateProfileControllerCollaborationMode(
				input.profile,
				agentControllerCollaborationMode
			);
		},
		onControllerPermissionModeUpdate: async (agentControllerPermissionMode) => {
			await input.controller.handleUpdateProfileControllerPermissionMode(
				input.profile,
				agentControllerPermissionMode
			);
		},
		onDisablePrimaryBinding: async () => {
			await input.controller.handleDisableProfilePrimaryBinding(input.profile);
		},
		onModelSelectionUpdate: async (modelSelection) => {
			await input.controller.handleUpdateProfileModelSelection(
				input.profile,
				modelSelection
			);
		},
		onOpenCodePermissionUpdate: async (openCodePermission) => {
			await input.controller.handleUpdateProfileOpenCodePermission(
				input.profile,
				openCodePermission
			);
		},
		onOpenDirectMessage: async () => {
			await input.controller.handleOpenDirectMessage(input.profile);
		},
		onProfileUpdated: (updatedProfile) => {
			updateAgentProfileListCaches({
				organizationId: input.controller.currentOrganization.id,
				profile: updatedProfile,
				queryClient: input.cardInput.queryClient,
				storageScope: input.cardInput.recovery.storageScope,
			});
			refreshWebAgentReadinessFacts({
				agentProfileIds: [updatedProfile.openMeldProfileId],
				organizationId: input.controller.currentOrganization.id,
				queryClient: input.cardInput.queryClient,
				storageScope: input.cardInput.recovery.storageScope,
			}).catch((error: unknown) => {
				console.error(
					"Failed to refresh Agent configuration after saving.",
					error
				);
			});
		},
		onRecoveryAction: (recoveryAction) => {
			if (input.cardInput.onRecoveryAction) {
				input.cardInput.onRecoveryAction(recoveryAction);
				return;
			}
			input.controller
				.handleAgentProfileWorkRecovery(input.profile, recoveryAction)
				.catch((error: unknown) => {
					console.error("Agent work recovery action failed.", error);
				});
		},
		onRemoveProfile: async () => {
			await input.controller.handleRemoveProfile(input.profile);
		},
		onRenameProfile: async (profileName) => {
			await input.controller.handleRenameProfile(input.profile, profileName);
		},
		onRepairAction: async (action) => {
			await input.controller.handleConnectProfileToComputer(
				input.profile,
				action
			);
		},
	};
}

function buildAgentProfileDirectoryRowConfiguration(input: {
	canManage: boolean;
	cardInput: AgentProfilesCardProps;
	controller: AgentProfilesCardController;
	localAgentEntry: ReturnType<
		typeof resolveOptionalAgentProfileLocalAgentEntry
	>;
	profile: AuthProfileView;
	readiness: GetAgentExecutionReadinessResponse | null;
}) {
	if (!input.canManage) {
		return { repairActions: [], setupAction: null };
	}
	return {
		repairActions: resolveAgentProfileRepairActions({
			isCurrentComputer: input.cardInput.isCurrentComputer,
			localAgentCatalogEntries: input.controller.localAgentCatalogEntries,
			readiness: input.readiness,
		}),
		setupAction: resolveAgentProfileSetupAction({
			autoRefreshExhausted: input.controller.autoRefreshExhaustedProfileIds.has(
				input.profile.openMeldProfileId
			),
			currentLocalRuntimeCanReply: input.controller.currentLocalRuntimeCanReply,
			localAgentDisplayName: input.localAgentEntry?.displayName ?? null,
			readiness: input.readiness,
			serviceUpdatePath: input.cardInput.serviceUpdatePath,
			setupPath: input.cardInput.setupPath,
			computerSettingsPath: input.readiness?.routeDeviceId
				? buildComputerSettingsPath({
						orgSlug: input.controller.currentOrganization.slug,
						deviceId: input.readiness.routeDeviceId,
					})
				: buildOrganizationComputersPath(
						input.controller.currentOrganization.slug
					),
			agentSettingsPath: buildAgentProfilePath({
				orgSlug: input.controller.currentOrganization.slug,
				profileId: input.profile.openMeldProfileId,
			}),
		}),
	};
}

function resolveOptionalAgentProfileLocalAgentEntry(input: {
	entries: Parameters<typeof resolveAgentProfileLocalAgentEntry>[0]["entries"];
	readiness: GetAgentExecutionReadinessResponse | null;
}) {
	if (!input.readiness) {
		return null;
	}
	return resolveAgentProfileLocalAgentEntry({
		entries: input.entries,
		readiness: input.readiness,
	});
}

function resolveAgentProfileModelCompatibilityContext(input: {
	agentControllerRef: string | null;
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	localRuntimes: readonly LocalRuntimeComputer[];
	orgSlug: string;
	readiness: GetAgentExecutionReadinessResponse | null;
}): AgentProfileModelCompatibilityContext | null {
	const controller = input.agentControllerRef
		? parseAgentControllerRef(input.agentControllerRef)
		: null;
	if (
		controller?.kind !== "builtin" ||
		!input.readiness?.routeDeviceId ||
		!input.readiness.routeLane
	) {
		return null;
	}
	const target = input.localRuntimes
		.flatMap((computer) => computer.executionTargets)
		.find(
			(candidate) =>
				candidate.deviceId === input.readiness?.routeDeviceId &&
				candidate.runtimeLane === input.readiness.routeLane
		);
	const snapshot = target?.capabilities.find(
		(capability) => capability.agentControllerRef === controller.ref
	)?.agentControllerInterface;
	if (!snapshot) {
		return null;
	}
	return {
		agentControllerId: controller.id,
		agentControllerRef: controller.ref,
		authType:
			snapshot.auth.status === "authenticated" ? snapshot.auth.type : null,
		controllerDisplayName:
			input.controllerChangeOptions.find(
				(option) => option.agentControllerRef === controller.ref
			)?.label ?? snapshot.displayName,
		installedVersion: snapshot.version,
		managePath: buildOrganizationComputerPath({
			deviceId: input.readiness.routeDeviceId,
			orgSlug: input.orgSlug,
		}),
		reportedModelIds: snapshot.models.map((model) => model.id),
	};
}

type AgentProfileOwnerGroup = {
	ownerLabel: string;
	ownerUserId: string;
	profiles: AuthProfileView[];
};

function groupAgentProfilesByOwner(input: {
	fallbackOwnerLabel: string;
	profiles: readonly AuthProfileView[];
}): AgentProfileOwnerGroup[] {
	const groups = new Map<string, AgentProfileOwnerGroup>();
	for (const profile of input.profiles) {
		if (!profile.ownerUserId) {
			continue;
		}
		const existing = groups.get(profile.ownerUserId);
		if (existing) {
			existing.profiles.push(profile);
			continue;
		}
		groups.set(profile.ownerUserId, {
			ownerLabel: profile.ownerName?.trim() || input.fallbackOwnerLabel,
			ownerUserId: profile.ownerUserId,
			profiles: [profile],
		});
	}
	return [...groups.values()];
}

function createMissingAgentProfilePrimaryBindingResponse(input: {
	agentProfileId: string;
	reasonCode: string;
}): GetAgentProfilePrimaryBindingResponse {
	const reasonCodes = [input.reasonCode];
	return {
		binding: {
			agentProfileId: input.agentProfileId,
			authoritySource: "none",
			bindingState: "missing",
			dispatchEligibility: {
				reasonCodes,
				routable: false,
				status: "not_routable",
			},
			executionTarget: null,
			grantsClaimSuccess: false,
			reasonCodes,
			resolutionSource: "missing_projection",
			routable: false,
		},
		grantsClaimSuccess: false,
		status: "missing",
	};
}

function resolveAgentProfileControllerOptionLabel(input: {
	agentControllerRef: string;
	options: readonly AgentProfileControllerChangeOption[];
}): string | null {
	return (
		input.options.find(
			(option) => option.agentControllerRef === input.agentControllerRef
		)?.label ?? null
	);
}

function resolveAgentProfileDisplayIconAgentId(input: {
	localAgentEntry: DeviceAgentCatalogEntry | null;
	primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
	readiness: GetAgentExecutionReadinessResponse;
}): string | null {
	const primaryBindingAgentControllerRef =
		input.primaryBinding?.executionTarget?.agentControllerRef ?? null;
	const parsedPrimaryBindingAgentControllerRef = parseAgentControllerRef(
		primaryBindingAgentControllerRef
	);
	return (
		parsedPrimaryBindingAgentControllerRef?.id ??
		resolveAgentProfileIconAgentId({
			localAgentEntry: input.localAgentEntry,
			readiness: input.readiness,
		})
	);
}

function AgentProfilesLoadingRows() {
	return (
		<div className="grid gap-3 lg:grid-cols-2">
			<span className="sr-only">Loading Agents.</span>
			{AGENT_PROFILE_ROW_SKELETON_IDS.map((id) => (
				<div
					className="min-h-40 border border-border/70 bg-card px-4 py-4"
					key={id}
				>
					<div className="flex items-start justify-between gap-3">
						<div className="flex min-w-0 flex-1 items-start gap-3">
							<Skeleton className="size-10 shrink-0" />
							<div className="min-w-0 flex-1 space-y-2">
								<Skeleton className="h-4 w-48 max-w-full" />
								<Skeleton className="h-3 w-64 max-w-full" />
							</div>
						</div>
						<Skeleton className="h-7 w-7 shrink-0" />
					</div>
					<div className="mt-8 border-border/70 border-t pt-3">
						<div className="flex items-center justify-between gap-3">
							<Skeleton className="h-3 w-48 max-w-full" />
							<Skeleton className="h-5 w-20" />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

function AgentProfilesInlineState(input: { message: string }) {
	return (
		<div className="rounded-md border border-border/70 bg-background/20 px-4 py-3 text-muted-foreground text-sm">
			{input.message}
		</div>
	);
}

function EmptyAgentProfilesState(input: { onCreateProfile?: () => void }) {
	return (
		<button
			className={ADD_CARD_PICKER_CLASS_NAME}
			onClick={input.onCreateProfile}
			type="button"
		>
			<SettingsAddComputerCardContent
				description="Create an AI teammate that can work and reply in Spaces."
				title="Create an Agent"
			/>
		</button>
	);
}

type AgentProfileRowState = {
	autoRefreshExhausted: boolean;
	canManage: boolean;
	currentLocalRuntimeCanReply: boolean | null;
	isFocused: boolean;
	isReadinessPending: boolean;
	isReadinessRefreshing: boolean;
};

type AgentProfileActionPendingState = {
	checkAgain: boolean;
	controllerChange: boolean;
	controllerCollaborationMode: boolean;
	controllerPermissionMode: boolean;
	directMessage: boolean;
	disablePrimaryBinding: boolean;
	modelSelection: boolean;
	openCodePermission: boolean;
	remove: boolean;
	rename: boolean;
	recoveryAction: boolean;
	repair: boolean;
};

type AgentProfileExecutionReadinessRowProps = {
	activityNavigation: AgentProfileActivityNavigation | null;
	actorProfileId: string | null;
	directoryAgentControllerRef: string | null;
	duplicateConversationProfileNames: readonly string[];
	errorMessage: string | null;
	localAgentCatalogEntries: readonly DeviceAgentCatalogEntry[];
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext: AgentProfileModelCompatibilityContext | null;
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	onControllerChange: (
		update: AgentProfileControllerChangeUpdate
	) => Promise<void>;
	onControllerCollaborationModeUpdate: (
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) => Promise<void>;
	onControllerPermissionModeUpdate: (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => Promise<void>;
	onDisablePrimaryBinding: () => Promise<void>;
	onModelSelectionUpdate: (
		modelSelection: AgentProfileModelSelectionUpdate
	) => Promise<void>;
	onOpenCodePermissionUpdate: (
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) => Promise<void>;
	onCheckAgain: () => Promise<void>;
	onOpenDirectMessage: () => Promise<void>;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	onRepairAction: (action: AgentProfileRepairAction) => Promise<void>;
	onRenameProfile: (profileName: string) => Promise<void>;
	onRemoveProfile: () => Promise<void>;
	organizationId: string;
	operationalContext: AgentProfileOperationalContextInput | null;
	ownerAvatarUrl: string | null;
	ownerProfile: AuthProfileView | null;
	profile: AuthProfileView;
	primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
	pendingState: AgentProfileActionPendingState;
	presentation: "cards" | "detail";
	readiness: GetAgentExecutionReadinessResponse | null;
	rowState: AgentProfileRowState;
	wakeAvailabilityDisplayOverride: AgentWakeAvailability | null;
	wakeAvailabilityNowMs: number;
	repairActions: readonly AgentProfileRepairAction[];
	rowRef?: Ref<HTMLElement>;
	setupAction: AgentProfileSetupAction | null;
	storageScope: string;
};

function resolveAgentProfilePublicPresentation(input: {
	localAgentDisplayName: string | null;
	localAgentEntry: ReturnType<typeof resolveAgentProfileLocalAgentEntry>;
	modelCatalog: ModelCatalog | null;
	primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
	readiness: GetAgentExecutionReadinessResponse;
}) {
	const publicConfiguration = input.readiness.publicProfileConfiguration;
	const publicControllerRef = publicConfiguration?.agentControllerRef ?? null;
	const parsedPublicControllerId =
		parseAgentControllerRef(publicControllerRef)?.id;
	const primaryBindingIsMissing =
		input.primaryBinding?.bindingState === "missing";
	const permissionModeLabel = publicConfiguration?.agentControllerPermissionMode
		? getAgentControllerPermissionModeDisplayMetadata(
				publicConfiguration.agentControllerPermissionMode,
				{ agentControllerRef: publicControllerRef }
			).label
		: null;
	const iconAgentId = primaryBindingIsMissing
		? null
		: (parsedPublicControllerId ??
			resolveAgentProfileDisplayIconAgentId({
				localAgentEntry: input.localAgentEntry,
				primaryBinding: input.primaryBinding,
				readiness: input.readiness,
			}));
	const controllerModelDetail = resolveAgentProfileControllerModelDetail({
		agentControllerRef:
			input.primaryBinding?.executionTarget?.agentControllerRef ??
			publicControllerRef ??
			(primaryBindingIsMissing
				? null
				: resolveLocalAgentEntryControllerRef(input.localAgentEntry)),
		controllerDisplayName: primaryBindingIsMissing
			? null
			: (input.localAgentDisplayName ??
				(parsedPublicControllerId
					? formatLocalAgentDisplayName(parsedPublicControllerId)
					: null)),
		modelCatalog: input.modelCatalog,
		modelSelection:
			input.primaryBinding?.modelSelection ??
			publicConfiguration?.modelSelection ??
			null,
	});
	return { controllerModelDetail, iconAgentId, permissionModeLabel };
}

function AgentProfileExecutionReadinessRow(
	input: AgentProfileExecutionReadinessRowProps
) {
	const viewerScope = resolveProfileDetailsViewerScope(
		input.rowState.canManage
	);
	const controllerPermissionModeDisplay =
		resolveWebAgentControllerPermissionModeDisplayFromBinding(
			input.primaryBinding
		);
	const profileDetailsWithoutModel = buildProfileDetailsSnapshotFromAuthProfile(
		{
			agentControllerPermissionModeDetail:
				controllerPermissionModeDisplay?.label ?? null,
			modelDetail: null,
			operationalContext: input.operationalContext,
			primaryBinding: input.primaryBinding,
			profile: input.profile,
			readiness: input.readiness,
			viewerScope,
		}
	);
	const rowMoreMenu = (
		details: ProfileDetailsSnapshot,
		supportingContent: ReactNode = null
	) => (
		<AgentProfileExecutionReadinessRowMenu
			details={details}
			row={input}
			supportingContent={supportingContent}
		/>
	);
	const readiness = input.readiness;
	if (readiness === null) {
		return renderUnavailableAgentProfilePresentation({
			controllerPermissionModeDisplay,
			input,
			menu: rowMoreMenu(profileDetailsWithoutModel),
			readiness,
		});
	}

	const isSelfHealing = isAgentExecutionSelfHealingReadiness(
		readiness.agentExecutionReadiness
	);
	const isDisplayProjectionRefreshing =
		isAgentExecutionDisplayProjectionRefreshing(readiness);
	const isServiceProjectionRefreshing =
		isCurrentRuntimeServiceProjectionRefreshing({
			currentLocalRuntimeCanReply: input.rowState.currentLocalRuntimeCanReply,
			readiness,
		});
	const hasControllerConversationConflict = hasAgentExecutionReason(
		readiness.agentExecutionReadiness,
		(reasonCode) =>
			reasonCode === "agent_profile_binding.controller_conversation_conflict"
	);
	const showConnecting =
		(isSelfHealing ||
			isDisplayProjectionRefreshing ||
			isServiceProjectionRefreshing) &&
		!input.rowState.autoRefreshExhausted;
	const localAgentEntry = resolveAgentProfileLocalAgentEntry({
		entries: input.localAgentCatalogEntries,
		readiness,
	});
	const localAgentDisplayName = localAgentEntry?.displayName ?? null;
	const publicPresentation = resolveAgentProfilePublicPresentation({
		localAgentDisplayName,
		localAgentEntry,
		modelCatalog: input.modelCatalog,
		primaryBinding: input.primaryBinding,
		readiness,
	});
	const rawDisplayedAgentWakeAvailability =
		resolveAgentProfileRowWakeAvailability({
			readiness,
		});
	const displayedAgentWakeAvailability = resolveAgentProfileVisualAvailability({
		displayOverride: input.wakeAvailabilityDisplayOverride,
		rawAvailability: rawDisplayedAgentWakeAvailability,
	});
	const canCheckExpiredWakeRouteAgain =
		canManuallyRefreshAgentProfileConnection({
			autoRefreshExhausted: input.rowState.autoRefreshExhausted,
			currentLocalRuntimeCanReply: input.rowState.currentLocalRuntimeCanReply,
			readiness,
		});
	const hideSetupAction =
		showConnecting ||
		rawDisplayedAgentWakeAvailability.category === "available";
	const runtimeDeviceName = resolveAgentExecutionRuntimeDeviceLabel(
		readiness,
		(isDisplayProjectionRefreshing || isServiceProjectionRefreshing) &&
			showConnecting
	);
	const availabilityState = resolveAgentWakeAvailabilityDisplayCategory(
		displayedAgentWakeAvailability
	);
	const statusLabel = displayedAgentWakeAvailability.badgeLabel;
	const statusTooltip = displayedAgentWakeAvailability.tooltip;
	const rowTone = resolveAgentProfileAvailabilityTone(availabilityState);
	const statusTextClassName =
		resolveAgentProfileStatusTextClassName(availabilityState);
	const rowSummary = resolveAgentProfileDisplaySummary({
		agentWakeAvailability: displayedAgentWakeAvailability,
	});
	const profileDetails = buildProfileDetailsSnapshotFromAuthProfile({
		agentControllerPermissionModeDetail:
			controllerPermissionModeDisplay?.label ??
			publicPresentation.permissionModeLabel,
		modelDetail: publicPresentation.controllerModelDetail,
		operationalContext: input.operationalContext,
		primaryBinding: input.primaryBinding,
		profile: input.profile,
		readiness,
		viewerScope,
	});
	const cardActions = renderAgentProfileCardActions({
		canCheckExpiredWakeRouteAgain:
			input.rowState.canManage && canCheckExpiredWakeRouteAgain,
		checkAgainIsPending: input.pendingState.checkAgain,
		duplicateConversationProfileNames: input.duplicateConversationProfileNames,
		hasControllerConversationConflict,
		hideSetupAction,
		onCheckAgain: input.onCheckAgain,
		onRemoveProfile: input.onRemoveProfile,
		onRepairAction: input.onRepairAction,
		profileName: input.profile.profileName,
		removeIsPending: input.pendingState.remove,
		repairActions: input.repairActions,
		repairIsPending: input.pendingState.repair,
		setupAction: input.setupAction,
		folderRecovery: {
			actorProfileId: input.actorProfileId,
			organizationId: input.organizationId,
			storageScope: input.storageScope,
			profile: input.profile,
			onProfileUpdated: input.onProfileUpdated,
		},
	});
	const supportingContent = cardActions;
	const presentations: Record<
		AgentProfileExecutionReadinessRowProps["presentation"],
		ReactNode
	> = {
		cards: (
			<ProfileCard
				actions={supportingContent}
				className={cn(
					"min-h-40",
					resolveFocusedAgentProfileClassName(input.rowState.isFocused)
				)}
				contextMenu
				dimTitle={rowTone === "muted"}
				footerLeft={
					<AgentProfileFooterDetail
						primaryDetail={resolveAgentProfilePrimaryDetail({
							availabilityState,
							rowSummary,
							runtimeDeviceName,
						})}
						profileCreatedAt={input.profile.createdAt}
					/>
				}
				footerRight={
					<AgentProfileFooterAvailabilityBadge
						availabilityAction={displayedAgentWakeAvailability.action}
						availabilityPhase={displayedAgentWakeAvailability.phase}
						availabilityReasonCode={displayedAgentWakeAvailability.reasonCode}
						checkedAt={readiness.generatedAt}
						className={statusTextClassName}
						errorMessage={input.errorMessage}
						isRefreshing={
							input.rowState.isReadinessRefreshing ||
							displayedAgentWakeAvailability.isRefreshing ||
							(showConnecting &&
								displayedAgentWakeAvailability.category === "checking")
						}
						label={statusLabel}
						nowMs={input.wakeAvailabilityNowMs}
						tooltip={statusTooltip}
					/>
				}
				icon={
					<AgentProfileRowIcon
						agentId={publicPresentation.iconAgentId}
						tone={rowTone}
					/>
				}
				menu={rowMoreMenu(profileDetails)}
				rowRef={input.rowRef}
				secondarySubtitle={
					controllerPermissionModeDisplay ? (
						<AgentProfileControllerPermissionModeInlineDisplay
							display={controllerPermissionModeDisplay}
						/>
					) : null
				}
				subtitle={
					publicPresentation.controllerModelDetail ?? "No local agent connected"
				}
				testId="agent-profile-execution-readiness"
				title={input.profile.profileName}
			/>
		),
		detail: rowMoreMenu(profileDetails, supportingContent),
	};
	return presentations[input.presentation];
}

function renderUnavailableAgentProfilePresentation(input: {
	controllerPermissionModeDisplay: ReturnType<
		typeof resolveWebAgentControllerPermissionModeDisplayFromBinding
	>;
	input: AgentProfileExecutionReadinessRowProps;
	menu: ReactNode;
	readiness: GetAgentExecutionReadinessResponse | null;
}) {
	if (input.input.presentation === "detail") {
		return input.menu;
	}
	return renderAgentProfileReadinessPlaceholderCard({
		agentControllerRef: input.input.directoryAgentControllerRef,
		controllerPermissionModeDisplay: input.controllerPermissionModeDisplay,
		errorMessage: input.input.errorMessage,
		isFocusedProfile: input.input.rowState.isFocused,
		isPending: input.input.rowState.isReadinessPending,
		menu: input.menu,
		onRepairAction: input.input.onRepairAction,
		profileCreatedAt: input.input.profile.createdAt,
		profileName: input.input.profile.profileName,
		readiness: input.readiness,
		repairActions: input.input.repairActions,
		repairIsPending: input.input.pendingState.repair,
		rowRef: input.input.rowRef,
		wakeAvailabilityNowMs: input.input.wakeAvailabilityNowMs,
	});
}

function AgentProfileExecutionReadinessRowMenu(input: {
	details: ProfileDetailsSnapshot;
	row: AgentProfileExecutionReadinessRowProps;
	supportingContent?: ReactNode;
}) {
	return (
		<AgentProfileRowMoreMenu
			activityNavigation={input.row.activityNavigation}
			actorProfileId={input.row.actorProfileId}
			capabilities={{
				canManage: input.row.rowState.canManage,
				hasEnabledPrimaryBinding:
					input.row.primaryBinding?.bindingState === "enabled_primary",
			}}
			controllerChangeOptions={input.row.controllerChangeOptions}
			details={input.details}
			editState={resolveAgentProfileEditState({
				binding: input.row.primaryBinding,
				modelCatalog: input.row.modelCatalog,
			})}
			modelCatalog={input.row.modelCatalog}
			modelCompatibilityContext={input.row.modelCompatibilityContext}
			onControllerChange={input.row.onControllerChange}
			onControllerCollaborationModeUpdate={
				input.row.onControllerCollaborationModeUpdate
			}
			onControllerPermissionModeUpdate={
				input.row.onControllerPermissionModeUpdate
			}
			onDisablePrimaryBinding={input.row.onDisablePrimaryBinding}
			onModelSelectionUpdate={input.row.onModelSelectionUpdate}
			onOpenCodePermissionUpdate={input.row.onOpenCodePermissionUpdate}
			onOpenDirectMessage={input.row.onOpenDirectMessage}
			onProfileUpdated={input.row.onProfileUpdated}
			onRecoveryAction={input.row.onRecoveryAction}
			onRemoveProfile={input.row.onRemoveProfile}
			onRenameProfile={input.row.onRenameProfile}
			onRepairAction={input.row.onRepairAction}
			operationalContext={input.row.operationalContext}
			organizationId={input.row.organizationId}
			ownerAvatarUrl={input.row.ownerAvatarUrl}
			ownerProfile={input.row.ownerProfile}
			pendingState={input.row.pendingState}
			presentation={input.row.presentation}
			primaryAgentControllerRef={
				input.row.primaryBinding?.executionTarget?.agentControllerRef ??
				input.row.readiness?.publicProfileConfiguration?.agentControllerRef ??
				input.row.directoryAgentControllerRef
			}
			primaryNativeSessionId={
				input.row.primaryBinding?.executionTarget
					?.agentControllerConversationId ?? null
			}
			profile={input.row.profile}
			profileName={input.row.profile.profileName}
			publicProfileConfiguration={
				input.row.readiness?.publicProfileConfiguration ?? null
			}
			readinessErrorMessage={input.row.errorMessage}
			readinessGeneratedAt={input.row.readiness?.generatedAt ?? null}
			readinessIsMissing={input.row.readiness === null}
			readinessIsPending={input.row.rowState.isReadinessPending}
			readinessIsRefreshing={input.row.rowState.isReadinessRefreshing}
			repairActions={input.row.repairActions}
			runtimeComputer={
				input.row.readiness?.routeDeviceId &&
				input.row.readiness.runtimeDeviceDisplayName
					? {
							deviceId: input.row.readiness.routeDeviceId,
							displayName: input.row.readiness.runtimeDeviceDisplayName,
						}
					: null
			}
			setupAction={input.row.setupAction}
			storageScope={input.row.storageScope}
			supportingContent={input.supportingContent}
			wakeAvailability={input.row.readiness?.agentWakeAvailability ?? null}
			wakeAvailabilityNowMs={input.row.wakeAvailabilityNowMs}
			workingFolderBindingTarget={
				projectAgentProfileBindingTarget(input.row.primaryBinding) ?? undefined
			}
			workingFolderTarget={
				input.row.readiness?.routeDeviceId && input.row.readiness.routeLane
					? {
							deviceId: input.row.readiness.routeDeviceId,
							runtimeLane: input.row.readiness.routeLane,
						}
					: undefined
			}
		/>
	);
}

function resolveAgentProfileVisualAvailability(input: {
	displayOverride: AgentWakeAvailability | null;
	rawAvailability: AgentWakeAvailability;
}): AgentWakeAvailability {
	return input.displayOverride ?? input.rawAvailability;
}

function renderAgentProfileCardActions(input: {
	folderRecovery: Parameters<typeof AgentProfileWorkingFolderRecoveryAction>[0];
	canCheckExpiredWakeRouteAgain: boolean;
	checkAgainIsPending: boolean;
	duplicateConversationProfileNames: readonly string[];
	hasControllerConversationConflict: boolean;
	hideSetupAction: boolean;
	onCheckAgain: () => Promise<void>;
	onRepairAction: (action: AgentProfileRepairAction) => Promise<void>;
	onRemoveProfile: () => Promise<void>;
	profileName: string;
	repairActions: readonly AgentProfileRepairAction[];
	repairIsPending: boolean;
	removeIsPending: boolean;
	setupAction: AgentProfileSetupAction | null;
}): ReactNode {
	let recoveryAction: ReactNode = null;
	if (input.hasControllerConversationConflict) {
		recoveryAction = (
			<AgentProfileConflictActions
				duplicateConversationProfileNames={
					input.duplicateConversationProfileNames
				}
				isPending={input.removeIsPending}
				onRemoveProfile={input.onRemoveProfile}
				profileName={input.profileName}
			/>
		);
	} else if (input.repairActions.length > 0) {
		recoveryAction = (
			<AgentProfileRepairActions
				actions={input.repairActions}
				isPending={input.repairIsPending}
				onRepairAction={input.onRepairAction}
			/>
		);
	} else if (input.setupAction && !input.hideSetupAction) {
		recoveryAction = (
			<AgentProfileSetupActionLink
				action={input.setupAction}
				folderRecovery={input.folderRecovery}
			/>
		);
	}

	const checkAgainAction = input.canCheckExpiredWakeRouteAgain ? (
		<div className="flex justify-start">
			<AgentProfileCheckAgainAction
				isPending={input.checkAgainIsPending}
				onCheckAgain={input.onCheckAgain}
			/>
		</div>
	) : null;

	if (!(recoveryAction || checkAgainAction)) {
		return null;
	}

	return (
		<div className="flex flex-col gap-2">
			{recoveryAction}
			{checkAgainAction}
		</div>
	);
}

function renderAgentProfileReadinessPlaceholderCard(input: {
	agentControllerRef: string | null;
	controllerPermissionModeDisplay: ReturnType<
		typeof resolveWebAgentControllerPermissionModeDisplayFromBinding
	>;
	errorMessage: string | null;
	isFocusedProfile: boolean;
	isPending: boolean;
	menu: ReactNode;
	onRepairAction: (action: AgentProfileRepairAction) => Promise<void>;
	profileCreatedAt: string | null;
	profileName: string;
	readiness: GetAgentExecutionReadinessResponse | null;
	repairActions: readonly AgentProfileRepairAction[];
	repairIsPending: boolean;
	rowRef?: Ref<HTMLElement>;
	wakeAvailabilityNowMs: number;
}): ReactNode {
	const agentId = parseAgentControllerRef(input.agentControllerRef)?.id ?? null;
	if (input.isPending && input.readiness === null) {
		return (
			<ProfileCard
				className={cn(
					"min-h-40",
					resolveFocusedAgentProfileClassName(input.isFocusedProfile)
				)}
				contextMenu
				footerLeft={
					<AgentProfileFooterDetail
						primaryDetail="Loading Wake availability"
						profileCreatedAt={input.profileCreatedAt}
					/>
				}
				footerRight={
					<AgentProfileFooterAvailabilityBadge
						className="text-muted-foreground"
						label="Loading"
						nowMs={input.wakeAvailabilityNowMs}
						tooltip="Loading Wake availability"
					/>
				}
				icon={<AgentProfileRowIcon agentId={agentId} tone="muted" />}
				menu={input.menu}
				rowRef={input.rowRef}
				secondarySubtitle={
					input.controllerPermissionModeDisplay ? (
						<AgentProfileControllerPermissionModeInlineDisplay
							display={input.controllerPermissionModeDisplay}
						/>
					) : null
				}
				subtitle="Loading Wake availability"
				testId="agent-profile-execution-readiness"
				title={input.profileName}
			/>
		);
	}

	if (input.errorMessage) {
		return (
			<ProfileCard
				className={cn(
					"min-h-40",
					resolveFocusedAgentProfileClassName(input.isFocusedProfile)
				)}
				contextMenu
				footerLeft={
					<AgentProfileFooterDetail
						primaryDetail={input.errorMessage}
						profileCreatedAt={input.profileCreatedAt}
					/>
				}
				footerRight={
					<AgentProfileFooterAvailabilityBadge
						className="text-muted-foreground"
						label="Couldn’t check availability."
						nowMs={input.wakeAvailabilityNowMs}
						tooltip={input.errorMessage}
					/>
				}
				icon={<AgentProfileRowIcon agentId={agentId} tone="muted" />}
				menu={input.menu}
				rowRef={input.rowRef}
				secondarySubtitle={
					input.controllerPermissionModeDisplay ? (
						<AgentProfileControllerPermissionModeInlineDisplay
							display={input.controllerPermissionModeDisplay}
						/>
					) : null
				}
				subtitle="Couldn’t check availability."
				testId="agent-profile-execution-readiness"
				title={input.profileName}
			/>
		);
	}

	if (input.readiness === null) {
		return (
			<ProfileCard
				actions={
					input.repairActions.length > 0 ? (
						<AgentProfileRepairActions
							actions={input.repairActions}
							isPending={input.repairIsPending}
							onRepairAction={input.onRepairAction}
						/>
					) : null
				}
				className={cn(
					"min-h-40",
					resolveFocusedAgentProfileClassName(input.isFocusedProfile)
				)}
				contextMenu
				dimTitle={true}
				footerLeft={
					<AgentProfileFooterDetail
						primaryDetail="OpenMeld has not checked this agent on this computer yet."
						profileCreatedAt={input.profileCreatedAt}
					/>
				}
				footerRight={
					<AgentProfileFooterAvailabilityBadge
						className="text-muted-foreground"
						label="Not checked"
						nowMs={input.wakeAvailabilityNowMs}
						tooltip="Not checked yet"
					/>
				}
				icon={<AgentProfileRowIcon agentId={agentId} tone="muted" />}
				menu={input.menu}
				rowRef={input.rowRef}
				secondarySubtitle={
					input.controllerPermissionModeDisplay ? (
						<AgentProfileControllerPermissionModeInlineDisplay
							display={input.controllerPermissionModeDisplay}
						/>
					) : null
				}
				subtitle="Wake availability not checked yet"
				testId="agent-profile-execution-readiness"
				title={input.profileName}
			/>
		);
	}

	return null;
}

function AgentProfileFooterDetail(input: {
	primaryDetail: string;
	profileCreatedAt: string | null;
}) {
	const created = formatProfileDate(input.profileCreatedAt);
	const primaryDetail = trimProfileFooterDetail(input.primaryDetail);

	if (!created) {
		return primaryDetail;
	}

	return (
		<span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
			<span>{primaryDetail}</span>
			<span className="hidden text-border sm:inline">/</span>
			<span>{`Created ${created}`}</span>
		</span>
	);
}

function trimProfileFooterDetail(value: string): string {
	return value.trim().replace(PROFILE_FOOTER_TRAILING_PERIOD_PATTERN, "");
}

function AgentProfileFooterAvailabilityBadge(input: {
	availabilityAction?: string | null;
	availabilityPhase?: string | null;
	availabilityReasonCode?: string | null;
	checkedAt?: string | null;
	className?: string;
	errorMessage?: string | null;
	isRefreshing?: boolean;
	label: string;
	nowMs: number;
	tooltip: string;
}) {
	const checkedAt = formatAgentWakeAvailabilityCheckedAt(
		input.checkedAt ?? null,
		input.nowMs
	);
	const statusText = (
		<TooltipHint content={input.tooltip}>
			<span
				className={cn(
					"block min-w-0 truncate font-medium text-xs",
					input.className
				)}
				data-availability-action={input.availabilityAction ?? undefined}
				data-availability-phase={input.availabilityPhase ?? undefined}
				data-availability-reason-code={
					input.availabilityReasonCode ?? undefined
				}
				data-testid="agent-profile-row-availability-badge"
			>
				{input.label}
				{checkedAt ? ` · ${checkedAt}` : ""}
				{input.isRefreshing ? (
					<span className="text-muted-foreground"> · Refreshing…</span>
				) : null}
				{input.errorMessage ? (
					<span className="text-muted-foreground" role="alert">
						{" · "}
						Couldn’t refresh availability.
						<span className="sr-only"> {input.errorMessage}</span>
					</span>
				) : null}
			</span>
		</TooltipHint>
	);

	return (
		<Tooltip>
			<TooltipTrigger render={statusText} />
			<TooltipContent
				className="max-w-sm whitespace-normal text-left leading-5"
				side="top"
			>
				{input.tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

function resolveAgentProfileStatusTextClassName(
	state: AgentWakeAvailabilityCategory
): string {
	switch (state) {
		case "available":
			return resolveStatusToneTextClassName("ready");
		case "checking":
			return resolveStatusToneTextClassName("checking");
		case "unavailable":
			return resolveStatusToneTextClassName("warning");
		case "offline":
			return resolveStatusToneTextClassName("muted");
		default:
			return "text-muted-foreground";
	}
}

function AgentProfileRowIcon(input: {
	agentId?: string | null;
	tone: AgentProfileVisualTone;
}) {
	if (input.agentId && hasLocalAgentLogo(input.agentId)) {
		return (
			<div
				aria-hidden="true"
				className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center"
				data-testid="agent-profile-controller-logo"
			>
				<LocalAgentLogo agentId={input.agentId} className="h-9 w-9" size="md" />
			</div>
		);
	}

	return (
		<div
			aria-hidden="true"
			className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
		>
			<RobotIcon className="h-5 w-5" />
		</div>
	);
}

function resolveAgentProfileDisplaySummary(input: {
	agentWakeAvailability: { label: string; summary: string };
}): string {
	return (
		input.agentWakeAvailability.summary || input.agentWakeAvailability.label
	);
}

function resolveAgentProfilePrimaryDetail(input: {
	availabilityState: ReturnType<
		typeof resolveAgentWakeAvailabilityDisplayCategory
	>;
	rowSummary: string;
	runtimeDeviceName: string;
}): string {
	if (input.availabilityState !== "available") {
		return input.rowSummary;
	}
	return formatAgentProfileExecutionComputerDetail(input.runtimeDeviceName);
}

function AgentProfileControllerPermissionModeInlineDisplay(input: {
	display: ReturnType<
		typeof resolveWebAgentControllerPermissionModeDisplayFromBinding
	>;
}) {
	if (!input.display) {
		return null;
	}
	return (
		<span data-testid="agent-controller-permission-mode-inline-display">
			<span data-testid="agent-controller-permission-mode-inline-label">
				{input.display.fieldLabel}:{" "}
			</span>
			<span
				className={cn(
					input.display.tone === "warning" ? "text-destructive" : null
				)}
				data-testid="agent-controller-permission-mode-inline-value"
			>
				{input.display.label}
			</span>
		</span>
	);
}

function AgentProfileConflictActions(input: {
	duplicateConversationProfileNames: readonly string[];
	isPending: boolean;
	onRemoveProfile: () => Promise<void>;
	profileName: string;
}) {
	const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
	const conflictDescription =
		input.duplicateConversationProfileNames.length > 0
			? `This Agent shares a reply conversation with ${formatListForSentence(input.duplicateConversationProfileNames)}. Keep one Agent for this reply conversation.`
			: "Keep one Agent for this reply conversation. Remove this Agent if it should not keep the conversation.";
	return (
		<div className="flex flex-wrap items-center gap-2 pt-1">
			<p className="text-muted-foreground text-xs">{conflictDescription}</p>
			<Button
				disabled={input.isPending}
				onClick={() => {
					setIsRemoveDialogOpen(true);
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				<TrashIcon aria-hidden="true" data-icon="inline-start" />
				{input.isPending ? "Removing..." : "Remove this profile"}
			</Button>
			<AgentProfileRemoveDialog
				isOpen={isRemoveDialogOpen}
				isPending={input.isPending}
				onOpenChange={setIsRemoveDialogOpen}
				onRemoveProfile={input.onRemoveProfile}
				profileName={input.profileName}
			/>
		</div>
	);
}

type AgentProfileControllerChangeEligibilityStatus =
	| "allowed"
	| "blocked"
	| "unavailable";

function shouldReadControllerChangeEligibility(input: {
	isMenuOpen: boolean;
	isProfileEditDialogOpen: boolean;
	isUnbindControllerDialogOpen: boolean;
}): boolean {
	return Object.values(input).some(Boolean);
}

function resolveControllerChangeStatusLabel(input: {
	isPending: boolean;
	status: AgentProfileControllerChangeEligibilityStatus;
}): string | null {
	if (input.status === "allowed") {
		return null;
	}
	if (input.status === "blocked") {
		return "Agent is working";
	}
	return input.isPending ? "Checking status" : "Status unavailable";
}

function isAgentProfileUnbindDisabled(input: {
	controllerChangeEligibilityStatus: AgentProfileControllerChangeEligibilityStatus;
	isProfileEditPending: boolean;
	isUnbindPending: boolean;
}): boolean {
	return (
		input.isUnbindPending ||
		input.isProfileEditPending ||
		input.controllerChangeEligibilityStatus !== "allowed"
	);
}

function AgentProfileOptionsMenu(input: {
	capabilities: {
		canManage: boolean;
		hasEnabledPrimaryBinding: boolean;
		showProjectSettings: boolean;
	};
	controllerChangeStatusLabel: string | null;
	disabledActions: {
		remove: boolean;
		unbindController: boolean;
	};
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onOpenDetails?: () => void;
	/**
	 * Opens Working folder. Omitted where the Working folder card is already
	 * on screen (the detail workspace), so there is one entry.
	 */
	onOpenProjectSettings?: () => void;
	onOpenRemove: () => void;
	onOpenUnbind: () => void;
	profileName: string;
	href: string;
	onEdit?: () => void;
	editDisabled?: boolean;
	onMessage: () => void;
	messageDisabled: boolean;
	showDetailsAction?: boolean;
}) {
	const items = (
		<>
			<ObjectMenuItems href={input.href} />
			<FluidDropdownMenuItem
				disabled={input.messageDisabled}
				index={4}
				onClick={input.onMessage}
			>
				<ChatCircleTextIcon aria-hidden="true" />
				Message
			</FluidDropdownMenuItem>
			{input.capabilities.canManage && input.onEdit && (
				<FluidDropdownMenuItem
					disabled={input.editDisabled}
					index={5}
					onClick={input.onEdit}
				>
					<WrenchIcon aria-hidden="true" />
					Edit Agent
				</FluidDropdownMenuItem>
			)}
			{input.showDetailsAction !== false && (
				<FluidDropdownMenuItem
					index={0}
					onClick={() => {
						input.onOpenChange(false);
						input.onOpenDetails?.();
					}}
				>
					<InfoIcon aria-hidden="true" />
					More details
				</FluidDropdownMenuItem>
			)}
			{input.capabilities.canManage && (
				<>
					{input.capabilities.showProjectSettings &&
						input.onOpenProjectSettings && (
							<FluidDropdownMenuItem
								index={1}
								onClick={() => {
									input.onOpenChange(false);
									input.onOpenProjectSettings?.();
								}}
							>
								<FolderOpenIcon aria-hidden="true" />
								Working folder
							</FluidDropdownMenuItem>
						)}
					{input.capabilities.hasEnabledPrimaryBinding && (
						<FluidDropdownMenuItem
							aria-description={input.controllerChangeStatusLabel ?? undefined}
							aria-label="Unbind controller"
							disabled={input.disabledActions.unbindController}
							index={2}
							onClick={() => {
								input.onOpenChange(false);
								input.onOpenUnbind();
							}}
							variant="destructive"
						>
							<WrenchIcon aria-hidden="true" />
							<span className="flex min-w-0 flex-1 justify-between gap-3">
								<span>Unbind controller</span>
								<span className="text-muted-foreground text-xs">
									{input.controllerChangeStatusLabel}
								</span>
							</span>
						</FluidDropdownMenuItem>
					)}
					<FluidDropdownMenuItem
						disabled={input.disabledActions.remove}
						index={3}
						onClick={() => {
							input.onOpenChange(false);
							input.onOpenRemove();
						}}
						variant="destructive"
					>
						<TrashIcon aria-hidden="true" />
						Remove profile
					</FluidDropdownMenuItem>
				</>
			)}
		</>
	);
	return (
		<>
			<DropdownMenu onOpenChange={input.onOpenChange} open={input.isOpen}>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Agent options for ${input.profileName}`}
							size="icon"
							type="button"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" />
				</DropdownMenuTrigger>
				<FluidDropdownMenuContent align="end" className="min-w-56">
					{items}
				</FluidDropdownMenuContent>
			</DropdownMenu>
			<FluidContextMenuContent className="min-w-56">
				{items}
			</FluidContextMenuContent>
		</>
	);
}

type AgentProfileRowMoreMenuProps = {
	workingFolderTarget?: PeopleComputerTarget;
	workingFolderBindingTarget?: AgentProfileBindingTarget;
	activityNavigation: AgentProfileActivityNavigation | null;
	actorProfileId: string | null;
	capabilities: {
		canManage: boolean;
		hasEnabledPrimaryBinding: boolean;
	};
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	details: ProfileDetailsSnapshot;
	editState: AgentProfileEditState | null;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext: AgentProfileModelCompatibilityContext | null;
	operationalContext: AgentProfileOperationalContextInput | null;
	onControllerChange: (
		update: AgentProfileControllerChangeUpdate
	) => Promise<void>;
	onControllerCollaborationModeUpdate: (
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) => Promise<void>;
	onControllerPermissionModeUpdate: (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => Promise<void>;
	onDisablePrimaryBinding: () => Promise<void>;
	onModelSelectionUpdate: (
		modelSelection: AgentProfileModelSelectionUpdate
	) => Promise<void>;
	onOpenCodePermissionUpdate: (
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) => Promise<void>;
	onOpenDirectMessage: () => Promise<void>;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	onProfileUpdated: (profile: AuthProfileView) => void;
	onRepairAction: (action: AgentProfileRepairAction) => Promise<void>;
	onRenameProfile: (profileName: string) => Promise<void>;
	onRemoveProfile: () => Promise<void>;
	organizationId: string;
	ownerAvatarUrl: string | null;
	profile: AuthProfileView;
	ownerProfile: AuthProfileView | null;
	profileName: string;
	readinessErrorMessage: string | null;
	readinessGeneratedAt: string | null;
	readinessIsMissing: boolean;
	readinessIsPending: boolean;
	readinessIsRefreshing: boolean;
	wakeAvailabilityNowMs: number;
	repairActions: readonly AgentProfileRepairAction[];
	primaryAgentControllerRef: string | null;
	primaryNativeSessionId: string | null;
	publicProfileConfiguration: NonNullable<
		GetAgentExecutionReadinessResponse["publicProfileConfiguration"]
	> | null;
	pendingState: AgentProfileActionPendingState;
	presentation?: "cards" | "detail";
	runtimeComputer: { deviceId: string; displayName: string } | null;
	setupAction: AgentProfileSetupAction | null;
	storageScope: string;
	supportingContent?: ReactNode;
	wakeAvailability: AgentWakeAvailability | null;
};

type AgentProfileRowDialogState = {
	detailsOpen: boolean;
	menuOpen: boolean;
	profileEditOpen: boolean;
	projectSettingsOpen: boolean;
	removeOpen: boolean;
	unbindControllerOpen: boolean;
};

const CLOSED_AGENT_PROFILE_ROW_DIALOG_STATE: AgentProfileRowDialogState = {
	detailsOpen: false,
	menuOpen: false,
	profileEditOpen: false,
	projectSettingsOpen: false,
	removeOpen: false,
	unbindControllerOpen: false,
};

function useAgentProfileRowDialogState() {
	const [state, updateState] = useReducer(
		(
			current: AgentProfileRowDialogState,
			patch: Partial<AgentProfileRowDialogState>
		) => ({
			...current,
			...patch,
		}),
		CLOSED_AGENT_PROFILE_ROW_DIALOG_STATE
	);
	return {
		state,
		setDetailsOpen: (detailsOpen: boolean) => updateState({ detailsOpen }),
		setMenuOpen: (menuOpen: boolean) => updateState({ menuOpen }),
		setProfileEditOpen: (profileEditOpen: boolean) =>
			updateState({ profileEditOpen }),
		setProjectSettingsOpen: (projectSettingsOpen: boolean) =>
			updateState({ projectSettingsOpen }),
		setRemoveOpen: (removeOpen: boolean) => updateState({ removeOpen }),
		setUnbindControllerOpen: (unbindControllerOpen: boolean) =>
			updateState({ unbindControllerOpen }),
	};
}

function useAgentProfileRowEligibility(input: {
	dialogState: AgentProfileRowDialogState;
	input: AgentProfileRowMoreMenuProps;
}) {
	const contextMenuOpen = useFluidContextMenuOpen();
	const controllerChangeEligibilityQuery = useQuery(
		agentProfileControllerChangeEligibilityQueryOptions({
			agentProfileId: input.input.profile.openMeldProfileId,
			enabled: shouldReadControllerChangeEligibility({
				isMenuOpen: input.dialogState.menuOpen || contextMenuOpen,
				isProfileEditDialogOpen:
					input.dialogState.profileEditOpen ||
					input.input.presentation === "detail",
				isUnbindControllerDialogOpen: input.dialogState.unbindControllerOpen,
			}),
			organizationId: input.input.organizationId,
			storageScope: input.input.storageScope,
		})
	);
	const controllerChangeEligibilityStatus =
		controllerChangeEligibilityQuery.data?.status ?? "unavailable";
	const isProfileEditPending =
		input.input.pendingState.controllerChange ||
		input.input.pendingState.controllerCollaborationMode ||
		input.input.pendingState.controllerPermissionMode ||
		input.input.pendingState.modelSelection ||
		input.input.pendingState.openCodePermission ||
		input.input.pendingState.rename;
	const controllerChangeStatusLabel = resolveControllerChangeStatusLabel({
		isPending: controllerChangeEligibilityQuery.isPending,
		status: controllerChangeEligibilityStatus,
	});
	const unbindControllerDisabled = isAgentProfileUnbindDisabled({
		controllerChangeEligibilityStatus,
		isProfileEditPending,
		isUnbindPending: input.input.pendingState.disablePrimaryBinding,
	});
	const showProjectSettings = shouldShowAgentProfileProjectSettings({
		agentControllerRef: input.input.primaryAgentControllerRef,
		managedRole: input.input.profile.managedRole,
	});
	return {
		controllerChangeEligibilityStatus,
		controllerChangeStatusLabel,
		isProfileEditPending,
		showProjectSettings,
		unbindControllerDisabled,
	};
}

function useAgentProfileCurrentSession(input: {
	canManage: boolean;
	detailsOpen: boolean;
	organizationId: string;
	organizationSlug: string;
	primaryNativeSessionId: string | null;
}) {
	const currentSessionQuery = useQuery(
		agentActivitySessionsQueryOptions({
			enabled:
				input.canManage &&
				input.detailsOpen &&
				Boolean(input.primaryNativeSessionId),
			limit: 1,
			nativeSessionId: input.primaryNativeSessionId ?? undefined,
			organizationId: input.organizationId,
		})
	);
	const currentSession = input.primaryNativeSessionId
		? (currentSessionQuery.data?.sessions.find(
				(session) => session.nativeSessionId === input.primaryNativeSessionId
			) ?? null)
		: null;
	const currentSessionLink =
		input.canManage &&
		input.primaryNativeSessionId &&
		currentSession?.computer.name
			? {
					computerName: currentSession.computer.name,
					href: `${buildOrganizationAgentActivitySessionsPath(input.organizationSlug)}?query=${encodeURIComponent(input.primaryNativeSessionId)}`,
					nativeSessionId: input.primaryNativeSessionId,
					title:
						currentSession?.nativeSessionTitle?.trim() ||
						currentSession?.localAgent.name ||
						"Local Agent Session",
				}
			: undefined;
	return currentSessionLink;
}

function resolveAgentProfileRowRuntime(input: {
	canManage: boolean;
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	organizationSlug: string;
	primaryAgentControllerRef: string | null;
	primaryNativeSessionId: string | null;
	runtimeComputer: { deviceId: string; displayName: string } | null;
}) {
	const runtimeControllerLabel =
		input.controllerChangeOptions.find(
			(option) => option.agentControllerRef === input.primaryAgentControllerRef
		)?.label ?? null;
	const runtime =
		input.canManage && input.runtimeComputer
			? {
					computerName: input.runtimeComputer.displayName,
					controllerConversationId: input.primaryNativeSessionId,
					controllerName:
						runtimeControllerLabel ??
						input.primaryAgentControllerRef ??
						"Local agent",
					managePath: buildOrganizationComputerPath({
						deviceId: input.runtimeComputer.deviceId,
						orgSlug: input.organizationSlug,
					}),
				}
			: null;
	return { runtime, runtimeControllerLabel };
}

function AgentProfileRowMoreMenu(input: AgentProfileRowMoreMenuProps) {
	const dialogs = useAgentProfileRowDialogState();
	const eligibility = useAgentProfileRowEligibility({
		dialogState: dialogs.state,
		input,
	});
	const { account, currentOrganization, currentUserId } = useAppOrganization();
	const currentSessionLink = useAgentProfileCurrentSession({
		canManage: input.capabilities.canManage,
		detailsOpen: dialogs.state.detailsOpen,
		organizationId: input.organizationId,
		organizationSlug: currentOrganization.slug,
		primaryNativeSessionId: input.primaryNativeSessionId,
	});
	const { runtime, runtimeControllerLabel } = resolveAgentProfileRowRuntime({
		canManage: input.capabilities.canManage,
		controllerChangeOptions: input.controllerChangeOptions,
		organizationSlug: currentOrganization.slug,
		primaryAgentControllerRef: input.primaryAgentControllerRef,
		primaryNativeSessionId: input.primaryNativeSessionId,
		runtimeComputer: input.runtimeComputer,
	});
	if (input.presentation === "detail") {
		return (
			<MemberAgentHarnessLock profileId={input.profile.openMeldProfileId}>
				<AgentProfileWorkspacePresentation
					controllerChangeEligibilityStatus={
						eligibility.controllerChangeEligibilityStatus
					}
					controllerChangeStatusLabel={eligibility.controllerChangeStatusLabel}
					input={input}
					onOpenChange={{
						details: dialogs.setDetailsOpen,
						menu: dialogs.setMenuOpen,
						profileEdit: dialogs.setProfileEditOpen,
						projectSettings: dialogs.setProjectSettingsOpen,
						remove: dialogs.setRemoveOpen,
						unbindController: dialogs.setUnbindControllerOpen,
					}}
					ownerAvatarUrl={
						input.profile.ownerUserId === currentUserId
							? (account.image ?? input.ownerAvatarUrl)
							: input.ownerAvatarUrl
					}
					presentationState={{
						...dialogs.state,
						profileEditPending: eligibility.isProfileEditPending,
					}}
					runtime={runtime}
					runtimeControllerLabel={runtimeControllerLabel}
					workspaceOptions={{
						showProjectSettings: eligibility.showProjectSettings,
						unbindControllerDisabled: eligibility.unbindControllerDisabled,
					}}
				/>
			</MemberAgentHarnessLock>
		);
	}
	return (
		<MemberAgentHarnessLock profileId={input.profile.openMeldProfileId}>
			<AgentProfileCardPresentation
				controllerChangeEligibilityStatus={
					eligibility.controllerChangeEligibilityStatus
				}
				controllerChangeStatusLabel={eligibility.controllerChangeStatusLabel}
				currentSession={currentSessionLink}
				input={input}
				onOpenChange={{
					details: dialogs.setDetailsOpen,
					menu: dialogs.setMenuOpen,
					profileEdit: dialogs.setProfileEditOpen,
					projectSettings: dialogs.setProjectSettingsOpen,
					remove: dialogs.setRemoveOpen,
					unbindController: dialogs.setUnbindControllerOpen,
				}}
				presentationState={{
					...dialogs.state,
					profileEditPending: eligibility.isProfileEditPending,
				}}
				runtime={runtime}
				showProjectSettings={eligibility.showProjectSettings}
				unbindControllerDisabled={eligibility.unbindControllerDisabled}
			/>
		</MemberAgentHarnessLock>
	);
}

function AgentProfileCardPresentation(input: {
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	controllerChangeStatusLabel: string | null;
	currentSession?: {
		computerName: string;
		href: string;
		nativeSessionId: string;
		title: string;
	};
	input: Parameters<typeof AgentProfileRowMoreMenu>[0];
	onOpenChange: {
		details: (open: boolean) => void;
		menu: (open: boolean) => void;
		profileEdit: (open: boolean) => void;
		projectSettings: (open: boolean) => void;
		remove: (open: boolean) => void;
		unbindController: (open: boolean) => void;
	};
	presentationState: {
		detailsOpen: boolean;
		menuOpen: boolean;
		profileEditOpen: boolean;
		profileEditPending: boolean;
		projectSettingsOpen: boolean;
		removeOpen: boolean;
		unbindControllerOpen: boolean;
	};
	runtime: {
		computerName: string;
		controllerConversationId?: string | null;
		controllerName: string;
		managePath: string;
	} | null;
	showProjectSettings: boolean;
	unbindControllerDisabled: boolean;
}) {
	return (
		<>
			<AgentProfileCardActions input={input} />
			<AgentProfileMoreDetailsDialog
				agentProfile={input.input.profile}
				details={input.input.details}
				onOpenChange={input.onOpenChange.details}
				open={input.presentationState.detailsOpen}
			/>
			<AgentProfileFoldersDialog
				actorProfileId={input.input.actorProfileId}
				agentControllerRef={input.input.primaryAgentControllerRef}
				executionTargetChangeEligibilityStatus={
					input.controllerChangeEligibilityStatus
				}
				expectedBindingTarget={input.input.workingFolderBindingTarget}
				onOpenChange={input.onOpenChange.projectSettings}
				onProfileUpdated={input.input.onProfileUpdated}
				open={input.presentationState.projectSettingsOpen}
				organizationId={input.input.organizationId}
				profile={input.input.profile}
				storageScope={input.input.storageScope}
				target={input.input.workingFolderTarget}
			/>
			<AgentProfileEditDialog
				controllerChangeEligibilityStatus={
					input.controllerChangeEligibilityStatus
				}
				controllerChangeOptions={input.input.controllerChangeOptions}
				editState={input.input.editState}
				isPending={input.presentationState.profileEditPending}
				modelCatalog={input.input.modelCatalog}
				modelCompatibilityContext={input.input.modelCompatibilityContext}
				onControllerChange={input.input.onControllerChange}
				onControllerCollaborationModeUpdate={
					input.input.onControllerCollaborationModeUpdate
				}
				onControllerPermissionModeUpdate={
					input.input.onControllerPermissionModeUpdate
				}
				onModelSelectionUpdate={input.input.onModelSelectionUpdate}
				onOpenChange={input.onOpenChange.profileEdit}
				onOpenCodePermissionUpdate={input.input.onOpenCodePermissionUpdate}
				onRenameProfile={input.input.onRenameProfile}
				open={input.presentationState.profileEditOpen}
				profileName={input.input.profileName}
				runtime={input.runtime}
			/>
			<AgentProfileUnbindControllerDialog
				controllerChangeEligibilityStatus={
					input.controllerChangeEligibilityStatus
				}
				isOpen={input.presentationState.unbindControllerOpen}
				isPending={input.input.pendingState.disablePrimaryBinding}
				onOpenChange={input.onOpenChange.unbindController}
				onUnbindController={input.input.onDisablePrimaryBinding}
				profileName={input.input.profileName}
			/>
			<AgentProfileRemoveDialog
				isOpen={input.presentationState.removeOpen}
				isPending={input.input.pendingState.remove}
				onOpenChange={input.onOpenChange.remove}
				onRemoveProfile={input.input.onRemoveProfile}
				profileName={input.input.profileName}
			/>
		</>
	);
}

function AgentProfileCardActions(input: {
	input: Parameters<typeof AgentProfileCardPresentation>[0];
}) {
	const { currentOrganization } = useAppOrganization();
	const presentation = input.input;
	const profile = presentation.input;
	return (
		<div className="flex items-center justify-end gap-1">
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label="Direct Message"
							disabled={profile.pendingState.directMessage}
							onClick={() => {
								profile.onOpenDirectMessage().catch((error) => {
									console.error("Direct Message action failed.", error);
								});
							}}
							size="icon"
							type="button"
							variant="ghost"
						>
							<ChatCircleTextIcon aria-hidden="true" />
						</Button>
					}
				/>
				<TooltipContent side="bottom">Direct Message</TooltipContent>
			</Tooltip>
			<AgentProfileCardEditAction input={presentation} />
			<AgentProfileOptionsMenu
				capabilities={{
					canManage: profile.capabilities.canManage,
					hasEnabledPrimaryBinding:
						profile.capabilities.hasEnabledPrimaryBinding &&
						!isHostedAgentControllerRef(profile.primaryAgentControllerRef),
					showProjectSettings: presentation.showProjectSettings,
				}}
				controllerChangeStatusLabel={presentation.controllerChangeStatusLabel}
				disabledActions={{
					remove: profile.pendingState.remove,
					unbindController: presentation.unbindControllerDisabled,
				}}
				editDisabled={
					presentation.presentationState.profileEditPending ||
					profile.pendingState.disablePrimaryBinding
				}
				href={`/o/${currentOrganization.slug}/agents?profileId=${encodeURIComponent(profile.profile.openMeldProfileId)}`}
				isOpen={presentation.presentationState.menuOpen}
				messageDisabled={profile.pendingState.directMessage}
				onEdit={() => presentation.onOpenChange.profileEdit(true)}
				onMessage={() => {
					profile
						.onOpenDirectMessage()
						.catch((error) =>
							console.error("Direct Message action failed.", error)
						);
				}}
				onOpenChange={presentation.onOpenChange.menu}
				onOpenDetails={() => presentation.onOpenChange.details(true)}
				onOpenProjectSettings={() =>
					presentation.onOpenChange.projectSettings(true)
				}
				onOpenRemove={() => presentation.onOpenChange.remove(true)}
				onOpenUnbind={() => presentation.onOpenChange.unbindController(true)}
				profileName={profile.profileName}
			/>
		</div>
	);
}

function AgentProfileCardEditAction(input: {
	input: Parameters<typeof AgentProfileCardPresentation>[0];
}) {
	if (!input.input.input.capabilities.canManage) {
		return null;
	}
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label="Edit Agent"
						disabled={
							input.input.presentationState.profileEditPending ||
							input.input.input.pendingState.disablePrimaryBinding
						}
						onClick={() => {
							input.input.onOpenChange.menu(false);
							input.input.onOpenChange.profileEdit(true);
						}}
						size="icon"
						type="button"
						variant="ghost"
					>
						<WrenchIcon aria-hidden="true" />
					</Button>
				}
			/>
			<TooltipContent side="bottom">Edit Agent</TooltipContent>
		</Tooltip>
	);
}

function AgentProfileWorkspacePresentation(input: {
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	controllerChangeStatusLabel: string | null;
	input: Parameters<typeof AgentProfileRowMoreMenu>[0];
	onOpenChange: {
		details: (open: boolean) => void;
		menu: (open: boolean) => void;
		profileEdit: (open: boolean) => void;
		projectSettings: (open: boolean) => void;
		remove: (open: boolean) => void;
		unbindController: (open: boolean) => void;
	};
	presentationState: {
		detailsOpen: boolean;
		menuOpen: boolean;
		profileEditOpen: boolean;
		profileEditPending: boolean;
		projectSettingsOpen: boolean;
		removeOpen: boolean;
		unbindControllerOpen: boolean;
	};
	ownerAvatarUrl: string | null | undefined;
	runtime: {
		computerName: string;
		controllerConversationId: string | null;
		controllerName: string;
		managePath: string;
	} | null;
	runtimeControllerLabel: string | null;
	workspaceOptions: {
		showProjectSettings: boolean;
		unbindControllerDisabled: boolean;
	};
}) {
	const { currentOrganization } = useAppOrganization();
	const projectId = input.input.profile.defaultProjectId;
	const folderQuery = useQuery(
		agentProfileWorkingFolderQueryOptions({
			actorProfileId: input.input.actorProfileId,
			organizationId: input.input.organizationId,
			profileId: input.input.profile.openMeldProfileId,
			storageScope: input.input.storageScope,
			target: input.input.workingFolderTarget,
			expectedBindingTarget: input.input.workingFolderBindingTarget,
			enabled:
				input.input.capabilities.canManage &&
				Boolean(input.input.workingFolderTarget) &&
				!isHostedAgentControllerRef(input.input.primaryAgentControllerRef),
		})
	);
	const folderSummary = describeSavedWorkingFolder(
		folderQuery.data?.workspace,
		folderQuery.isFetching
	);
	const projectsQuery = useQuery(
		projectsQueryOptions({
			organizationId: input.input.organizationId,
			enabled: Boolean(projectId),
		})
	);
	const workingFolderProjectName = projectId
		? (projectsQuery.data?.projects.find((project) => project.id === projectId)
				?.name ?? null)
		: null;
	const parsedControllerRef = parseAgentControllerRef(
		input.input.primaryAgentControllerRef
	);
	const controllerDisplayName =
		input.runtimeControllerLabel ??
		(parsedControllerRef
			? formatLocalAgentDisplayName(parsedControllerRef.id)
			: null);
	const modelPresentation = resolveWorkspaceModelPresentation(
		input.input,
		controllerDisplayName
	);
	const ownerControllerModelSummary = modelPresentation.summary;
	const controllerModelSummary = ownerControllerModelSummary;
	const modelIsLoading = modelPresentation.isLoading;
	const wakeAvailabilityRecoveryActions =
		input.input.readinessIsMissing &&
		input.input.readinessErrorMessage ? null : (
			<AgentProfileWakeAvailabilityRecoveryActions
				folderRecovery={{
					actorProfileId: input.input.actorProfileId,
					organizationId: input.input.organizationId,
					storageScope: input.input.storageScope,
					profile: input.input.profile,
					onProfileUpdated: input.input.onProfileUpdated,
				}}
				isPending={input.input.pendingState.repair}
				onRepairAction={input.input.onRepairAction}
				readinessIsPending={input.input.readinessIsPending}
				repairActions={input.input.repairActions}
				setupAction={input.input.setupAction}
			/>
		);
	const usageCard = (
		<AgentProfileUsage
			agentControllerRef={input.input.primaryAgentControllerRef}
			profileId={input.input.profile.openMeldProfileId}
			variant={input.input.capabilities.canManage ? "owner-card" : "card"}
		/>
	);
	const overflowActions = (
		<AgentProfileOptionsMenu
			capabilities={{
				canManage: input.input.capabilities.canManage,
				hasEnabledPrimaryBinding:
					input.input.capabilities.hasEnabledPrimaryBinding &&
					!isHostedAgentControllerRef(input.input.primaryAgentControllerRef),
				showProjectSettings: input.workspaceOptions.showProjectSettings,
			}}
			controllerChangeStatusLabel={input.controllerChangeStatusLabel}
			disabledActions={{
				remove: input.input.pendingState.remove,
				unbindController: input.workspaceOptions.unbindControllerDisabled,
			}}
			href={`/o/${currentOrganization.slug}/agents?profileId=${encodeURIComponent(input.input.profile.openMeldProfileId)}`}
			isOpen={input.presentationState.menuOpen}
			messageDisabled={input.input.pendingState.directMessage}
			onMessage={() => {
				input.input
					.onOpenDirectMessage()
					.catch((error) =>
						console.error("Direct Message action failed.", error)
					);
			}}
			onOpenChange={input.onOpenChange.menu}
			onOpenDetails={() => input.onOpenChange.details(true)}
			onOpenRemove={() => input.onOpenChange.remove(true)}
			onOpenUnbind={() => input.onOpenChange.unbindController(true)}
			profileName={input.input.profileName}
		/>
	);
	return (
		<>
			<AgentProfileWorkspaceDetail
				activityNavigation={input.input.activityNavigation}
				agentControllerRef={input.input.primaryAgentControllerRef}
				canEdit={input.input.capabilities.canManage}
				configurationContent={
					input.input.capabilities.canManage ? (
						<AgentProfileConfigurationOverview
							agentControllerRef={input.input.primaryAgentControllerRef}
							controllerChangeEligibilityStatus={
								input.controllerChangeEligibilityStatus
							}
							controllerChangeOptions={input.input.controllerChangeOptions}
							controllerDisplayName={controllerDisplayName}
							controllerModelSummary={ownerControllerModelSummary}
							details={input.input.details}
							disabled={
								input.presentationState.profileEditPending ||
								input.input.pendingState.disablePrimaryBinding
							}
							editState={input.input.editState}
							isLoading={modelIsLoading}
							modelCatalog={input.input.modelCatalog}
							modelCompatibilityContext={input.input.modelCompatibilityContext}
							onControllerChange={input.input.onControllerChange}
							onControllerCollaborationModeUpdate={
								input.input.onControllerCollaborationModeUpdate
							}
							onControllerPermissionModeUpdate={
								input.input.onControllerPermissionModeUpdate
							}
							onModelSelectionUpdate={input.input.onModelSelectionUpdate}
							onOpenCodePermissionUpdate={
								input.input.onOpenCodePermissionUpdate
							}
							onOpenProjectSettings={() =>
								input.onOpenChange.projectSettings(true)
							}
							onRenameProfile={input.input.onRenameProfile}
							ownerAvatarUrl={input.ownerAvatarUrl}
							ownerProfileId={
								input.input.ownerProfile?.openMeldProfileId ??
								input.input.ownerProfile?.ownerUserId
							}
							runtime={input.runtime}
							usageCard={usageCard}
							wakeAvailability={input.input.wakeAvailability}
							workingFolderPath={folderSummary.path}
							workingFolderProjectName={workingFolderProjectName}
							workingFolderProjectPending={
								Boolean(projectId) && projectsQuery.isPending
							}
							workingFolderProjectSelected={Boolean(projectId)}
							workingFolderSummary={folderSummary.summary}
						/>
					) : (
						<AgentProfileReadOnlyConfigurationOverview
							details={input.input.details}
							isLoading={input.input.readinessIsPending}
							modelValue={resolvePublicModelCardValue({
								modelCatalog: input.input.modelCatalog,
								publicProfileConfiguration:
									input.input.publicProfileConfiguration,
							})}
							publicProfileConfiguration={
								input.input.publicProfileConfiguration
							}
							usageCard={usageCard}
						/>
					)
				}
				controllerModelSummary={controllerModelSummary}
				conversationViewerProfileId={input.input.actorProfileId}
				details={input.input.details}
				headerRecoveryActions={wakeAvailabilityRecoveryActions}
				isDirectMessagePending={input.input.pendingState.directMessage}
				isRecoveryActionPending={input.input.pendingState.recoveryAction}
				modelId={
					input.input.editState?.modelSelection?.modelId ??
					input.input.publicProfileConfiguration?.modelSelection?.modelId ??
					input.input.modelCatalog?.agentControllers["center-agent"]
						?.hostedRuntimePolicy?.personalRemoteAgentDefaultModelId ??
					null
				}
				modelIsLoading={modelIsLoading}
				onAvatarUpdated={input.input.onProfileUpdated}
				onOpenDirectMessage={() => {
					input.input.onOpenDirectMessage().catch((error) => {
						console.error("Direct Message action failed.", error);
					});
				}}
				onRecoveryAction={input.input.onRecoveryAction}
				onRenameProfile={input.input.onRenameProfile}
				operationalContext={input.input.operationalContext}
				overflowActions={overflowActions}
				owner={{
					name:
						resolveProfileDetailsValue(input.input.details, "owner") ??
						"Unknown",
					avatarUrl: input.ownerAvatarUrl,
					profileId:
						input.input.ownerProfile?.openMeldProfileId ??
						input.input.ownerProfile?.ownerUserId ??
						input.input.profile.openMeldProfileId,
				}}
				profile={input.input.profile}
				supportingContent={
					input.input.repairActions.length > 0 || input.input.setupAction
						? null
						: input.input.supportingContent
				}
				wakeAvailability={input.input.wakeAvailability}
				wakeAvailabilityCheckedAt={input.input.readinessGeneratedAt}
				wakeAvailabilityErrorMessage={input.input.readinessErrorMessage}
				wakeAvailabilityIsPending={input.input.readinessIsPending}
				wakeAvailabilityIsRefreshing={
					input.input.readinessIsRefreshing ||
					input.input.wakeAvailability?.isRefreshing === true
				}
				wakeAvailabilityNowMs={input.input.wakeAvailabilityNowMs}
			/>
			<AgentProfileMoreDetailsDialog
				agentProfile={input.input.profile}
				details={input.input.details}
				onOpenChange={input.onOpenChange.details}
				open={input.presentationState.detailsOpen}
			/>
			<AgentProfileFoldersDialog
				actorProfileId={input.input.actorProfileId}
				agentControllerRef={input.input.primaryAgentControllerRef}
				executionTargetChangeEligibilityStatus={
					input.controllerChangeEligibilityStatus
				}
				expectedBindingTarget={input.input.workingFolderBindingTarget}
				onOpenChange={input.onOpenChange.projectSettings}
				onProfileUpdated={input.input.onProfileUpdated}
				open={input.presentationState.projectSettingsOpen}
				organizationId={input.input.organizationId}
				profile={input.input.profile}
				storageScope={input.input.storageScope}
				target={input.input.workingFolderTarget}
			/>
			<AgentProfileUnbindControllerDialog
				controllerChangeEligibilityStatus={
					input.controllerChangeEligibilityStatus
				}
				isOpen={input.presentationState.unbindControllerOpen}
				isPending={input.input.pendingState.disablePrimaryBinding}
				onOpenChange={input.onOpenChange.unbindController}
				onUnbindController={input.input.onDisablePrimaryBinding}
				profileName={input.input.profileName}
			/>
			<AgentProfileRemoveDialog
				isOpen={input.presentationState.removeOpen}
				isPending={input.input.pendingState.remove}
				onOpenChange={input.onOpenChange.remove}
				onRemoveProfile={input.input.onRemoveProfile}
				profileName={input.input.profileName}
			/>
		</>
	);
}

function resolveWorkspaceModelPresentation(
	input: AgentProfileRowMoreMenuProps,
	controllerDisplayName: string | null
): { isLoading: boolean; summary: string } {
	const configurationKnown =
		input.editState !== null || input.publicProfileConfiguration !== null;
	if (!configurationKnown) {
		return {
			isLoading: input.readinessIsPending,
			summary: "Model unavailable",
		};
	}
	return {
		isLoading: input.readinessIsPending && !configurationKnown,
		summary:
			resolveAgentProfileControllerModelDetail({
				agentControllerRef: input.primaryAgentControllerRef,
				controllerDisplayName,
				modelCatalog: input.modelCatalog,
				modelSelection: input.editState?.modelSelection
					? {
							modelId: input.editState.modelSelection.modelId,
							reasoningLevel:
								input.editState.modelSelection.reasoningLevel || undefined,
						}
					: (input.publicProfileConfiguration?.modelSelection ?? null),
			}) ?? "No Controller connected",
	};
}

type AgentProfileConfigurationOverviewProps = {
	workingFolderSummary?: string;
	/** The folder's full path, for the Working folder card's tooltip. */
	workingFolderPath?: string;
	workingFolderProjectName?: string | null;
	workingFolderProjectPending?: boolean;
	workingFolderProjectSelected?: boolean;
	usageCard?: ReactNode;
	isLoading?: boolean;
	agentControllerRef?: string | null;
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	controllerDisplayName: string | null;
	controllerModelSummary: string;
	details: ProfileDetailsSnapshot;
	disabled: boolean;
	editState: AgentProfileEditState | null;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext: AgentProfileModelCompatibilityContext | null;
	onControllerChange: (
		update: AgentProfileControllerChangeUpdate
	) => Promise<void>;
	onControllerCollaborationModeUpdate: (
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) => Promise<void>;
	onControllerPermissionModeUpdate: (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => Promise<void>;
	onModelSelectionUpdate: (
		modelSelection: AgentProfileModelSelectionUpdate
	) => Promise<void>;
	onOpenCodePermissionUpdate: (
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) => Promise<void>;
	onOpenProjectSettings?: () => void;
	onRenameProfile: (profileName: string) => Promise<void>;
	ownerAvatarUrl: string | null | undefined;
	ownerProfileId?: string | null;
	runtime: {
		computerName: string;
		controllerConversationId?: string | null;
		controllerName: string;
		managePath: string;
	} | null;
	showHeading?: boolean;
	compact?: boolean;
	wakeAvailability?: AgentWakeAvailability | null;
};

type AgentProfileConfigurationEditorId =
	| "model"
	| "collaboration"
	| "permissions";

function useAgentProfileConfigurationEditor(
	input: AgentProfileConfigurationOverviewProps
) {
	const confirmationId = useId();
	const permissionControlRef = useRef<HTMLButtonElement>(null);
	const [activeEditor, setActiveEditor] =
		useState<AgentProfileConfigurationEditorId | null>(null);
	const [savedEditor, setSavedEditor] =
		useState<AgentProfileConfigurationEditorId | null>(null);
	const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
	const [pendingEdit, setPendingEdit] = useState<{
		editor: AgentProfileConfigurationEditorId;
		summary: string;
	} | null>(null);
	const [failedEdits, setFailedEdits] = useState<
		Partial<
			Record<
				AgentProfileConfigurationEditorId,
				{
					draft: AgentProfileEditDraft;
					message: string;
				}
			>
		>
	>({});
	const savingRef = useRef(false);
	const draftInput = useMemo(
		() =>
			resolveAgentProfileEditDraftInput({
				editState: input.editState,
				open: true,
				profileName:
					resolveProfileDetailsValue(input.details, "name") ?? "Agent",
			}),
		[input.details, input.editState]
	);
	const [draft, setDraft] = useState<AgentProfileEditDraft>(() =>
		createAgentProfileEditDraft(draftInput)
	);
	const activeEditState = resolveActiveAgentProfileEditState({
		currentEditState: input.editState,
		modelCatalog: input.modelCatalog,
		selectedAgentControllerRef: draft.selectedAgentControllerRef,
	});
	const controllerPermissionMode =
		activeEditState?.controllerPermissionMode ?? null;
	const controllerCollaborationMode =
		activeEditState?.controllerCollaborationMode ?? null;
	const modelSelection = activeEditState?.modelSelection ?? null;
	const openCodePermission = activeEditState?.openCodePermission ?? null;
	const dialogState = resolveAgentProfileEditDialogState({
		activeDraft: scopeConfigurationDraft(
			draft,
			createAgentProfileEditDraft(draftInput),
			activeEditor
		),
		controllerCollaborationMode,
		controllerChangeEligibilityStatus: input.controllerChangeEligibilityStatus,
		controllerPermissionMode,
		currentAgentControllerRef: input.editState?.agentControllerRef ?? null,
		isPending: input.disabled || pendingEdit !== null,
		modelCatalog: input.modelCatalog,
		modelSelection,
		openCodePermission,
		profileName: draftInput.profileName,
	});
	const setEditorOpen = (
		editor: AgentProfileConfigurationEditorId,
		open: boolean
	) => {
		setSaveErrorMessage(null);
		if (open) {
			setDraft(
				failedEdits[editor]?.draft ?? createAgentProfileEditDraft(draftInput)
			);
			setSaveErrorMessage(failedEdits[editor]?.message ?? null);
			setActiveEditor(editor);
			return;
		}
		setActiveEditor((current) => (current === editor ? null : current));
	};
	const saveEditor = async (editor: AgentProfileConfigurationEditorId) => {
		if (savingRef.current || dialogState.saveButtonDisabled) {
			return;
		}
		savingRef.current = true;
		setSaveErrorMessage(null);
		setFailedEdits((current) => ({ ...current, [editor]: undefined }));
		setSavedEditor(null);
		setPendingEdit({
			editor,
			summary: resolveConfigurationDraftSummary({
				draft,
				editState: activeEditState,
				editor,
				modelCatalog: input.modelCatalog,
				controllerDisplayName: input.controllerDisplayName,
			}),
		});
		setActiveEditor(null);
		try {
			await submitAgentProfileEditDialogChanges({
				controllerChangeEligibilityStatus:
					input.controllerChangeEligibilityStatus,
				dialogState,
				onControllerChange: input.onControllerChange,
				onControllerCollaborationModeUpdate:
					input.onControllerCollaborationModeUpdate,
				onControllerPermissionModeUpdate:
					input.onControllerPermissionModeUpdate,
				onModelSelectionUpdate: input.onModelSelectionUpdate,
				onOpenChange: () => undefined,
				onOpenCodePermissionUpdate: input.onOpenCodePermissionUpdate,
				onRenameProfile: input.onRenameProfile,
			});
			setSavedEditor(editor);
			window.setTimeout(() => {
				setSavedEditor((current) => (current === editor ? null : current));
			}, 1600);
		} catch (error) {
			console.error("Failed to update Agent Profile setting.", error);
			const message =
				error instanceof Error
					? error.message
					: "Couldn’t save this setting. Try again.";
			setFailedEdits((current) => ({
				...current,
				[editor]: { draft, message },
			}));
		} finally {
			savingRef.current = false;
			setPendingEdit(null);
		}
	};
	const editorFooter = (editor: AgentProfileConfigurationEditorId) => (
		<>
			{pendingEdit ? (
				<output className="mb-3 block text-muted-foreground text-xs">
					Another setting is saving. You can keep editing.
				</output>
			) : null}
			{saveErrorMessage && activeEditor === editor ? (
				<p className="mb-3 text-destructive text-xs leading-5" role="alert">
					{saveErrorMessage}
				</p>
			) : null}
			<div className="mt-4 flex justify-end gap-2 border-border/70 border-t pt-3">
				<Button
					onClick={() => setEditorOpen(editor, false)}
					size="sm"
					type="button"
					variant="ghost"
				>
					Cancel
				</Button>
				<Button
					disabled={dialogState.saveButtonDisabled}
					onClick={() => {
						saveEditor(editor).catch(() => undefined);
					}}
					size="sm"
					type="button"
					variant={dialogState.permissionModeState.buttonVariant}
				>
					Save changes
				</Button>
			</div>
		</>
	);
	return {
		activeEditState,
		activeEditor,
		confirmationId,
		controllerCollaborationMode,
		controllerPermissionMode,
		dialogState,
		draft,
		draftInput,
		editorFooter,
		modelSelection,
		openCodePermission,
		pendingEdit,
		failedEdits,
		controlsDisabled: input.disabled && pendingEdit === null,
		permissionControlRef,
		savedEditor,
		setDraft,
		setEditorOpen,
	};
}

function resolveConfigurationDraftSummary(input: {
	draft: AgentProfileEditDraft;
	editState: AgentProfileEditState | null;
	editor: AgentProfileConfigurationEditorId;
	modelCatalog: ModelCatalog | null;
	controllerDisplayName: string | null;
}): string {
	if (input.editor === "model") {
		const catalog =
			input.modelCatalog?.agentControllers[
				input.editState?.modelSelection?.agentControllerId ?? ""
			];
		const modelId = input.draft.selectedModelId;
		const model = catalog?.models.find(
			(entry) => entry.id === (modelId || catalog.defaultModelId)
		);
		return [
			input.controllerDisplayName,
			model?.displayName ?? modelId,
			input.draft.selectedReasoningLevel,
		]
			.filter(Boolean)
			.join(" · ");
	}
	if (input.editor === "collaboration") {
		return (
			input.editState?.controllerCollaborationMode?.options.find(
				(option) => option.value === input.draft.selectedCollaborationMode
			)?.label ?? "Default"
		);
	}
	if (input.draft.selectedPolicy && input.editState?.controllerPermissionMode) {
		return getAgentControllerPermissionModeDisplayMetadata(
			input.draft.selectedPolicy,
			{
				agentControllerRef:
					input.editState.controllerPermissionMode.agentControllerRef,
			}
		).label;
	}
	return input.draft.selectedOpenCodePermission
		? "Custom permissions"
		: "Default";
}

function scopeConfigurationDraft(
	draft: AgentProfileEditDraft,
	current: AgentProfileEditDraft,
	editor: AgentProfileConfigurationEditorId | null
): AgentProfileEditDraft {
	// Validate and submit only the card's visible fields, rebasing hidden fields
	// onto current server values when another save or refresh completes.
	if (editor === "model") {
		return {
			...current,
			selectedModelId: draft.selectedModelId,
			selectedReasoningLevel: draft.selectedReasoningLevel,
		};
	}
	if (editor === "collaboration") {
		return {
			...current,
			selectedCollaborationMode: draft.selectedCollaborationMode,
		};
	}
	if (editor === "permissions") {
		return {
			...current,
			selectedPolicy: draft.selectedPolicy,
			selectedOpenCodePermission: draft.selectedOpenCodePermission,
			confirmed: draft.confirmed,
		};
	}
	return draft;
}

export function AgentProfileConfigurationOverview(
	input: AgentProfileConfigurationOverviewProps
) {
	const editor = useAgentProfileConfigurationEditor(input);
	const collaboration = input.editState?.controllerCollaborationMode;
	const collaborationSummary = collaboration
		? (collaboration.options.find(
				(option) => option.value === collaboration.value
			)?.label ?? "Default")
		: "Default";
	const permissionMode = input.editState?.controllerPermissionMode;
	const permissionSummary = permissionMode?.value
		? getAgentControllerPermissionModeDisplayMetadata(permissionMode.value, {
				agentControllerRef: permissionMode.agentControllerRef,
			}).label
		: "Default";
	const owner = resolveProfileDetailsValue(input.details, "owner") ?? "You";
	const ownerProfileId = input.ownerProfileId ?? owner;
	const workingFolderNeedsAttention =
		resolvePublicAgentFailureRecovery({
			errorCode: input.wakeAvailability?.reasonCode,
		})?.recoveryTarget === "working_folder";
	const workingFolder = resolveWorkingFolderSummary(
		input,
		workingFolderNeedsAttention
	);
	return (
		<section
			className="grid min-w-0 gap-3"
			data-testid="agent-configuration-overview"
		>
			<AgentProfileConfigurationHeading visible={input.showHeading !== false} />
			<AgentConfigurationGrid
				className={input.compact ? "lg:grid-cols-2" : "lg:grid-cols-3"}
			>
				{/* The page header names the owner; a dialog has no header. */}
				{input.compact ? (
					<AgentProfileOwnerConfigurationCard
						avatarUrl={input.ownerAvatarUrl}
						owner={owner}
						profileId={ownerProfileId}
					/>
				) : null}
				{input.isLoading ? (
					<AgentConfigurationSkeletonCard label="Model" />
				) : (
					<AgentProfileModelConfigurationCard editor={editor} input={input} />
				)}
				{isHostedAgentControllerRef(input.agentControllerRef) ? null : (
					<AgentProfileWorkingFolderSlot
						disabled={input.disabled}
						isLoading={input.isLoading}
						needsAttention={workingFolderNeedsAttention}
						onOpen={input.onOpenProjectSettings}
						path={workingFolder.path}
						summary={workingFolder.summary}
					/>
				)}
				{input.usageCard}
				{input.isLoading &&
				!isHostedAgentControllerRef(input.agentControllerRef) ? (
					<>
						<AgentConfigurationSkeletonCard label="Permissions" />
						<AgentConfigurationSkeletonCard label="Collaboration mode" />
					</>
				) : null}
				{input.isLoading ||
				isHostedAgentControllerRef(input.agentControllerRef) ? null : (
					<>
						<AgentProfilePermissionsConfigurationCard
							editor={editor}
							input={input}
							summary={permissionSummary}
						/>
						<AgentProfileCollaborationConfigurationCard
							editor={editor}
							input={input}
							summary={collaborationSummary}
						/>
					</>
				)}
				{input.runtime ? (
					<AgentConfigurationCard
						compact
						icon={<DesktopTowerIcon aria-hidden="true" />}
						itemId="runtime"
						label="Runs on"
						readOnly
						summary={input.runtime.computerName}
						summaryTitle={
							input.runtime.controllerConversationId
								? `Conversation ID: ${input.runtime.controllerConversationId}`
								: undefined
						}
					/>
				) : null}
			</AgentConfigurationGrid>
		</section>
	);
}

function resolveWorkingFolderSummary(
	input: AgentProfileConfigurationOverviewProps,
	needsAttention: boolean
): { summary: string; path?: string } {
	if (needsAttention) {
		return { summary: "Needs attention", path: input.workingFolderPath };
	}
	if (input.workingFolderProjectName) {
		return { summary: `Project: ${input.workingFolderProjectName}` };
	}
	if (input.workingFolderProjectPending) {
		return { summary: "Loading project…" };
	}
	if (input.workingFolderProjectSelected) {
		return { summary: "Project details unavailable" };
	}
	return {
		summary:
			input.workingFolderSummary ??
			resolveProfileDetailsValue(input.details, "workspace_directory") ??
			"Folder details unavailable",
		path: input.workingFolderPath,
	};
}

/** The model a colleague's Agent saved, or null when it saved none. */
function resolvePublicModelCardValue(input: {
	modelCatalog: ModelCatalog | null;
	publicProfileConfiguration: NonNullable<
		GetAgentExecutionReadinessResponse["publicProfileConfiguration"]
	> | null;
}): string | null {
	const configuration = input.publicProfileConfiguration;
	if (!configuration?.modelSelection?.modelId) {
		return null;
	}
	return (
		resolveAgentProfileModelCardValue({
			agentControllerRef: configuration.agentControllerRef ?? null,
			modelCatalog: input.modelCatalog,
			modelSelection: configuration.modelSelection,
		})?.value ?? null
	);
}

function AgentProfileReadOnlyConfigurationOverview(input: {
	usageCard?: ReactNode;
	isLoading?: boolean;
	/** Hidden when unknown: a viewer can't see the harness's own default. */
	modelValue: string | null;
	details: ProfileDetailsSnapshot;
	publicProfileConfiguration: NonNullable<
		GetAgentExecutionReadinessResponse["publicProfileConfiguration"]
	> | null;
}) {
	const isLoading = input.isLoading && !input.publicProfileConfiguration;
	const controllerRef = input.publicProfileConfiguration?.agentControllerRef;
	const collaborationMode =
		input.publicProfileConfiguration?.agentControllerCollaborationMode;
	const permissionMode =
		input.publicProfileConfiguration?.agentControllerPermissionMode;
	let collaborationSummary = "Default";
	if (collaborationMode === "codex:plan") {
		collaborationSummary = "Plan";
	} else if (collaborationMode) {
		collaborationSummary = "Default";
	}
	const permissionSummary = permissionMode
		? getAgentControllerPermissionModeDisplayMetadata(permissionMode, {
				agentControllerRef: controllerRef,
			}).label
		: "Default";
	return (
		<section
			className="grid min-w-0 gap-3"
			data-testid="agent-configuration-overview"
		>
			<h2 className="font-medium text-sm">How this Agent works</h2>
			<AgentConfigurationGrid className="lg:grid-cols-2">
				{isLoading ? <AgentConfigurationSkeletonCard label="Model" /> : null}
				{!isLoading && input.modelValue ? (
					<AgentConfigurationCard
						compact
						icon={<BrainIcon aria-hidden="true" />}
						itemId="model"
						label="Model"
						readOnly
						summary={input.modelValue}
					/>
				) : null}
				{input.usageCard}
				{isLoading ? (
					<AgentConfigurationSkeletonCard label="Permissions" />
				) : (
					<AgentConfigurationCard
						compact
						icon={<LockKeyIcon aria-hidden="true" />}
						itemId="permissions"
						label="Permissions"
						readOnly
						summary={
							input.publicProfileConfiguration
								? permissionSummary
								: "Not available"
						}
					/>
				)}
				{isLoading ? (
					<AgentConfigurationSkeletonCard label="Collaboration mode" />
				) : (
					<AgentConfigurationCard
						compact
						icon={<HandIcon aria-hidden="true" />}
						itemId="collaboration"
						label="Collaboration mode"
						readOnly
						summary={
							input.publicProfileConfiguration
								? collaborationSummary
								: "Not available"
						}
					/>
				)}
			</AgentConfigurationGrid>
		</section>
	);
}

type AgentProfileConfigurationEditor = ReturnType<
	typeof useAgentProfileConfigurationEditor
>;

function AgentProfileConfigurationHeading(input: { visible: boolean }) {
	if (!input.visible) {
		return null;
	}
	return (
		<div className="flex items-end justify-between gap-3">
			<h2 className="font-medium text-sm">How this Agent works</h2>
		</div>
	);
}

function AgentProfileOwnerConfigurationCard(input: {
	avatarUrl: string | null | undefined;
	owner: string;
	profileId: string;
}) {
	return (
		<AgentConfigurationCard
			icon={
				<DitherProfileAvatar
					avatarImageUrl={input.avatarUrl}
					profileId={input.profileId}
					profileKind="human"
					profileName={input.owner}
					size={28}
				/>
			}
			itemId="owner"
			label="Owner"
			readOnly
			summary={input.owner}
		/>
	);
}

function AgentProfileWorkingFolderSlot(input: {
	disabled: boolean;
	isLoading?: boolean;
	needsAttention: boolean;
	onOpen: (() => void) | undefined;
	path?: string;
	summary: string;
}) {
	if (input.isLoading) {
		return <AgentConfigurationSkeletonCard label="Working folder" />;
	}
	return (
		<AgentConfigurationCard
			actionLabel={input.needsAttention ? "Review working folder" : undefined}
			attention={input.needsAttention}
			compact
			description={input.needsAttention ? "Review working folder" : undefined}
			disabled={input.disabled || !input.onOpen}
			icon={<FolderOpenIcon aria-hidden="true" />}
			itemId="working-folder"
			label="Working folder"
			onClick={input.onOpen}
			readOnly={!input.onOpen}
			summary={input.summary}
			summaryTitle={input.path}
		/>
	);
}

function AgentProfileModelConfigurationCard(input: {
	editor: AgentProfileConfigurationEditor;
	input: AgentProfileConfigurationOverviewProps;
}) {
	const { editor, input: props } = input;
	const selection = editor.modelSelection;
	const controller = selection
		? props.modelCatalog?.agentControllers[selection.agentControllerId]
		: null;
	const model = controller?.models.find(
		(entry) => entry.id === selection?.modelId
	);
	// What a new chat uses; the hosted summary already names its model.
	const cardValue = isHostedAgentControllerRef(props.agentControllerRef)
		? null
		: resolveAgentProfileModelCardValue({
				agentControllerRef: props.agentControllerRef ?? null,
				modelCatalog: props.modelCatalog,
				modelSelection: selection
					? {
							modelId: selection.modelId,
							reasoningLevel: selection.reasoningLevel || undefined,
						}
					: null,
			});
	const retirement = resolveModelRetirementDisplay(
		model,
		props.modelCompatibilityContext
	);
	let retirementTone: "danger" | "warning" | undefined;
	if (retirement) {
		retirementTone = retirement.status === "withdrawn" ? "danger" : "warning";
	}
	const retirementDescription = retirement
		? formatModelRetirementNotice(retirement)
		: undefined;
	return (
		<AgentConfigurationCard
			actionLabel={retirement ? "Change model" : undefined}
			attention={Boolean(retirement)}
			attentionTone={retirementTone}
			compact
			description={
				editor.failedEdits.model
					? "Changes weren’t saved. Open to retry."
					: retirementDescription
			}
			disabled={
				editor.controlsDisabled || editor.pendingEdit?.editor === "model"
			}
			icon={<BrainIcon aria-hidden="true" />}
			itemId="model"
			label="Model"
			onOpenChange={(open) => editor.setEditorOpen("model", open)}
			open={editor.activeEditor === "model"}
			readOnly={!editor.modelSelection}
			status={resolveAgentConfigurationCardStatus({
				active: editor.pendingEdit?.editor === "model",
				disabled: editor.pendingEdit !== null,
				saved: editor.savedEditor === "model",
			})}
			summary={
				editor.pendingEdit?.editor === "model"
					? editor.pendingEdit.summary
					: (cardValue?.value ?? props.controllerModelSummary)
			}
		>
			<AgentProfileModelSelectionEditSection
				activeDraft={editor.draft}
				disabled={editor.controlsDisabled}
				draftKey={editor.draftInput.draftKey}
				modelCatalog={props.modelCatalog}
				modelCompatibilityContext={props.modelCompatibilityContext}
				modelSelection={editor.modelSelection}
				onDraftChange={editor.setDraft}
			/>
			{editor.editorFooter("model")}
		</AgentConfigurationCard>
	);
}

function AgentProfileCollaborationConfigurationCard(input: {
	editor: AgentProfileConfigurationEditor;
	input: AgentProfileConfigurationOverviewProps;
	summary: string;
}) {
	const { editor } = input;
	return (
		<AgentConfigurationCard
			compact
			description={
				editor.failedEdits.collaboration
					? "Changes weren’t saved. Open to retry."
					: undefined
			}
			disabled={
				editor.controlsDisabled ||
				editor.pendingEdit?.editor === "collaboration"
			}
			icon={<HandIcon aria-hidden="true" />}
			itemId="collaboration"
			label="Collaboration mode"
			onOpenChange={(open) => editor.setEditorOpen("collaboration", open)}
			open={editor.activeEditor === "collaboration"}
			readOnly={!editor.controllerCollaborationMode?.editable}
			status={resolveAgentConfigurationCardStatus({
				active: editor.pendingEdit?.editor === "collaboration",
				disabled: editor.pendingEdit !== null,
				saved: editor.savedEditor === "collaboration",
			})}
			summary={
				editor.pendingEdit?.editor === "collaboration"
					? editor.pendingEdit.summary
					: input.summary
			}
		>
			<AgentProfileCollaborationModeEditSection
				activeDraft={editor.draft}
				controllerCollaborationMode={editor.controllerCollaborationMode}
				disabled={editor.controlsDisabled}
				draftKey={editor.draftInput.draftKey}
				onDraftChange={editor.setDraft}
			/>
			{editor.editorFooter("collaboration")}
		</AgentConfigurationCard>
	);
}

function AgentProfilePermissionsConfigurationCard(input: {
	editor: AgentProfileConfigurationEditor;
	input: AgentProfileConfigurationOverviewProps;
	summary: string;
}) {
	const { editor, input: props } = input;
	return (
		<AgentConfigurationCard
			compact
			description={
				editor.failedEdits.permissions
					? "Changes weren’t saved. Open to retry."
					: undefined
			}
			disabled={
				editor.controlsDisabled || editor.pendingEdit?.editor === "permissions"
			}
			icon={<LockKeyIcon aria-hidden="true" />}
			itemId="permissions"
			label="Permissions"
			onOpenChange={(open) => editor.setEditorOpen("permissions", open)}
			open={editor.activeEditor === "permissions"}
			readOnly={
				!(
					editor.controllerPermissionMode?.editable || editor.openCodePermission
				)
			}
			status={resolveAgentConfigurationCardStatus({
				active: editor.pendingEdit?.editor === "permissions",
				disabled: editor.pendingEdit !== null,
				saved: editor.savedEditor === "permissions",
			})}
			summary={
				editor.pendingEdit?.editor === "permissions"
					? editor.pendingEdit.summary
					: input.summary
			}
		>
			<div className="grid gap-4">
				<AgentProfilePermissionModeEditSection
					activeDraft={editor.draft}
					confirmationId={editor.confirmationId}
					controllerPermissionMode={editor.controllerPermissionMode}
					disabled={editor.controlsDisabled}
					draftKey={editor.draftInput.draftKey}
					focusRef={editor.permissionControlRef}
					isAgentWorking={props.controllerChangeEligibilityStatus === "blocked"}
					onDraftChange={editor.setDraft}
					selectedPolicy={editor.dialogState.selectedPolicy}
				/>
				<AgentProfileOpenCodePermissionEditSection
					activeDraft={editor.draft}
					disabled={editor.controlsDisabled}
					draftKey={editor.draftInput.draftKey}
					onDraftChange={editor.setDraft}
					openCodePermission={editor.openCodePermission}
				/>
			</div>
			{editor.editorFooter("permissions")}
		</AgentConfigurationCard>
	);
}

function resolveAgentConfigurationCardStatus(input: {
	active: boolean;
	disabled: boolean;
	saved: boolean;
}): "idle" | "saving" | "saved" {
	if (input.active && input.disabled) {
		return "saving";
	}
	return input.saved ? "saved" : "idle";
}

function resolveProfileDetailsValue(
	details: ProfileDetailsSnapshot,
	rowId: string
): string | null {
	for (const section of details.sections) {
		const row = section.rows.find((candidate) => candidate.id === rowId);
		if (row?.value) {
			return row.value;
		}
	}
	return null;
}

function createAgentProfileEditDraft(
	input: CreateAgentProfileEditDraftInput
): AgentProfileEditDraft {
	return {
		confirmed: false,
		key: input.draftKey,
		profileName: input.profileName,
		selectedAgentControllerRef: null,
		selectedCollaborationMode: input.currentCollaborationMode,
		selectedModelId: input.currentModelId,
		selectedOpenCodePermission: input.currentOpenCodePermission,
		selectedPolicy: input.currentPermissionMode,
		selectedReasoningLevel: input.currentReasoningLevel,
	};
}

function resolveAgentProfileEditDraftInput(input: {
	editState: AgentProfileEditState | null;
	open: boolean;
	profileName: string;
}): CreateAgentProfileEditDraftInput {
	const controllerCollaborationMode =
		input.editState?.controllerCollaborationMode ?? null;
	const controllerPermissionMode =
		input.editState?.controllerPermissionMode ?? null;
	const modelSelection = input.editState?.modelSelection ?? null;
	const openCodePermission = input.editState?.openCodePermission ?? null;
	return {
		currentCollaborationMode: controllerCollaborationMode?.value ?? null,
		currentModelId: modelSelection?.modelId ?? "",
		currentOpenCodePermission: openCodePermission?.value ?? null,
		currentPermissionMode: controllerPermissionMode?.value ?? null,
		currentReasoningLevel: modelSelection?.reasoningLevel ?? "",
		draftKey: [
			input.profileName,
			controllerCollaborationMode?.agentControllerRef ?? "none",
			controllerCollaborationMode?.value ?? "none",
			controllerPermissionMode?.agentControllerRef ?? "none",
			controllerPermissionMode?.value ?? "none",
			modelSelection?.agentControllerRef ?? "none",
			modelSelection?.modelId ?? "none",
			modelSelection?.reasoningLevel ?? "none",
			formatOpenCodePermissionJson(openCodePermission?.value ?? null),
			input.open ? "open" : "closed",
		].join(":"),
		profileName: input.profileName,
	};
}

export function AgentProfileEditDialog(input: {
	controllerChangeEligibilityStatus?: "allowed" | "blocked" | "unavailable";
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	editState: AgentProfileEditState | null;
	isLoading?: boolean;
	initialSection?: "permissions";
	isPending: boolean;
	loadErrorMessage?: string | null;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	onControllerChange: (
		update: AgentProfileControllerChangeUpdate
	) => Promise<void>;
	onControllerCollaborationModeUpdate: (
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) => Promise<void>;
	onControllerPermissionModeUpdate: (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => Promise<void>;
	onModelSelectionUpdate: (
		modelSelection: AgentProfileModelSelectionUpdate
	) => Promise<void>;
	onOpenCodePermissionUpdate: (
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) => Promise<void>;
	onOpenChange: (isOpen: boolean) => void;
	onRenameProfile: (profileName: string) => Promise<void>;
	onSaveComplete?: () => Promise<void>;
	open: boolean;
	profileName: string;
	runtime?: {
		computerName: string;
		controllerName: string;
		managePath: string;
	} | null;
}) {
	const draftInput = useMemo(
		() =>
			resolveAgentProfileEditDraftInput({
				editState: input.editState,
				open: input.open,
				profileName: input.profileName,
			}),
		[input.editState, input.open, input.profileName]
	);
	return (
		<AgentProfileEditDialogContent
			key={draftInput.draftKey}
			{...input}
			draftInput={draftInput}
		/>
	);
}

type AgentProfileInlineEditorProps = Omit<
	Parameters<typeof AgentProfileEditDialog>[0],
	"onOpenChange" | "open"
> & {
	onCancel: () => void;
};

export function AgentProfileInlineEditor(input: AgentProfileInlineEditorProps) {
	const draftInput = useMemo(
		() =>
			resolveAgentProfileEditDraftInput({
				editState: input.editState,
				open: true,
				profileName: input.profileName,
			}),
		[input.editState, input.profileName]
	);
	return <AgentProfileInlineEditorContent {...input} draftInput={draftInput} />;
}

function AgentProfileInlineEditorContent(
	input: AgentProfileInlineEditorProps & {
		draftInput: CreateAgentProfileEditDraftInput;
	}
) {
	const confirmationId = useId();
	const profileNameInputId = useId();
	const permissionControlRef = useRef<HTMLButtonElement>(null);
	const draftKey = input.draftInput.draftKey;
	const [draft, setDraft] = useState<AgentProfileEditDraft>(() =>
		createAgentProfileEditDraft(input.draftInput)
	);
	const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
	const activeEditState = resolveActiveAgentProfileEditState({
		currentEditState: input.editState,
		modelCatalog: input.modelCatalog,
		selectedAgentControllerRef: draft.selectedAgentControllerRef,
	});
	const controllerPermissionMode =
		activeEditState?.controllerPermissionMode ?? null;
	const controllerCollaborationMode =
		activeEditState?.controllerCollaborationMode ?? null;
	const modelSelection = activeEditState?.modelSelection ?? null;
	const openCodePermission = activeEditState?.openCodePermission ?? null;
	const dialogState = resolveAgentProfileEditDialogState({
		activeDraft: draft,
		controllerCollaborationMode,
		controllerChangeEligibilityStatus:
			input.controllerChangeEligibilityStatus ?? "allowed",
		controllerPermissionMode,
		currentAgentControllerRef: input.editState?.agentControllerRef ?? null,
		isPending: input.isPending,
		modelCatalog: input.modelCatalog,
		modelSelection,
		openCodePermission,
		profileName: input.profileName,
	});

	return (
		<section
			className="min-w-0 space-y-5"
			data-testid="agent-profile-inline-editor"
		>
			<div className="space-y-1">
				<div className="flex items-center gap-1.5">
					<h2 className="font-semibold text-xl">Edit Agent</h2>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="When Agent changes take effect"
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<InfoIcon aria-hidden="true" />
								</Button>
							}
						/>
						<TooltipContent className="max-w-80" side="top">
							{AGENT_PROFILE_CHANGE_TIMING_SUMMARY}
						</TooltipContent>
					</Tooltip>
				</div>
				<p className="text-muted-foreground text-sm">
					Update settings for {input.profileName}.
				</p>
			</div>
			<AgentProfileEditRuntimeSummary runtime={input.runtime} />
			<AgentProfileEditFieldsState
				fields={{
					activeDraft: draft,
					activeEditState,
					confirmationId,
					controllerChangeEligibilityStatus:
						input.controllerChangeEligibilityStatus ?? "allowed",
					controllerChangeOptions: input.controllerChangeOptions,
					controllerCollaborationMode,
					controllerPermissionMode,
					dialogState,
					disabled: input.isPending,
					draftKey,
					editState: input.editState,
					modelCatalog: input.modelCatalog,
					modelCompatibilityContext: input.modelCompatibilityContext,
					modelSelection,
					onDraftChange: setDraft,
					openCodePermission,
					permissionControlRef,
					profileNameInputId,
				}}
				isLoading={input.isLoading === true}
				loadErrorMessage={input.loadErrorMessage ?? null}
			/>
			{saveErrorMessage ? (
				<p
					className="rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm"
					role="alert"
				>
					{saveErrorMessage}
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border border-t pt-4">
				<Button
					disabled={input.isPending}
					onClick={input.onCancel}
					type="button"
					variant="outline"
				>
					Cancel
				</Button>
				<Button
					disabled={
						input.isLoading ||
						Boolean(input.loadErrorMessage) ||
						dialogState.saveButtonDisabled
					}
					onClick={() => {
						setSaveErrorMessage(null);
						submitAgentProfileEditDialogChanges({
							controllerChangeEligibilityStatus:
								input.controllerChangeEligibilityStatus ?? "allowed",
							dialogState,
							onControllerChange: input.onControllerChange,
							onControllerCollaborationModeUpdate:
								input.onControllerCollaborationModeUpdate,
							onControllerPermissionModeUpdate:
								input.onControllerPermissionModeUpdate,
							onModelSelectionUpdate: input.onModelSelectionUpdate,
							onOpenChange: (open) => {
								if (!open) {
									input.onCancel();
								}
							},
							onOpenCodePermissionUpdate: input.onOpenCodePermissionUpdate,
							onRenameProfile: input.onRenameProfile,
							onSaveComplete: input.onSaveComplete,
						}).catch((error: unknown) => {
							console.error("Failed to update Agent Profile.", error);
							setSaveErrorMessage(
								error instanceof Error
									? error.message
									: "OpenMeld could not save these Agent changes."
							);
						});
					}}
					type="button"
					variant={dialogState.permissionModeState.buttonVariant}
				>
					{input.isPending ? "Saving..." : "Save changes"}
				</Button>
			</div>
		</section>
	);
}

function AgentProfileEditDialogContent(
	input: Parameters<typeof AgentProfileEditDialog>[0] & {
		draftInput: CreateAgentProfileEditDraftInput;
	}
) {
	const confirmationId = useId();
	const profileNameInputId = useId();
	const permissionControlRef = useRef<HTMLButtonElement>(null);
	const didFocusInitialPermissionsRef = useRef(false);
	const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
	const draftKey = input.draftInput.draftKey;
	const [draft, setDraft] = useState<AgentProfileEditDraft>(() =>
		createAgentProfileEditDraft(input.draftInput)
	);
	const activeDraft = draft;
	const activeEditState = resolveActiveAgentProfileEditState({
		currentEditState: input.editState,
		modelCatalog: input.modelCatalog,
		selectedAgentControllerRef: activeDraft.selectedAgentControllerRef,
	});
	const controllerPermissionMode =
		activeEditState?.controllerPermissionMode ?? null;
	const hasControllerPermissionMode = controllerPermissionMode !== null;
	const controllerCollaborationMode =
		activeEditState?.controllerCollaborationMode ?? null;
	const modelSelection = activeEditState?.modelSelection ?? null;
	const openCodePermission = activeEditState?.openCodePermission ?? null;
	const dialogState = resolveAgentProfileEditDialogState({
		activeDraft,
		controllerCollaborationMode,
		controllerChangeEligibilityStatus:
			input.controllerChangeEligibilityStatus ?? "allowed",
		controllerPermissionMode,
		currentAgentControllerRef: input.editState?.agentControllerRef ?? null,
		isPending: input.isPending,
		modelCatalog: input.modelCatalog,
		modelSelection,
		openCodePermission,
		profileName: input.profileName,
	});
	useEffect(() => {
		if (!input.open) {
			didFocusInitialPermissionsRef.current = false;
			return;
		}
		if (
			didFocusInitialPermissionsRef.current ||
			input.initialSection !== "permissions" ||
			input.isLoading ||
			input.loadErrorMessage ||
			!hasControllerPermissionMode
		) {
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			const control = permissionControlRef.current;
			if (!control) {
				return;
			}
			didFocusInitialPermissionsRef.current = true;
			control.focus({ preventScroll: true });
			control.scrollIntoView?.({ block: "nearest" });
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [
		hasControllerPermissionMode,
		input.initialSection,
		input.isLoading,
		input.loadErrorMessage,
		input.open,
	]);

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!input.isPending) {
					input.onOpenChange(nextOpen);
				}
			}}
			open={input.open}
		>
			<DialogContent
				className="sm:max-w-3xl"
				initialFocus={
					input.initialSection === "permissions" &&
					controllerPermissionMode?.editable
						? permissionControlRef
						: undefined
				}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-1.5">
						Edit Agent
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										aria-label="When Agent changes take effect"
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<InfoIcon aria-hidden="true" />
									</Button>
								}
							/>
							<TooltipContent className="max-w-80" side="top">
								{AGENT_PROFILE_CHANGE_TIMING_SUMMARY}
							</TooltipContent>
						</Tooltip>
					</DialogTitle>
					<DialogDescription>
						Update settings for {input.profileName}.
					</DialogDescription>
				</DialogHeader>
				<AgentProfileEditRuntimeSummary runtime={input.runtime} />
				<AgentProfileEditFieldsState
					fields={{
						activeDraft,
						activeEditState,
						confirmationId,
						controllerChangeEligibilityStatus:
							input.controllerChangeEligibilityStatus ?? "allowed",
						controllerChangeOptions: input.controllerChangeOptions,
						controllerCollaborationMode,
						controllerPermissionMode,
						dialogState,
						disabled: input.isPending,
						draftKey,
						editState: input.editState,
						modelCatalog: input.modelCatalog,
						modelCompatibilityContext: input.modelCompatibilityContext,
						modelSelection,
						onDraftChange: setDraft,
						openCodePermission,
						permissionControlRef,
						profileNameInputId,
					}}
					isLoading={input.isLoading === true}
					loadErrorMessage={input.loadErrorMessage ?? null}
				/>
				{saveErrorMessage ? (
					<p className="text-destructive text-sm" role="alert">
						{saveErrorMessage}
					</p>
				) : null}
				<DialogFooter>
					<DialogClose
						render={
							<Button
								disabled={input.isPending}
								type="button"
								variant="outline"
							/>
						}
					>
						Cancel
					</DialogClose>
					<Button
						disabled={
							input.isLoading ||
							Boolean(input.loadErrorMessage) ||
							dialogState.saveButtonDisabled
						}
						onClick={() => {
							setSaveErrorMessage(null);
							submitAgentProfileEditDialogChanges({
								dialogState,
								onControllerCollaborationModeUpdate:
									input.onControllerCollaborationModeUpdate,
								onControllerPermissionModeUpdate:
									input.onControllerPermissionModeUpdate,
								onModelSelectionUpdate: input.onModelSelectionUpdate,
								onOpenCodePermissionUpdate: input.onOpenCodePermissionUpdate,
								onOpenChange: input.onOpenChange,
								onRenameProfile: input.onRenameProfile,
								onControllerChange: input.onControllerChange,
								controllerChangeEligibilityStatus:
									input.controllerChangeEligibilityStatus ?? "allowed",
								onSaveComplete: input.onSaveComplete,
							}).catch((error) => {
								console.error("Failed to update Agent Profile.", error);
								setSaveErrorMessage(
									error instanceof Error
										? error.message
										: "Couldn’t save these settings. Try again."
								);
							});
						}}
						type="button"
						variant={dialogState.permissionModeState.buttonVariant}
					>
						{input.isPending ? "Saving..." : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AgentProfileEditRuntimeSummary(input: {
	runtime: Parameters<typeof AgentProfileEditDialog>[0]["runtime"];
}) {
	if (!input.runtime) {
		return null;
	}
	return (
		<div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
			<div className="min-w-0">
				<p className="text-muted-foreground text-xs">Runtime</p>
				<p className="truncate font-medium text-sm">
					{input.runtime.controllerName} on {input.runtime.computerName}
				</p>
			</div>
			<Link
				className={buttonVariants({ size: "sm", variant: "outline" })}
				to={input.runtime.managePath}
			>
				Manage on Computer
			</Link>
		</div>
	);
}

function AgentProfileEditFieldsState(input: {
	fields: Parameters<typeof AgentProfileEditDialogFields>[0];
	isLoading: boolean;
	loadErrorMessage: string | null;
}) {
	if (input.isLoading) {
		return <SkeletonForm className="py-6" label="Loading Agent settings" />;
	}
	if (input.loadErrorMessage) {
		return (
			<p className="rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
				{input.loadErrorMessage}
			</p>
		);
	}
	return <AgentProfileEditDialogFields {...input.fields} />;
}

function AgentProfileEditDialogFields(input: {
	activeDraft: AgentProfileEditDraft;
	activeEditState: AgentProfileEditState | null;
	confirmationId: string;
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	controllerCollaborationMode: AgentProfileControllerCollaborationModeEditState | null;
	controllerPermissionMode: AgentProfileControllerPermissionModeEditState | null;
	dialogState: AgentProfileEditDialogState;
	disabled: boolean;
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	draftKey: string;
	editState: AgentProfileEditState | null;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	modelSelection: AgentProfileModelSelectionEditState | null;
	onDraftChange: (draft: AgentProfileEditDraft) => void;
	openCodePermission: AgentProfileOpenCodePermissionEditState | null;
	permissionControlRef: Ref<HTMLButtonElement>;
	profileNameInputId: string;
}) {
	const nameLocked = useMemberAgentProfileNameLocked();
	return (
		<div className="grid gap-5">
			<AgentConfigurationEditorCard
				description="Keep it recognizable when several Agents use similar setups."
				icon={<RobotIcon aria-hidden="true" />}
				label="Name"
			>
				<div className="grid gap-2">
					<Label className="sr-only" htmlFor={input.profileNameInputId}>
						Name
					</Label>
					{nameLocked ? (
						<p className="text-sm">
							{input.activeDraft.profileName}
							<span className="mt-1 block text-muted-foreground text-xs">
								The default Profile is named after its harness.
							</span>
						</p>
					) : (
						<Input
							disabled={input.disabled}
							id={input.profileNameInputId}
							onChange={(event) => {
								input.onDraftChange({
									...input.activeDraft,
									key: input.draftKey,
									profileName: event.target.value,
								});
							}}
							value={input.activeDraft.profileName}
						/>
					)}
					{input.dialogState.profileNameChanged &&
					!input.dialogState.profileNameIsValid ? (
						<p className="text-destructive text-xs">Enter an Agent name.</p>
					) : null}
				</div>
			</AgentConfigurationEditorCard>
			{input.editState && input.activeEditState ? (
				<AgentConfigurationGrid>
					<AgentConfigurationEditorCard
						description="Changing this can interrupt where the Agent runs."
						icon={<DesktopTowerIcon aria-hidden="true" />}
						label="Runs on"
					>
						<div className="grid gap-3">
							<AgentProfileControllerChangeEditSection
								activeDraft={input.activeDraft}
								currentAgentControllerRef={input.editState.agentControllerRef}
								currentControllerCollaborationMode={
									input.editState.controllerCollaborationMode
								}
								currentControllerPermissionMode={
									input.editState.controllerPermissionMode
								}
								currentModelSelection={input.editState.modelSelection}
								disabled={
									input.disabled ||
									input.controllerChangeEligibilityStatus !== "allowed"
								}
								draftKey={input.draftKey}
								modelCatalog={input.modelCatalog}
								onDraftChange={input.onDraftChange}
								options={input.controllerChangeOptions}
							/>
							<ControllerChangeAvailabilityNote
								status={input.controllerChangeEligibilityStatus}
							/>
						</div>
					</AgentConfigurationEditorCard>
					<AgentConfigurationEditorCard
						description="Choose the model and how deeply it reasons."
						icon={<BrainIcon aria-hidden="true" />}
						label="Model"
					>
						<AgentProfileModelSelectionEditSection
							activeDraft={input.activeDraft}
							disabled={input.disabled}
							draftKey={input.draftKey}
							modelCatalog={input.modelCatalog}
							modelCompatibilityContext={input.modelCompatibilityContext}
							modelSelection={input.modelSelection}
							onDraftChange={input.onDraftChange}
						/>
					</AgentConfigurationEditorCard>
					<AgentConfigurationEditorCard
						description="How Codex works with you during a task."
						icon={<HandIcon aria-hidden="true" />}
						label="Collaboration"
					>
						<AgentProfileCollaborationModeEditSection
							activeDraft={input.activeDraft}
							controllerCollaborationMode={input.controllerCollaborationMode}
							disabled={input.disabled}
							draftKey={input.draftKey}
							onDraftChange={input.onDraftChange}
						/>
					</AgentConfigurationEditorCard>
					<AgentConfigurationEditorCard
						description="What this Agent can do without asking."
						icon={<LockKeyIcon aria-hidden="true" />}
						label="Permissions"
					>
						<div className="grid gap-4">
							<AgentProfilePermissionModeEditSection
								activeDraft={input.activeDraft}
								confirmationId={input.confirmationId}
								controllerPermissionMode={input.controllerPermissionMode}
								disabled={input.disabled}
								draftKey={input.draftKey}
								focusRef={input.permissionControlRef}
								isAgentWorking={
									input.controllerChangeEligibilityStatus === "blocked"
								}
								onDraftChange={input.onDraftChange}
								selectedPolicy={input.dialogState.selectedPolicy}
							/>
							<AgentProfileOpenCodePermissionEditSection
								activeDraft={input.activeDraft}
								disabled={input.disabled}
								draftKey={input.draftKey}
								onDraftChange={input.onDraftChange}
								openCodePermission={input.openCodePermission}
							/>
						</div>
					</AgentConfigurationEditorCard>
				</AgentConfigurationGrid>
			) : (
				<AgentProfileBindingUnavailableEditSection />
			)}
		</div>
	);
}

function ControllerChangeAvailabilityNote(input: {
	status: "allowed" | "blocked" | "unavailable";
}) {
	if (input.status === "blocked") {
		return (
			<div className="grid gap-1 text-muted-foreground text-xs leading-5">
				<p>
					Controller changes are unavailable while this Agent is working because
					reconnecting would interrupt the current Wake.
				</p>
				<p>
					Model, reasoning effort, collaboration mode, and OpenCode permission
					changes apply to the next Wake.
				</p>
			</div>
		);
	}
	if (input.status === "unavailable") {
		return (
			<p className="text-muted-foreground text-xs leading-5">
				OpenMeld couldn’t confirm whether this Agent is working, so controller
				changes are temporarily unavailable. Try again.
			</p>
		);
	}
	return null;
}

function AgentProfileControllerChangeEditSection(input: {
	activeDraft: AgentProfileEditDraft;
	currentAgentControllerRef: string;
	currentControllerCollaborationMode: AgentProfileControllerCollaborationModeEditState | null;
	currentControllerPermissionMode: AgentProfileControllerPermissionModeEditState | null;
	currentModelSelection: AgentProfileModelSelectionEditState | null;
	disabled: boolean;
	draftKey: string;
	modelCatalog: ModelCatalog | null;
	onDraftChange: (draft: AgentProfileEditDraft) => void;
	options: readonly AgentProfileControllerChangeOption[];
}) {
	const harnessLocked = useMemberAgentHarnessLocked();
	const selectId = useId();
	const selectedControllerRef =
		input.activeDraft.selectedAgentControllerRef ?? "";
	const currentLabel =
		resolveAgentProfileControllerOptionLabel({
			agentControllerRef: input.currentAgentControllerRef,
			options: input.options,
		}) ?? input.currentAgentControllerRef;
	const selectedLabel = selectedControllerRef
		? resolveAgentProfileControllerOptionLabel({
				agentControllerRef: selectedControllerRef,
				options: input.options,
			})
		: null;
	return (
		<div className="grid gap-2">
			<Label htmlFor={selectId}>Controller</Label>
			<p className="text-muted-foreground text-xs leading-5">
				Current controller: {currentLabel}
			</p>
			{harnessLocked ? (
				<p className="text-muted-foreground text-xs leading-5">
					This Profile belongs to an Agent, so it always runs on that Agent’s
					harness.
				</p>
			) : (
				<Select
					disabled={input.disabled || input.options.length === 0}
					onValueChange={(agentControllerRef) => {
						const nextAgentControllerRef =
							normalizeAgentProfileEditText(agentControllerRef);
						if (!nextAgentControllerRef) {
							input.onDraftChange({
								...input.activeDraft,
								confirmed: false,
								key: input.draftKey,
								selectedAgentControllerRef: null,
								selectedCollaborationMode:
									input.currentControllerCollaborationMode?.value ?? null,
								selectedModelId: input.currentModelSelection?.modelId ?? "",
								selectedOpenCodePermission: null,
								selectedPolicy:
									input.currentControllerPermissionMode?.value ?? null,
								selectedReasoningLevel:
									input.currentModelSelection?.reasoningLevel ?? "",
							});
							return;
						}
						const nextPermissionMode = nextAgentControllerRef
							? resolveDefaultAgentProfileEditPermissionMode({
									agentControllerRef: nextAgentControllerRef,
									modelCatalog: input.modelCatalog,
								})
							: null;
						const nextCollaborationMode = nextAgentControllerRef
							? resolveDefaultAgentProfileEditCollaborationMode({
									agentControllerRef: nextAgentControllerRef,
									modelCatalog: input.modelCatalog,
								})
							: null;
						input.onDraftChange({
							...input.activeDraft,
							confirmed: false,
							key: input.draftKey,
							selectedAgentControllerRef: nextAgentControllerRef,
							selectedCollaborationMode: nextCollaborationMode,
							selectedModelId: "",
							selectedOpenCodePermission: null,
							selectedPolicy: nextPermissionMode,
							selectedReasoningLevel: "",
						});
					}}
					value={selectedControllerRef}
				>
					<SelectTrigger
						aria-label="Change controller"
						className="h-10 w-full px-3 text-sm"
						displayValue={selectedLabel ?? "Change controller..."}
						id={selectId}
						placeholder="Change controller..."
					/>
					<SelectContent className="max-h-64">
						<SelectItem index={0} value="">
							Keep current controller
						</SelectItem>
						{input.options.map((option, index) => (
							<SelectItem
								index={index + 1}
								key={option.agentControllerRef}
								value={option.agentControllerRef}
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	);
}

function AgentProfileBindingUnavailableEditSection() {
	return (
		<div className="grid gap-2">
			<p className="font-medium text-sm">Local agent binding</p>
			<p className="text-muted-foreground text-xs leading-5">
				Connect this Agent to a local tool before editing model, reasoning
				effort, permission mode, or controller.
			</p>
		</div>
	);
}

function resolveActiveAgentProfileEditState(input: {
	currentEditState: AgentProfileEditState | null;
	modelCatalog: ModelCatalog | null;
	selectedAgentControllerRef: string | null;
}): AgentProfileEditState | null {
	if (!input.selectedAgentControllerRef) {
		return input.currentEditState;
	}
	return createAgentProfileEditStateForController({
		agentControllerRef: input.selectedAgentControllerRef,
		modelCatalog: input.modelCatalog,
	});
}

function createAgentProfileEditStateForController(input: {
	agentControllerRef: string;
	modelCatalog: ModelCatalog | null;
}): AgentProfileEditState | null {
	const parsedAgentControllerRef = parseAgentControllerRef(
		input.agentControllerRef
	);
	if (!parsedAgentControllerRef) {
		return null;
	}
	const capabilities = resolveAgentProfileEditCapabilities({
		agentControllerRef: input.agentControllerRef,
		modelCatalog: input.modelCatalog,
	});
	return {
		agentControllerId: parsedAgentControllerRef.id,
		agentControllerRef: input.agentControllerRef,
		capabilities,
		controllerCollaborationMode: {
			agentControllerRef: input.agentControllerRef,
			editable: capabilities.collaborationMode.editable,
			options: capabilities.collaborationMode.options,
			value: capabilities.collaborationMode.options[0]?.value ?? null,
		},
		controllerPermissionMode: {
			agentControllerRef: input.agentControllerRef,
			editable: capabilities.permissionMode.editable,
			options: capabilities.permissionMode.options,
			value: capabilities.permissionMode.options[0]?.value ?? null,
		},
		modelSelection: capabilities.modelSelection.editable
			? {
					agentControllerId: getAgentControllerModelCatalogId(
						parsedAgentControllerRef
					),
					agentControllerRef: input.agentControllerRef,
					modelId: "",
					reasoningLevel: "",
				}
			: null,
		openCodePermission: isOpenCodeAgentControllerRef(input.agentControllerRef)
			? {
					agentControllerRef: input.agentControllerRef,
					value: null,
				}
			: null,
	};
}

function resolveDefaultAgentProfileEditPermissionMode(input: {
	agentControllerRef: string;
	modelCatalog: ModelCatalog | null;
}): AgentControllerPermissionMode | null {
	return (
		resolveAgentProfileEditCapabilities(input).permissionMode.options[0]
			?.value ?? null
	);
}

function resolveDefaultAgentProfileEditCollaborationMode(input: {
	agentControllerRef: string;
	modelCatalog: ModelCatalog | null;
}): AgentControllerCollaborationMode | null {
	return (
		resolveAgentProfileEditCapabilities(input).collaborationMode.options[0]
			?.value ?? null
	);
}

function resolveAgentProfileEditDialogState(input: {
	activeDraft: AgentProfileEditDraft;
	controllerCollaborationMode: AgentProfileControllerCollaborationModeEditState | null;
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	controllerPermissionMode: AgentProfileControllerPermissionModeEditState | null;
	currentAgentControllerRef: string | null;
	isPending: boolean;
	modelCatalog: ModelCatalog | null;
	modelSelection: AgentProfileModelSelectionEditState | null;
	openCodePermission: AgentProfileOpenCodePermissionEditState | null;
	profileName: string;
}): AgentProfileEditDialogState {
	const normalizedDraftProfileName =
		normalizeAgentProfileEditText(input.activeDraft.profileName) ?? "";
	const normalizedCurrentProfileName =
		normalizeAgentProfileEditText(input.profileName) ?? "";
	const profileNameChanged =
		normalizedDraftProfileName !== normalizedCurrentProfileName;
	const profileNameIsValid = normalizedDraftProfileName.length > 0;
	const selectedPolicy = input.activeDraft.selectedPolicy;
	const selectedCollaborationMode = input.activeDraft.selectedCollaborationMode;
	const permissionModeState = resolveAgentProfileEditPermissionModeState({
		controllerPermissionMode: input.controllerPermissionMode,
		isControllerChange:
			input.activeDraft.selectedAgentControllerRef !== null &&
			input.activeDraft.selectedAgentControllerRef !==
				input.currentAgentControllerRef,
		selectedPolicy,
	});
	const selectedModelId = input.activeDraft.selectedModelId;
	const selectedReasoningLevel = input.activeDraft.selectedReasoningLevel;
	const saveModelId = resolveAgentProfileEditModelId({
		modelCatalog: input.modelCatalog,
		modelSelection: input.modelSelection,
		selectedModelId,
	});
	const modelSelectionChanged =
		input.modelSelection !== null &&
		(selectedModelId !== input.modelSelection.modelId ||
			selectedReasoningLevel !== input.modelSelection.reasoningLevel);
	const openCodePermissionChanged =
		input.openCodePermission !== null &&
		!openCodePermissionEquals(
			input.activeDraft.selectedOpenCodePermission,
			input.openCodePermission.value
		);
	const permissionModeChanged =
		input.controllerPermissionMode?.editable === true &&
		selectedPolicy !== null &&
		selectedPolicy !== input.controllerPermissionMode.value;
	const collaborationModeChanged =
		input.controllerCollaborationMode?.editable === true &&
		selectedCollaborationMode !== null &&
		selectedCollaborationMode !== input.controllerCollaborationMode.value;
	const saveControllerRef = input.activeDraft.selectedAgentControllerRef;
	const controllerChanged =
		saveControllerRef !== null &&
		saveControllerRef !== input.currentAgentControllerRef;
	const hasChanges =
		profileNameChanged ||
		controllerChanged ||
		modelSelectionChanged ||
		collaborationModeChanged ||
		permissionModeChanged ||
		openCodePermissionChanged;

	return {
		collaborationModeChanged,
		controllerChanged,
		hasChanges,
		modelSelectionChanged,
		normalizedDraftProfileName,
		openCodePermissionChanged,
		permissionModeChanged,
		permissionModeState,
		profileNameChanged,
		profileNameIsValid,
		saveButtonDisabled:
			input.isPending ||
			!hasChanges ||
			(controllerChanged &&
				input.controllerChangeEligibilityStatus !== "allowed") ||
			(profileNameChanged && !profileNameIsValid) ||
			(modelSelectionChanged && !saveModelId) ||
			(permissionModeState.requiresConfirmation &&
				!input.activeDraft.confirmed),
		saveControllerRef,
		saveModelId,
		saveOpenCodePermission: input.activeDraft.selectedOpenCodePermission,
		selectedCollaborationMode,
		selectedPolicy,
		selectedReasoningLevel,
	};
}

type AgentProfileEditSubmissionInput = {
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	dialogState: AgentProfileEditDialogState;
	onControllerChange: (
		update: AgentProfileControllerChangeUpdate
	) => Promise<void>;
	onControllerCollaborationModeUpdate: (
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) => Promise<void>;
	onControllerPermissionModeUpdate: (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => Promise<void>;
	onModelSelectionUpdate: (
		modelSelection: AgentProfileModelSelectionUpdate
	) => Promise<void>;
	onOpenCodePermissionUpdate: (
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) => Promise<void>;
	onOpenChange: (isOpen: boolean) => void;
	onRenameProfile: (profileName: string) => Promise<void>;
	onSaveComplete?: () => Promise<void>;
};

async function submitAgentProfileEditDialogChanges(
	input: AgentProfileEditSubmissionInput
) {
	if (
		input.dialogState.controllerChanged &&
		input.controllerChangeEligibilityStatus !== "allowed"
	) {
		throw new Error(
			input.controllerChangeEligibilityStatus === "blocked"
				? "Controller changes are unavailable while this Agent is working."
				: "OpenMeld couldn’t confirm whether this Agent is working. Try again."
		);
	}
	let completedMutation = false;
	const runMutation = async (mutation: () => Promise<void>) => {
		await mutation();
		completedMutation = true;
	};
	try {
		await submitAgentProfileBindingChanges({ input, runMutation });
		if (input.dialogState.profileNameChanged) {
			await runMutation(
				async () =>
					await input.onRenameProfile(
						input.dialogState.normalizedDraftProfileName
					)
			);
		}
	} catch (error) {
		if (completedMutation) {
			await input.onSaveComplete?.();
		}
		throw error;
	}
	await input.onSaveComplete?.();
	input.onOpenChange(false);
}

async function submitAgentProfileBindingChanges(input: {
	input: AgentProfileEditSubmissionInput;
	runMutation: (mutation: () => Promise<void>) => Promise<void>;
}) {
	const submission = input.input;
	if (submission.dialogState.controllerChanged) {
		const agentControllerRef = submission.dialogState.saveControllerRef;
		if (!agentControllerRef) {
			throw new Error("Agent Controller is required.");
		}
		await input.runMutation(
			async () =>
				await submission.onControllerChange({
					agentControllerCollaborationMode:
						submission.dialogState.selectedCollaborationMode,
					agentControllerPermissionMode: submission.dialogState.selectedPolicy,
					agentControllerRef,
					modelId: submission.dialogState.saveModelId,
					openCodePermission: submission.dialogState.saveOpenCodePermission,
					reasoningLevel: submission.dialogState.selectedReasoningLevel || null,
				})
		);
		return;
	}
	const selectedCollaborationMode =
		submission.dialogState.selectedCollaborationMode;
	if (
		submission.dialogState.collaborationModeChanged &&
		selectedCollaborationMode !== null
	) {
		await input.runMutation(
			async () =>
				await submission.onControllerCollaborationModeUpdate(
					selectedCollaborationMode
				)
		);
	}
	if (submission.dialogState.modelSelectionChanged) {
		const modelId = submission.dialogState.saveModelId;
		if (!modelId) {
			throw new Error("Model selection is required.");
		}
		await input.runMutation(
			async () =>
				await submission.onModelSelectionUpdate({
					modelId,
					reasoningLevel: submission.dialogState.selectedReasoningLevel || null,
				})
		);
	}
	const selectedPolicy = submission.dialogState.selectedPolicy;
	if (submission.dialogState.permissionModeChanged && selectedPolicy !== null) {
		await input.runMutation(
			async () =>
				await submission.onControllerPermissionModeUpdate(selectedPolicy)
		);
	}
	if (submission.dialogState.openCodePermissionChanged) {
		await input.runMutation(
			async () =>
				await submission.onOpenCodePermissionUpdate(
					submission.dialogState.saveOpenCodePermission
				)
		);
	}
}

function AgentProfileModelSelectionEditSection(input: {
	activeDraft: AgentProfileEditDraft;
	disabled: boolean;
	draftKey: string;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	modelSelection: AgentProfileModelSelectionEditState | null;
	onDraftChange: (draft: AgentProfileEditDraft) => void;
}) {
	if (!input.modelSelection) {
		return null;
	}
	const modelSelection = input.modelSelection;
	const selectedReasoningLevel = input.activeDraft.selectedReasoningLevel;
	return (
		<AgentProfileModelSelectionFields
			agentId={modelSelection.agentControllerId}
			disabled={input.disabled}
			modelCatalog={input.modelCatalog}
			modelCompatibilityContext={input.modelCompatibilityContext}
			modelId={input.activeDraft.selectedModelId}
			onChangeModelId={(modelId) => {
				const nextReasoningLevel =
					resolveAgentProfileEditReasoningLevelForModel({
						agentControllerId: modelSelection.agentControllerId,
						currentReasoningLevel: selectedReasoningLevel,
						modelCatalog: input.modelCatalog,
						modelId,
					});
				input.onDraftChange({
					...input.activeDraft,
					key: input.draftKey,
					selectedModelId: modelId,
					selectedReasoningLevel: nextReasoningLevel,
				});
			}}
			onChangeReasoningLevel={(reasoningLevel) => {
				input.onDraftChange({
					...input.activeDraft,
					key: input.draftKey,
					selectedReasoningLevel: reasoningLevel,
				});
			}}
			reasoningLevel={selectedReasoningLevel}
		/>
	);
}

function AgentProfileCollaborationModeEditSection(input: {
	activeDraft: AgentProfileEditDraft;
	controllerCollaborationMode: AgentProfileControllerCollaborationModeEditState | null;
	disabled: boolean;
	draftKey: string;
	onDraftChange: (draft: AgentProfileEditDraft) => void;
}) {
	const selectId = useId();
	if (!input.controllerCollaborationMode?.editable) {
		return null;
	}
	const options = input.controllerCollaborationMode.options;
	const selectedMode = input.activeDraft.selectedCollaborationMode;
	const selectedOption =
		options.find((option) => option.value === selectedMode) ?? options[0];
	if (!selectedOption) {
		return null;
	}
	return (
		<div className="grid gap-3">
			<label className="font-medium text-sm" htmlFor={selectId}>
				Codex collaboration mode
			</label>
			<Select
				disabled={input.disabled || options.length <= 1}
				onValueChange={(value) => {
					const nextMode =
						resolveNativeAgentControllerCollaborationModeForController(value, {
							agentControllerRef:
								input.controllerCollaborationMode?.agentControllerRef,
						});
					if (!nextMode) {
						return;
					}
					input.onDraftChange({
						...input.activeDraft,
						key: input.draftKey,
						selectedCollaborationMode: nextMode,
					});
				}}
				value={selectedOption.value}
			>
				<SelectTrigger
					aria-label="Codex collaboration mode"
					className="h-10 w-full px-3 text-sm"
					displayValue={selectedOption.label}
					id={selectId}
					placeholder="Codex collaboration mode"
				/>
				<SelectContent>
					{options.map((option, index) => (
						<SelectItem index={index} key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs leading-5">
				{selectedOption.description}
			</p>
		</div>
	);
}

function AgentProfilePermissionModeEditSection(input: {
	activeDraft: AgentProfileEditDraft;
	confirmationId: string;
	controllerPermissionMode: AgentProfileControllerPermissionModeEditState | null;
	disabled: boolean;
	isAgentWorking: boolean;
	draftKey: string;
	focusRef: Ref<HTMLButtonElement>;
	onDraftChange: (draft: AgentProfileEditDraft) => void;
	selectedPolicy: AgentControllerPermissionMode | null;
}) {
	const selectId = useId();
	const outcomeId = useId();
	if (!input.controllerPermissionMode) {
		return null;
	}
	if (!input.controllerPermissionMode.editable) {
		return (
			<div className="grid gap-2">
				<p className="font-medium text-sm">Permission Mode</p>
				<p className="text-muted-foreground text-xs leading-5">
					Permission mode is not configurable for this controller.
				</p>
			</div>
		);
	}
	if (!input.selectedPolicy) {
		return null;
	}
	const options = input.controllerPermissionMode.options;
	const selectedMetadata = getAgentControllerPermissionModeDisplayMetadata(
		input.selectedPolicy,
		{ agentControllerRef: input.controllerPermissionMode.agentControllerRef }
	);
	const applicationTiming = resolveAgentProfileEditApplicationTiming({
		agentControllerRef: input.controllerPermissionMode.agentControllerRef,
		field: "permission_mode",
		currentPermissionMode: input.controllerPermissionMode.value,
		nextPermissionMode: input.selectedPolicy,
	});
	const requiresConfirmation =
		selectedMetadata.requiresExplicitConfirmation &&
		(input.activeDraft.selectedAgentControllerRef !== null ||
			input.selectedPolicy !== input.controllerPermissionMode.value);
	return (
		<div
			className="grid gap-3"
			data-slot="agent-profile-permission-mode-section"
		>
			<label className="font-medium text-sm" htmlFor={selectId}>
				{selectedMetadata.fieldLabel}
			</label>
			<Select
				disabled={input.disabled || options.length <= 1}
				onValueChange={(value) => {
					const nextPolicy = resolveAgentControllerPermissionModeForController(
						value,
						{
							agentControllerRef: input.controllerPermissionMode
								? input.controllerPermissionMode.agentControllerRef
								: "",
						}
					);
					input.onDraftChange({
						...input.activeDraft,
						confirmed: false,
						key: input.draftKey,
						selectedPolicy: nextPolicy,
					});
				}}
				value={input.selectedPolicy}
			>
				<SelectTrigger
					aria-describedby={getAgentControllerPermissionModeOutcomeDescriptionId(
						outcomeId
					)}
					aria-label={selectedMetadata.fieldLabel}
					className="h-10 w-full px-3 text-sm"
					displayValue={selectedMetadata.label}
					id={selectId}
					placeholder={selectedMetadata.fieldLabel}
					ref={input.focusRef}
				/>
				<SelectContent className="max-h-64">
					{options.map((option, index) => (
						<SelectItem
							className="items-start"
							index={index}
							key={option.value}
							value={option.value}
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<AgentControllerPermissionModeOutcome
				id={outcomeId}
				metadata={selectedMetadata}
			/>
			{input.isAgentWorking ? (
				<p className="text-muted-foreground text-xs leading-5">
					{applicationTiming === "applies_now"
						? "This controller can apply a saved Permission Mode to later tool requests in the current Wake. If the current session cannot accept it, the next Wake uses it."
						: "A saved Permission Mode applies to the next Wake. The current Wake keeps its existing mode."}
				</p>
			) : null}
			{requiresConfirmation ? (
				<label
					className="flex items-start gap-2 text-destructive text-xs leading-5"
					htmlFor={input.confirmationId}
				>
					<input
						checked={input.activeDraft.confirmed}
						className="mt-0.5 size-4 shrink-0 accent-current"
						disabled={input.disabled}
						id={input.confirmationId}
						onChange={(event) => {
							input.onDraftChange({
								...input.activeDraft,
								confirmed: event.target.checked,
							});
						}}
						type="checkbox"
					/>
					<span>
						I understand this mode may run dangerous actions without asking.
					</span>
				</label>
			) : null}
		</div>
	);
}

function AgentProfileOpenCodePermissionEditSection(input: {
	activeDraft: AgentProfileEditDraft;
	disabled: boolean;
	draftKey: string;
	onDraftChange: (draft: AgentProfileEditDraft) => void;
	openCodePermission: AgentProfileOpenCodePermissionEditState | null;
}) {
	if (!input.openCodePermission) {
		return null;
	}
	return (
		<OpenCodePermissionsField
			disabled={input.disabled}
			onChange={(openCodePermission) => {
				input.onDraftChange({
					...input.activeDraft,
					key: input.draftKey,
					selectedOpenCodePermission: openCodePermission,
				});
			}}
			value={input.activeDraft.selectedOpenCodePermission}
		/>
	);
}

function resolveAgentProfileEditPermissionModeState(input: {
	controllerPermissionMode: AgentProfileControllerPermissionModeEditState | null;
	isControllerChange: boolean;
	selectedPolicy: AgentControllerPermissionMode | null;
}): {
	buttonVariant: "default" | "destructive";
	requiresConfirmation: boolean;
} {
	if (!(input.controllerPermissionMode && input.selectedPolicy)) {
		return {
			buttonVariant: "default",
			requiresConfirmation: false,
		};
	}
	const selectedMetadata = getAgentControllerPermissionModeDisplayMetadata(
		input.selectedPolicy,
		{ agentControllerRef: input.controllerPermissionMode.agentControllerRef }
	);
	const requiresConfirmation =
		selectedMetadata.requiresExplicitConfirmation &&
		(input.isControllerChange ||
			input.selectedPolicy !== input.controllerPermissionMode.value);
	return {
		buttonVariant: requiresConfirmation ? "destructive" : "default",
		requiresConfirmation,
	};
}

function resolveAgentProfileEditModelId(input: {
	modelCatalog: ModelCatalog | null;
	modelSelection: AgentProfileModelSelectionEditState | null;
	selectedModelId: string;
}): string | null {
	if (!input.modelSelection) {
		return null;
	}
	const selectedModelId = normalizeAgentProfileEditText(input.selectedModelId);
	if (selectedModelId) {
		return selectedModelId;
	}
	if (input.modelSelection.agentControllerId === "center-agent") {
		return null;
	}
	return (
		normalizeAgentProfileEditText(
			input.modelCatalog?.agentControllers[
				input.modelSelection.agentControllerId
			]?.defaultModelId
		) ?? null
	);
}

function resolveAgentProfileEditReasoningLevelForModel(input: {
	agentControllerId: string;
	currentReasoningLevel: string;
	modelCatalog: ModelCatalog | null;
	modelId: string;
}): string {
	const modelId = normalizeAgentProfileEditText(input.modelId);
	if (!modelId) {
		return "";
	}
	const selectedModel = input.modelCatalog?.agentControllers[
		input.agentControllerId
	]?.models.find((model) => model.id === modelId && !model.unavailable);
	const currentReasoningLevel = normalizeAgentProfileEditText(
		input.currentReasoningLevel
	);
	return currentReasoningLevel &&
		selectedModel?.supportedReasoningLevels.includes(currentReasoningLevel)
		? currentReasoningLevel
		: "";
}

function normalizeAgentProfileEditText(
	value: string | null | undefined
): string | null {
	const normalized = value?.trim() ?? "";
	return normalized.length > 0 ? normalized : null;
}

function AgentProfileRemoveDialog(input: {
	isOpen: boolean;
	isPending: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onRemoveProfile: () => Promise<void>;
	profileName: string;
}) {
	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!input.isPending) {
					input.onOpenChange(nextOpen);
				}
			}}
			open={input.isOpen}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Remove Agent?</DialogTitle>
					<DialogDescription>
						This hides {input.profileName} from Local Agents for this account.
						Existing space messages stay in history.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose
						render={
							<Button
								disabled={input.isPending}
								type="button"
								variant="outline"
							/>
						}
					>
						Cancel
					</DialogClose>
					<Button
						disabled={input.isPending}
						onClick={() => {
							input.onOpenChange(false);
							input.onRemoveProfile().catch((error) => {
								console.error("Failed to remove Agent Profile.", error);
							});
						}}
						type="button"
						variant="destructive"
					>
						<TrashIcon aria-hidden="true" data-icon="inline-start" />
						{input.isPending ? "Removing..." : "Remove profile"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AgentProfileUnbindControllerDialog(input: {
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	isOpen: boolean;
	isPending: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onUnbindController: () => Promise<void>;
	profileName: string;
}) {
	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!input.isPending) {
					input.onOpenChange(nextOpen);
				}
			}}
			open={input.isOpen}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Unbind controller?</DialogTitle>
					<DialogDescription>
						{input.profileName} will not be able to run until you connect a
						local tool again. The Agent and its Space membership will stay in
						place.
					</DialogDescription>
				</DialogHeader>
				{input.controllerChangeEligibilityStatus === "blocked" ? (
					<p className="text-muted-foreground text-sm">
						This Agent is working. Wait for the current Wake to finish before
						unbinding its Controller.
					</p>
				) : null}
				{input.controllerChangeEligibilityStatus === "unavailable" ? (
					<p className="text-muted-foreground text-sm">
						OpenMeld could not confirm whether this Agent is working, so
						unbinding is temporarily unavailable. Try again.
					</p>
				) : null}
				<DialogFooter>
					<DialogClose
						render={
							<Button
								disabled={input.isPending}
								type="button"
								variant="outline"
							/>
						}
					>
						Cancel
					</DialogClose>
					<Button
						disabled={
							input.isPending ||
							input.controllerChangeEligibilityStatus !== "allowed"
						}
						onClick={() => {
							input
								.onUnbindController()
								.then(() => {
									input.onOpenChange(false);
								})
								.catch((error) => {
									console.error(
										"Failed to unbind Agent Profile controller.",
										error
									);
								});
						}}
						type="button"
						variant="destructive"
					>
						<WrenchIcon aria-hidden="true" data-icon="inline-start" />
						{input.isPending ? "Unbinding..." : "Unbind controller"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AgentProfileRepairActions(input: {
	actions: readonly AgentProfileRepairAction[];
	isPending: boolean;
	onRepairAction: (action: AgentProfileRepairAction) => Promise<void>;
}) {
	const [selectedActionKey, setSelectedActionKey] = useState(
		input.actions[0] ? buildAgentProfileRepairActionKey(input.actions[0]) : ""
	);
	const selectedAction =
		input.actions.find(
			(action) => buildAgentProfileRepairActionKey(action) === selectedActionKey
		) ??
		input.actions[0] ??
		null;
	if (!selectedAction) {
		return null;
	}

	if (input.actions.length === 1) {
		return (
			<div className="flex justify-start pt-1">
				<Button
					disabled={input.isPending}
					onClick={() => {
						input.onRepairAction(selectedAction).catch((error) => {
							console.error(
								"Failed to connect Agent Profile to this computer.",
								error
							);
						});
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					<WrenchIcon aria-hidden="true" data-icon="inline-start" />
					{input.isPending ? "Connecting..." : "Connect local agent"}
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-2 pt-1">
			<Select
				disabled={input.isPending}
				onValueChange={setSelectedActionKey}
				value={buildAgentProfileRepairActionKey(selectedAction)}
			>
				<SelectTrigger
					aria-label="Choose local agent"
					className="h-9 min-w-[220px]"
					displayValue={selectedAction.agentDisplayName}
					placeholder="Choose local agent"
				/>
				<SelectContent className="max-h-56">
					{input.actions.map((action, index) => (
						<SelectItem
							index={index}
							key={buildAgentProfileRepairActionKey(action)}
							value={buildAgentProfileRepairActionKey(action)}
						>
							{action.agentDisplayName}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button
				className="h-9"
				disabled={input.isPending}
				onClick={() => {
					input.onRepairAction(selectedAction).catch((error) => {
						console.error(
							"Failed to connect Agent Profile to this computer.",
							error
						);
					});
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.isPending ? "Connecting..." : "Connect local agent"}
			</Button>
		</div>
	);
}

function AgentProfileCheckAgainAction(input: {
	isPending: boolean;
	onCheckAgain: () => Promise<void>;
}) {
	return (
		<Button
			disabled={input.isPending}
			onClick={async () => {
				await input.onCheckAgain();
			}}
			size="xs"
			type="button"
			variant="outline"
		>
			<ArrowClockwiseIcon aria-hidden="true" data-icon="inline-start" />
			{input.isPending ? "Checking..." : "Check again"}
		</Button>
	);
}

function AgentProfileSetupActionLink(input: {
	action: AgentProfileSetupAction;
	folderRecovery: Parameters<typeof AgentProfileWorkingFolderRecoveryAction>[0];
}) {
	if (input.action.recoveryTarget === "working_folder") {
		return (
			<div className="flex justify-start pt-1">
				{/* Shown from the Agent's readiness: no failed task to retry. */}
				<AgentProfileWorkingFolderRecoveryAction
					{...input.folderRecovery}
					fromReadiness
				/>
			</div>
		);
	}
	return (
		<div className="flex justify-start pt-1">
			<Link
				className={buttonVariants({ size: "sm", variant: "outline" })}
				to={input.action.href}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.action.label}
			</Link>
		</div>
	);
}

function AgentProfileWakeAvailabilityRecoveryActions(input: {
	folderRecovery: Parameters<typeof AgentProfileWorkingFolderRecoveryAction>[0];
	isPending: boolean;
	onRepairAction: (action: AgentProfileRepairAction) => Promise<void>;
	readinessIsPending: boolean;
	repairActions: readonly AgentProfileRepairAction[];
	setupAction: AgentProfileSetupAction | null;
}) {
	if (input.readinessIsPending) {
		return null;
	}
	if (input.repairActions.length > 0) {
		return (
			<AgentProfileRepairActions
				actions={input.repairActions}
				isPending={input.isPending}
				onRepairAction={input.onRepairAction}
			/>
		);
	}
	if (input.setupAction) {
		return (
			<AgentProfileSetupActionLink
				action={input.setupAction}
				folderRecovery={input.folderRecovery}
			/>
		);
	}
	return null;
}

import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
