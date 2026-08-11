"use client";

import { Popover } from "@base-ui/react/popover";
import { buildProfileDetailsSnapshotFromAuthProfile } from "@openmeld/agent-profile";
import {
	type AgentControllerCollaborationModeOption,
	type AgentControllerPermissionModeOption,
	type AgentProfileEditCapabilities,
	type AgentWakeAvailabilityCategory,
	getAgentControllerPermissionModeDisplayMetadata,
	parseAgentControllerRef,
	resolveAgentControllerPermissionModeForController,
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
	GetAgentExecutionReadinessResponse,
	GetAgentProfilePrimaryBindingResponse,
	LocalRuntimeExecutionTarget,
	ModelCatalog,
	OrganizationBindingAuthorizationProfile,
	ProfileDetailsSnapshot,
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
import {
	hasLocalAgentLogo,
	LocalAgentLogo,
} from "@openmeld/ui/components/local-agent-logo";
import { SettingsAddComputerCardContent } from "@openmeld/ui/components/settings-computers";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Switch } from "@openmeld/ui/components/switch";
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
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
	DirectoryOwnerGroup,
} from "#/components/directory/directory-card-grid";
import {
	AgentProfileProjectSettingsDialog,
	shouldShowAgentProfileProjectSettings,
} from "#/components/profiles/agent-profile-project-settings-dialog";
import { AgentProfileModelSelectionFields } from "#/components/profiles/create-profile-form";
import {
	formatOpenCodePermissionJson,
	isOpenCodeAgentControllerRef,
	OpenCodePermissionsField,
	openCodePermissionEquals,
} from "#/components/profiles/open-code-permissions-field";
import { ProfileDetailsDialog } from "#/components/profiles/profile-details-dialog";
import { ProfileCard } from "#/components/profiles/profile-list-item";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import { resolveWebAgentControllerPermissionModeDisplayFromBinding } from "#/lib/profiles/agent-controller-permission-mode-display";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import { disableAgentProfilePrimaryBinding } from "#/lib/profiles/agent-profile-primary-binding";
import { deleteStartAgentProfile } from "#/lib/profiles/delete-agent-profile";
import {
	authorizeAgentProfileBindingForCurrentOrganization,
	revokeAgentProfileBindingForCurrentOrganization,
} from "#/lib/profiles/organization-binding-authorizations";
import {
	bindableLocalAgentEntriesFromTarget,
	resolveProfileBindingCatalogExecutionTarget,
} from "#/lib/profiles/profile-binding-target";
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
import {
	currentUserAgentProfileOrganizationWakeAccessQueryOptions,
	organizationBindingAuthorizationProfilesQueryOptions,
	organizationBindingAuthorizationQueryKeys,
} from "#/query/profiles/organization-binding-authorizations";
import { agentProfilePrimaryBindingQueryKeys } from "#/query/profiles/primary-binding";
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
type AgentProfileControllerPermissionModeEditState = {
	agentControllerRef: string;
	editable: boolean;
	options: AgentControllerPermissionModeOption[];
	value: AgentControllerPermissionMode | null;
};
type AgentProfileControllerCollaborationModeEditState = {
	agentControllerRef: string;
	editable: boolean;
	options: AgentControllerCollaborationModeOption[];
	value: AgentControllerCollaborationMode | null;
};
type AgentProfileModelSelectionEditState = {
	agentControllerId: string;
	agentControllerRef: string;
	modelId: string;
	reasoningLevel: string;
};
type AgentProfileOpenCodePermissionEditState = {
	agentControllerRef: string;
	value: AgentProfileBindingOpenCodePermission | null;
};
export type AgentProfileEditState = {
	agentControllerId: string;
	agentControllerRef: string;
	capabilities: AgentProfileEditCapabilities;
	controllerCollaborationMode: AgentProfileControllerCollaborationModeEditState | null;
	controllerPermissionMode: AgentProfileControllerPermissionModeEditState | null;
	modelSelection: AgentProfileModelSelectionEditState | null;
	openCodePermission: AgentProfileOpenCodePermissionEditState | null;
};
export type {
	AgentProfileControllerChangeUpdate,
	AgentProfileModelSelectionUpdate,
} from "./agent-profile-edit-actions";
export type AgentProfileControllerChangeOption = {
	agentControllerRef: string;
	label: string;
};
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
	for (const profileId of [...profileIds]) {
		if (!activeProfileIds.includes(profileId)) {
			deleteProfileId(profileId);
		}
	}
}

export function AgentProfilesCard(input: {
	availabilityFilter: AgentProfileAvailabilityFilter;
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
	queryClient: QueryClient;
	recovery: AgentsPageController;
	serviceUpdatePath: string;
	showOwnerGroups?: boolean;
	setupPath: string;
}) {
	const navigate = useNavigate();
	const { currentOrganization } = useAppOrganization();
	const agentProfiles = input.agentProfiles ?? input.recovery.agentProfiles;
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
	const isPersonalOrganizationContext = currentOrganization.isPersonal === true;
	const organizationWakeAccessProfilesQuery = useQuery(
		organizationBindingAuthorizationProfilesQueryOptions({
			enabled: !isPersonalOrganizationContext,
			organizationId: currentOrganization.id,
		})
	);
	const organizationWakeAccessByProfileId = useMemo(() => {
		const next = new Map<string, OrganizationBindingAuthorizationProfile>();
		for (const profile of organizationWakeAccessProfilesQuery.data?.profiles ??
			[]) {
			next.set(profile.agentProfileId, profile);
		}
		return next;
	}, [organizationWakeAccessProfilesQuery.data]);
	const currentUserOrganizationWakeAccessQuery = useQuery(
		currentUserAgentProfileOrganizationWakeAccessQueryOptions({
			enabled: isPersonalOrganizationContext,
		})
	);
	const organizationMembershipsByProfileId = useMemo(() => {
		const next = new Map<
			string,
			readonly { organizationId: string; organizationName: string }[]
		>();
		for (const profile of currentUserOrganizationWakeAccessQuery.data
			?.profiles ?? []) {
			next.set(profile.agentProfileId, profile.organizations);
		}
		return next;
	}, [currentUserOrganizationWakeAccessQuery.data]);
	const sortedAgentProfiles = useMemo(
		() =>
			sortAgentProfilesForDisplay({
				profiles: agentProfiles,
				readinessByProfileId: agentExecutionReadinessByProfileId,
			}),
		[agentExecutionReadinessByProfileId, agentProfiles]
	);
	const visibleAgentProfiles = useMemo(() => {
		if (input.availabilityFilter === "all") {
			return sortedAgentProfiles;
		}
		return sortedAgentProfiles.filter(
			(profile) =>
				resolveAgentProfileAvailabilityFilterState({
					errorByProfileId: agentExecutionReadinessErrorByProfileId,
					pendingProfileIds: agentExecutionReadinessPendingProfileIds,
					profileId: profile.openMeldProfileId,
					readinessByProfileId: agentExecutionReadinessByProfileId,
				}) === input.availabilityFilter
		);
	}, [
		agentExecutionReadinessByProfileId,
		agentExecutionReadinessErrorByProfileId,
		agentExecutionReadinessPendingProfileIds,
		input.availabilityFilter,
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
	const [pendingRemoveProfileId, setPendingRemoveProfileId] = useState<
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
	const [
		pendingOrganizationWakeAccessProfileId,
		setPendingOrganizationWakeAccessProfileId,
	] = useState<string | null>(null);
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
	const [highlightedProfileId, setHighlightedProfileId] = useState<
		string | null
	>(input.focusProfileId);
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
		setHighlightedProfileId(input.focusProfileId);
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
					queryClient: input.queryClient,
					storageScope: input.recovery.storageScope,
				});
			}
			await refreshWebAgentReadinessSharedCaches({
				agentProfileIds: profileIdsToRefresh,
				includeLocalRuntimeCaches: false,
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
			await input.recovery.refreshAll();
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
			});
			if (!(response.disabled || response.status === "missing")) {
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
		try {
			await deleteStartAgentProfile({ data: profile.openMeldProfileId });
			await input.recovery.refreshAll();
			toast.success(`${profile.profileName} was removed from Local Agents.`);
		} catch (error) {
			if (isAgentProfileAlreadyRemovedError(error)) {
				try {
					await input.recovery.refreshAll();
					toast.success(
						`${profile.profileName} was already removed from Local Agents.`
					);
				} catch (refreshError) {
					console.error(
						"Failed to refresh Local Agents after the Agent Profile was already removed.",
						refreshError
					);
					toast.warning(
						`${profile.profileName} was already removed. Refresh this page if Local Agents still shows it.`
					);
				}
			} else {
				toast.error(
					formatMutationError(
						error,
						`OpenMeld could not remove ${profile.profileName} right now.`
					)
				);
			}
		}
		setPendingRemoveProfileId(null);
	};

	const handleToggleOrganizationWakeAccess = async (
		profile: AuthProfileView,
		authorized: boolean
	) => {
		setPendingOrganizationWakeAccessProfileId(profile.openMeldProfileId);
		try {
			if (authorized) {
				await authorizeAgentProfileBindingForCurrentOrganization({
					agentProfileId: profile.openMeldProfileId,
					organizationId: currentOrganization.id,
				});
			} else {
				await revokeAgentProfileBindingForCurrentOrganization({
					agentProfileId: profile.openMeldProfileId,
					organizationId: currentOrganization.id,
				});
			}
			await input.queryClient.invalidateQueries({
				queryKey: organizationBindingAuthorizationQueryKeys.profiles(
					currentOrganization.id
				),
			});
		} catch (error) {
			toast.error(
				formatMutationError(
					error,
					`OpenMeld could not update Wake access for ${profile.profileName}.`
				)
			);
		} finally {
			setPendingOrganizationWakeAccessProfileId(null);
		}
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

	if (agentProfilesQueryState.isPending) {
		return <AgentProfilesLoadingRows />;
	}

	if (agentProfilesQueryState.isError) {
		return (
			<AgentProfilesInlineState message="OpenMeld could not load your Agents right now." />
		);
	}

	if (agentProfiles.length === 0) {
		return <EmptyAgentProfilesState onCreateProfile={input.onCreateProfile} />;
	}

	if (visibleAgentProfiles.length === 0) {
		return <AgentProfilesInlineState message="No Agents match this filter." />;
	}

	const renderAgentProfileRow = (profile: AuthProfileView) => {
		const canManage = canManageProfile(profile);
		const readiness =
			agentExecutionReadinessByProfileId.get(profile.openMeldProfileId) ?? null;
		const localAgentEntry = readiness
			? resolveAgentProfileLocalAgentEntry({
					entries: localAgentCatalogEntries,
					readiness,
				})
			: null;
		const organizationWakeAccessRecord =
			organizationWakeAccessByProfileId.get(profile.openMeldProfileId) ?? null;
		const organizationWakeAccess =
			!isPersonalOrganizationContext &&
			canManage &&
			organizationWakeAccessRecord?.bindingId
				? {
						authorized: organizationWakeAccessRecord.authorized,
						isPending:
							pendingOrganizationWakeAccessProfileId ===
							profile.openMeldProfileId,
						onToggle: (authorized: boolean) =>
							handleToggleOrganizationWakeAccess(profile, authorized),
					}
				: null;
		const organizationMemberships = isPersonalOrganizationContext
			? (organizationMembershipsByProfileId.get(profile.openMeldProfileId) ??
				[])
			: [];
		return (
			<AgentProfileExecutionReadinessRow
				actorProfileId={input.recovery.selectedHumanProfileId}
				autoRefreshExhausted={autoRefreshExhaustedProfileIds.has(
					profile.openMeldProfileId
				)}
				canManage={canManage}
				checkAgainIsPending={
					pendingCheckProfileId === profile.openMeldProfileId
				}
				controllerChangeIsPending={
					pendingControllerChangeProfileId === profile.openMeldProfileId
				}
				controllerChangeOptions={controllerChangeOptions}
				controllerCollaborationModeIsPending={
					pendingControllerCollaborationModeProfileId ===
					profile.openMeldProfileId
				}
				controllerPermissionModeIsPending={
					pendingControllerPermissionModeProfileId === profile.openMeldProfileId
				}
				currentLocalRuntimeCanReply={currentLocalRuntimeCanReply}
				directMessageIsPending={
					pendingDirectMessageProfileId === profile.openMeldProfileId
				}
				disablePrimaryBindingIsPending={
					pendingDisablePrimaryBindingProfileId === profile.openMeldProfileId
				}
				duplicateConversationProfileNames={
					duplicateConversationProfileNamesByProfileId.get(
						profile.openMeldProfileId
					) ?? []
				}
				errorMessage={
					agentExecutionReadinessErrorByProfileId.get(
						profile.openMeldProfileId
					) ?? null
				}
				isFocusedProfile={highlightedProfileId === profile.openMeldProfileId}
				isPending={agentExecutionReadinessPendingProfileIds.has(
					profile.openMeldProfileId
				)}
				key={profile.openMeldProfileId}
				localAgentCatalogEntries={localAgentCatalogEntries}
				modelCatalog={modelCatalog}
				modelSelectionIsPending={
					pendingModelSelectionProfileId === profile.openMeldProfileId
				}
				onCheckAgain={async () => {
					await handleCheckProfileAgain(profile);
				}}
				onControllerChange={async (update) => {
					await handleChangeProfileController(profile, update);
				}}
				onControllerCollaborationModeUpdate={async (
					agentControllerCollaborationMode
				) => {
					await handleUpdateProfileControllerCollaborationMode(
						profile,
						agentControllerCollaborationMode
					);
				}}
				onControllerPermissionModeUpdate={async (
					agentControllerPermissionMode
				) => {
					await handleUpdateProfileControllerPermissionMode(
						profile,
						agentControllerPermissionMode
					);
				}}
				onDisablePrimaryBinding={async () => {
					await handleDisableProfilePrimaryBinding(profile);
				}}
				onModelSelectionUpdate={async (modelSelection) => {
					await handleUpdateProfileModelSelection(profile, modelSelection);
				}}
				onOpenCodePermissionUpdate={async (openCodePermission) => {
					await handleUpdateProfileOpenCodePermission(
						profile,
						openCodePermission
					);
				}}
				onOpenDirectMessage={async () => {
					await handleOpenDirectMessage(profile);
				}}
				onProfileUpdated={(updatedProfile) => {
					updateAgentProfileListCaches({
						profile: updatedProfile,
						queryClient: input.queryClient,
						storageScope: input.recovery.storageScope,
					});
				}}
				onRemoveProfile={async () => {
					await handleRemoveProfile(profile);
				}}
				onRenameProfile={async (profileName) => {
					await handleRenameProfile(profile, profileName);
				}}
				onRepairAction={async (action) =>
					await handleConnectProfileToComputer(profile, action)
				}
				openCodePermissionIsPending={
					pendingOpenCodePermissionProfileId === profile.openMeldProfileId
				}
				organizationId={currentOrganization.id}
				organizationMemberships={organizationMemberships}
				organizationWakeAccess={organizationWakeAccess}
				primaryBinding={
					primaryBindingByProfileId.get(profile.openMeldProfileId) ?? null
				}
				profile={profile}
				readiness={readiness}
				removeIsPending={pendingRemoveProfileId === profile.openMeldProfileId}
				renameIsPending={pendingRenameProfileId === profile.openMeldProfileId}
				repairActions={
					canManage
						? resolveAgentProfileRepairActions({
								isCurrentComputer: input.isCurrentComputer,
								localAgentCatalogEntries,
								readiness,
							})
						: []
				}
				repairIsPending={pendingRepairProfileIds.has(profile.openMeldProfileId)}
				rowRef={(node) => {
					if (node) {
						profileRowElementsRef.current.set(profile.openMeldProfileId, node);
					} else {
						profileRowElementsRef.current.delete(profile.openMeldProfileId);
					}
				}}
				setupAction={
					canManage
						? resolveAgentProfileSetupAction({
								autoRefreshExhausted: autoRefreshExhaustedProfileIds.has(
									profile.openMeldProfileId
								),
								currentLocalRuntimeCanReply,
								localAgentDisplayName: localAgentEntry?.displayName ?? null,
								readiness,
								serviceUpdatePath: input.serviceUpdatePath,
								setupPath: input.setupPath,
							})
						: null
				}
				wakeAvailabilityDisplayOverride={
					wakeAvailabilityDisplayOverrideByProfileId.get(
						profile.openMeldProfileId
					) ?? null
				}
			/>
		);
	};

	if (!input.showOwnerGroups) {
		return (
			<>
				{bulkReconnectCandidates.length > 1 ? (
					<AgentProfileBulkReconnectNotice
						candidates={bulkReconnectCandidates}
						isPending={bulkReconnectCandidates.some((candidate) =>
							pendingRepairProfileIds.has(candidate.profile.openMeldProfileId)
						)}
						onReconnect={handleBulkReconnectProfiles}
					/>
				) : null}
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
			{bulkReconnectCandidates.length > 1 ? (
				<AgentProfileBulkReconnectNotice
					candidates={bulkReconnectCandidates}
					isPending={bulkReconnectCandidates.some((candidate) =>
						pendingRepairProfileIds.has(candidate.profile.openMeldProfileId)
					)}
					onReconnect={handleBulkReconnectProfiles}
				/>
			) : null}
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

export function resolveAgentProfileControllerChangeOptions(
	executionTarget: LocalRuntimeExecutionTarget | null
): readonly AgentProfileControllerChangeOption[] {
	const options = new Map<string, AgentProfileControllerChangeOption>();
	for (const entry of bindableLocalAgentEntriesFromTarget(executionTarget)) {
		const agentControllerRef = resolveLocalAgentEntryControllerRef(entry);
		if (!agentControllerRef || options.has(agentControllerRef)) {
			continue;
		}
		options.set(agentControllerRef, {
			agentControllerRef,
			label: entry.displayName || entry.agentId,
		});
	}
	return [...options.values()];
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

function AgentProfileExecutionReadinessRow(input: {
	actorProfileId: string | null;
	autoRefreshExhausted: boolean;
	canManage: boolean;
	checkAgainIsPending: boolean;
	controllerCollaborationModeIsPending: boolean;
	controllerPermissionModeIsPending: boolean;
	currentLocalRuntimeCanReply: boolean | null;
	directMessageIsPending: boolean;
	disablePrimaryBindingIsPending: boolean;
	duplicateConversationProfileNames: readonly string[];
	errorMessage: string | null;
	isFocusedProfile: boolean;
	isPending: boolean;
	localAgentCatalogEntries: readonly DeviceAgentCatalogEntry[];
	modelCatalog: ModelCatalog | null;
	modelSelectionIsPending: boolean;
	openCodePermissionIsPending: boolean;
	controllerChangeIsPending: boolean;
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	onControllerChange: (
		update: AgentProfileControllerChangeUpdate
	) => Promise<void>;
	renameIsPending: boolean;
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
	onProfileUpdated: (profile: AuthProfileView) => void;
	onRepairAction: (action: AgentProfileRepairAction) => Promise<void>;
	onRenameProfile: (profileName: string) => Promise<void>;
	onRemoveProfile: () => Promise<void>;
	organizationMemberships: readonly {
		organizationId: string;
		organizationName: string;
	}[];
	organizationId: string;
	organizationWakeAccess: {
		authorized: boolean;
		isPending: boolean;
		onToggle: (authorized: boolean) => void;
	} | null;
	profile: AuthProfileView;
	primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
	readiness: GetAgentExecutionReadinessResponse | null;
	wakeAvailabilityDisplayOverride: AgentWakeAvailability | null;
	repairActions: readonly AgentProfileRepairAction[];
	repairIsPending: boolean;
	removeIsPending: boolean;
	rowRef?: Ref<HTMLElement>;
	setupAction: AgentProfileSetupAction | null;
}) {
	const controllerPermissionModeDisplay =
		resolveWebAgentControllerPermissionModeDisplayFromBinding(
			input.primaryBinding
		);
	const profileDetailsWithoutModel = buildProfileDetailsSnapshotFromAuthProfile(
		{
			agentControllerPermissionModeDetail:
				controllerPermissionModeDisplay?.label ?? null,
			modelDetail: null,
			primaryBinding: input.primaryBinding,
			profile: input.profile,
			readiness: input.readiness,
		}
	);
	const rowMoreMenu = (details: ProfileDetailsSnapshot) => (
		<AgentProfileRowMoreMenu
			actorProfileId={input.actorProfileId}
			canManage={input.canManage}
			controllerChangeOptions={input.controllerChangeOptions}
			details={details}
			editState={resolveAgentProfileEditState({
				binding: input.primaryBinding,
				modelCatalog: input.modelCatalog,
			})}
			hasEnabledPrimaryBinding={
				input.primaryBinding?.bindingState === "enabled_primary"
			}
			isControllerChangePending={input.controllerChangeIsPending}
			isControllerCollaborationModePending={
				input.controllerCollaborationModeIsPending
			}
			isControllerPermissionModePending={
				input.controllerPermissionModeIsPending
			}
			isDirectMessagePending={input.directMessageIsPending}
			isDisablePrimaryBindingPending={input.disablePrimaryBindingIsPending}
			isModelSelectionPending={input.modelSelectionIsPending}
			isOpenCodePermissionPending={input.openCodePermissionIsPending}
			isRemovePending={input.removeIsPending}
			isRenamePending={input.renameIsPending}
			modelCatalog={input.modelCatalog}
			onControllerChange={input.onControllerChange}
			onControllerCollaborationModeUpdate={
				input.onControllerCollaborationModeUpdate
			}
			onControllerPermissionModeUpdate={input.onControllerPermissionModeUpdate}
			onDisablePrimaryBinding={input.onDisablePrimaryBinding}
			onModelSelectionUpdate={input.onModelSelectionUpdate}
			onOpenCodePermissionUpdate={input.onOpenCodePermissionUpdate}
			onOpenDirectMessage={input.onOpenDirectMessage}
			onProfileUpdated={input.onProfileUpdated}
			onRemoveProfile={input.onRemoveProfile}
			onRenameProfile={input.onRenameProfile}
			organizationId={input.organizationId}
			primaryAgentControllerRef={
				input.primaryBinding?.executionTarget?.agentControllerRef ?? null
			}
			profile={input.profile}
			profileName={input.profile.profileName}
		/>
	);
	const readiness = input.readiness;
	if (readiness === null || input.errorMessage) {
		return renderAgentProfileReadinessPlaceholderCard({
			controllerPermissionModeDisplay,
			errorMessage: input.errorMessage,
			isFocusedProfile: input.isFocusedProfile,
			isPending: input.isPending,
			menu: rowMoreMenu(profileDetailsWithoutModel),
			onRepairAction: input.onRepairAction,
			profileCreatedAt: input.profile.createdAt,
			profileName: input.profile.profileName,
			readiness,
			repairActions: input.repairActions,
			repairIsPending: input.repairIsPending,
			rowRef: input.rowRef,
		});
	}

	const isSelfHealing = isAgentExecutionSelfHealingReadiness(
		readiness.agentExecutionReadiness
	);
	const isDisplayProjectionRefreshing =
		isAgentExecutionDisplayProjectionRefreshing(readiness);
	const isServiceProjectionRefreshing =
		isCurrentRuntimeServiceProjectionRefreshing({
			currentLocalRuntimeCanReply: input.currentLocalRuntimeCanReply,
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
		!input.autoRefreshExhausted;
	const localAgentEntry = resolveAgentProfileLocalAgentEntry({
		entries: input.localAgentCatalogEntries,
		readiness,
	});
	const localAgentDisplayName = localAgentEntry?.displayName ?? null;
	const rawDisplayedAgentWakeAvailability =
		resolveAgentProfileRowWakeAvailability({
			autoRefreshExhausted: input.autoRefreshExhausted,
			currentLocalRuntimeCanReply: input.currentLocalRuntimeCanReply,
			localAgentDisplayName,
			readiness,
		});
	const displayedAgentWakeAvailability = resolveAgentProfileVisualAvailability({
		displayOverride: input.wakeAvailabilityDisplayOverride,
		rawAvailability: rawDisplayedAgentWakeAvailability,
	});
	const canCheckExpiredWakeRouteAgain =
		canManuallyRefreshAgentProfileConnection({
			autoRefreshExhausted: input.autoRefreshExhausted,
			currentLocalRuntimeCanReply: input.currentLocalRuntimeCanReply,
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
		primaryBinding: input.primaryBinding,
		profile: input.profile,
		readiness,
	});
	const cardActions = renderAgentProfileCardActions({
		canCheckExpiredWakeRouteAgain:
			input.canManage && canCheckExpiredWakeRouteAgain,
		checkAgainIsPending: input.checkAgainIsPending,
		duplicateConversationProfileNames: input.duplicateConversationProfileNames,
		hasControllerConversationConflict,
		hideSetupAction,
		onCheckAgain: input.onCheckAgain,
		onRemoveProfile: input.onRemoveProfile,
		onRepairAction: input.onRepairAction,
		profileName: input.profile.profileName,
		removeIsPending: input.removeIsPending,
		repairActions: input.repairActions,
		repairIsPending: input.repairIsPending,
		setupAction: input.setupAction,
	});
	const organizationAccessRow = renderAgentProfileOrganizationAccessRow({
		organizationMemberships: input.organizationMemberships,
		organizationWakeAccess: input.organizationWakeAccess,
		profileName: input.profile.profileName,
	});

	return (
		<ProfileCard
			actions={combineAgentProfileCardMiddleContent(
				organizationAccessRow,
				cardActions
			)}
			className={cn(
				"min-h-40",
				resolveFocusedAgentProfileClassName(input.isFocusedProfile)
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

function renderAgentProfileOrganizationAccessRow(input: {
	organizationMemberships: readonly {
		organizationId: string;
		organizationName: string;
	}[];
	organizationWakeAccess: {
		authorized: boolean;
		isPending: boolean;
		onToggle: (authorized: boolean) => void;
	} | null;
	profileName: string;
}): ReactNode {
	if (input.organizationWakeAccess) {
		return (
			<AgentProfileOrganizationWakeAccessRow
				authorized={input.organizationWakeAccess.authorized}
				isPending={input.organizationWakeAccess.isPending}
				onToggle={input.organizationWakeAccess.onToggle}
				profileName={input.profileName}
			/>
		);
	}
	return (
		<AgentProfileOrganizationMembershipDetail
			organizations={input.organizationMemberships}
		/>
	);
}

function combineAgentProfileCardMiddleContent(
	organizationAccessRow: ReactNode,
	cardActions: ReactNode
): ReactNode {
	if (!(organizationAccessRow || cardActions)) {
		return null;
	}
	return (
		<div className="flex flex-col gap-3">
			{organizationAccessRow}
			{cardActions}
		</div>
	);
}

function AgentProfileOrganizationWakeAccessRow(input: {
	authorized: boolean;
	isPending: boolean;
	onToggle: (authorized: boolean) => void;
	profileName: string;
}) {
	return (
		<div className="flex items-center justify-between gap-3 border-border/70 border-t pt-3">
			<span className="text-muted-foreground text-xs">
				Organization Wake Access
			</span>
			<Switch
				aria-label={`Authorize ${input.profileName} for this organization's Wake access`}
				checked={input.authorized}
				disabled={input.isPending}
				onCheckedChange={input.onToggle}
			/>
		</div>
	);
}

function AgentProfileOrganizationMembershipDetail(input: {
	organizations: readonly {
		organizationId: string;
		organizationName: string;
	}[];
}) {
	if (input.organizations.length === 0) {
		return null;
	}
	return (
		<div className="border-border/70 border-t pt-3">
			<span className="text-muted-foreground text-xs">
				Wake access:{" "}
				{input.organizations
					.map((organization) => organization.organizationName)
					.join(", ")}
			</span>
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

function resolveLocalAgentEntryControllerRef(
	localAgentEntry: DeviceAgentCatalogEntry | null
): string | null {
	if (!localAgentEntry) {
		return null;
	}
	return `${localAgentEntry.targetKind}:${localAgentEntry.agentId}`;
}

export function resolveAgentProfileEditState(input: {
	binding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
	modelCatalog: ModelCatalog | null;
}): AgentProfileEditState | null {
	const agentControllerRef =
		input.binding?.executionTarget?.agentControllerRef ?? null;
	if (!agentControllerRef) {
		return null;
	}
	const parsedAgentControllerRef = parseAgentControllerRef(agentControllerRef);
	if (!parsedAgentControllerRef) {
		return null;
	}
	const capabilities = resolveAgentProfileEditCapabilities({
		agentControllerRef,
		modelCatalog: input.modelCatalog,
	});
	const controllerCollaborationMode = {
		agentControllerRef,
		editable: capabilities.collaborationMode.editable,
		options: capabilities.collaborationMode.options,
		value: capabilities.collaborationMode.editable
			? (resolveNativeAgentControllerCollaborationModeForController(
					input.binding?.agentControllerCollaborationMode,
					{ agentControllerRef }
				) ?? null)
			: null,
	};
	const controllerPermissionMode = {
		agentControllerRef,
		editable: capabilities.permissionMode.editable,
		options: capabilities.permissionMode.options,
		value: capabilities.permissionMode.editable
			? resolveAgentControllerPermissionModeForController(
					input.binding?.agentControllerPermissionMode,
					{ agentControllerRef }
				)
			: null,
	};
	const modelSelection = capabilities.modelSelection.editable
		? {
				agentControllerId: parsedAgentControllerRef.id,
				agentControllerRef,
				modelId: input.binding?.modelSelection?.modelId ?? "",
				reasoningLevel: input.binding?.modelSelection?.reasoningLevel ?? "",
			}
		: null;
	const openCodePermission = isOpenCodeAgentControllerRef(agentControllerRef)
		? {
				agentControllerRef,
				value: input.binding?.openCodePermission ?? null,
			}
		: null;
	return {
		agentControllerId: parsedAgentControllerRef.id,
		agentControllerRef,
		capabilities,
		controllerCollaborationMode,
		controllerPermissionMode,
		modelSelection,
		openCodePermission,
	};
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

function AgentProfileRowMoreMenu(input: {
	actorProfileId: string | null;
	canManage: boolean;
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	details: ProfileDetailsSnapshot;
	editState: AgentProfileEditState | null;
	hasEnabledPrimaryBinding: boolean;
	isControllerChangePending: boolean;
	isControllerCollaborationModePending: boolean;
	isControllerPermissionModePending: boolean;
	isDirectMessagePending: boolean;
	isDisablePrimaryBindingPending: boolean;
	isModelSelectionPending: boolean;
	isOpenCodePermissionPending: boolean;
	isRenamePending: boolean;
	isRemovePending: boolean;
	modelCatalog: ModelCatalog | null;
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
	onProfileUpdated: (profile: AuthProfileView) => void;
	onRenameProfile: (profileName: string) => Promise<void>;
	onRemoveProfile: () => Promise<void>;
	organizationId: string;
	profile: AuthProfileView;
	profileName: string;
	primaryAgentControllerRef: string | null;
}) {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [isProfileEditDialogOpen, setIsProfileEditDialogOpen] = useState(false);
	const [isProjectSettingsDialogOpen, setIsProjectSettingsDialogOpen] =
		useState(false);
	const [isUnbindControllerDialogOpen, setIsUnbindControllerDialogOpen] =
		useState(false);
	const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
	const isProfileEditPending =
		input.isControllerChangePending ||
		input.isControllerCollaborationModePending ||
		input.isControllerPermissionModePending ||
		input.isModelSelectionPending ||
		input.isOpenCodePermissionPending ||
		input.isRenamePending;
	const showProjectSettings = shouldShowAgentProfileProjectSettings({
		agentControllerRef: input.primaryAgentControllerRef,
		managedRole: input.profile.managedRole,
	});
	return (
		<>
			<div className="flex items-center justify-end gap-1">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Direct Message"
								disabled={input.isDirectMessagePending}
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
				{input.canManage ? (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="Edit Agent"
									disabled={
										isProfileEditPending || input.isDisablePrimaryBindingPending
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
				<Popover.Root
					modal={false}
					onOpenChange={setIsMenuOpen}
					open={isMenuOpen}
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
								<button
									className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
									onClick={() => {
										setIsMenuOpen(false);
										setIsDetailsDialogOpen(true);
									}}
									type="button"
								>
									<InfoIcon aria-hidden="true" className="h-4 w-4" />
									About profile
								</button>
								{input.canManage ? (
									<>
										{showProjectSettings ? (
											<button
												className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
												onClick={() => {
													setIsMenuOpen(false);
													setIsProjectSettingsDialogOpen(true);
												}}
												type="button"
											>
												<WrenchIcon aria-hidden="true" className="h-4 w-4" />
												Default Project and folder
											</button>
										) : null}
										{input.hasEnabledPrimaryBinding ? (
											<button
												className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-destructive text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
												disabled={
													input.isDisablePrimaryBindingPending ||
													isProfileEditPending
												}
												onClick={() => {
													setIsMenuOpen(false);
													setIsUnbindControllerDialogOpen(true);
												}}
												type="button"
											>
												<WrenchIcon aria-hidden="true" className="h-4 w-4" />
												Unbind controller
											</button>
										) : null}
										<button
											className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-destructive text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
											disabled={input.isRemovePending}
											onClick={() => {
												setIsMenuOpen(false);
												setIsRemoveDialogOpen(true);
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
			</div>
			<ProfileDetailsDialog
				details={input.details}
				isDirectMessagePending={input.isDirectMessagePending}
				onOpenChange={setIsDetailsDialogOpen}
				onOpenDirectMessage={() => {
					input.onOpenDirectMessage().catch((error) => {
						console.error("Direct Message action failed.", error);
					});
				}}
				open={isDetailsDialogOpen}
			/>
			<AgentProfileProjectSettingsDialog
				actorProfileId={input.actorProfileId}
				agentControllerRef={input.primaryAgentControllerRef}
				onOpenChange={setIsProjectSettingsDialogOpen}
				onProfileUpdated={input.onProfileUpdated}
				open={isProjectSettingsDialogOpen}
				organizationId={input.organizationId}
				profile={input.profile}
			/>
			<AgentProfileEditDialog
				controllerChangeOptions={input.controllerChangeOptions}
				editState={input.editState}
				isPending={isProfileEditPending}
				modelCatalog={input.modelCatalog}
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
			/>
			<AgentProfileUnbindControllerDialog
				isOpen={isUnbindControllerDialogOpen}
				isPending={input.isDisablePrimaryBindingPending}
				onOpenChange={setIsUnbindControllerDialogOpen}
				onUnbindController={input.onDisablePrimaryBinding}
				profileName={input.profileName}
			/>
			<AgentProfileRemoveDialog
				isOpen={isRemoveDialogOpen}
				isPending={input.isRemovePending}
				onOpenChange={setIsRemoveDialogOpen}
				onRemoveProfile={input.onRemoveProfile}
				profileName={input.profileName}
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
	controllerChangeOptions: readonly AgentProfileControllerChangeOption[];
	editState: AgentProfileEditState | null;
	isLoading?: boolean;
	isPending: boolean;
	loadErrorMessage?: string | null;
	modelCatalog: ModelCatalog | null;
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
}) {
	const confirmationId = useId();
	const profileNameInputId = useId();
	const draftInput = useMemo(
		() =>
			resolveAgentProfileEditDraftInput({
				editState: input.editState,
				open: input.open,
				profileName: input.profileName,
			}),
		[input.editState, input.open, input.profileName]
	);
	const draftKey = draftInput.draftKey;
	const [draft, setDraft] = useState<AgentProfileEditDraft>(() =>
		createAgentProfileEditDraft(draftInput)
	);
	useEffect(() => {
		setDraft((currentDraft) =>
			currentDraft.key === draftInput.draftKey
				? currentDraft
				: createAgentProfileEditDraft(draftInput)
		);
	}, [draftInput]);
	const activeDraft =
		draft.key === draftKey ? draft : createAgentProfileEditDraft(draftInput);
	const activeEditState = resolveActiveAgentProfileEditState({
		currentEditState: input.editState,
		modelCatalog: input.modelCatalog,
		selectedAgentControllerRef: activeDraft.selectedAgentControllerRef,
	});
	const controllerPermissionMode =
		activeEditState?.controllerPermissionMode ?? null;
	const controllerCollaborationMode =
		activeEditState?.controllerCollaborationMode ?? null;
	const modelSelection = activeEditState?.modelSelection ?? null;
	const openCodePermission = activeEditState?.openCodePermission ?? null;
	const dialogState = resolveAgentProfileEditDialogState({
		activeDraft,
		controllerCollaborationMode,
		controllerPermissionMode,
		currentAgentControllerRef: input.editState?.agentControllerRef ?? null,
		isPending: input.isPending,
		modelCatalog: input.modelCatalog,
		modelSelection,
		openCodePermission,
		profileName: input.profileName,
	});

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!input.isPending) {
					input.onOpenChange(nextOpen);
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-3xl">
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
								Runtime setting changes apply to new work after the local
								OpenMeld Service syncs. Work already running continues with the
								settings it started with.
							</TooltipContent>
						</Tooltip>
					</DialogTitle>
					<DialogDescription>
						Update settings for {input.profileName}.
					</DialogDescription>
				</DialogHeader>
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
						controllerChangeOptions={input.controllerChangeOptions}
						controllerCollaborationMode={controllerCollaborationMode}
						controllerPermissionMode={controllerPermissionMode}
						dialogState={dialogState}
						disabled={input.isPending}
						draftKey={draftKey}
						editState={input.editState}
						modelCatalog={input.modelCatalog}
						modelSelection={modelSelection}
						onDraftChange={setDraft}
						openCodePermission={openCodePermission}
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
	draftKey: string;
	editState: AgentProfileEditState | null;
	modelCatalog: ModelCatalog | null;
	modelSelection: AgentProfileModelSelectionEditState | null;
	onDraftChange: (draft: AgentProfileEditDraft) => void;
	openCodePermission: AgentProfileOpenCodePermissionEditState | null;
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
						disabled={input.disabled}
						draftKey={input.draftKey}
						modelCatalog={input.modelCatalog}
						onDraftChange={input.onDraftChange}
						options={input.controllerChangeOptions}
					/>
					<AgentProfileModelSelectionEditSection
						activeDraft={input.activeDraft}
						disabled={input.disabled}
						draftKey={input.draftKey}
						modelCatalog={input.modelCatalog}
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
	let completedMutation = false;
	const runMutation = async (mutation: () => Promise<void>) => {
		await mutation();
		completedMutation = true;
	};
	try {
		if (input.dialogState.profileNameChanged) {
			await runMutation(
				async () =>
					await input.onRenameProfile(
						input.dialogState.normalizedDraftProfileName
					)
			);
		}
		await submitAgentProfileBindingChanges({ input, runMutation });
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
	draftKey: string;
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
	const requiresConfirmation = selectedMetadata.requiresExplicitConfirmation;
	return (
		<div className="grid gap-3">
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
							input
								.onRemoveProfile()
								.then(() => {
									input.onOpenChange(false);
								})
								.catch((error) => {
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
	useEffect(() => {
		if (
			input.actions.some(
				(action) =>
					buildAgentProfileRepairActionKey(action) === selectedActionKey
			)
		) {
			return;
		}
		setSelectedActionKey(
			input.actions[0] ? buildAgentProfileRepairActionKey(input.actions[0]) : ""
		);
	}, [input.actions, selectedActionKey]);

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
				value={selectedActionKey}
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
