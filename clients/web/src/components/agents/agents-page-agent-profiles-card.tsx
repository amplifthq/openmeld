"use client";

import { Popover } from "@base-ui/react/popover";
import {
	type AgentProfileOperationalContextInput,
	buildProfileDetailsSnapshotFromAuthProfile,
} from "@openmeld/agent-profile";
import {
	type AgentWakeAvailabilityCategory,
	getAgentControllerPermissionModeDisplayMetadata,
	parseAgentControllerRef,
	resolveAgentControllerPermissionModeForController,
	resolveAgentProfileEditApplicationTiming,
	resolveAgentProfileEditCapabilities,
	resolveAgentWakeAvailabilityDisplayCategory,
	resolveNativeAgentControllerCollaborationModeForController,
} from "@openmeld/agent-runtime";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AgentWakeAvailability,
	AuthProfileView,
	ExecuteAgentProfileWorkRecoveryBody,
	GetAgentExecutionReadinessResponse,
	GetAgentProfilePrimaryBindingResponse,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	ModelCatalog,
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
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
	ChatCircleTextIcon,
	DotsThreeIcon,
	InfoIcon,
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
import {
	DirectoryCardGrid,
	DirectoryCardItem,
	DirectoryOwnerGroup,
} from "#/components/directory/directory-card-grid";
import { shouldShowAgentProfileProjectSettings } from "#/components/profiles/agent-profile-project-settings";
import { AgentProfileProjectSettingsDialog } from "#/components/profiles/agent-profile-project-settings-dialog";
import {
	type AgentProfileModelCompatibilityContext,
	AgentProfileModelSelectionFields,
} from "#/components/profiles/create-profile-form";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import {
	formatOpenCodePermissionJson,
	isOpenCodeAgentControllerRef,
	OpenCodePermissionsField,
	openCodePermissionEquals,
} from "#/components/profiles/open-code-permissions-field";
import { ProfileDetailsDialog } from "#/components/profiles/profile-details-dialog";
import { ProfileCard } from "#/components/profiles/profile-list-item";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentActivitySessionsPath,
	buildOrganizationComputerPath,
	buildOrganizationDirectMessagePath,
} from "#/lib/organizations/organization-routes";
import { resolveWebAgentControllerPermissionModeDisplayFromBinding } from "#/lib/profiles/agent-controller-permission-mode-display";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import { disableAgentProfilePrimaryBinding } from "#/lib/profiles/agent-profile-primary-binding";
import { executeAgentProfileWorkRecovery } from "#/lib/profiles/agent-profile-work-recovery";
import { deleteStartAgentProfile } from "#/lib/profiles/delete-agent-profile";
import { resolveProfileBindingCatalogExecutionTarget } from "#/lib/profiles/profile-binding-target";
import { formatProfileDate } from "#/lib/profiles/profile-date-format";
import { isAgentExecutionSelfHealingReadiness } from "#/lib/spaces/agent-route-status";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import {
	refreshWebAgentReadinessFacts,
	refreshWebAgentReadinessSharedCaches,
} from "#/query/agents/execution-readiness";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import { agentActivitySessionsQueryOptions } from "#/query/organizations/agent-activity";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	agentProfileControllerChangeEligibilityQueryOptions,
	agentProfilePrimaryBindingQueryKeys,
} from "#/query/profiles/primary-binding";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { AGENT_PROFILE_ROUTE_REFRESH_WINDOW_MS } from "#/strategy-constants";
import { AgentProfileBulkReconnectNotice } from "./agent-profile-bulk-reconnect-notice";
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
import { AgentProfileWorkspaceDetail } from "./agent-profile-workspace-detail";
import {
	type AgentProfileAvailabilityFilter,
	type AgentProfileBulkReconnectCandidate,
	type AgentProfileRepairAction,
	type AgentProfileSetupAction,
	type AgentProfileVisualTone,
	buildAgentProfileRepairActionKey,
	buildDuplicateConversationProfileNamesByProfileId,
	canManuallyRefreshAgentProfileConnection,
	formatAgentProfileExecutionComputerDetail,
	hasAgentExecutionReason,
	isAgentExecutionDisplayProjectionRefreshing,
	isAgentExecutionSelfHealing,
	isCurrentRuntimeServiceProjectionRefreshing,
	replaceSetIfChanged,
	resolveAgentExecutionRuntimeDeviceLabel,
	resolveAgentProfileAutoRefreshDelayMs,
	resolveAgentProfileAvailabilityFilterState,
	resolveAgentProfileAvailabilityTone,
	resolveAgentProfileBulkReconnectCandidates,
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
	availabilityFilter: AgentProfileAvailabilityFilter;
	agentProfileOperationalContextByProfileId?: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	agentExecutionReadinessByProfileId?: ReadonlyMap<
		string,
		GetAgentExecutionReadinessResponse
	>;
	agentExecutionReadinessErrorByProfileId?: ReadonlyMap<string, string>;
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
	onCreateProfile?: () => void;
	onFocusProfileConsumed?: () => void;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	presentation?: "cards" | "controller" | "detail";
	queryClient: QueryClient;
	recovery: AgentsPageController;
	serviceUpdatePath: string;
	showOwnerGroups?: boolean;
	setupPath: string;
};

export function AgentProfilesCard(input: AgentProfilesCardProps) {
	const controller = useAgentProfilesCardController(input);
	return <AgentProfilesCardView controller={controller} input={input} />;
}

function useAgentProfilesCardController(input: AgentProfilesCardProps) {
	const navigate = useNavigate();
	const { currentOrganization } = useAppOrganization();
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
	const bulkReconnectCandidates = resolveAgentProfileBulkReconnectCandidates({
		canManageProfile,
		currentLocalRuntimeCanReply,
		isCurrentComputer: input.isCurrentComputer,
		localAgentCatalogEntries,
		profiles: sortedAgentProfiles,
		readinessByProfileId: agentExecutionReadinessByProfileId,
	});
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
			const binding =
				agentExecutionReadinessByProfileId.get(profile.openMeldProfileId)
					?.primaryBinding ?? null;
			if (binding) {
				next.set(profile.openMeldProfileId, binding);
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
			refreshAll: input.recovery.refreshAll,
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
					`${profile.profileName} was ${action.intent === "reconnect" ? "reconnected" : "connected"}, but OpenMeld could not refresh its status. Refresh this page to check it again.`
				);
				return;
			}
			toast.success(
				action.intent === "reconnect"
					? `${profile.profileName} was reconnected to this computer. OpenMeld is checking whether it can reply.`
					: `Local agent connection saved for ${profile.profileName}. OpenMeld is checking whether it can reply from this computer.`
			);
		} catch (error) {
			toast.error(
				formatMutationError(
					error,
					action.intent === "reconnect"
						? `OpenMeld could not reconnect ${profile.profileName} to this computer.`
						: `OpenMeld could not connect ${profile.profileName} to this computer.`
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

	const handleBulkReconnectProfiles = async (
		candidates: readonly AgentProfileBulkReconnectCandidate[]
	) => {
		const profileIds = candidates.map(
			(candidate) => candidate.profile.openMeldProfileId
		);
		setPendingRepairProfileIds(
			(current) => new Set([...current, ...profileIds])
		);
		const reconnectResults = await Promise.all(
			candidates.map(async (candidate) => {
				try {
					await saveProfileConnection(candidate.profile, candidate.action);
					return {
						profileId: candidate.profile.openMeldProfileId,
						status: "reconnected" as const,
					};
				} catch (error) {
					console.error(
						`Failed to reconnect Agent Profile ${candidate.profile.openMeldProfileId}.`,
						error
					);
					return {
						profileName: candidate.profile.profileName,
						status: "failed" as const,
					};
				}
			})
		);
		const reconnectedProfileIds = reconnectResults.flatMap((result) =>
			result.status === "reconnected" ? [result.profileId] : []
		);
		const failedProfileNames = reconnectResults.flatMap((result) =>
			result.status === "failed" ? [result.profileName] : []
		);

		let refreshFailed = false;
		if (reconnectedProfileIds.length > 0) {
			try {
				await refreshProfileConnections(reconnectedProfileIds);
			} catch (error) {
				refreshFailed = true;
				console.error(
					"Agent Profile connections were saved, but their status refresh failed.",
					error
				);
			}
		}

		if (failedProfileNames.length > 0) {
			toast.warning(
				`Reconnected ${reconnectedProfileIds.length} of ${candidates.length} Agents. Review ${formatListForSentence(failedProfileNames)} and try again.`
			);
		} else if (refreshFailed) {
			toast.warning(
				`Reconnected ${reconnectedProfileIds.length} Agents, but OpenMeld could not refresh their status. Refresh this page to check them again.`
			);
		} else {
			toast.success(
				`Reconnected ${reconnectedProfileIds.length} Agents to this computer. OpenMeld is checking whether they can reply.`
			);
		}

		setPendingRepairProfileIds((current) => {
			const next = new Set(current);
			for (const profileId of profileIds) {
				next.delete(profileId);
			}
			return next;
		});
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
			await input.recovery.refreshAll();
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
			Promise.resolve()
				.then(() => input.recovery.refreshAll())
				.catch((refreshError: unknown) => {
					console.error(
						"Agent was renamed, but current views could not be refreshed.",
						refreshError
					);
					toast.warning(
						"The Agent was renamed, but OpenMeld could not refresh every view. Refresh the page to see the latest details."
					);
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
			await input.recovery.refreshAll();
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
				input.recovery.refreshAll(),
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
			const response = await openCurrentDirectMessageSpace({
				organizationId: currentOrganization.id,
				targetProfileId: profile.openMeldProfileId,
			});
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
		let recoveryRequest: ExecuteAgentProfileWorkRecoveryBody;
		if (recoveryAction.kind === "skip_interrupted_work") {
			const expectedInterruptedTargetWakeLifecycleId =
				recoveryAction.expectedInterruptedTargetWakeLifecycleId;
			if (!expectedInterruptedTargetWakeLifecycleId) {
				toast.error("Refresh this page before skipping the interrupted work.");
				return;
			}
			recoveryRequest = {
				action: recoveryAction.kind,
				expectedInterruptedTargetWakeLifecycleId,
			};
		} else {
			recoveryRequest = { action: recoveryAction.kind };
		}
		setPendingRecoveryActionProfileId(profile.openMeldProfileId);
		try {
			await executeAgentProfileWorkRecovery({
				agentProfileId: profile.openMeldProfileId,
				organizationId: currentOrganization.id,
				...recoveryRequest,
			});
			try {
				await Promise.all([
					input.queryClient.invalidateQueries({
						queryKey: organizationQueryKeys.directory(currentOrganization.id),
					}),
					input.queryClient.invalidateQueries({
						queryKey: inboxQueryKeys.organization(currentOrganization.id),
					}),
				]);
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
		bulkReconnectCandidates,
		canManageProfile,
		controllerChangeOptions,
		currentLocalRuntimeCanReply,
		currentOrganization,
		duplicateConversationProfileNamesByProfileId,
		handleBulkReconnectProfiles,
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
		bulkReconnectCandidates,
		handleBulkReconnectProfiles,
		pendingRemoveProfileId,
		pendingRepairProfileIds,
		visibleAgentProfileGroups,
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

	const renderAgentProfileRow = (profile: AuthProfileView) => (
		<AgentProfileDirectoryRow
			cardInput={cardInput}
			controller={input.controller}
			presentation={presentation}
			profile={profile}
		/>
	);
	const bulkReconnectNotice =
		bulkReconnectCandidates.length > 1 ? (
			<AgentProfileBulkReconnectNotice
				candidates={bulkReconnectCandidates}
				isPending={bulkReconnectCandidates.some((candidate) =>
					pendingRepairProfileIds.has(candidate.profile.openMeldProfileId)
				)}
				onReconnect={handleBulkReconnectProfiles}
			/>
		) : null;

	if (presentation === "detail") {
		const selectedProfile =
			visibleAgentProfiles.find(
				(profile) => profile.openMeldProfileId === cardInput.focusProfileId
			) ?? visibleAgentProfiles[0];
		return selectedProfile ? (
			<>
				{bulkReconnectNotice}
				{renderAgentProfileRow(selectedProfile)}
			</>
		) : null;
	}

	if (!cardInput.showOwnerGroups) {
		return (
			<>
				{bulkReconnectNotice}
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
			</>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			{bulkReconnectNotice}
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
	const localAgentEntry = readiness
		? resolveAgentProfileLocalAgentEntry({
				entries: controller.localAgentCatalogEntries,
				readiness,
			})
		: null;
	const primaryBinding =
		controller.primaryBindingByProfileId.get(profile.openMeldProfileId) ?? null;
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

	return (
		<AgentProfileExecutionReadinessRow
			actorProfileId={input.cardInput.recovery.selectedHumanProfileId}
			controllerChangeOptions={controller.controllerChangeOptions}
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
			onCheckAgain={async () => {
				await controller.handleCheckProfileAgain(profile);
			}}
			onControllerChange={async (update) => {
				await controller.handleChangeProfileController(profile, update);
			}}
			onControllerCollaborationModeUpdate={async (
				agentControllerCollaborationMode
			) => {
				await controller.handleUpdateProfileControllerCollaborationMode(
					profile,
					agentControllerCollaborationMode
				);
			}}
			onControllerPermissionModeUpdate={async (
				agentControllerPermissionMode
			) => {
				await controller.handleUpdateProfileControllerPermissionMode(
					profile,
					agentControllerPermissionMode
				);
			}}
			onDisablePrimaryBinding={async () => {
				await controller.handleDisableProfilePrimaryBinding(profile);
			}}
			onModelSelectionUpdate={async (modelSelection) => {
				await controller.handleUpdateProfileModelSelection(
					profile,
					modelSelection
				);
			}}
			onOpenCodePermissionUpdate={async (openCodePermission) => {
				await controller.handleUpdateProfileOpenCodePermission(
					profile,
					openCodePermission
				);
			}}
			onOpenDirectMessage={async () => {
				await controller.handleOpenDirectMessage(profile);
			}}
			onProfileUpdated={(updatedProfile) => {
				updateAgentProfileListCaches({
					organizationId: controller.currentOrganization.id,
					profile: updatedProfile,
					queryClient: input.cardInput.queryClient,
					storageScope: input.cardInput.recovery.storageScope,
				});
			}}
			onRecoveryAction={(recoveryAction) => {
				if (input.cardInput.onRecoveryAction) {
					input.cardInput.onRecoveryAction(recoveryAction);
					return;
				}
				controller
					.handleAgentProfileWorkRecovery(profile, recoveryAction)
					.catch((error: unknown) => {
						console.error("Agent work recovery action failed.", error);
					});
			}}
			onRemoveProfile={async () => {
				await controller.handleRemoveProfile(profile);
			}}
			onRenameProfile={async (profileName) => {
				await controller.handleRenameProfile(profile, profileName);
			}}
			onRepairAction={async (action) =>
				await controller.handleConnectProfileToComputer(profile, action)
			}
			operationalContext={
				controller.agentProfileOperationalContextByProfileId.get(
					profile.openMeldProfileId
				) ?? null
			}
			organizationId={controller.currentOrganization.id}
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
			repairActions={
				canManage
					? resolveAgentProfileRepairActions({
							isCurrentComputer: input.cardInput.isCurrentComputer,
							localAgentCatalogEntries: controller.localAgentCatalogEntries,
							readiness,
						})
					: []
			}
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
			}}
			setupAction={
				canManage
					? resolveAgentProfileSetupAction({
							autoRefreshExhausted:
								controller.autoRefreshExhaustedProfileIds.has(
									profile.openMeldProfileId
								),
							currentLocalRuntimeCanReply:
								controller.currentLocalRuntimeCanReply,
							localAgentDisplayName: localAgentEntry?.displayName ?? null,
							readiness,
							serviceUpdatePath: input.cardInput.serviceUpdatePath,
							setupPath: input.cardInput.setupPath,
						})
					: null
			}
			storageScope={input.cardInput.recovery.storageScope}
			wakeAvailabilityDisplayOverride={
				controller.wakeAvailabilityDisplayOverrideByProfileId.get(
					profile.openMeldProfileId
				) ?? null
			}
		/>
	);
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
	actorProfileId: string | null;
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
	profile: AuthProfileView;
	primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
	pendingState: AgentProfileActionPendingState;
	presentation: "cards" | "detail";
	readiness: GetAgentExecutionReadinessResponse | null;
	rowState: AgentProfileRowState;
	wakeAvailabilityDisplayOverride: AgentWakeAvailability | null;
	repairActions: readonly AgentProfileRepairAction[];
	rowRef?: Ref<HTMLElement>;
	setupAction: AgentProfileSetupAction | null;
	storageScope: string;
};

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
	if (readiness === null || input.errorMessage) {
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
	const rawDisplayedAgentWakeAvailability =
		resolveAgentProfileRowWakeAvailability({
			autoRefreshExhausted: input.rowState.autoRefreshExhausted,
			currentLocalRuntimeCanReply: input.rowState.currentLocalRuntimeCanReply,
			localAgentDisplayName,
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
	const primaryBindingIsMissing =
		input.primaryBinding?.bindingState === "missing";
	const iconAgentId = primaryBindingIsMissing
		? null
		: resolveAgentProfileDisplayIconAgentId({
				localAgentEntry,
				primaryBinding: input.primaryBinding,
				readiness,
			});
	const rowTone = resolveAgentProfileAvailabilityTone(availabilityState);
	const statusTextClassName =
		resolveAgentProfileStatusTextClassName(availabilityState);
	const rowSummary = resolveAgentProfileDisplaySummary({
		agentWakeAvailability: displayedAgentWakeAvailability,
	});
	const controllerModelDetail = resolveAgentProfileControllerModelDetail({
		agentControllerRef:
			input.primaryBinding?.executionTarget?.agentControllerRef ??
			(primaryBindingIsMissing
				? null
				: resolveLocalAgentEntryControllerRef(localAgentEntry)),
		controllerDisplayName: primaryBindingIsMissing
			? null
			: localAgentDisplayName,
		modelCatalog: input.modelCatalog,
		modelSelection: input.primaryBinding?.modelSelection ?? null,
	});
	const profileDetails = buildProfileDetailsSnapshotFromAuthProfile({
		agentControllerPermissionModeDetail:
			controllerPermissionModeDisplay?.label ?? null,
		modelDetail: controllerModelDetail,
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
						className={statusTextClassName}
						isRefreshing={
							displayedAgentWakeAvailability.isRefreshing ||
							(showConnecting &&
								displayedAgentWakeAvailability.category === "checking")
						}
						label={statusLabel}
						tooltip={statusTooltip}
					/>
				}
				icon={<AgentProfileRowIcon agentId={iconAgentId} tone={rowTone} />}
				menu={rowMoreMenu(profileDetails)}
				rowRef={input.rowRef}
				secondarySubtitle={
					controllerPermissionModeDisplay ? (
						<AgentProfileControllerPermissionModeInlineDisplay
							display={controllerPermissionModeDisplay}
						/>
					) : null
				}
				subtitle={controllerModelDetail ?? "No local agent connected"}
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
	});
}

function AgentProfileExecutionReadinessRowMenu(input: {
	details: ProfileDetailsSnapshot;
	row: AgentProfileExecutionReadinessRowProps;
	supportingContent?: ReactNode;
}) {
	return (
		<AgentProfileRowMoreMenu
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
			pendingState={input.row.pendingState}
			presentation={input.row.presentation}
			primaryAgentControllerRef={
				input.row.primaryBinding?.executionTarget?.agentControllerRef ?? null
			}
			primaryNativeSessionId={
				input.row.primaryBinding?.executionTarget
					?.agentControllerConversationId ?? null
			}
			profile={input.row.profile}
			profileName={input.row.profile.profileName}
			readinessErrorMessage={input.row.errorMessage}
			readinessIsMissing={input.row.readiness === null}
			readinessIsPending={input.row.rowState.isReadinessPending}
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
			storageScope={input.row.storageScope}
			supportingContent={input.supportingContent}
			wakeAvailability={input.row.readiness?.agentWakeAvailability ?? null}
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
		recoveryAction = <AgentProfileSetupActionLink action={input.setupAction} />;
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
}): ReactNode {
	if (input.isPending && input.readiness === null) {
		return (
			<ProfileCard
				className={cn(
					"min-h-40",
					resolveFocusedAgentProfileClassName(input.isFocusedProfile)
				)}
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
						tooltip="Loading Wake availability"
					/>
				}
				icon={<AgentProfileRowIcon tone="muted" />}
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
				dimTitle={true}
				footerLeft={
					<AgentProfileFooterDetail
						primaryDetail={input.errorMessage}
						profileCreatedAt={input.profileCreatedAt}
					/>
				}
				footerRight={
					<AgentProfileFooterAvailabilityBadge
						className={resolveAgentProfileStatusTextClassName("unavailable")}
						label="Unavailable"
						tooltip="Status unavailable"
					/>
				}
				icon={<AgentProfileRowIcon tone="muted" />}
				menu={input.menu}
				rowRef={input.rowRef}
				secondarySubtitle={
					input.controllerPermissionModeDisplay ? (
						<AgentProfileControllerPermissionModeInlineDisplay
							display={input.controllerPermissionModeDisplay}
						/>
					) : null
				}
				subtitle="Status unavailable"
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
						tooltip="Not checked yet"
					/>
				}
				icon={<AgentProfileRowIcon tone="muted" />}
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
	className?: string;
	isRefreshing?: boolean;
	label: string;
	tooltip: string;
}) {
	const statusText = (
		<span
			className={cn(
				"block min-w-0 truncate font-medium text-xs",
				input.className,
				input.isRefreshing ? "shimmer-text" : null
			)}
			data-availability-action={input.availabilityAction ?? undefined}
			data-availability-phase={input.availabilityPhase ?? undefined}
			data-availability-reason-code={input.availabilityReasonCode ?? undefined}
			data-testid="agent-profile-row-availability-badge"
			title={input.tooltip}
		>
			{input.label}
		</span>
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

function AgentProfileOptionsPopover(input: {
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
	onOpenProjectSettings: () => void;
	onOpenRemove: () => void;
	onOpenUnbind: () => void;
	profileName: string;
	showDetailsAction?: boolean;
}) {
	return (
		<Popover.Root
			modal={false}
			onOpenChange={input.onOpenChange}
			open={input.isOpen}
		>
			<Popover.Trigger
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
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="end"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "start",
						side: "flip",
					}}
					collisionPadding={12}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						className="z-50 min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
						finalFocus={false}
					>
						{input.showDetailsAction === false ? null : (
							<button
								className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
								onClick={() => {
									input.onOpenChange(false);
									input.onOpenDetails?.();
								}}
								type="button"
							>
								<InfoIcon aria-hidden="true" className="h-4 w-4" />
								About profile
							</button>
						)}
						{input.capabilities.canManage ? (
							<>
								{input.capabilities.showProjectSettings ? (
									<button
										className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
										onClick={() => {
											input.onOpenChange(false);
											input.onOpenProjectSettings();
										}}
										type="button"
									>
										<WrenchIcon aria-hidden="true" className="h-4 w-4" />
										Default Project and folder
									</button>
								) : null}
								{input.capabilities.hasEnabledPrimaryBinding ? (
									<button
										className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-destructive text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
										disabled={input.disabledActions.unbindController}
										onClick={() => {
											input.onOpenChange(false);
											input.onOpenUnbind();
										}}
										type="button"
									>
										<WrenchIcon aria-hidden="true" className="h-4 w-4" />
										<span className="flex min-w-0 flex-1 items-center justify-between gap-3">
											<span>Unbind controller</span>
											<span
												aria-hidden="true"
												className="text-muted-foreground text-xs empty:hidden"
											>
												{input.controllerChangeStatusLabel}
											</span>
										</span>
									</button>
								) : null}
								<button
									className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-destructive text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
									disabled={input.disabledActions.remove}
									onClick={() => {
										input.onOpenChange(false);
										input.onOpenRemove();
									}}
									type="button"
								>
									<TrashIcon aria-hidden="true" className="h-4 w-4" />
									Remove profile
								</button>
							</>
						) : null}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function AgentProfileRowMoreMenu(input: {
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
	profile: AuthProfileView;
	profileName: string;
	readinessErrorMessage: string | null;
	readinessIsMissing: boolean;
	readinessIsPending: boolean;
	repairActions: readonly AgentProfileRepairAction[];
	primaryAgentControllerRef: string | null;
	primaryNativeSessionId: string | null;
	pendingState: AgentProfileActionPendingState;
	presentation?: "cards" | "detail";
	runtimeComputer: { deviceId: string; displayName: string } | null;
	storageScope: string;
	supportingContent?: ReactNode;
	wakeAvailability: AgentWakeAvailability | null;
}) {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [isProfileEditDialogOpen, setIsProfileEditDialogOpen] = useState(false);
	const [isProjectSettingsDialogOpen, setIsProjectSettingsDialogOpen] =
		useState(false);
	const [isUnbindControllerDialogOpen, setIsUnbindControllerDialogOpen] =
		useState(false);
	const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
	const controllerChangeEligibilityQuery = useQuery(
		agentProfileControllerChangeEligibilityQueryOptions({
			agentProfileId: input.profile.openMeldProfileId,
			enabled: shouldReadControllerChangeEligibility({
				isMenuOpen,
				isProfileEditDialogOpen,
				isUnbindControllerDialogOpen,
			}),
			organizationId: input.organizationId,
			storageScope: input.storageScope,
		})
	);
	const controllerChangeEligibilityStatus =
		controllerChangeEligibilityQuery.data?.status ?? "unavailable";
	const isProfileEditPending =
		input.pendingState.controllerChange ||
		input.pendingState.controllerCollaborationMode ||
		input.pendingState.controllerPermissionMode ||
		input.pendingState.modelSelection ||
		input.pendingState.openCodePermission ||
		input.pendingState.rename;
	const controllerChangeStatusLabel = resolveControllerChangeStatusLabel({
		isPending: controllerChangeEligibilityQuery.isPending,
		status: controllerChangeEligibilityStatus,
	});
	const unbindControllerDisabled = isAgentProfileUnbindDisabled({
		controllerChangeEligibilityStatus,
		isProfileEditPending,
		isUnbindPending: input.pendingState.disablePrimaryBinding,
	});
	const showProjectSettings = shouldShowAgentProfileProjectSettings({
		agentControllerRef: input.primaryAgentControllerRef,
		managedRole: input.profile.managedRole,
	});
	const { currentOrganization } = useAppOrganization();
	const currentSessionQuery = useQuery(
		agentActivitySessionsQueryOptions({
			enabled:
				input.capabilities.canManage &&
				(input.presentation === "detail" || isDetailsDialogOpen) &&
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
		input.capabilities.canManage && input.primaryNativeSessionId
			? {
					href: `${buildOrganizationAgentActivitySessionsPath(currentOrganization.slug)}?query=${encodeURIComponent(input.primaryNativeSessionId)}`,
					nativeSessionId: input.primaryNativeSessionId,
					title:
						currentSession?.nativeSessionTitle?.trim() ||
						currentSession?.localAgent.name ||
						"Local Agent Session",
				}
			: undefined;
	const runtimeControllerLabel =
		input.controllerChangeOptions.find(
			(option) => option.agentControllerRef === input.primaryAgentControllerRef
		)?.label ?? null;
	const runtime =
		input.capabilities.canManage &&
		input.runtimeComputer &&
		runtimeControllerLabel
			? {
					computerName: input.runtimeComputer.displayName,
					controllerName: runtimeControllerLabel,
					managePath: buildOrganizationComputerPath({
						deviceId: input.runtimeComputer.deviceId,
						orgSlug: currentOrganization.slug,
					}),
				}
			: null;
	if (input.presentation === "detail") {
		return (
			<AgentProfileWorkspacePresentation
				controllerChangeEligibilityStatus={controllerChangeEligibilityStatus}
				controllerChangeStatusLabel={controllerChangeStatusLabel}
				currentSession={currentSessionLink}
				input={input}
				onOpenChange={{
					menu: setIsMenuOpen,
					profileEdit: setIsProfileEditDialogOpen,
					projectSettings: setIsProjectSettingsDialogOpen,
					remove: setIsRemoveDialogOpen,
					unbindController: setIsUnbindControllerDialogOpen,
				}}
				presentationState={{
					menuOpen: isMenuOpen,
					profileEditOpen: isProfileEditDialogOpen,
					profileEditPending: isProfileEditPending,
					projectSettingsOpen: isProjectSettingsDialogOpen,
					removeOpen: isRemoveDialogOpen,
					unbindControllerOpen: isUnbindControllerDialogOpen,
				}}
				runtime={runtime}
				runtimeControllerLabel={runtimeControllerLabel}
				workspaceOptions={{
					showProjectSettings,
					unbindControllerDisabled,
				}}
			/>
		);
	}
	return (
		<>
			<div className="flex items-center justify-end gap-1">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Direct Message"
								disabled={input.pendingState.directMessage}
								onClick={() => {
									input.onOpenDirectMessage().catch((error) => {
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
				{input.capabilities.canManage ? (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="Edit Agent"
									disabled={
										isProfileEditPending ||
										input.pendingState.disablePrimaryBinding
									}
									onClick={() => {
										setIsMenuOpen(false);
										setIsProfileEditDialogOpen(true);
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
				) : null}
				<AgentProfileOptionsPopover
					capabilities={{
						canManage: input.capabilities.canManage,
						hasEnabledPrimaryBinding:
							input.capabilities.hasEnabledPrimaryBinding,
						showProjectSettings,
					}}
					controllerChangeStatusLabel={controllerChangeStatusLabel}
					disabledActions={{
						remove: input.pendingState.remove,
						unbindController: unbindControllerDisabled,
					}}
					isOpen={isMenuOpen}
					onOpenChange={setIsMenuOpen}
					onOpenDetails={() => setIsDetailsDialogOpen(true)}
					onOpenProjectSettings={() => setIsProjectSettingsDialogOpen(true)}
					onOpenRemove={() => setIsRemoveDialogOpen(true)}
					onOpenUnbind={() => setIsUnbindControllerDialogOpen(true)}
					profileName={input.profileName}
				/>
			</div>
			<ProfileDetailsDialog
				currentSession={currentSessionLink}
				details={input.details}
				isDirectMessagePending={input.pendingState.directMessage}
				isRecoveryActionPending={input.pendingState.recoveryAction}
				onOpenChange={setIsDetailsDialogOpen}
				onOpenDirectMessage={() => {
					input.onOpenDirectMessage().catch((error) => {
						console.error("Direct Message action failed.", error);
					});
				}}
				onRecoveryAction={input.onRecoveryAction}
				open={isDetailsDialogOpen}
			/>
			<AgentProfileProjectSettingsDialog
				actorProfileId={input.actorProfileId}
				agentControllerRef={input.primaryAgentControllerRef}
				executionTargetChangeEligibilityStatus={
					controllerChangeEligibilityStatus
				}
				onOpenChange={setIsProjectSettingsDialogOpen}
				onProfileUpdated={input.onProfileUpdated}
				open={isProjectSettingsDialogOpen}
				organizationId={input.organizationId}
				profile={input.profile}
			/>
			<AgentProfileEditDialog
				controllerChangeEligibilityStatus={controllerChangeEligibilityStatus}
				controllerChangeOptions={input.controllerChangeOptions}
				editState={input.editState}
				isPending={isProfileEditPending}
				modelCatalog={input.modelCatalog}
				modelCompatibilityContext={input.modelCompatibilityContext}
				onControllerChange={input.onControllerChange}
				onControllerCollaborationModeUpdate={
					input.onControllerCollaborationModeUpdate
				}
				onControllerPermissionModeUpdate={
					input.onControllerPermissionModeUpdate
				}
				onModelSelectionUpdate={input.onModelSelectionUpdate}
				onOpenChange={setIsProfileEditDialogOpen}
				onOpenCodePermissionUpdate={input.onOpenCodePermissionUpdate}
				onRenameProfile={input.onRenameProfile}
				open={isProfileEditDialogOpen}
				profileName={input.profileName}
				runtime={runtime}
			/>
			<AgentProfileUnbindControllerDialog
				controllerChangeEligibilityStatus={controllerChangeEligibilityStatus}
				isOpen={isUnbindControllerDialogOpen}
				isPending={input.pendingState.disablePrimaryBinding}
				onOpenChange={setIsUnbindControllerDialogOpen}
				onUnbindController={input.onDisablePrimaryBinding}
				profileName={input.profileName}
			/>
			<AgentProfileRemoveDialog
				isOpen={isRemoveDialogOpen}
				isPending={input.pendingState.remove}
				onOpenChange={setIsRemoveDialogOpen}
				onRemoveProfile={input.onRemoveProfile}
				profileName={input.profileName}
			/>
		</>
	);
}

function AgentProfileWorkspacePresentation(input: {
	controllerChangeEligibilityStatus: "allowed" | "blocked" | "unavailable";
	controllerChangeStatusLabel: string | null;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	input: Parameters<typeof AgentProfileRowMoreMenu>[0];
	onOpenChange: {
		menu: (open: boolean) => void;
		profileEdit: (open: boolean) => void;
		projectSettings: (open: boolean) => void;
		remove: (open: boolean) => void;
		unbindController: (open: boolean) => void;
	};
	presentationState: {
		menuOpen: boolean;
		profileEditOpen: boolean;
		profileEditPending: boolean;
		projectSettingsOpen: boolean;
		removeOpen: boolean;
		unbindControllerOpen: boolean;
	};
	runtime: {
		computerName: string;
		controllerName: string;
		managePath: string;
	} | null;
	runtimeControllerLabel: string | null;
	workspaceOptions: {
		showProjectSettings: boolean;
		unbindControllerDisabled: boolean;
	};
}) {
	const parsedControllerRef = parseAgentControllerRef(
		input.input.primaryAgentControllerRef
	);
	const controllerDisplayName =
		input.runtimeControllerLabel ??
		(parsedControllerRef
			? formatLocalAgentDisplayName(parsedControllerRef.id)
			: null);
	const ownerControllerModelSummary =
		resolveAgentProfileControllerModelDetail({
			agentControllerRef: input.input.primaryAgentControllerRef,
			controllerDisplayName,
			modelCatalog: input.input.modelCatalog,
			modelSelection: input.input.editState?.modelSelection
				? {
						modelId: input.input.editState.modelSelection.modelId,
						reasoningLevel:
							input.input.editState.modelSelection.reasoningLevel || undefined,
					}
				: null,
		}) ?? "No Controller connected";
	const controllerModelSummary = input.input.capabilities.canManage
		? ownerControllerModelSummary
		: (controllerDisplayName ?? "No Controller connected");
	const overflowActions = input.input.capabilities.canManage ? (
		<AgentProfileOptionsPopover
			capabilities={{
				canManage: true,
				hasEnabledPrimaryBinding:
					input.input.capabilities.hasEnabledPrimaryBinding,
				showProjectSettings: input.workspaceOptions.showProjectSettings,
			}}
			controllerChangeStatusLabel={input.controllerChangeStatusLabel}
			disabledActions={{
				remove: input.input.pendingState.remove,
				unbindController: input.workspaceOptions.unbindControllerDisabled,
			}}
			isOpen={input.presentationState.menuOpen}
			onOpenChange={input.onOpenChange.menu}
			onOpenProjectSettings={() => input.onOpenChange.projectSettings(true)}
			onOpenRemove={() => input.onOpenChange.remove(true)}
			onOpenUnbind={() => input.onOpenChange.unbindController(true)}
			profileName={input.input.profileName}
			showDetailsAction={false}
		/>
	) : null;
	return (
		<>
			<AgentProfileWorkspaceDetail
				agentControllerRef={input.input.primaryAgentControllerRef}
				canEdit={input.input.capabilities.canManage}
				controllerModelSummary={controllerModelSummary}
				currentSession={input.currentSession}
				details={input.input.details}
				editContent={
					input.presentationState.profileEditOpen ? (
						<AgentProfileInlineEditor
							controllerChangeEligibilityStatus={
								input.controllerChangeEligibilityStatus
							}
							controllerChangeOptions={input.input.controllerChangeOptions}
							editState={input.input.editState}
							isPending={input.presentationState.profileEditPending}
							modelCatalog={input.input.modelCatalog}
							modelCompatibilityContext={input.input.modelCompatibilityContext}
							onCancel={() => input.onOpenChange.profileEdit(false)}
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
							onRenameProfile={input.input.onRenameProfile}
							profileName={input.input.profileName}
							runtime={input.runtime}
						/>
					) : null
				}
				editDisabled={
					input.presentationState.profileEditPending ||
					input.input.pendingState.disablePrimaryBinding
				}
				editing={input.presentationState.profileEditOpen}
				isDirectMessagePending={input.input.pendingState.directMessage}
				isRecoveryActionPending={input.input.pendingState.recoveryAction}
				onEdit={() => {
					input.onOpenChange.menu(false);
					input.onOpenChange.profileEdit(true);
				}}
				onOpenDirectMessage={() => {
					input.input.onOpenDirectMessage().catch((error) => {
						console.error("Direct Message action failed.", error);
					});
				}}
				onRecoveryAction={input.input.onRecoveryAction}
				operationalContext={input.input.operationalContext}
				overflowActions={overflowActions}
				profile={input.input.profile}
				supportingContent={input.input.supportingContent}
				wakeAvailability={input.input.wakeAvailability}
				wakeAvailabilityErrorMessage={input.input.readinessErrorMessage}
				wakeAvailabilityIsPending={input.input.readinessIsPending}
				wakeAvailabilityRecoveryActions={
					(input.input.readinessIsMissing ||
						Boolean(input.input.readinessErrorMessage)) &&
					!input.input.readinessIsPending &&
					input.input.repairActions.length > 0 ? (
						<AgentProfileRepairActions
							actions={input.input.repairActions}
							isPending={input.input.pendingState.repair}
							onRepairAction={input.input.onRepairAction}
						/>
					) : null
				}
			/>
			<AgentProfileProjectSettingsDialog
				actorProfileId={input.input.actorProfileId}
				agentControllerRef={input.input.primaryAgentControllerRef}
				executionTargetChangeEligibilityStatus={
					input.controllerChangeEligibilityStatus
				}
				onOpenChange={input.onOpenChange.projectSettings}
				onProfileUpdated={input.input.onProfileUpdated}
				open={input.presentationState.projectSettingsOpen}
				organizationId={input.input.organizationId}
				profile={input.input.profile}
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
			{input.runtime ? (
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
			) : null}
			{input.isLoading ? (
				<p className="py-6 text-muted-foreground text-sm">
					Loading Agent settings...
				</p>
			) : null}
			{!input.isLoading && input.loadErrorMessage ? (
				<p className="rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
					{input.loadErrorMessage}
				</p>
			) : null}
			{input.isLoading || input.loadErrorMessage ? null : (
				<AgentProfileEditDialogFields
					activeDraft={draft}
					activeEditState={activeEditState}
					confirmationId={confirmationId}
					controllerChangeEligibilityStatus={
						input.controllerChangeEligibilityStatus ?? "allowed"
					}
					controllerChangeOptions={input.controllerChangeOptions}
					controllerCollaborationMode={controllerCollaborationMode}
					controllerPermissionMode={controllerPermissionMode}
					dialogState={dialogState}
					disabled={input.isPending}
					draftKey={draftKey}
					editState={input.editState}
					modelCatalog={input.modelCatalog}
					modelCompatibilityContext={input.modelCompatibilityContext}
					modelSelection={modelSelection}
					onDraftChange={setDraft}
					openCodePermission={openCodePermission}
					permissionControlRef={permissionControlRef}
					profileNameInputId={profileNameInputId}
				/>
			)}
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
				{input.runtime ? (
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
				) : null}
				{input.isLoading ? (
					<p className="py-6 text-muted-foreground text-sm">
						Loading Agent settings...
					</p>
				) : null}
				{!input.isLoading && input.loadErrorMessage ? (
					<p className="rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
						{input.loadErrorMessage}
					</p>
				) : null}
				{input.isLoading || input.loadErrorMessage ? null : (
					<AgentProfileEditDialogFields
						activeDraft={activeDraft}
						activeEditState={activeEditState}
						confirmationId={confirmationId}
						controllerChangeEligibilityStatus={
							input.controllerChangeEligibilityStatus ?? "allowed"
						}
						controllerChangeOptions={input.controllerChangeOptions}
						controllerCollaborationMode={controllerCollaborationMode}
						controllerPermissionMode={controllerPermissionMode}
						dialogState={dialogState}
						disabled={input.isPending}
						draftKey={draftKey}
						editState={input.editState}
						modelCatalog={input.modelCatalog}
						modelCompatibilityContext={input.modelCompatibilityContext}
						modelSelection={modelSelection}
						onDraftChange={setDraft}
						openCodePermission={openCodePermission}
						permissionControlRef={permissionControlRef}
						profileNameInputId={profileNameInputId}
					/>
				)}
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
	return (
		<div className="grid gap-5">
			<div className="grid gap-2">
				<Label htmlFor={input.profileNameInputId}>Name</Label>
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
				{input.dialogState.profileNameChanged &&
				!input.dialogState.profileNameIsValid ? (
					<p className="text-destructive text-xs">Enter an Agent name.</p>
				) : null}
			</div>
			{input.editState && input.activeEditState ? (
				<>
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
					{input.controllerChangeEligibilityStatus === "blocked" ? (
						<div className="grid gap-1 text-muted-foreground text-xs leading-5">
							<p>
								Controller changes are unavailable while this Agent is working
								because reconnecting would interrupt the current Wake.
							</p>
							<p>
								Model, reasoning effort, collaboration mode, and OpenCode
								permission changes apply to the next Wake.
							</p>
						</div>
					) : null}
					{input.controllerChangeEligibilityStatus === "unavailable" ? (
						<p className="text-muted-foreground text-xs leading-5">
							OpenMeld couldn’t confirm whether this Agent is working, so
							Controller changes are temporarily unavailable. Try again.
						</p>
					) : null}
					<AgentProfileModelSelectionEditSection
						activeDraft={input.activeDraft}
						disabled={input.disabled}
						draftKey={input.draftKey}
						modelCatalog={input.modelCatalog}
						modelCompatibilityContext={input.modelCompatibilityContext}
						modelSelection={input.modelSelection}
						onDraftChange={input.onDraftChange}
					/>
					<AgentProfileCollaborationModeEditSection
						activeDraft={input.activeDraft}
						controllerCollaborationMode={input.controllerCollaborationMode}
						disabled={input.disabled}
						draftKey={input.draftKey}
						onDraftChange={input.onDraftChange}
					/>
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
				</>
			) : (
				<AgentProfileBindingUnavailableEditSection />
			)}
		</div>
	);
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
					agentControllerId: parsedAgentControllerRef.id,
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
	const selectedOption =
		options.find((option) => option.value === input.selectedPolicy) ??
		options[0];
	const selectedMetadata = getAgentControllerPermissionModeDisplayMetadata(
		input.selectedPolicy,
		{ agentControllerRef: input.controllerPermissionMode.agentControllerRef }
	);
	const applicationTiming = resolveAgentProfileEditApplicationTiming({
		agentControllerRef: input.controllerPermissionMode.agentControllerRef,
		field: "permission_mode",
	});
	const requiresConfirmation = selectedMetadata.requiresExplicitConfirmation;
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
				value={selectedOption?.value}
			>
				<SelectTrigger
					aria-label={selectedMetadata.fieldLabel}
					className="h-10 w-full px-3 text-sm"
					displayValue={selectedOption?.label}
					id={selectId}
					placeholder={selectedMetadata.fieldLabel}
					ref={input.focusRef}
				/>
				<SelectContent className="max-h-64">
					{options.map((option, index) => (
						<SelectItem index={index} key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p
				className={cn(
					"text-xs leading-5",
					selectedMetadata.tone === "warning"
						? "text-destructive"
						: "text-muted-foreground"
				)}
			>
				{selectedMetadata.description}
			</p>
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
						I understand this permissions mode can run with dangerous full
						access.
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
	return {
		buttonVariant:
			selectedMetadata.tone === "warning" ? "destructive" : "default",
		requiresConfirmation: selectedMetadata.requiresExplicitConfirmation,
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
		const actionLabel =
			selectedAction.intent === "reconnect"
				? `Reconnect to ${selectedAction.agentDisplayName}`
				: `Connect to ${selectedAction.agentDisplayName}`;
		const pendingLabel =
			selectedAction.intent === "reconnect"
				? "Reconnecting..."
				: "Connecting...";
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
					{input.isPending ? pendingLabel : actionLabel}
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
				{input.isPending ? "Connecting..." : "Connect"}
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
}) {
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
