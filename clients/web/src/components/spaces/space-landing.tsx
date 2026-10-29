import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import {
	createDirectMessageApi,
	type StructuredApiClientFailure,
} from "@openmeld/api-client";
import { WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE } from "@openmeld/schemas";
import type {
	AuthProfileView,
	ConvertDirectMessageToSpaceResponse,
	CurrentLocalRuntimeReplyReadinessResponse,
	GetSpaceStatusResponse,
	RemoveSpaceMembersResponse,
	SpaceMembersSnapshot,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	isActiveWakeProgressItem,
	isAutomaticWakeSpace,
	isDirectMessageSpace,
	resolveSpaceMemberAgentOwnerWakeDiagnosticsView,
} from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type DirectMessageAccessRequest,
	directMessageAccessBadge,
	directMessageAccessRequestCopy,
	useDirectMessageAccessRequest,
} from "#/components/agent-access/direct-message-access-request";
import type { AgentProfileEditDialogContext } from "#/components/agents/agent-profile-edit-dialog-controller";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppMainContent } from "#/components/app/app-main-content";
import { COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY } from "#/components/connect/prepare-session-pointer";
import {
	UnsavedChangesDialog,
	UnsavedChangesGuard,
} from "#/components/forms/unsaved-changes-guard";
import { usePublishInboxVisibleConversation } from "#/components/inbox/inbox-visible-conversation";
import {
	type DirectMessageMemberAgent,
	MemberAgentChatHistory,
	resolveDirectMessageMemberAgent,
} from "#/components/member-agents/member-agent-chat-history";
import { useMemberAgentIndex } from "#/components/member-agents/use-member-agents";
import { useWalkthroughSpaceProgress } from "#/components/onboarding/walkthrough/use-walkthrough-space-progress";
import { useWalkthrough } from "#/components/onboarding/walkthrough/walkthrough-context";
import { WalkthroughGuide } from "#/components/onboarding/walkthrough/walkthrough-guide";
import { CenterAgentChatHistory } from "#/components/organizations/center-agent-chat-history";
import { CenterAgentHeaderTabs } from "#/components/organizations/center-agent-header-navigation";
import { useAccountAvatar } from "#/hooks/account.hooks";
import {
	planAgentProfileReplyRecoveryFromWebEvidence,
	type WebAgentProfileReplyRecoveryLocalAgentCatalog,
} from "#/lib/agents/agent-profile-reply-recovery";
import type {
	ComposerDraftRecord,
	ComposerDraftScope,
} from "#/lib/composer-draft-storage";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { resolveConnectedRuntimeTarget } from "#/lib/connect/connected-runtime";
import { mapCurrentLocalRuntimeReplyReadinessQueryState } from "#/lib/connect/current-local-runtime-readiness";
import {
	spaceOpenFailureMilestone,
	useSpaceOpenPaint,
} from "#/lib/observability/use-space-open-paint";
import { recordProfileSpaceHistory } from "#/lib/onboarding/record-profile-space-history";
import {
	createOrganizationScopedWebOpenMeldApiFoundation,
	resolveWebOrganizationSelector,
} from "#/lib/openmeld-api/client";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { buildProfileRequestContext } from "#/lib/profiles/human-profiles";
import { resolveProfileBindingCatalogExecutionTarget } from "#/lib/profiles/profile-binding-target";
import {
	findActiveProfileById,
	listActiveProfilesByKind,
} from "#/lib/profiles/profiles";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
import {
	applyConfirmedHumanSpaceMemberToCache,
	applySpaceMemberRemovalToCache,
	applySpaceMembersResponseToCache,
} from "#/lib/spaces/member-cache";
import {
	readSpaceMembersPanelOpen,
	writeSpaceMembersPanelOpen,
} from "#/lib/spaces/members-panel-storage";
import type { PendingSpaceMessage } from "#/lib/spaces/pending-message";
import { resolveCurrentSpaceProfileName } from "#/lib/spaces/profile-display";
import {
	resolveAgentAccessHighlightId,
	useOpenMembersPanelForFocus,
	useSpaceMembersFocus,
} from "#/lib/spaces/space-members-focus";
import {
	resolveWakeFailureTargetContext,
	type WakeFailureTargetContext,
} from "#/lib/spaces/wake-failure-display";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import {
	refreshWebAgentReadinessAfterCoreFactsChanged,
	refreshWebAgentReadinessFacts,
	type WebAgentReadinessRefreshFailure,
} from "#/query/agents/execution-readiness";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import {
	centerAgentDesignationQueryOptions,
	centerAgentDirectMessageSpaceProjectionQueryOptions,
} from "#/query/organizations/center-agent";
import { usePendingPermissionModeSuggestions } from "#/query/organizations/permission-mode-suggestions";
import { usePendingSpacePluginActionRequests } from "#/query/organizations/plugin-action-requests";
import { isQueryCancellationError } from "#/query/query-cancellation";
import {
	accountSpaceItemsQueryOptions,
	accountSpaceQueryKeys,
} from "#/query/spaces/account-spaces";
import type { SpaceBootstrapSnapshot } from "#/query/spaces/bootstrap";
import { spaceMemberDirectoryDisplayQueryOptions } from "#/query/spaces/member-directory-display";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	buildDirectMessageConversionDefaultName,
	resolveDirectMessageConversionNames,
} from "./direct-message-conversion";
import { DirectMessageConversionDialog } from "./direct-message-conversion-dialog";
import { resolveDirectMessageSessionAgentProfileId } from "./direct-message-presentation";
import { isManualOnlyAgentRecoveryPlan } from "./space-agent-manual-participation";
import { SpaceAgentProfileEditProvider } from "./space-agent-profile-edit-context";
import type { SpaceAgentProfileBindingRecoveryPlan } from "./space-agent-recovery-action";
import { SpaceAgentRecoveryProvider } from "./space-agent-recovery-context";
import type { SpaceAutomaticWakeComposerHintKind } from "./space-composer-copy";
import type { SpaceComposerEditorHandle } from "./space-composer-editor";
import { SpaceConversationPanel } from "./space-conversation-panel";
import { useSpaceGuideDraft } from "./space-guide-draft";
import {
	type SpaceGuideSaver,
	saveSpaceGuideBeforeLeaving,
	useSpaceGuideSaver,
} from "./space-guide-save";
import { SpaceHeader, SpaceWindowHeader } from "./space-header";
import { SpaceLandingErrorBoundary } from "./space-landing-error-boundary";
import { SpaceLiveNotice } from "./space-live-notice";
import {
	isSameOwnerUserId,
	resolveCurrentSpaceProfileOwnerUserId,
} from "./space-member-ownership";
import {
	SPACE_MEMBERS_SIDE_PANEL_QUERY,
	SpaceAddMembersLauncher,
	type SpaceAddOrganizationDirectoryProfilesInput,
	type SpaceAddProfilesResult,
	type SpaceConvertDirectMessageInput,
	SpaceMembersDrawer,
	SpaceMembersSidePanel,
	SpaceMembersToggleButton,
	type SpaceRemoveMemberResult,
} from "./space-members-drawer";
import { SPACE_MEMBERS_LOAD_ERROR_MESSAGE } from "./space-members-error-copy";
import { MessageActionTooltipProvider } from "./space-message-actions";
import { SpaceNotificationMenu } from "./space-notification-menu";
import {
	SetupRecallButton,
	SpaceConversationRecoveryBanner,
	type SpaceSetupVisibility,
} from "./space-onboarding-banner";
import {
	SpaceFilesSkeleton,
	SpaceTasksSkeleton,
} from "./space-panel-skeletons";
import {
	partitionSpacePendingAgentActions,
	resolveSpacePendingAgentActionIdentity,
} from "./space-pending-agent-action-model";
import { SpacePendingAgentActions } from "./space-pending-agent-actions";
import { SpacePinsProvider } from "./space-pins";
import { SpaceProfileSwitcher } from "./space-profile-switcher";
import { SpaceReadingHeaderProvider } from "./space-reading-header";
import { buildSpaceReferenceMessageTexts } from "./space-reference-message-texts";
import {
	SpaceLandingFailureSurface,
	SpaceLandingLoadingShell,
	SpacePasswordRecoverySurface,
} from "./space-state-surfaces";
import { SpaceTaskReferencesProvider } from "./space-task-references";
import { SpaceThreadLoadingPanel } from "./space-thread-loading";
import { SpaceThreadPanel } from "./space-thread-panel";
import type { SpaceView } from "./space-view";
import { SpaceViewTabs } from "./space-view-tabs";
import {
	isSpaceWakeStatusAutoRefreshable,
	isSpaceWakeStatusPassiveRefreshCandidate,
	isSpaceWakeStatusRefreshCandidate,
	resolveSpaceWakeStatusTransientState,
	SPACE_WAKE_STATUS_AUTO_REFRESH_ATTEMPTS,
	SPACE_WAKE_STATUS_FRESHNESS_REFRESH_INTERVAL_MS,
	SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS,
	SPACE_WAKE_STATUS_REFRESH_WINDOW_MS,
} from "./space-wake-status-refresh";
import { SpaceWorkBookmarksProvider } from "./space-work-bookmarks";
import { useSavedConversationTitle } from "./use-saved-conversation-title";
import {
	type SavedDirectMessageJoin,
	useSaveDirectMessageJoin,
	useSpaceComposerRegion,
	useSpaceViewerMembership,
	type ViewerMembershipState,
} from "./use-space-composer-region";
import { useSpaceConversationReadCache } from "./use-space-conversation-read-cache";
import { useSpaceFileNavigation } from "./use-space-file-navigation";
import { useSpaceInboxReadPosition } from "./use-space-inbox-read-position";
import { useSpaceLandingController } from "./use-space-landing-controller";
import { useSpaceMessageReferences } from "./use-space-message-references";
import { useSpacePanelWidth } from "./use-space-panel-width";
import { useSpacePendingAgentActions } from "./use-space-pending-agent-actions";
import { useSpaceThreadTarget } from "./use-space-thread-target";
import { useWakeDisplayDebounce } from "./use-wake-display-debounce";
import { WelcomeSpaceGuide } from "./welcome-space-guide";
import {
	buildWelcomeSpaceDraft,
	readWelcomeRecipients,
	readWelcomeSpace,
	resolveWelcomeRecipients,
	saveWelcomeRecipients,
	saveWelcomeSpace,
	useWelcomeSpace,
	welcomeStepStartedAt,
} from "./welcome-space-state";

const SpaceFilesPanel = lazy(() =>
	import("./space-files-panel").then((module) => ({
		default: module.SpaceFilesPanel,
	}))
);

const SpaceGuidePanel = lazy(() =>
	import("./space-guide-panel").then((module) => ({
		default: module.SpaceGuidePanel,
	}))
);

const SpaceTasksPanel = lazy(() =>
	import("./space-tasks-panel").then((module) => ({
		default: module.SpaceTasksPanel,
	}))
);

function DelayedSpaceTasksFallback() {
	return useDelayedPending(true) ? <SpaceTasksSkeleton /> : null;
}

function DelayedSpaceFilesFallback() {
	return useDelayedPending(true) ? (
		<SpaceFilesSkeleton className="p-6" showToolbar />
	) : null;
}

function SpaceTasksPanelSlot(input: {
	canAddMembers: boolean;
	selectedTaskId: string | null;
	onSelectTask: (taskId: string | null) => void;
	enabled: boolean;
	membersSnapshot: SpaceMembersSnapshot | null;
	onOpenThread: (threadId: string) => void;
	openMeldProfileId: string;
	organizationId: string | null;
	organizationSlug?: string;
	spaceId: string;
	spaceName: string | null;
}) {
	if (!input.enabled) {
		return null;
	}
	return (
		<Suspense fallback={<DelayedSpaceTasksFallback />}>
			<SpaceTasksPanel
				canAddMembers={input.canAddMembers}
				key={input.spaceId}
				membersSnapshot={input.membersSnapshot}
				onOpenThread={input.onOpenThread}
				onSelectTask={input.onSelectTask}
				openMeldProfileId={input.openMeldProfileId}
				organizationId={input.organizationId ?? undefined}
				organizationSlug={input.organizationSlug}
				selectedTaskId={input.selectedTaskId}
				spaceId={input.spaceId}
				spaceName={input.spaceName}
			/>
		</Suspense>
	);
}

const EMPTY_ACCOUNT_PROFILES: readonly AuthProfileView[] = [];
const EMPTY_SPACE_DESCRIPTION =
	"You and your teammates can give agents work. Agents can ask other agents for help. Everyone can see the results here.";
const EMPTY_SPACE_TITLE = "A Space is where people and agents work together.";

type WakeFinalOutcomeFactsRefreshInput = {
	agentProfileIds: readonly string[];
	signalIds: readonly string[];
};

type CurrentSpaceMemberFactsRefreshInput = {
	agentProfileIds?: readonly string[];
	forceNetwork?: boolean;
};

// Recall + Add-agents-highlight state for the Get-set-up panel, lifted here so
// the header recall action and the Members-drawer flash can share it. Extracted
// from SpaceLanding to keep that component's cognitive complexity in budget.
function useSpaceSetupRecallWiring(input: {
	activeView: SpaceView;
	onViewChange: (view: SpaceView) => void;
}) {
	const [setupRecallNonce, setSetupRecallNonce] = useState(0);
	const [setupVisibility, setSetupVisibility] = useState<SpaceSetupVisibility>({
		allHidden: false,
		hasSetup: false,
	});
	const [addMembersRequestNonce, setAddMembersRequestNonce] = useState(0);
	const handleSetupVisibilityChange = useCallback(
		(visibility: SpaceSetupVisibility) => {
			setSetupVisibility(visibility);
		},
		[]
	);
	const handleRecallSetup = useCallback(() => {
		input.onViewChange("messages");
		setSetupRecallNonce((nonce) => nonce + 1);
		setSetupVisibility((current) => ({ ...current, allHidden: false }));
	}, [input.onViewChange]);
	const handleAddAgentsFromBanner = useCallback(() => {
		setAddMembersRequestNonce((nonce) => nonce + 1);
	}, []);
	const setupRecallAction =
		setupVisibility.hasSetup &&
		(setupVisibility.allHidden || input.activeView === "graph") ? (
			<SetupRecallButton onClick={handleRecallSetup} />
		) : null;
	return {
		addMembersRequestNonce,
		handleAddAgentsFromBanner,
		handleSetupVisibilityChange,
		setupRecallAction,
		setupRecallNonce,
	};
}

function resolveCurrentSpaceControls(input: {
	isDeleted: boolean;
	isGuest?: boolean;
	isActiveSpaceMember: boolean;
	isCurrentAccessConfirmed: boolean;
	currentSpaceIsCenterAgentDirectMessage: boolean;
	currentSpaceIsDirectMessage: boolean;
	handleAddAgentsFromBanner: () => void;
	handleAddOrganizationDirectoryProfiles: (
		input: SpaceAddOrganizationDirectoryProfilesInput
	) => Promise<SpaceAddProfilesResult>;
	handleAddProfiles: (
		profileIds: readonly string[]
	) => Promise<SpaceAddProfilesResult>;
	handleConvertDirectMessageToSpace: (
		input: SpaceConvertDirectMessageInput
	) => Promise<SpaceAddProfilesResult>;
	showDeleteSpaceAction: boolean;
}): {
	canManageSpaceAccess: boolean;
	canManageSpaceName: boolean;
	hideShareControl: boolean;
	managementControl: ReactNode;
	onAddAgentsFromBanner?: () => void;
	onAddOrganizationDirectoryProfiles?: (
		input: SpaceAddOrganizationDirectoryProfilesInput
	) => Promise<SpaceAddProfilesResult>;
	onAddProfiles?: (
		profileIds: readonly string[]
	) => Promise<SpaceAddProfilesResult>;
	onConvertDirectMessageToSpace?: (
		input: SpaceConvertDirectMessageInput
	) => Promise<SpaceAddProfilesResult>;
} {
	if (
		input.isDeleted ||
		!input.isCurrentAccessConfirmed ||
		input.isGuest ||
		(input.currentSpaceIsDirectMessage && !input.isActiveSpaceMember)
	) {
		return {
			canManageSpaceAccess: false,
			canManageSpaceName: false,
			hideShareControl: true,
			managementControl: null,
		};
	}
	if (input.currentSpaceIsCenterAgentDirectMessage) {
		return {
			canManageSpaceAccess: false,
			canManageSpaceName: false,
			hideShareControl: true,
			managementControl: null,
		};
	}
	if (input.currentSpaceIsDirectMessage) {
		return {
			canManageSpaceAccess: false,
			canManageSpaceName: false,
			hideShareControl: true,
			managementControl: null,
			onAddOrganizationDirectoryProfiles:
				input.handleAddOrganizationDirectoryProfiles,
			onAddProfiles: input.handleAddProfiles,
			onConvertDirectMessageToSpace: input.handleConvertDirectMessageToSpace,
		};
	}

	return {
		canManageSpaceAccess: input.showDeleteSpaceAction,
		canManageSpaceName: input.showDeleteSpaceAction,
		hideShareControl: false,
		managementControl: null,
		onAddAgentsFromBanner: input.handleAddAgentsFromBanner,
		onAddOrganizationDirectoryProfiles:
			input.handleAddOrganizationDirectoryProfiles,
		onAddProfiles: input.handleAddProfiles,
	};
}

function useSpaceCenterAgentState(input: {
	knownCenterAgentDirectMessage?: boolean;
	organizationId: string | null;
	spaceId: string;
}) {
	const projectionQuery = useQuery(
		centerAgentDirectMessageSpaceProjectionQueryOptions({
			enabled: input.organizationId !== null,
			organizationId: input.organizationId ?? "",
		})
	);
	const designationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: input.organizationId !== null,
			organizationId: input.organizationId ?? "",
		})
	);
	const currentSpaceProjection =
		projectionQuery.data?.projection?.spaceId === input.spaceId
			? projectionQuery.data.projection
			: null;
	const projectionMatchesCurrentSpace = currentSpaceProjection !== null;

	return {
		centerAgentProfileId:
			currentSpaceProjection?.centerAgentProfileId ??
			designationQuery.data?.designation?.agentProfileId ??
			null,
		designationPending: designationQuery.isPending,
		isCenterAgentDirectMessage:
			input.knownCenterAgentDirectMessage ?? projectionMatchesCurrentSpace,
		slackConnection: designationQuery.data?.slackConnection,
	};
}

function resolveOptionalAppOrganizationId(
	context: ReturnType<typeof useOptionalAppOrganization>
) {
	return context?.currentOrganization.id ?? null;
}

function useActiveWakeTargetProfileIds(
	controller: ReturnType<typeof useSpaceLandingController>
) {
	const activeWakeWaitingTargetProfileIds = useMemo(
		() =>
			controller.mode === "ready"
				? resolveActiveWakeWaitingTargetProfileIds(
						controller.presentedWakeProgressItems,
						controller.threadEphemeralActivityItems
					)
				: new Set<string>(),
		[controller]
	);
	const activeWakeDisplayTargetProfileIds = useMemo(
		() =>
			controller.mode === "ready"
				? resolveActiveWakeDisplayTargetProfileIds(
						controller.presentedWakeProgressItems,
						controller.threadEphemeralActivityItems
					)
				: new Set<string>(),
		[controller]
	);
	const activeWakeFolderWaitTargetProfileIds = useMemo(
		() =>
			controller.mode === "ready"
				? resolveActiveWakeFolderWaitTargetProfileIds(
						controller.presentedWakeProgressItems,
						controller.threadEphemeralActivityItems
					)
				: new Set<string>(),
		[controller]
	);
	return {
		activeWakeDisplayTargetProfileIds,
		activeWakeFolderWaitTargetProfileIds,
		activeWakeWaitingTargetProfileIds,
	};
}

type SpaceLandingInput = {
	/** Embedded conversations only advance read state while actively being read. */
	readingEnabled?: boolean;
	isGuest?: boolean;
	conversationTitle?: string;
	conversationTitleAction?: (title: string) => ReactNode;
	conversationControl?: ReactNode;
	accountProfiles?: readonly AuthProfileView[];
	composerDraftMigrationScopes?: readonly ComposerDraftScope[];
	currentUserAvatarImageUrl?: string | null;
	initialComposerDraft?: ComposerDraftRecord | null;
	initialFocusInteractionId?: string;
	initialFocusRequestId?: string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	initialPendingMessage?: PendingSpaceMessage | null;
	initialSpaceView?: SpaceView;
	isPersonalContext?: boolean;
	isCenterAgentDirectMessage?: boolean;
	isDirectMessageConversation?: boolean;
	loadingFallback?:
		| ReactNode
		| ((
				controller: Extract<
					SpaceLandingState["controller"],
					{ mode: "loading" }
				>
		  ) => ReactNode);
	onInitialPendingMessageConsumed?: () => void;
	onComposerReady?: (composer: SpaceComposerEditorHandle) => void;
	onSpaceViewCommitted?: (view: SpaceView) => void;
	orgSlug?: string;
	presentation?: "compact" | "full";
	membersPresentation?: "inline";
	spaceId: string;
	profileId: string;
};

function resolveSpaceInboxUnreadDestination(input: {
	isCenterAgentDirectMessage: boolean;
	isDirectMessageConversation: boolean;
}): "center-agent" | "direct-message" | "ordinary-space" {
	if (input.isCenterAgentDirectMessage) {
		return "center-agent";
	}
	if (input.isDirectMessageConversation) {
		return "direct-message";
	}
	return "ordinary-space";
}

function useSpaceLandingState(input: SpaceLandingInput) {
	const [taskSelection, setTaskSelection] = useState<{
		spaceId: string | undefined;
		taskId: string | null;
	} | null>(null);
	const selectedTaskId =
		taskSelection?.spaceId === input.spaceId
			? (taskSelection?.taskId ?? null)
			: null;
	const setSelectedTaskId = (taskId: string | null) =>
		setTaskSelection({ spaceId: input.spaceId, taskId });
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const generatedSpaceViewId = useId();
	const spaceViewIdPrefix = `space-view-${generatedSpaceViewId}`;
	const spaceFileNavigation = useSpaceFileNavigation(
		input.initialSpaceView,
		input.onSpaceViewCommitted
	);
	const { changeSpaceView, openSpaceFile, spaceFileToOpen, spaceView } =
		spaceFileNavigation;
	const accountProfiles = resolveSpaceLandingAccountProfiles(
		input.accountProfiles
	);
	const organizationContext = useOptionalAppOrganization();
	const currentUserAvatarImageUrl = useSpaceLandingCurrentUserAvatarImageUrl(
		input.currentUserAvatarImageUrl
	);
	const { data: modelCatalog = null } = useQuery(modelCatalogQueryOptions());
	const organizationId = resolveOptionalAppOrganizationId(organizationContext);
	const centerAgentState = useSpaceCenterAgentState({
		knownCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		organizationId,
		spaceId: input.spaceId,
	});
	const currentSpaceIsCenterAgentDirectMessage =
		centerAgentState.isCenterAgentDirectMessage;
	const spaceInboxReadPosition = useSpaceInboxReadPosition({
		destination: resolveSpaceInboxUnreadDestination({
			isCenterAgentDirectMessage: currentSpaceIsCenterAgentDirectMessage,
			isDirectMessageConversation: input.isDirectMessageConversation === true,
		}),
		organizationId,
		profileId: input.profileId,
		spaceId: input.spaceId,
	});
	const recovery = useLocalAgentRecoveryController({
		currentLocalRuntimeReplyReadinessRefetchIntervalMs: false,
		loadAgentExecutionReadiness: false,
		loadAgentProfiles: false,
		loadSetupState: false,
	});
	const wakeFinalOutcomeFactsRefreshRef = useRef<
		((refreshInput: WakeFinalOutcomeFactsRefreshInput) => Promise<void>) | null
	>(null);
	const currentSpaceMemberFactsRefreshRef = useRef<
		| ((refreshInput?: CurrentSpaceMemberFactsRefreshInput) => Promise<void>)
		| null
	>(null);
	const routeCatalogRefreshProfileIdsRef = useRef(new Set<string>());
	const refreshWakeFinalOutcomeFacts = useCallback(
		async (refreshInput: WakeFinalOutcomeFactsRefreshInput) => {
			await wakeFinalOutcomeFactsRefreshRef.current?.(refreshInput);
		},
		[]
	);
	const refreshCurrentSpaceMemberFacts = useCallback(
		async (refreshInput?: CurrentSpaceMemberFactsRefreshInput) => {
			await currentSpaceMemberFactsRefreshRef.current?.(refreshInput);
		},
		[]
	);
	const controller = useSpaceLandingController({
		...input,
		centerAgentProfileId: currentSpaceIsCenterAgentDirectMessage
			? centerAgentState.centerAgentProfileId
			: null,
		onViewedUpdates: spaceInboxReadPosition.markViewed,
		unreadStateReady: spaceInboxReadPosition.isReady,
		unreadTotalCount: spaceInboxReadPosition.totalUnreadCount,
		unreadTargets: spaceInboxReadPosition.targets,
		unreadScopes: spaceInboxReadPosition.scopes,
		unreadBoundaryVersion: spaceInboxReadPosition.readBoundaryVersion,
		onInitialPendingMessageConsumed: input.onInitialPendingMessageConsumed,
		onWakeFinalOutcomeFactsRefresh: refreshWakeFinalOutcomeFacts,
		ownerAccountId: recovery.storageScope,
		organizationId,
	});
	const composerHandleRef =
		controller.mode === "ready" ? controller.textareaRef : null;
	useEffect(() => {
		if (composerHandleRef?.current) {
			input.onComposerReady?.(composerHandleRef.current);
		}
	}, [composerHandleRef, input.onComposerReady]);
	usePublishInboxVisibleConversation(
		input.readingEnabled !== false &&
			controller.mode === "ready" &&
			spaceView === "messages"
			? {
					kind: "space",
					spaceId: input.spaceId,
					threadRootSignalId: controller.activeThread?.rootSignalId ?? null,
				}
			: null
	);
	// A Space the viewer is looking at can be deleted by anyone (e.g. via the CLI),
	// which makes the Space load fail; this redirects away from the dead URL instead
	// of stranding the viewer on a futile "Try Again" (extracted to a hook to keep
	// this component under the cognitive-complexity budget).
	const { currentSpaceWasDeleted, isCheckingForDeletion } =
		useRedirectAwayFromDeletedSpace({
			controllerMode: controller.mode,
			orgSlug: input.orgSlug,
			profileId: input.profileId,
			spaceId: input.spaceId,
		});
	const viewportSupportsMembersPanel = useMediaQuery(
		SPACE_MEMBERS_SIDE_PANEL_QUERY
	);
	const isDesktopMembersPanel =
		input.membersPresentation === "inline" || viewportSupportsMembersPanel;
	const [membersPanelOpenOverrides, setMembersPanelOpenOverrides] = useState<
		ReadonlyMap<string, boolean>
	>(() => new Map());
	const membersOpen =
		membersPanelOpenOverrides.get(input.spaceId) ??
		resolveInitialMembersPanelOpen({
			spaceId: input.spaceId,
		});
	const setMembersOpen = useCallback(
		(open: boolean) => {
			setMembersPanelOpenOverrides((current) => {
				const next = new Map(current);
				next.set(input.spaceId, open);
				return next;
			});
		},
		[input.spaceId]
	);
	const membersFocus = useSpaceMembersFocus();
	useOpenMembersPanelForFocus({
		focus: membersFocus,
		onOpen: setMembersOpen,
		spaceId: input.spaceId,
	});
	const membersPanelWidth = useSpacePanelWidth({
		panel: "members",
		spaceId: input.spaceId,
	});
	const setupPromptedSpaceIdRef = useRef<string | null>(null);
	const autoRefreshAttemptsRef = useRef(new Map<string, number>());
	const localRuntimeReadinessEventStateRef =
		useRef<LocalRuntimeReadinessEventState | null>(null);
	const localAgentRecoveryRefreshWindowTimerRef = useRef<number | null>(null);
	const [autoRefreshExhaustedProfileIds, setAutoRefreshExhaustedProfileIds] =
		useState<ReadonlySet<string>>(() => new Set());
	const [
		localAgentRecoveryRefreshWindowActive,
		setLocalAgentRecoveryRefreshWindowActive,
	] = useState(false);
	const pageVisible = useSyncExternalStore(
		subscribeDocumentVisibility,
		getDocumentVisibilitySnapshot,
		getServerDocumentVisibilitySnapshot
	);
	const previousPageVisibleRef = useRef(pageVisible);
	const membersSnapshot =
		controller.mode === "ready" ? controller.membersSnapshot : null;
	// One debounce timer for the whole Members surface so desktop SidePanel and
	// mobile Drawer share a single display-only override (never count down
	// independently). Visual smoothing only -- raw snapshot still drives dispatch.
	const wakeDisplayOverrideByProfileId = useWakeDisplayDebounce(
		membersSnapshot?.agents ?? []
	);
	const {
		activeWakeDisplayTargetProfileIds,
		activeWakeFolderWaitTargetProfileIds,
		activeWakeWaitingTargetProfileIds,
	} = useActiveWakeTargetProfileIds(controller);
	const currentAccountProfile = useMemo(
		() =>
			accountProfiles.find(
				(profile) => profile.openMeldProfileId === input.profileId
			) ?? null,
		[accountProfiles, input.profileId]
	);
	const currentOwnerUserId = useMemo(
		() =>
			resolveCurrentSpaceProfileOwnerUserId({
				currentProfileId: input.profileId,
				snapshot: membersSnapshot,
			}) ??
			currentAccountProfile?.ownerUserId ??
			null,
		[currentAccountProfile?.ownerUserId, input.profileId, membersSnapshot]
	);
	const canCurrentProfileRemoveSpaceMembers =
		controller.mode === "ready" && controller.showDeleteSpaceAction;
	// Normalize the optional Space name (string | undefined) to string | null for
	// the onboarding banner's create-first-agent launcher. Memoized so the guard
	// and nullish coalescing live in this nested scope rather than SpaceLanding's
	// body. A loading conversation can also carry a display-only status.
	const spaceName = useMemo(
		() =>
			controller.mode === "ready" ? (controller.status.name ?? null) : null,
		[controller]
	);
	const spaceReferenceInputs = resolveSpaceReferenceInputs(controller);
	const spaceReferenceMessageTexts = useMemo(
		() =>
			buildSpaceReferenceMessageTexts({
				membersSnapshot: spaceReferenceInputs.membersSnapshot,
				threadSignals: spaceReferenceInputs.threadSignals,
				timelineItems: spaceReferenceInputs.timelineItems,
			}),
		[
			spaceReferenceInputs.membersSnapshot,
			spaceReferenceInputs.threadSignals,
			spaceReferenceInputs.timelineItems,
		]
	);
	const spaceReferencesById = useSpaceMessageReferences({
		accountProfileId: input.profileId,
		currentSpace: spaceReferenceInputs.currentSpace,
		messageTexts: spaceReferenceMessageTexts,
		organizationId,
		organizationSlug: input.orgSlug ?? null,
	});
	const localAgentRecoveryAutoRefreshActive =
		localAgentRecoveryRefreshWindowActive ||
		activeWakeWaitingTargetProfileIds.size > 0;
	const computerReplyReadiness = useMemo(
		() =>
			resolveSpaceComputerReplyReadiness({
				isFetching: recovery.currentLocalRuntimeReplyReadinessQuery.isFetching,
				isPending: recovery.currentLocalRuntimeReplyReadinessQuery.isPending,
				readiness: recovery.currentLocalRuntimeReplyReadinessQuery.data ?? null,
			}),
		[
			recovery.currentLocalRuntimeReplyReadinessQuery.data,
			recovery.currentLocalRuntimeReplyReadinessQuery.isFetching,
			recovery.currentLocalRuntimeReplyReadinessQuery.isPending,
		]
	);
	const deviceAgentCatalog = useMemo(
		() => recovery.selectedExecutionTarget?.localAgentCatalog ?? null,
		[recovery.selectedExecutionTarget]
	);
	const agentRecoveryPlansByProfileId = useMemo(
		() =>
			buildSpaceAgentRecoveryPlansByProfileId({
				autoRefreshActive: localAgentRecoveryAutoRefreshActive,
				autoRefreshExhaustedProfileIds,
				computerReplyReadiness,
				currentOwnerUserId,
				deviceAgentCatalog,
				snapshot: membersSnapshot,
			}),
		[
			autoRefreshExhaustedProfileIds,
			computerReplyReadiness,
			currentOwnerUserId,
			deviceAgentCatalog,
			localAgentRecoveryAutoRefreshActive,
			membersSnapshot,
		]
	);
	const wakeFailureTargetContextsByProfileId = useMemo(
		() =>
			buildWakeFailureTargetContextsByProfileId({
				currentOwnerUserId,
				snapshot: membersSnapshot,
			}),
		[currentOwnerUserId, membersSnapshot]
	);
	const shouldOpenMembersPanelOnEntry = useMemo(
		() =>
			shouldOpenMembersPanelOnSpaceEntry({
				agentRecoveryPlansByProfileId,
				autoRefreshExhaustedProfileIds,
				currentOwnerUserId,
				snapshot: membersSnapshot,
			}),
		[
			agentRecoveryPlansByProfileId,
			autoRefreshExhaustedProfileIds,
			currentOwnerUserId,
			membersSnapshot,
		]
	);
	const shouldAutoRefreshLocalAgentRecovery = useMemo(
		() =>
			shouldAutoRefreshSpaceAgentRecovery({
				activeWakeWaitingTargetProfileIds,
				agentRecoveryPlansByProfileId,
				autoRefreshExhaustedProfileIds,
				currentOwnerUserId,
				recoveryRefreshWindowActive: localAgentRecoveryRefreshWindowActive,
				snapshot: membersSnapshot,
			}),
		[
			activeWakeWaitingTargetProfileIds,
			agentRecoveryPlansByProfileId,
			autoRefreshExhaustedProfileIds,
			currentOwnerUserId,
			localAgentRecoveryRefreshWindowActive,
			membersSnapshot,
		]
	);
	const shouldStartPassiveLocalAgentRecoveryRefreshWindow = useMemo(
		() =>
			shouldStartPassiveLocalAgentRecoveryRefresh({
				agentRecoveryPlansByProfileId,
				autoRefreshExhaustedProfileIds,
				currentOwnerUserId,
				recoveryRefreshWindowActive: localAgentRecoveryRefreshWindowActive,
				snapshot: membersSnapshot,
			}),
		[
			agentRecoveryPlansByProfileId,
			autoRefreshExhaustedProfileIds,
			currentOwnerUserId,
			localAgentRecoveryRefreshWindowActive,
			membersSnapshot,
		]
	);
	const shouldRunHighFrequencyRecoveryRefresh =
		pageVisible && shouldAutoRefreshLocalAgentRecovery;
	useEffect(() => {
		if (!membersSnapshot) {
			autoRefreshAttemptsRef.current.clear();
			setAutoRefreshExhaustedProfileIds((current) =>
				current.size === 0 ? current : new Set()
			);
			return;
		}
		const refreshableProfileIds = new Set<string>();
		for (const agent of membersSnapshot.agents) {
			if (
				isCurrentOwnerSpaceAgentMember({
					agent,
					currentOwnerUserId,
				}) &&
				isSpaceWakeStatusRefreshCandidate({
					agent,
					plan: agentRecoveryPlansByProfileId.get(agent.profileId),
				})
			) {
				refreshableProfileIds.add(agent.profileId);
			}
		}
		for (const profileId of [...autoRefreshAttemptsRef.current.keys()]) {
			if (!refreshableProfileIds.has(profileId)) {
				autoRefreshAttemptsRef.current.delete(profileId);
			}
		}
		setAutoRefreshExhaustedProfileIds((current) =>
			replaceSetIfChanged(
				current,
				[...current].filter((profileId) => refreshableProfileIds.has(profileId))
			)
		);
	}, [agentRecoveryPlansByProfileId, currentOwnerUserId, membersSnapshot]);
	const startLocalAgentRecoveryRefreshWindow = useCallback(() => {
		autoRefreshAttemptsRef.current.clear();
		routeCatalogRefreshProfileIdsRef.current.clear();
		setAutoRefreshExhaustedProfileIds((current) =>
			current.size === 0 ? current : new Set()
		);
		setLocalAgentRecoveryRefreshWindowActive(true);
		if (localAgentRecoveryRefreshWindowTimerRef.current) {
			clearTimeout(localAgentRecoveryRefreshWindowTimerRef.current);
		}
		localAgentRecoveryRefreshWindowTimerRef.current = window.setTimeout(() => {
			localAgentRecoveryRefreshWindowTimerRef.current = null;
			routeCatalogRefreshProfileIdsRef.current.clear();
			setLocalAgentRecoveryRefreshWindowActive(false);
		}, SPACE_WAKE_STATUS_REFRESH_WINDOW_MS);
	}, []);
	useEffect(
		() => () => {
			if (localAgentRecoveryRefreshWindowTimerRef.current) {
				clearTimeout(localAgentRecoveryRefreshWindowTimerRef.current);
			}
		},
		[]
	);
	useLayoutEffect(() => {
		wakeFinalOutcomeFactsRefreshRef.current = async (refreshInput) => {
			const agentProfileIds = normalizeAgentProfileIds(
				refreshInput.agentProfileIds
			);
			const signalIds = normalizeSignalIds(refreshInput.signalIds);
			const currentOwnerAgentProfileIds = filterCurrentOwnerAgentProfileIds({
				agentProfileIds,
				currentOwnerUserId,
				snapshot: membersSnapshot,
			});
			const currentOwnerEvidenceAvailable =
				membersSnapshot !== null && currentOwnerUserId !== null;
			if (organizationId && currentOwnerAgentProfileIds.length > 0) {
				startLocalAgentRecoveryRefreshWindow();
				await refreshWebAgentReadinessAfterCoreFactsChanged({
					agentProfileIds: currentOwnerAgentProfileIds,
					includeLocalRuntimeCaches: false,
					onStepFailure: (failure) =>
						warnWakeFinalOutcomeRefreshFailure({
							...failure,
							signalIds,
							spaceId: input.spaceId,
						}),
					maxAttempts: 2,
					organizationId,
					queryClient,
					storageScope: recovery.storageScope,
				});
			} else if (
				organizationId &&
				!currentOwnerEvidenceAvailable &&
				agentProfileIds.length > 0
			) {
				await refreshWebAgentReadinessAfterCoreFactsChanged({
					agentProfileIds: [],
					includeLocalRuntimeCaches: false,
					onStepFailure: (failure) =>
						warnWakeFinalOutcomeRefreshFailure({
							...failure,
							signalIds,
							spaceId: input.spaceId,
						}),
					maxAttempts: 2,
					organizationId,
					queryClient,
					storageScope: recovery.storageScope,
				});
			}
			if (controller.mode === "ready") {
				await runWakeFinalOutcomeRefreshStep({
					agentProfileIds,
					action: controller.onRefreshStatusAndMembers,
					signalIds,
					spaceId: input.spaceId,
					step: "status_members",
					maxAttempts: 2,
				});
			}
		};

		return () => {
			wakeFinalOutcomeFactsRefreshRef.current = null;
		};
	}, [
		controller,
		currentOwnerUserId,
		input.spaceId,
		membersSnapshot,
		organizationId,
		queryClient,
		recovery.storageScope,
		startLocalAgentRecoveryRefreshWindow,
	]);
	useLayoutEffect(() => {
		currentSpaceMemberFactsRefreshRef.current = async (refreshInput) => {
			if (controller.mode !== "ready") {
				return;
			}
			const requestedAgentProfileIds = normalizeAgentProfileIds(
				refreshInput?.agentProfileIds ?? []
			);
			if (requestedAgentProfileIds.length > 0) {
				startLocalAgentRecoveryRefreshWindow();
			}
			const profileIdsToRefresh =
				requestedAgentProfileIds.length > 0
					? requestedAgentProfileIds
					: normalizeAgentProfileIds(
							listCurrentOwnerActiveAgentProfileIds({
								currentOwnerUserId,
								snapshot: controller.membersSnapshot,
							})
						);
			if (organizationId && requestedAgentProfileIds.length > 0) {
				await refreshWebAgentReadinessFacts({
					agentProfileIds: profileIdsToRefresh,
					includeLocalRuntimeCaches: false,
					organizationId,
					queryClient,
					storageScope: recovery.storageScope,
				});
			} else if (organizationId) {
				await refreshWebAgentReadinessAfterCoreFactsChanged({
					agentProfileIds: profileIdsToRefresh,
					includeLocalRuntimeCaches: false,
					organizationId,
					queryClient,
					storageScope: recovery.storageScope,
				});
			}
			await Promise.all([
				recovery.refreshAll(),
				refreshInput?.forceNetwork
					? controller.onHardRefreshStatusAndMembers()
					: controller.onRefreshStatusAndMembers(),
			]);
		};

		return () => {
			currentSpaceMemberFactsRefreshRef.current = null;
		};
	}, [
		controller,
		currentOwnerUserId,
		organizationId,
		queryClient,
		recovery.refreshAll,
		recovery.storageScope,
		startLocalAgentRecoveryRefreshWindow,
	]);
	useEffect(() => {
		if (
			!pageVisible ||
			controller.mode !== "ready" ||
			!shouldStartPassiveLocalAgentRecoveryRefreshWindow
		) {
			return;
		}
		startLocalAgentRecoveryRefreshWindow();
	}, [
		controller.mode,
		pageVisible,
		shouldStartPassiveLocalAgentRecoveryRefreshWindow,
		startLocalAgentRecoveryRefreshWindow,
	]);
	const refreshLocalAgentRecoveryState = useEffectEvent(async () => {
		if (controller.mode !== "ready") {
			return;
		}
		const snapshot = controller.membersSnapshot;
		if (!snapshot) {
			return;
		}

		const profileIdsToRefresh = resolveAutoRefreshProfileIds({
			activeWakeWaitingTargetProfileIds,
			agentRecoveryPlansByProfileId,
			autoRefreshExhaustedProfileIds,
			attemptsByProfileId: autoRefreshAttemptsRef.current,
			currentOwnerUserId,
			recoveryRefreshWindowActive: localAgentRecoveryRefreshWindowActive,
			snapshot,
		});
		setAutoRefreshExhaustedProfileIds((current) =>
			replaceSetIfChanged(
				current,
				resolveExhaustedAutoRefreshProfileIds({
					agentRecoveryPlansByProfileId,
					attemptsByProfileId: autoRefreshAttemptsRef.current,
					currentOwnerUserId,
					snapshot,
				})
			)
		);
		if (profileIdsToRefresh.length === 0) {
			return;
		}
		for (const profileId of profileIdsToRefresh) {
			const attempts = autoRefreshAttemptsRef.current.get(profileId) ?? 0;
			autoRefreshAttemptsRef.current.set(profileId, attempts + 1);
		}

		const profileIdsNeedingRouteCatalogRefresh: string[] = [];
		const profileIdsNeedingReadOnlyRefresh: string[] = [];
		for (const profileId of profileIdsToRefresh) {
			if (routeCatalogRefreshProfileIdsRef.current.has(profileId)) {
				profileIdsNeedingReadOnlyRefresh.push(profileId);
			} else {
				routeCatalogRefreshProfileIdsRef.current.add(profileId);
				profileIdsNeedingRouteCatalogRefresh.push(profileId);
			}
		}
		if (organizationId && profileIdsNeedingRouteCatalogRefresh.length > 0) {
			await refreshWebAgentReadinessFacts({
				agentProfileIds: profileIdsNeedingRouteCatalogRefresh,
				includeLocalRuntimeCaches: false,
				organizationId,
				queryClient,
				storageScope: recovery.storageScope,
			});
		}
		if (organizationId && profileIdsNeedingReadOnlyRefresh.length > 0) {
			await refreshWebAgentReadinessAfterCoreFactsChanged({
				agentProfileIds: profileIdsNeedingReadOnlyRefresh,
				includeLocalRuntimeCaches: false,
				organizationId,
				queryClient,
				storageScope: recovery.storageScope,
			});
		}
		await controller.onRefreshStatusAndMembers();
		setAutoRefreshExhaustedProfileIds((current) =>
			replaceSetIfChanged(
				current,
				resolveExhaustedAutoRefreshProfileIds({
					agentRecoveryPlansByProfileId,
					attemptsByProfileId: autoRefreshAttemptsRef.current,
					currentOwnerUserId,
					snapshot,
				})
			)
		);
	});
	const refreshSpaceAfterLocalRuntimeReadinessChange = useEffectEvent(
		async () => {
			if (controller.mode !== "ready") {
				return;
			}
			const profileIdsToRefresh = listCurrentOwnerActiveAgentProfileIds({
				currentOwnerUserId,
				snapshot: controller.membersSnapshot,
			});
			if (organizationId) {
				await refreshWebAgentReadinessAfterCoreFactsChanged({
					agentProfileIds: profileIdsToRefresh,
					includeLocalRuntimeCaches: false,
					organizationId,
					queryClient,
					storageScope: recovery.storageScope,
				});
			}
			await controller.onRefreshStatusAndMembers();
		}
	);
	useEffect(() => {
		if (controller.mode !== "ready" || !shouldRunHighFrequencyRecoveryRefresh) {
			return;
		}

		const intervalId = window.setInterval(() => {
			refreshLocalAgentRecoveryState().catch((error) => {
				warnSpaceRefreshFailure(
					"Failed to refresh local agent recovery state.",
					error
				);
			});
		}, SPACE_WAKE_STATUS_REFRESH_INTERVAL_MS);

		return () => window.clearInterval(intervalId);
	}, [controller.mode, shouldRunHighFrequencyRecoveryRefresh]);
	useEffect(() => {
		if (controller.mode !== "ready" || !shouldRunHighFrequencyRecoveryRefresh) {
			return;
		}
		refreshLocalAgentRecoveryState().catch((error) => {
			warnSpaceRefreshFailure(
				"Failed to refresh local agent recovery state.",
				error
			);
		});
	}, [controller.mode, shouldRunHighFrequencyRecoveryRefresh]);
	useEffect(() => {
		if (
			controller.mode !== "ready" ||
			!pageVisible ||
			shouldRunHighFrequencyRecoveryRefresh
		) {
			return;
		}

		const intervalId = window.setInterval(() => {
			refreshCurrentSpaceMemberFacts().catch((error) => {
				warnSpaceRefreshFailure(
					"Failed to refresh Space member readiness.",
					error
				);
			});
		}, SPACE_WAKE_STATUS_FRESHNESS_REFRESH_INTERVAL_MS);

		return () => window.clearInterval(intervalId);
	}, [
		controller.mode,
		pageVisible,
		refreshCurrentSpaceMemberFacts,
		shouldRunHighFrequencyRecoveryRefresh,
	]);
	useEffect(() => {
		const readiness = recovery.currentLocalRuntimeReplyReadinessQuery.data;
		const currentState =
			readiness === undefined
				? null
				: resolveLocalRuntimeReadinessEventState(readiness);
		const previousState = localRuntimeReadinessEventStateRef.current;
		localRuntimeReadinessEventStateRef.current = currentState;
		if (!(previousState && currentState)) {
			return;
		}
		if (
			(previousState.canReplyFromThisComputer === false &&
				currentState.canReplyFromThisComputer) ||
			(previousState.serviceConnected === false &&
				currentState.serviceConnected)
		) {
			refreshSpaceAfterLocalRuntimeReadinessChange().catch((error) => {
				warnSpaceRefreshFailure(
					"Failed to refresh Space after OpenMeld Service readiness changed.",
					error
				);
			});
		}
	}, [recovery.currentLocalRuntimeReplyReadinessQuery.data]);
	useEffect(() => {
		const onStorage = (event: StorageEvent) => {
			if (
				event.key !== COMPLETED_PREPARE_SESSION_POINTER_STORAGE_KEY ||
				event.newValue === event.oldValue
			) {
				return;
			}
			startLocalAgentRecoveryRefreshWindow();
		};

		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [startLocalAgentRecoveryRefreshWindow]);
	useEffect(() => {
		const wasVisible = previousPageVisibleRef.current;
		previousPageVisibleRef.current = pageVisible;
		if (
			controller.mode !== "ready" ||
			wasVisible ||
			!pageVisible ||
			shouldRunHighFrequencyRecoveryRefresh
		) {
			return;
		}
		refreshCurrentSpaceMemberFacts().catch((error) => {
			warnSpaceRefreshFailure(
				"Failed to refresh Space after the page became visible.",
				error
			);
		});
	}, [
		controller.mode,
		pageVisible,
		refreshCurrentSpaceMemberFacts,
		shouldRunHighFrequencyRecoveryRefresh,
	]);
	useEffect(() => {
		if (
			controller.mode !== "ready" ||
			!isDesktopMembersPanel ||
			!shouldOpenMembersPanelOnEntry
		) {
			return;
		}
		if (setupPromptedSpaceIdRef.current === input.spaceId) {
			return;
		}
		if (readSpaceMembersPanelOpen({ spaceId: input.spaceId }) === false) {
			return;
		}

		setupPromptedSpaceIdRef.current = input.spaceId;
		setMembersOpen(true);
	}, [
		controller.mode,
		input.spaceId,
		isDesktopMembersPanel,
		setMembersOpen,
		shouldOpenMembersPanelOnEntry,
	]);
	const handleAgentRecoveryAction = useCallback(
		async (plan: SpaceAgentProfileBindingRecoveryPlan) => {
			if (controller.mode !== "ready") {
				return;
			}

			const connectedRuntimeTarget = resolveConnectedRuntimeTarget(recovery);
			await controller.onUpdateAgentProfileBinding({
				controllerEnabled: true,
				agentControllerRef: plan.agentControllerRef,
				// Bind the agent to the connected runtime. connectedRuntimeTarget is
				// liveness-first (Binding target when present, else the live
				// ServiceRuntime session), so recovery works for a connected computer
				// regardless of the Binding-derived current-device pointer.
				deviceId: connectedRuntimeTarget?.deviceId ?? null,
				profileId: plan.profileId,
				profileName: plan.profileName,
				runtimeLane:
					connectedRuntimeTarget?.runtimeLane ?? recovery.runtimeLane,
			});
			startLocalAgentRecoveryRefreshWindow();
			if (organizationId) {
				await refreshWebAgentReadinessFacts({
					agentProfileIds: [plan.profileId],
					organizationId,
					queryClient,
					storageScope: recovery.storageScope,
				});
			}
			await Promise.all([
				recovery.refreshAll(),
				controller.onRefreshStatusAndMembers(),
			]);
		},
		[
			controller,
			organizationId,
			queryClient,
			recovery,
			startLocalAgentRecoveryRefreshWindow,
		]
	);
	const handleMembersOpenChange = useCallback(
		(open: boolean) => {
			setMembersOpen(open);
			writeSpaceMembersPanelOpen({
				open,
				spaceId: input.spaceId,
			});
		},
		[input.spaceId, setMembersOpen]
	);
	// Setup recall and direct requests to open the shared member picker.
	const {
		addMembersRequestNonce,
		handleAddAgentsFromBanner,
		handleSetupVisibilityChange,
		setupRecallAction,
		setupRecallNonce,
	} = useSpaceSetupRecallWiring({
		activeView: spaceView,
		onViewChange: changeSpaceView,
	});
	const handleAddProfiles = useSpaceAddProfilesHandler({
		accountProfiles,
		controller,
		organizationId,
		organizationSlug: input.orgSlug,
		queryClient,
		storageScope: recovery.storageScope,
	});
	const handleAddOrganizationDirectoryProfiles =
		useSpaceAddOrganizationDirectoryProfilesHandler({
			controller,
			organizationId,
			organizationSlug: input.orgSlug,
			queryClient,
			storageScope: recovery.storageScope,
		});
	const handleConvertDirectMessageToSpace =
		useConvertDirectMessageToSpaceHandler({
			accountProfiles,
			controller,
			navigate,
			orgSlug: input.orgSlug,
			queryClient,
		});
	const handleRemoveMember = useSpaceRemoveMemberHandler({
		accountProfiles,
		controller,
		organizationId,
		organizationSlug: input.orgSlug,
		queryClient,
	});
	const isDirectMessage =
		controller.mode === "ready" &&
		isDirectMessageSpace({
			directMessageConvertedAt: controller.status.directMessageConvertedAt,
			purpose: controller.status.spacePurpose,
		});
	const spaceMemberRemovalHandler = resolveSpaceMemberRemovalHandler({
		canRemoveMembers: canCurrentProfileRemoveSpaceMembers,
		isDirectMessage,
		onRemoveMember: handleRemoveMember,
	});
	return {
		accountProfiles,
		activeWakeDisplayTargetProfileIds,
		activeWakeFolderWaitTargetProfileIds,
		activeWakeWaitingTargetProfileIds,
		addMembersRequestNonce,
		agentRecoveryPlansByProfileId,
		autoRefreshExhaustedProfileIds,
		centerAgentState,
		controller,
		currentOwnerUserId,
		currentSpaceIsCenterAgentDirectMessage,
		currentSpaceWasDeleted,
		currentUserAvatarImageUrl,
		handleAddAgentsFromBanner,
		handleAddOrganizationDirectoryProfiles,
		handleAddProfiles,
		handleConvertDirectMessageToSpace,
		handleAgentRecoveryAction,
		handleMembersOpenChange,
		handleSetupVisibilityChange,
		isCheckingForDeletion,
		isDirectMessage,
		isDesktopMembersPanel,
		membersFocus,
		membersOpen,
		membersPanelWidth,
		modelCatalog,
		openSpaceFile,
		navigate,
		organizationId,
		recovery,
		refreshCurrentSpaceMemberFacts,
		setupRecallAction,
		setupRecallNonce,
		spaceMemberRemovalHandler,
		spaceName,
		spaceFileToOpen,
		spaceFileNavigation,
		spaceInboxReadPosition,
		spaceReferencesById,
		selectedTaskId,
		setSelectedTaskId,
		spaceView,
		spaceViewIdPrefix,
		wakeDisplayOverrideByProfileId,
		wakeFailureTargetContextsByProfileId,
	};
}

type SpaceLandingState = ReturnType<typeof useSpaceLandingState>;
type SpaceConversationController = Extract<
	SpaceLandingState["controller"],
	{ mode: "ready" | "loading" }
>;

export function SpaceLanding(input: SpaceLandingInput) {
	const target = useSpaceThreadTarget({
		spaceId: input.spaceId,
		profileId: input.profileId,
		focusSignalId: input.initialFocusSignalId,
		focusThreadRootSignalId: input.initialFocusThreadRootSignalId,
	});
	return (
		<div
			className="flex h-full min-h-0 w-full flex-col"
			data-walkthrough="conversation"
		>
			<SpaceLandingContent
				{...input}
				initialFocusThreadRootSignalId={
					input.initialFocusThreadRootSignalId ?? target?.rootSignalId
				}
			/>
		</div>
	);
}

function SpaceLandingContent(input: SpaceLandingInput) {
	useSpaceConversationReadCache({
		spaceId: input.spaceId,
		openMeldProfileId: input.profileId,
	});
	const state = useSpaceLandingState(input);
	const { controller } = state;
	const tutorialProgress = useWalkthroughSpaceProgress(
		input.spaceId,
		controller
	);
	useSpaceOpenPaint(input.spaceId, spaceOpenFailureMilestone(controller.mode));
	if (controller.mode === "loading" && input.loadingFallback) {
		return typeof input.loadingFallback === "function"
			? input.loadingFallback(controller)
			: input.loadingFallback;
	}

	if (controller.mode === "password") {
		return (
			<SpacePasswordRecoverySurface
				inlineErrorMessage={controller.inlineErrorMessage}
				isSubmitting={controller.isSubmitting}
				onPasswordChange={controller.onPasswordChange}
				onRefresh={controller.onRefresh}
				onSubmit={controller.onSubmit}
				password={controller.password}
				spaceId={controller.spaceId}
			/>
		);
	}

	if (controller.mode === "failure") {
		return (
			<SpaceLoadFailure
				currentSpaceWasDeleted={state.currentSpaceWasDeleted}
				error={controller.error}
				isCheckingForDeletion={state.isCheckingForDeletion}
				onRetry={controller.onRetry}
				spaceId={controller.spaceId}
			/>
		);
	}

	return (
		<>
			<SpaceLandingConversationShell
				controller={controller}
				input={input}
				state={state}
				threadPanelVisible={
					state.spaceView === "messages" && controller.threadPanelOpen
				}
			/>
			<WalkthroughGuide
				onAddAgents={state.handleAddAgentsFromBanner}
				onConnectAgent={() => state.handleMembersOpenChange(true)}
				spaceProgress={tutorialProgress}
			/>
		</>
	);
}

function useThreadRootMainFocus(input: SpaceLandingInput) {
	// Reuse main-message focus without changing the route-owned Thread selection.
	// A later route navigation must supersede this local presentation request.
	const focusScope = JSON.stringify([
		input.spaceId,
		input.profileId,
		input.initialFocusInteractionId,
		input.initialFocusSignalId,
		input.initialFocusThreadRootSignalId,
		input.initialFocusRequestId,
	]);
	const [mainMessageFocus, setMainMessageFocus] = useState<{
		scope: string;
		signalId: string;
		requestId: string;
	} | null>(null);
	if (mainMessageFocus && mainMessageFocus.scope !== focusScope) {
		setMainMessageFocus(null);
	}
	const conversationInput =
		mainMessageFocus?.scope === focusScope
			? {
					...input,
					initialFocusInteractionId: undefined,
					initialFocusSignalId: mainMessageFocus.signalId,
					initialFocusThreadRootSignalId: undefined,
					initialFocusRequestId: mainMessageFocus.requestId,
				}
			: input;
	return {
		conversationInput,
		onShowMessageInMain: (signalId: string) => {
			setMainMessageFocus({
				scope: focusScope,
				signalId,
				requestId: crypto.randomUUID(),
			});
		},
	};
}

function pendingActionThreadHandlers(
	isCompact: boolean,
	select: (identity: string) => void,
	open: (threadId: string) => void
) {
	if (isCompact) {
		return {};
	}
	const show = (threadId: string | null | undefined, identity: string) => {
		if (threadId) {
			select(identity);
			open(threadId);
		}
	};
	return {
		onOpenRequestThread: (item: WakeProgressItem) =>
			show(
				item.sourceContext?.threadId,
				resolveSpacePendingAgentActionIdentity(item)
			),
		onOpenPluginRequestThread: (
			request: import("@openmeld/schemas/types").PluginActionRequestView
		) => show(request.sourceThreadId, `plugin:${request.requestId}`),
	};
}

function SpaceLandingConversationShell({
	controller,
	input,
	state,
	threadPanelVisible,
}: {
	controller: SpaceConversationController;
	input: SpaceLandingInput;
	state: SpaceLandingState;
	threadPanelVisible: boolean;
}) {
	const { conversationInput, onShowMessageInMain } =
		useThreadRootMainFocus(input);
	const {
		accountProfiles,
		currentSpaceIsCenterAgentDirectMessage,
		currentOwnerUserId,
		handleAddAgentsFromBanner,
		handleAddOrganizationDirectoryProfiles,
		handleAddProfiles,
		handleConvertDirectMessageToSpace,
		handleMembersOpenChange,
		isDirectMessage,
		isDesktopMembersPanel,
		membersOpen,
		membersPanelWidth,
		modelCatalog,
		navigate,
		organizationId,
		setupRecallAction,
		spaceFileNavigation,
		spaceView,
		spaceViewIdPrefix,
	} = state;
	const {
		agentOwnerDirectMessageJoin,
		agentOwnerDirectMessageObserver,
		agentOwnerVisibilityLabel,
		currentHumanViewer,
		currentProfileIsActiveSpaceMember,
		currentProfileName,
		directMessageAccessRequest,
		directMessageJoinPrompt,
		viewerMembership,
	} = useSpaceLandingViewerState({ controller, state });
	const guideDraft = useSpaceGuideDraft(controller.spaceId);
	const guideSaver = useSpaceGuideSaver({
		onSaved: guideDraft.onSaved,
		openMeldProfileId: controller.profileId,
		spaceId: controller.spaceId,
	});
	const memberAgentDirectMessage = useCurrentMemberAgentDirectMessage({
		isActiveSpaceMember: currentProfileIsActiveSpaceMember,
		isCenterAgentDirectMessage: currentSpaceIsCenterAgentDirectMessage,
		isDirectMessage,
		snapshot: controller.membersSnapshot,
	});
	const currentSpaceControls = resolveCurrentSpaceControls({
		isDeleted: Boolean(controller.status?.deletedAt),
		isGuest: input.isGuest,
		isActiveSpaceMember: currentProfileIsActiveSpaceMember,
		isCurrentAccessConfirmed: controller.isCurrentAccessConfirmed,
		currentSpaceIsDirectMessage: isDirectMessage,
		currentSpaceIsCenterAgentDirectMessage,
		handleAddAgentsFromBanner,
		handleAddOrganizationDirectoryProfiles,
		handleAddProfiles,
		handleConvertDirectMessageToSpace,
		showDeleteSpaceAction: controller.showDeleteSpaceAction,
	});
	const historyErrorMessage = resolveSpaceHistoryErrorMessage(controller);
	// A MemberAgent session's saved title holds the header until its Session
	// controls load, so the name does not change on the way.
	const savedConversationTitle = useSavedConversationTitle({
		known: null,
		profileId: controller.profileId,
		spaceId: controller.spaceId,
	});
	const conversationTitle = input.conversationTitle ?? savedConversationTitle;
	const membersControl = (
		<SpaceLandingMembersControl
			isDesktopMembersPanel={isDesktopMembersPanel}
			memberCount={
				controller.isCurrentAccessConfirmed
					? controller.status?.members.totalCount
					: null
			}
			onOpenChange={handleMembersOpenChange}
			open={membersOpen}
			profileId={controller.profileId}
			spaceId={controller.spaceId}
		/>
	);
	// The Join button shows as soon as the viewer is known not to be a member,
	// from a confirmed read or cached data; the server decides the join.
	const humanJoinControl = controller.status?.deletedAt
		? null
		: resolveSpaceHumanJoinControl({
				humanProfile: currentHumanViewer.humanProfile,
				isCenterAgentDirectMessage: currentSpaceIsCenterAgentDirectMessage,
				isDirectMessage,
				membership: viewerMembership,
				onJoin: async (profileId) => {
					await handleAddProfiles([profileId]);
				},
			});
	const managementControl = (
		<SpaceLandingManagementControl
			agentOwnerDirectMessageJoin={agentOwnerDirectMessageJoin}
			humanJoinControl={
				state.spaceView === "messages" ? null : humanJoinControl
			}
			managementControl={currentSpaceControls.managementControl}
		/>
	);
	const currentProfileLeaveAction = resolveCurrentProfileLeaveAction({
		isAccessConfirmed: controller.isCurrentAccessConfirmed,
		isActiveSpaceMember: currentProfileIsActiveSpaceMember,
		onLeaveSpace: controller.onLeaveSpace,
	});
	const automaticWakeConversationKind = resolveAutomaticWakeConversationKind(
		controller.status
	);
	// In-Space identity switcher (built by a module helper to keep this
	// component's complexity flat): renders only when the account has more than
	// one human profile. Switching re-opens the same Space with a different
	// ?profileId; the route's entry effect remembers the choice on the remount.
	const composerProfileControl = buildSpaceProfileControl({
		currentProfileId: controller.profileId,
		currentProfileName,
		humanProfiles: listActiveProfilesByKind(accountProfiles, "human"),
		navigate,
		orgSlug: input.orgSlug,
		spaceId: input.spaceId,
	});
	// The shared "Connect this computer" recovery link for this Space. It carries
	// only returnTo=space + spaceId (the viewer is resolved on arrival from the
	// Space's last-used human profile) and forces a fresh setup session.
	// Consumed by the prepare_agent_profile recovery action and the Wake-failure
	// "prepare_setup" link. review_computer uses the Get-set-up banner instead.
	const prepareSetupHref = input.orgSlug
		? buildConnectComputerPath({
				orgSlug: input.orgSlug,
				returnTo: "space",
				session: "fresh",
				spaceId: controller.spaceId,
			})
		: undefined;
	const isCompactPresentation = input.presentation === "compact";
	const { agentProfileEditContext, pendingAgentActions } =
		useSpaceLandingPendingAgentActions({
			controller,
			state,
		});
	const [requestedInteraction, setRequestedInteraction] = useState<
		string | undefined
	>();
	const activeActionThreadId =
		input.presentation !== "compact" && controller.isCurrentAccessConfirmed
			? (controller.activeThread?.threadId ?? null)
			: null;
	const pendingActionsByPanel = partitionSpacePendingAgentActions(
		pendingAgentActions.surfaceProps.items,
		activeActionThreadId
	);
	const pendingPluginActions = usePendingSpacePluginActionRequests(
		controller.spaceId,
		activeActionThreadId
	);
	const permissionModeSuggestions = usePendingPermissionModeSuggestions(
		controller.spaceId
	);
	const pendingActionSurface = (
		<SpacePendingAgentActions
			{...pendingAgentActions.surfaceProps}
			onResolvePermissionModeSuggestion={permissionModeSuggestions.resolve}
			permissionModeSuggestions={permissionModeSuggestions.suggestions}
			{...pendingActionThreadHandlers(
				isCompactPresentation,
				setRequestedInteraction,
				controller.onOpenThread
			)}
			items={pendingActionsByPanel.conversation}
			onReloadRequests={
				pendingPluginActions.isError
					? () => pendingPluginActions.refetch()
					: undefined
			}
			pluginRequests={pendingPluginActions.conversation}
			returnFocusRef={controller.textareaRef}
		/>
	);
	const threadPendingActionSurface = (
		<SpacePendingAgentActions
			{...pendingAgentActions.surfaceProps}
			initialInteractionIdentity={requestedInteraction}
			items={pendingActionsByPanel.thread}
			key={`${activeActionThreadId}:${requestedInteraction ?? ""}`}
			pluginRequests={pendingPluginActions.thread}
			returnFocusRef={controller.threadTextareaRef}
		/>
	);

	const content = (
		<SpaceAgentProfileEditProvider
			accountProfiles={accountProfiles}
			context={agentProfileEditContext ?? null}
			currentOwnerUserId={currentOwnerUserId}
			modelCatalog={modelCatalog}
			organizationId={organizationId}
			orgSlug={input.orgSlug}
		>
			<SpaceWorkBookmarksProvider
				activeThreadId={activeActionThreadId}
				hasMore={controller.ownActiveWakesHaveMore}
				items={controller.presentedWakeProgressItems}
				key={`${controller.spaceId}:${controller.profileId}`}
				onOpenThread={controller.onOpenThread}
				onShowConversation={() =>
					spaceFileNavigation.changeSpaceView("messages")
				}
				profileId={controller.profileId}
				queuedItems={controller.queuedInputItems}
				threadHasAttachments={controller.threadComposerFiles.length > 0}
			>
				<SpaceFileNavigationGuards navigation={spaceFileNavigation} />
				<UnsavedChangesGuard
					allowSamePageNavigation
					description="Your changes to this Space's guide haven't been saved."
					hasUnsavedChanges={guideDraft.hasUnsavedChanges}
					onDiscard={guideDraft.discard}
					onSave={() =>
						saveSpaceGuideBeforeLeaving(guideDraft.draft, guideSaver)
					}
					saving={guideSaver.isPending}
				/>
				<AppMainContent
					bodyClassName="flex"
					bodySlotName={resolveSpaceLandingBodySlotName(input.presentation)}
					header={
						<SpaceLandingHeader
							accessModeErrorMessage={controller.accessModeErrorMessage}
							canManageSpaceAccess={currentSpaceControls.canManageSpaceAccess}
							canManageSpaceName={currentSpaceControls.canManageSpaceName}
							chatSessionAgentProfileId={resolveDirectMessageSessionAgentProfileId(
								{
									isDirectMessage,
									isCenterAgentDirectMessage:
										currentSpaceIsCenterAgentDirectMessage,
									viewerProfileId: controller.profileId,
									snapshot: controller.membersSnapshot,
								}
							)}
							conversationTitle={conversationTitle}
							conversationTitleAction={input.conversationTitleAction}
							conversationTitleControl={resolveConversationTitleControl({
								centerAgent:
									currentSpaceIsCenterAgentDirectMessage && input.orgSlug
										? { titleAction: input.conversationTitleAction }
										: null,
								memberAgent: memberAgentDirectMessage,
								profileId: controller.profileId,
								spaceId: controller.spaceId,
							})}
							currentProfileId={input.profileId}
							currentProfileName={currentProfileName}
							deleteSpaceErrorMessage={controller.deleteSpaceErrorMessage}
							directMessageOwnerVisibilityLabel={agentOwnerVisibilityLabel}
							hideShareControl={currentSpaceControls.hideShareControl}
							isAccessModePending={controller.isAccessModePending}
							isCenterAgentDirectMessage={
								currentSpaceIsCenterAgentDirectMessage
							}
							isDeleteSpacePending={controller.isDeleteSpacePending}
							isLeaveSpacePending={controller.isLeaveSpacePending}
							isSpaceNamePending={controller.isSpaceNamePending}
							leaveSpaceErrorMessage={controller.leaveSpaceErrorMessage}
							managementControl={
								<>
									{input.conversationControl}
									{managementControl}
								</>
							}
							membersControl={input.isGuest ? undefined : membersControl}
							notificationControl={
								<SpaceNotificationMenu
									isGuest={input.isGuest}
									spaceId={controller.spaceId}
								/>
							}
							onDeleteSpace={controller.onDeleteSpace}
							onLeaveSpace={currentProfileLeaveAction}
							onRecallPinnedItems={() =>
								spaceFileNavigation.changeSpaceView("messages")
							}
							onSetAccessMode={controller.onSetAccessMode}
							onUpdateSpaceName={controller.onUpdateSpaceName}
							renderFrame={false}
							setupRecallAction={setupRecallAction}
							showChatSettingsMenu={currentSpaceIsCenterAgentDirectMessage}
							showDeleteSpaceAction={
								controller.isCurrentAccessConfirmed &&
								controller.showDeleteSpaceAction
							}
							spaceNameErrorMessage={controller.spaceNameErrorMessage}
							status={controller.status}
							viewControl={
								currentSpaceIsCenterAgentDirectMessage && input.orgSlug ? (
									<CenterAgentHeaderTabs
										activeSectionId="chat"
										activeSpaceView={spaceView}
										className="h-full shrink-0 gap-5"
										idPrefix={spaceViewIdPrefix}
										onSpaceViewChange={spaceFileNavigation.changeSpaceView}
										organizationSlug={input.orgSlug}
									/>
								) : (
									<SpaceViewTabs
										activeView={spaceView}
										className="shrink-0"
										guideEnabled
										idPrefix={spaceViewIdPrefix}
										onViewChange={spaceFileNavigation.changeSpaceView}
										tasksEnabled
									/>
								)
							}
						/>
					}
					showHeader={input.presentation !== "compact"}
				>
					<div
						className="relative flex min-h-0 flex-1 overflow-hidden"
						data-space-conversation-presentation={input.presentation}
						data-space-inline-panels=""
						data-space-members-panel-open={
							isDesktopMembersPanel &&
							membersOpen &&
							!currentSpaceIsCenterAgentDirectMessage
						}
						data-space-thread-panel-open={threadPanelVisible}
						style={
							{
								"--space-members-panel-width": membersPanelWidth.width,
							} as CSSProperties
						}
					>
						<SpaceLandingErrorBoundary>
							<SpaceLandingConversation
								agentOwnerDirectMessageObserver={
									agentOwnerDirectMessageObserver
								}
								automaticWakeConversationKind={automaticWakeConversationKind}
								composerPrimaryAction={
									resolveAgentOwnerDirectMessageComposerPrimaryAction(
										agentOwnerDirectMessageJoin
									) ?? humanJoinControl
								}
								composerProfileControl={composerProfileControl}
								controller={controller}
								currentProfileName={currentProfileName}
								currentSpaceControls={currentSpaceControls}
								directMessageAccessRequest={directMessageAccessRequest}
								directMessageJoinPrompt={directMessageJoinPrompt}
								guideDraft={guideDraft}
								guideSaver={guideSaver}
								historyErrorMessage={historyErrorMessage}
								input={conversationInput}
								pendingActionSurface={pendingActionSurface}
								prepareSetupHref={prepareSetupHref}
								state={state}
								viewerMembership={viewerMembership}
							/>
						</SpaceLandingErrorBoundary>
						{input.presentation === "compact" ? null : (
							<SpaceLandingSecondaryPanels
								agentProfileEditContext={agentProfileEditContext}
								automaticWakeConversationKind={automaticWakeConversationKind}
								composerProfileControl={composerProfileControl}
								controller={controller}
								currentProfileIsActiveSpaceMember={
									currentProfileIsActiveSpaceMember
								}
								currentSpaceControls={currentSpaceControls}
								input={input}
								onShowMessageInMain={onShowMessageInMain}
								organizationId={organizationId}
								pendingActionSurface={threadPendingActionSurface}
								prepareSetupHref={prepareSetupHref}
								state={state}
								threadPanelVisible={threadPanelVisible}
							/>
						)}
					</div>
				</AppMainContent>
				<AgentOwnerDirectMessageJoinDialog
					control={agentOwnerDirectMessageJoin}
				/>
				{pendingAgentActions.profileEditDialog}
			</SpaceWorkBookmarksProvider>
		</SpaceAgentProfileEditProvider>
	);
	return (
		<SpacePinsProvider
			canPin={currentProfileIsActiveSpaceMember}
			organizationSlug={input.orgSlug}
			profileId={controller.profileId}
			spaceId={controller.spaceId}
		>
			<SpaceReadingHeaderProvider
				isDirectMessage={isDirectMessage}
				key={`${controller.spaceId}:${controller.profileId}`}
				organizationSlug={input.orgSlug}
				profileId={controller.profileId}
				spaceId={controller.spaceId}
				view={spaceView}
			>
				<MessageActionTooltipProvider>
					<SpaceAgentRecoveryProvider
						isAgentRecoveryPending={controller.isAgentRecoveryPending}
						onAgentRecoveryAction={state.handleAgentRecoveryAction}
						orgSlug={input.orgSlug}
						plansByProfileId={state.agentRecoveryPlansByProfileId}
						prepareSetupHref={prepareSetupHref}
					>
						{content}
					</SpaceAgentRecoveryProvider>
				</MessageActionTooltipProvider>
			</SpaceReadingHeaderProvider>
		</SpacePinsProvider>
	);
}

function useCurrentMemberAgentDirectMessage(input: {
	isActiveSpaceMember: boolean;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
}): DirectMessageMemberAgent | null {
	const memberAgents = useMemberAgentIndex();
	// Only the Human in the Session gets its Session controls; an Agent owner
	// observing a colleague's chat never does.
	if (!(memberAgents.ready && input.isActiveSpaceMember)) {
		return null;
	}
	return resolveDirectMessageMemberAgent({
		index: memberAgents.index,
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		isDirectMessage: input.isDirectMessage,
		snapshot: input.snapshot,
	});
}

function resolveConversationTitleControl(input: {
	centerAgent: {
		titleAction?: (title: string) => ReactNode;
	} | null;
	memberAgent: DirectMessageMemberAgent | null;
	profileId: string;
	spaceId: string;
}): ((title: string) => ReactNode) | undefined {
	const centerAgent = input.centerAgent;
	if (centerAgent) {
		return (title) => (
			<CenterAgentChatHistory
				spaceId={input.spaceId}
				title={title}
				titleAction={centerAgent.titleAction?.(title)}
			/>
		);
	}
	const memberAgent = input.memberAgent;
	if (memberAgent) {
		return (title) => (
			<MemberAgentChatHistory
				current={memberAgent}
				profileId={input.profileId}
				spaceId={input.spaceId}
				title={title}
			/>
		);
	}
	return;
}

function useSpaceLandingViewerState({
	controller,
	state,
}: {
	controller: SpaceConversationController;
	state: SpaceLandingState;
}) {
	const currentHumanViewer = resolveCurrentSpaceHumanViewer({
		accountProfiles: state.accountProfiles,
		currentProfileId: controller.profileId,
		membersSnapshot: controller.membersSnapshot,
	});
	const currentProfileIsActiveSpaceMember =
		controller.currentProfileMembershipState === "member";
	const viewerMembership = useSpaceViewerMembership({
		confirmed: controller.currentProfileMembershipState,
		organizationId: state.organizationId,
		ownerAccountId: state.recovery.storageScope,
		profileId: controller.profileId,
		spaceId: controller.spaceId,
	});
	const agentOwnerDirectMessageObserver =
		resolveAgentOwnerDirectMessageObserver({
			currentOwnerUserId: state.currentOwnerUserId,
			humanProfile: currentHumanViewer.humanProfile,
			isActiveSpaceMember: currentProfileIsActiveSpaceMember,
			isCenterAgentDirectMessage: state.currentSpaceIsCenterAgentDirectMessage,
			isDirectMessage: state.isDirectMessage,
			snapshot: controller.membersSnapshot,
		});
	const directMessageJoinPresentation =
		resolveAgentOwnerDirectMessageJoinPresentation({
			currentSpaceName: controller.status?.name,
			humanProfile: currentHumanViewer.humanProfile,
			observer: agentOwnerDirectMessageObserver,
			// A live members read decides; the saved prompt only fills the gap
			// before it returns.
			saved: controller.membersSnapshot
				? undefined
				: viewerMembership.savedDirectMessageJoin,
		});
	useSaveDirectMessageJoin({
		join:
			agentOwnerDirectMessageObserver && directMessageJoinPresentation
				? {
						defaultName: directMessageJoinPresentation.defaultName,
						prompt: directMessageJoinPresentation.prompt,
						selectedNames: directMessageJoinPresentation.selectedNames,
					}
				: null,
		profileId: controller.profileId,
		spaceId: controller.spaceId,
	});
	const agentOwnerDirectMessageJoin = useAgentOwnerDirectMessageJoin({
		onJoin: state.handleConvertDirectMessageToSpace,
		presentation: directMessageJoinPresentation,
	});
	const directMessageAccessRequest = useDirectMessageAccessRequest({
		isCenterAgentDirectMessage: state.currentSpaceIsCenterAgentDirectMessage,
		isDirectMessage: state.isDirectMessage,
		snapshot: controller.membersSnapshot,
		spaceId: controller.spaceId,
	});
	return {
		agentOwnerDirectMessageJoin,
		directMessageAccessRequest,
		directMessageJoinPrompt: directMessageJoinPresentation?.prompt ?? null,
		viewerMembership: viewerMembership.membership,
		agentOwnerDirectMessageObserver,
		agentOwnerVisibilityLabel:
			(directMessageAccessRequest &&
				directMessageAccessBadge(directMessageAccessRequest.access.state)) ??
			resolveAgentOwnerVisibilityLabel({
				currentOwnerUserId: state.currentOwnerUserId,
				isObserver: Boolean(agentOwnerDirectMessageObserver),
				isCenterAgentDirectMessage:
					state.currentSpaceIsCenterAgentDirectMessage,
				isDirectMessage: state.isDirectMessage,
				snapshot: controller.membersSnapshot,
			}),
		currentHumanViewer,
		currentProfileIsActiveSpaceMember,
		currentProfileName: currentHumanViewer.profileName,
	};
}

function useSpaceLandingPendingAgentActions({
	controller,
	state,
}: {
	controller: SpaceConversationController;
	state: SpaceLandingState;
}) {
	const agentProfileEditContext = resolveAgentProfileEditDialogContext({
		onSaved: async (profileId) => {
			await Promise.all([
				state.refreshCurrentSpaceMemberFacts({
					agentProfileIds: [profileId],
					forceNetwork: true,
				}),
				state.recovery.refreshAll(),
			]);
		},
		organizationId: state.organizationId,
		recovery: state.recovery,
	});
	const pendingAgentActions = useSpacePendingAgentActions({
		accountProfiles: state.accountProfiles,
		agentProfileEditContext,
		currentOwnerUserId: state.currentOwnerUserId,
		membersSnapshot: controller.membersSnapshot,
		modelCatalog: state.modelCatalog,
		onRespond: controller.onAgentInteractionResponse,
		presentedItems: controller.presentedWakeProgressItems,
		threadItems: controller.threadEphemeralActivityItems,
	});
	return {
		agentProfileEditContext,
		pendingAgentActions,
	};
}

function resolveSpaceHistoryErrorMessage(
	controller: SpaceConversationController
): string | null {
	if (!(controller.historyError && controller.timelineItems.length === 0)) {
		return null;
	}
	const requestId = controller.historyError.requestId
		? ` Request ID: ${controller.historyError.requestId}`
		: "";
	return `Couldn't load recent history. ${controller.historyError.message}${requestId}`;
}

function SpaceLandingMembersControl(input: {
	spaceId: string;
	profileId: string;
	isDesktopMembersPanel: boolean;
	memberCount: number | null | undefined;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const displayQuery = useQuery(
		spaceMemberDirectoryDisplayQueryOptions(input.spaceId, input.profileId)
	);
	return (
		<SpaceMembersToggleButton
			controlsId={
				input.isDesktopMembersPanel
					? "space-members-panel"
					: "space-members-drawer"
			}
			memberCount={
				input.memberCount ?? displayQuery.data?.members.length ?? null
			}
			onOpenChange={input.onOpenChange}
			open={input.open}
		/>
	);
}

function SpaceLandingManagementControl(input: {
	agentOwnerDirectMessageJoin: ReturnType<
		typeof useAgentOwnerDirectMessageJoin
	>;
	humanJoinControl: ReactNode;
	managementControl: ReactNode;
}) {
	return (
		<>
			{input.managementControl}
			{input.agentOwnerDirectMessageJoin ? (
				<AgentOwnerDirectMessageJoinHeaderControl
					control={input.agentOwnerDirectMessageJoin}
				/>
			) : (
				input.humanJoinControl
			)}
		</>
	);
}

function SpaceFileNavigationGuards(input: {
	navigation: ReturnType<typeof useSpaceFileNavigation>;
}) {
	return (
		<>
			<UnsavedChangesGuard
				description="Your changes to this Space file haven't been saved."
				hasUnsavedChanges={input.navigation.hasUnsavedFileChanges}
				onSave={input.navigation.saveCurrentFile}
			/>
			<UnsavedChangesDialog
				description="Your changes to this Space file haven't been saved."
				onCancel={input.navigation.cancelPendingNavigation}
				onDiscard={input.navigation.discardAndContinue}
				onSaveAndLeave={input.navigation.saveAndContinue}
				open={input.navigation.pendingNavigation !== null}
			/>
		</>
	);
}

function SpaceLandingHeader({
	status,
	...props
}: Omit<ComponentProps<typeof SpaceHeader>, "status"> & {
	status: SpaceConversationController["status"];
}) {
	if (!status) {
		return (
			<SpaceWindowHeader
				navigation={<span className="text-sm">Messages</span>}
				renderFrame={false}
				title={props.conversationTitle ?? ""}
			/>
		);
	}
	return <SpaceHeader {...props} status={status} />;
}

function SpaceLandingConversation({
	automaticWakeConversationKind,
	agentOwnerDirectMessageObserver,
	composerPrimaryAction,
	composerProfileControl,
	controller,
	currentProfileName,
	currentSpaceControls,
	directMessageAccessRequest,
	directMessageJoinPrompt,
	guideDraft,
	guideSaver,
	historyErrorMessage,
	input,
	pendingActionSurface,
	prepareSetupHref,
	state,
	viewerMembership,
}: {
	automaticWakeConversationKind: ReturnType<
		typeof resolveAutomaticWakeConversationKind
	>;
	agentOwnerDirectMessageObserver: ReturnType<
		typeof resolveAgentOwnerDirectMessageObserver
	>;
	composerPrimaryAction?: ReactNode;
	composerProfileControl: ReactNode;
	controller: SpaceConversationController;
	currentProfileName: string | null;
	currentSpaceControls: ReturnType<typeof resolveCurrentSpaceControls>;
	directMessageAccessRequest: DirectMessageAccessRequest | null;
	directMessageJoinPrompt: string | null;
	guideDraft: ReturnType<typeof useSpaceGuideDraft>;
	guideSaver: SpaceGuideSaver;
	historyErrorMessage: string | null;
	input: SpaceLandingInput;
	pendingActionSurface?: ReactNode;
	prepareSetupHref?: string;
	state: SpaceLandingState;
	viewerMembership: ViewerMembershipState;
}) {
	const {
		accountProfiles,
		agentRecoveryPlansByProfileId,
		centerAgentState,
		currentOwnerUserId,
		currentSpaceIsCenterAgentDirectMessage,
		currentUserAvatarImageUrl,
		handleAgentRecoveryAction,
		handleSetupVisibilityChange,
		isDirectMessage,
		modelCatalog,
		openSpaceFile,
		organizationId,
		recovery,
		setupRecallNonce,
		spaceName,
		spaceFileToOpen,
		spaceReferencesById,
		spaceView,
		spaceViewIdPrefix,
		spaceFileNavigation,
		spaceInboxReadPosition,
		wakeFailureTargetContextsByProfileId,
	} = state;
	const welcomeStep = useWelcomeSpace(recovery.storageScope, input.spaceId);
	const consentEmptyState =
		directMessageAccessRequest?.access.state === "draft"
			? directMessageAccessRequestCopy(directMessageAccessRequest)
			: null;
	const tutorial = useWalkthrough();
	const tutorialActive = Boolean(
		tutorial?.record &&
			tutorial.record.spaceId === input.spaceId &&
			!tutorial.record.paused &&
			tutorial.record.step !== "complete"
	);
	const welcomeRecipients = useMemo(
		() =>
			welcomeStep
				? resolveWelcomeRecipients(
						[
							...(controller.membersSnapshot?.humans ?? []),
							...(controller.membersSnapshot?.agents ?? []),
						].filter((member) => member.status === "active"),
						readWelcomeRecipients(recovery.storageScope, input.spaceId),
						input.profileId
					)
				: [],
		[
			controller.membersSnapshot,
			welcomeStep,
			recovery.storageScope,
			input.spaceId,
			input.profileId,
		]
	);
	const hasWelcomeDraft = Boolean(
		controller.composerText.trim() ||
			controller.composerFiles.length ||
			controller.composerReplyToSignalId
	);
	useEffect(() => {
		if (welcomeStep !== "send" && welcomeStep !== "add") {
			return;
		}
		const since = welcomeStepStartedAt(recovery.storageScope, input.spaceId);
		const sentIds = new Set(
			controller.timelineItems
				.filter(
					(item) =>
						item.actorProfileId === input.profileId &&
						item.deliveryState === "sent" &&
						item.createdAtMs > since
				)
				.map((item) => item.id)
		);
		if (
			controller.timelineItems.some(
				(item) =>
					item.actorProfileKind === "agent" &&
					welcomeRecipients.some(
						(member) => member.profileId === item.actorProfileId
					) &&
					item.deliveryState === "sent" &&
					item.createdAtMs > since &&
					!!item.replyToSignalId &&
					sentIds.has(item.replyToSignalId) &&
					item.isAgentFinalReply
			)
		) {
			saveWelcomeSpace(recovery.storageScope, input.spaceId, "done");
		}
	}, [
		welcomeStep,
		recovery.storageScope,
		input.spaceId,
		input.profileId,
		controller.timelineItems,
		welcomeRecipients,
	]);
	const composerRegion = useSpaceComposerRegion({
		isDeleted: Boolean(controller.status?.deletedAt),
		membersFailed: Boolean(controller.membersError),
		membershipState: viewerMembership,
		profileId: controller.profileId,
		spaceId: controller.spaceId,
	});
	let readOnlyComposerPlaceholder: string | undefined;
	if (controller.status?.deletedAt) {
		readOnlyComposerPlaceholder =
			"This Space was deleted. You can still read and search its history.";
	} else if (directMessageJoinPrompt) {
		readOnlyComposerPlaceholder = directMessageJoinPrompt;
	} else if (viewerMembership === "nonmember") {
		readOnlyComposerPlaceholder = `Join as ${currentProfileName ?? "your profile"} to participate in this Space.`;
	}
	return (
		<SpaceConversationPanel
			actionableAgentInteractionPlacement="pending-surface"
			activeSpaceView={spaceView}
			agentRecoveryPlansByProfileId={agentRecoveryPlansByProfileId}
			agentStreams={controller.agentStreams}
			allowedActions={controller.status?.allowedActions ?? []}
			allowSendWhileAccessSettles={!controller.isCurrentAccessConfirmed}
			automaticWakeConversationKind={automaticWakeConversationKind}
			centerAgentProfileId={centerAgentState.centerAgentProfileId}
			className="min-w-0"
			composerAddressingTargets={controller.composerAddressingTargets}
			composerAgentRequestMentions={controller.composerAgentRequestMentions}
			composerAuthoredMentions={controller.composerAuthoredMentions}
			composerBlockedWakeProfileId={controller.composerBlockedWakeProfileId}
			composerErrorMessage={controller.composerErrorMessage}
			composerFileCleanup={controller.composerFileCleanup}
			composerFileRestorationError={controller.composerFileRestorationError}
			composerFiles={controller.composerFiles}
			composerMembers={
				controller.membersSnapshot
					? undefined
					: {
							state: controller.membersError ? "error" : "loading",
							onRetry: controller.onRefreshMembers,
						}
			}
			composerMentionPickerItems={controller.composerMentionPickerItems}
			composerPrimaryAction={composerPrimaryAction}
			composerReplyToSignalId={controller.composerReplyToSignalId}
			composerText={controller.composerText}
			currentOwnerUserId={currentOwnerUserId}
			directMessageAccessRequest={directMessageAccessRequest}
			emptyStateAlignment={welcomeStep ? "start" : "center"}
			emptyStateDescription={
				consentEmptyState?.emptyStateDescription ??
				resolveReadySpaceEmptyStateDescription({
					hasWelcomeStep: Boolean(welcomeStep),
					isAgentOwnerDirectMessageObserver:
						agentOwnerDirectMessageObserver !== null,
					isDirectMessage,
				})
			}
			emptyStateTitle={
				isDirectMessage ? consentEmptyState?.emptyStateTitle : EMPTY_SPACE_TITLE
			}
			ephemeralActivityItems={controller.presentedWakeProgressItems}
			files={
				<Suspense fallback={<DelayedSpaceFilesFallback />}>
					<SpaceFilesPanel
						fileToOpen={spaceFileToOpen}
						key={controller.spaceId}
						onLeaveGuardChange={spaceFileNavigation.setSpaceFileLeaveGuard}
						openMeldProfileId={controller.profileId}
						organizationSlug={input.orgSlug}
						spaceId={controller.spaceId}
					/>
				</Suspense>
			}
			firstUnreadSignalId={controller.firstUnreadSignalId}
			guide={
				<Suspense fallback={null}>
					<SpaceGuidePanel
						canEdit={Boolean(
							currentOwnerUserId &&
								controller.status?.ownerUserIds?.includes(currentOwnerUserId)
						)}
						draft={guideDraft.draft}
						key={controller.spaceId}
						onDraftChange={guideDraft.onDraftChange}
						openMeldProfileId={controller.profileId}
						saver={guideSaver}
						spaceId={controller.spaceId}
					/>
				</Suspense>
			}
			historyActionErrorMessage={controller.historyActionErrorMessage}
			historyErrorMessage={historyErrorMessage}
			historyNavigation={controller.historyNavigation}
			initialFocusInteractionId={input.initialFocusInteractionId}
			initialFocusRequestId={input.initialFocusRequestId}
			initialFocusSignalId={input.initialFocusSignalId}
			initialFocusThreadRootSignalId={input.initialFocusThreadRootSignalId}
			isAgentRecoveryPending={controller.isAgentRecoveryPending}
			isDiagnosticReportPending={controller.isDiagnosticReportPending}
			isDiagnosticReportSent={controller.isDiagnosticReportSent}
			liveNotice={
				<SpaceLiveNotice
					hidden={Boolean(
						historyErrorMessage || controller.historyActionErrorMessage
					)}
					key={`${controller.spaceId}::${controller.profileId}`}
					liveState={controller.liveState}
					onRetry={controller.onRetryLiveUpdates}
				/>
			}
			membersSnapshot={controller.presentationMembersSnapshot}
			modelCatalog={modelCatalog}
			onAddComposerFiles={controller.onAddComposerFiles}
			onAddPeopleOrAgents={currentSpaceControls.onAddAgentsFromBanner}
			onAgentInteractionResponse={controller.onAgentInteractionResponse}
			onAgentRecoveryAction={handleAgentRecoveryAction}
			onClearComposerReplyTo={controller.onClearComposerReplyTo}
			onComposeExpiredDeviceWait={
				controller.status?.allowedActions.includes("post_message")
					? controller.onComposeExpiredDeviceWait
					: undefined
			}
			onComposerEditorChange={controller.onComposerEditorChange}
			onCreateThread={controller.onCreateThread}
			onJumpToDate={controller.onJumpToDate}
			onLoadEarlierHistory={controller.onLoadEarlierHistory}
			onMentionButtonClick={controller.onMentionButtonClick}
			onOpenSpaceFile={openSpaceFile}
			onOpenTask={(taskId) => {
				state.setSelectedTaskId(taskId);
				spaceFileNavigation.changeSpaceView("tasks");
			}}
			onOpenThread={controller.onOpenThread}
			onOpenUnreadThread={controller.onOpenUnreadThread}
			onPrepareMarkAllRead={
				input.readingEnabled !== false
					? spaceInboxReadPosition.prepareMarkAllRead
					: undefined
			}
			onRecoverExecution={controller.onRecoverExecution}
			onRemoveComposerFile={controller.onRemoveComposerFile}
			onReplyToMessage={controller.onReplyToMessage}
			onReportMessage={controller.onReportMessage}
			onRetryComposerFile={controller.onRetryComposerFile}
			onRetryComposerFileCleanup={controller.onRetryComposerFileCleanup}
			onRetryComposerFileRestoration={controller.onRetryComposerFileRestoration}
			onSend={controller.onSend}
			onSendStarterPrompt={controller.onSendText}
			onSpaceViewChange={spaceFileNavigation.changeSpaceView}
			onViewedUpdates={
				input.readingEnabled !== false
					? controller.onConversationViewedUpdates
					: undefined
			}
			onWakeStopRequest={controller.onWakeStopRequest}
			organizationId={organizationId}
			orgSlug={input.orgSlug}
			pendingActionSurface={pendingActionSurface}
			prepareSetupHref={prepareSetupHref}
			profileControl={composerProfileControl}
			readOnlyComposerPlaceholder={readOnlyComposerPlaceholder}
			renderSetupGuidance={(presentation) => {
				if (tutorialActive && presentation === "banner") {
					return null;
				}
				if (!(controller.isCurrentAccessConfirmed && input.orgSlug)) {
					return null;
				}
				if (welcomeStep) {
					return (
						<WelcomeSpaceGuide
							hasDraft={hasWelcomeDraft}
							hasRecipients={welcomeRecipients.length > 0}
							onAddAgents={currentSpaceControls.onAddAgentsFromBanner}
							onPrepareConversation={() => {
								if (hasWelcomeDraft || welcomeRecipients.length === 0) {
									return;
								}
								controller.onComposerEditorChange(
									buildWelcomeSpaceDraft(welcomeRecipients)
								);
								if (welcomeStep === "add") {
									saveWelcomeSpace(
										recovery.storageScope,
										input.spaceId,
										"send"
									);
								}
							}}
							presentation={presentation}
							scope={recovery.storageScope}
							spaceId={input.spaceId}
						/>
					);
				}
				return (
					<SpaceConversationRecoveryBanner
						accountProfiles={accountProfiles}
						actingProfileId={input.profileId}
						isDirectMessage={isDirectMessage}
						onAddAgents={currentSpaceControls.onAddAgentsFromBanner}
						onSetupVisibilityChange={handleSetupVisibilityChange}
						orgSlug={input.orgSlug}
						presentation={presentation}
						recovery={recovery}
						setupRecallNonce={setupRecallNonce}
						snapshot={controller.membersSnapshot}
						spaceId={controller.spaceId}
						spaceName={spaceName}
					/>
				);
			}}
			selfAvatarImageUrl={currentUserAvatarImageUrl}
			selfProfileId={controller.profileId}
			spaceId={controller.spaceId}
			spaceReferencesById={spaceReferencesById}
			spaceViewIdPrefix={spaceViewIdPrefix}
			tasks={
				<SpaceTasksPanelSlot
					canAddMembers={!isDirectMessage}
					enabled
					membersSnapshot={controller.presentationMembersSnapshot}
					onOpenThread={(threadId) => {
						spaceFileNavigation.changeSpaceView("messages");
						controller.onOpenThread(threadId);
					}}
					onSelectTask={state.setSelectedTaskId}
					openMeldProfileId={controller.profileId}
					organizationId={organizationId}
					organizationSlug={input.orgSlug}
					selectedTaskId={state.selectedTaskId}
					spaceId={controller.spaceId}
					spaceName={spaceName}
				/>
			}
			textareaRef={controller.textareaRef}
			threadPreviews={controller.threadPreviews}
			threads={controller.threads}
			threadsErrorMessage={controller.threadsErrorMessage}
			timelineItems={controller.timelineItems}
			unreadCount={controller.unreadCount}
			unreadScopes={spaceInboxReadPosition.scopes}
			unreadTargets={spaceInboxReadPosition.targets}
			viewState={{
				composerFileLimitReached: controller.composerFileLimitReached,
				composerHasAuthoredMentions: controller.composerHasAuthoredMentions,
				hasEarlierHistory: controller.hasEarlierHistory,
				historyIsPending: controller.historyIsPending,
				isCenterAgentDirectMessage: currentSpaceIsCenterAgentDirectMessage,
				isCreatingThread: controller.isCreatingThread,
				isDirectMessage,
				isLoadingEarlierHistory: controller.isLoadingEarlierHistory,
				isPersonalContext: input.isPersonalContext === true,
				isSendingMessage: controller.isSendingMessage,
				readOnly:
					Boolean(controller.status?.deletedAt) ||
					viewerMembership === "nonmember",
				composerAccessPending: composerRegion.barPending,
				composerTraysHeld: composerRegion.traysHeld,
				threadsIsLoading: controller.threadsIsLoading,
				unreadStateReady: controller.unreadStateReady,
			}}
			wakeFailureTargetContextsByProfileId={
				wakeFailureTargetContextsByProfileId
			}
			wakeStopRequestStatusBySelectorKey={
				controller.wakeStopRequestStatusBySelectorKey
			}
		/>
	);
}

function resolveSpaceHumanJoinControl(input: {
	humanProfile: AuthProfileView | null;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
	membership: ViewerMembershipState;
	onJoin: (profileId: string) => Promise<void>;
}) {
	const humanProfile = input.humanProfile;
	if (
		!humanProfile ||
		input.membership !== "nonmember" ||
		input.isDirectMessage ||
		input.isCenterAgentDirectMessage
	) {
		return null;
	}

	return (
		<SpaceHumanJoinAction
			onJoin={async () => {
				await input.onJoin(humanProfile.openMeldProfileId);
			}}
			profileName={humanProfile.profileName}
		/>
	);
}

function resolveCurrentSpaceHumanViewer(input: {
	accountProfiles: readonly AuthProfileView[];
	currentProfileId: string;
	membersSnapshot: SpaceMembersSnapshot | null;
}): {
	humanProfile: AuthProfileView | null;
	profileName: string | null;
} {
	const humanProfile = findActiveProfileById(input.accountProfiles, {
		profileId: input.currentProfileId,
		profileKind: "human",
	});
	return {
		humanProfile,
		profileName:
			resolveCurrentSpaceProfileName({
				currentProfileId: input.currentProfileId,
				snapshot: input.membersSnapshot,
			}) ??
			humanProfile?.profileName ??
			null,
	};
}

function resolveCurrentProfileLeaveAction(input: {
	isAccessConfirmed: boolean;
	isActiveSpaceMember: boolean;
	onLeaveSpace: () => Promise<void>;
}): (() => Promise<void>) | undefined {
	return input.isAccessConfirmed && input.isActiveSpaceMember
		? input.onLeaveSpace
		: undefined;
}

function SpaceHumanJoinAction(input: {
	onJoin: () => Promise<void>;
	profileName: string;
}) {
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isPending, setIsPending] = useState(false);
	const profileName = input.profileName.trim() || "your profile";

	return (
		<div className="flex min-w-0 flex-col items-end gap-1">
			<Button
				disabled={isPending}
				onClick={() => {
					setIsPending(true);
					setErrorMessage(null);
					input
						.onJoin()
						.catch(() => {
							setErrorMessage("Unable to join this Space. Try again.");
						})
						.finally(() => {
							setIsPending(false);
						});
				}}
				size="sm"
				type="button"
			>
				{isPending ? "Joining…" : `Join as ${profileName}`}
			</Button>
			{errorMessage ? (
				<p
					className="max-w-64 text-right text-destructive text-xs"
					role="alert"
				>
					{errorMessage}
				</p>
			) : null}
		</div>
	);
}

function resolveAgentOwnerDirectMessageObserver(input: {
	currentOwnerUserId: string | null;
	humanProfile: AuthProfileView | null;
	isActiveSpaceMember: boolean;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
}): {
	composerPlaceholder: string;
	humanProfile: AuthProfileView;
	snapshot: SpaceMembersSnapshot;
} | null {
	if (
		!input.isDirectMessage ||
		input.isCenterAgentDirectMessage ||
		input.isActiveSpaceMember ||
		!input.currentOwnerUserId ||
		!input.humanProfile ||
		!input.snapshot
	) {
		return null;
	}
	const ownedAgent = input.snapshot.agents.find(
		(agent) =>
			agent.status === "active" &&
			isSameOwnerUserId({
				currentOwnerUserId: input.currentOwnerUserId,
				ownerUserId: agent.ownerUserId,
			})
	);
	const participant = [...input.snapshot.humans, ...input.snapshot.agents].find(
		(member) =>
			member.status === "active" && member.profileId !== ownedAgent?.profileId
	);
	return ownedAgent
		? {
				composerPlaceholder: participant
					? `${participant.profileName} is chatting with your agent, ${ownedAgent.profileName}. Join this conversation to send messages.`
					: `This conversation is with your agent, ${ownedAgent.profileName}. Join this conversation to send messages.`,
				humanProfile: input.humanProfile,
				snapshot: input.snapshot,
			}
		: null;
}

function resolveAgentOwnerVisibilityLabel(input: {
	currentOwnerUserId: string | null;
	isObserver: boolean;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
}): string | null {
	if (
		!input.isDirectMessage ||
		input.isCenterAgentDirectMessage ||
		!input.snapshot
	) {
		return null;
	}
	const participantOwners = new Set(
		input.snapshot.humans
			.filter((human) => human.status === "active")
			.map((human) => human.ownerUserId)
	);
	const observers = new Map<string, string>();
	for (const agent of input.snapshot.agents) {
		if (
			agent.status === "active" &&
			agent.ownerUserId &&
			agent.ownerUserId !== input.currentOwnerUserId &&
			!participantOwners.has(agent.ownerUserId)
		) {
			observers.set(
				agent.ownerUserId,
				agent.ownerName?.trim() || "Agent owner"
			);
		}
	}
	const visibility =
		observers.size > 0
			? `${[...observers.values()].join(" and ")} can view`
			: null;
	return input.isObserver
		? ["View only", visibility].filter(Boolean).join(" · ")
		: visibility;
}

function resolveSpaceConversationEmptyStateDescription(input: {
	isAgentOwnerDirectMessageObserver: boolean;
	isDirectMessage: boolean;
}): string | undefined {
	if (input.isAgentOwnerDirectMessageObserver) {
		return "Join the conversation to send the first message.";
	}
	return input.isDirectMessage ? undefined : EMPTY_SPACE_DESCRIPTION;
}

function resolveReadySpaceEmptyStateDescription(input: {
	hasWelcomeStep: boolean;
	isAgentOwnerDirectMessageObserver: boolean;
	isDirectMessage: boolean;
}): string | null | undefined {
	return input.hasWelcomeStep
		? null
		: resolveSpaceConversationEmptyStateDescription(input);
}

type AgentOwnerDirectMessageJoinState = {
	defaultName: string;
	errorMessage: string | null;
	isOpen: boolean;
	isPending: boolean;
	onConfirm: (name: string) => Promise<void>;
	onOpen: () => void;
	onOpenChange: (open: boolean) => void;
	selectedNames: string[];
};

/**
 * The Join prompt of a direct message whose Agent the viewer owns. A live
 * members read builds it; until that read returns, the prompt saved on the
 * last visit lets the bar and its Join dialog render on the first frame.
 */
function resolveAgentOwnerDirectMessageJoinPresentation(input: {
	currentSpaceName: string | null | undefined;
	humanProfile: AuthProfileView | null;
	observer: ReturnType<typeof resolveAgentOwnerDirectMessageObserver>;
	saved: SavedDirectMessageJoin | undefined;
}): {
	defaultName: string;
	humanProfileId: string;
	prompt: string;
	selectedNames: string[];
} | null {
	if (!input.observer) {
		return input.saved && input.humanProfile
			? {
					...input.saved,
					humanProfileId: input.humanProfile.openMeldProfileId,
				}
			: null;
	}
	const selectedNames = resolveDirectMessageConversionNames({
		snapshot: input.observer.snapshot,
		selectedMembers: [input.observer.humanProfile],
	});
	const currentMemberNames = [
		...input.observer.snapshot.humans,
		...input.observer.snapshot.agents,
	].flatMap((member) =>
		member.status === "active" ? [member.profileName] : []
	);
	return {
		defaultName: buildDirectMessageConversionDefaultName({
			currentMemberNames,
			currentSpaceName: input.currentSpaceName,
			selectedNames,
		}),
		humanProfileId: input.observer.humanProfile.openMeldProfileId,
		prompt: input.observer.composerPlaceholder,
		selectedNames,
	};
}

function useAgentOwnerDirectMessageJoin(input: {
	onJoin: (
		input: SpaceConvertDirectMessageInput
	) => Promise<SpaceAddProfilesResult>;
	presentation: ReturnType<
		typeof resolveAgentOwnerDirectMessageJoinPresentation
	>;
}): AgentOwnerDirectMessageJoinState | null {
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [isPending, setIsPending] = useState(false);
	const presentation = input.presentation;
	if (!presentation) {
		return null;
	}
	const { defaultName, humanProfileId, selectedNames } = presentation;

	return {
		defaultName,
		errorMessage,
		isOpen,
		isPending,
		onConfirm: async (name) => {
			setIsPending(true);
			setErrorMessage(null);
			try {
				await input.onJoin({
					name,
					profileIds: [humanProfileId],
				});
				setIsOpen(false);
			} catch {
				setErrorMessage("Unable to join this conversation. Try again.");
			} finally {
				setIsPending(false);
			}
		},
		onOpen: () => {
			setErrorMessage(null);
			setIsOpen(true);
		},
		onOpenChange: setIsOpen,
		selectedNames,
	};
}

function AgentOwnerDirectMessageJoinButton(input: {
	control: AgentOwnerDirectMessageJoinState | null;
}) {
	if (!input.control) {
		return null;
	}
	return (
		<Button
			aria-label="Join conversation"
			className="shrink-0"
			disabled={input.control.isPending}
			onClick={input.control.onOpen}
			size="sm"
			type="button"
		>
			Join
		</Button>
	);
}

function resolveAgentOwnerDirectMessageComposerPrimaryAction(
	control: AgentOwnerDirectMessageJoinState | null
): ReactNode | undefined {
	if (!control) {
		return undefined;
	}
	return <AgentOwnerDirectMessageJoinButton control={control} />;
}

function AgentOwnerDirectMessageJoinHeaderControl(input: {
	control: AgentOwnerDirectMessageJoinState;
}) {
	return (
		<div className="flex min-w-0 flex-col items-end gap-1">
			<AgentOwnerDirectMessageJoinButton control={input.control} />
			{input.control.errorMessage ? (
				<p
					className="max-w-64 text-right text-destructive text-xs"
					role="alert"
				>
					{input.control.errorMessage}
				</p>
			) : null}
		</div>
	);
}

function AgentOwnerDirectMessageJoinDialog(input: {
	control: AgentOwnerDirectMessageJoinState | null;
}) {
	if (!input.control) {
		return null;
	}
	return (
		<DirectMessageConversionDialog
			defaultName={input.control.defaultName}
			isPending={input.control.isPending}
			onConfirm={input.control.onConfirm}
			onOpenChange={input.control.onOpenChange}
			open={input.control.isOpen}
			selectedNames={input.control.selectedNames}
		/>
	);
}

function SpaceLandingSecondaryPanels({
	organizationId,
	automaticWakeConversationKind,
	agentProfileEditContext,
	composerProfileControl,
	controller,
	currentProfileIsActiveSpaceMember,
	currentSpaceControls,
	input,
	onShowMessageInMain,
	pendingActionSurface,
	prepareSetupHref,
	state,
	threadPanelVisible,
}: {
	organizationId: string | null;
	automaticWakeConversationKind: ReturnType<
		typeof resolveAutomaticWakeConversationKind
	>;
	agentProfileEditContext: ReturnType<
		typeof resolveAgentProfileEditDialogContext
	>;
	composerProfileControl: ReactNode;
	controller: SpaceConversationController;
	currentProfileIsActiveSpaceMember: boolean;
	currentSpaceControls: ReturnType<typeof resolveCurrentSpaceControls>;
	input: SpaceLandingInput;
	onShowMessageInMain: (signalId: string) => void;
	pendingActionSurface?: ReactNode;
	prepareSetupHref?: string;
	state: SpaceLandingState;
	threadPanelVisible: boolean;
}) {
	if (!controller.isCurrentAccessConfirmed) {
		return threadPanelVisible ? (
			<SpaceThreadLoadingPanel onClose={controller.onCloseThread} />
		) : null;
	}
	const {
		accountProfiles,
		activeWakeDisplayTargetProfileIds,
		activeWakeFolderWaitTargetProfileIds,
		activeWakeWaitingTargetProfileIds,
		addMembersRequestNonce,
		agentRecoveryPlansByProfileId,
		autoRefreshExhaustedProfileIds,
		centerAgentState,
		currentOwnerUserId,
		currentSpaceIsCenterAgentDirectMessage,
		currentUserAvatarImageUrl,
		handleAgentRecoveryAction,
		handleMembersOpenChange,
		isDesktopMembersPanel,
		membersOpen,
		membersPanelWidth,
		modelCatalog,
		openSpaceFile,
		refreshCurrentSpaceMemberFacts,
		spaceMemberRemovalHandler,
		spaceInboxReadPosition,
		spaceReferencesById,
		wakeDisplayOverrideByProfileId,
		wakeFailureTargetContextsByProfileId,
	} = state;
	const sharedMembersProps = {
		accountProfiles,
		agentProfileEditContext,
		activeWakeDisplayTargetProfileIds,
		activeWakeFolderWaitTargetProfileIds,
		activeWakeWaitingTargetProfileIds,
		agentAccessHighlightId: resolveAgentAccessHighlightId(state.membersFocus),
		agentRecoveryPlansByProfileId,
		autoRefreshExhaustedProfileIds,
		centerAgentProfileId: centerAgentState.centerAgentProfileId,
		currentOwnerUserId,
		currentProfileId: controller.profileId,
		displayWakeOverrideByProfileId: wakeDisplayOverrideByProfileId,
		isAgentRecoveryPending: controller.isAgentRecoveryPending,
		isDirectMessage: state.isDirectMessage,
		isLoading:
			controller.isMembersLoading || !controller.isCurrentAccessConfirmed,
		membersError: resolveSpaceMembersLoadErrorMessage(controller.membersError),
		modelCatalog,
		onAddOrganizationDirectoryProfiles:
			currentSpaceControls.onAddOrganizationDirectoryProfiles,
		onAddProfiles: currentSpaceControls.onAddProfiles,
		onConvertDirectMessageToSpace:
			currentSpaceControls.onConvertDirectMessageToSpace,
		onAgentRecoveryAction: handleAgentRecoveryAction,
		onOpenChange: handleMembersOpenChange,
		onRefresh: refreshCurrentSpaceMemberFacts,
		onRemoveMember: spaceMemberRemovalHandler,
		openAddMembersNonce: addMembersRequestNonce,
		orgSlug: input.orgSlug,
		prepareSetupHref,
		snapshot: controller.isCurrentAccessConfirmed
			? controller.membersSnapshot
			: null,
		spaceId: controller.spaceId,
		spaceName: controller.status?.name,
	};
	return (
		<>
			<SpaceTaskReferencesProvider
				disabled={!threadPanelVisible}
				onOpen={(taskId) => {
					state.setSelectedTaskId(taskId);
					controller.onCloseThread();
					state.spaceFileNavigation.changeSpaceView("tasks");
				}}
				organizationSlug={input.orgSlug}
				profileId={controller.profileId}
				spaceId={controller.spaceId}
			>
				<SpaceThreadPanel
					actionableAgentInteractionPlacement="pending-surface"
					activeThread={controller.activeThread}
					agentRecoveryPlansByProfileId={agentRecoveryPlansByProfileId}
					agentStreams={controller.agentStreams}
					automaticWakeConversationKind={
						state.isDirectMessage ? automaticWakeConversationKind : null
					}
					canSendMessage={
						controller.status?.allowedActions.includes("post_message") === true
					}
					centerAgentProfileId={centerAgentState.centerAgentProfileId}
					composerAddressingTargets={controller.threadComposerAddressingTargets}
					composerAuthoredMentions={controller.threadComposerAuthoredMentions}
					composerBlockedWakeProfileId={
						controller.threadComposerBlockedWakeProfileId
					}
					composerErrorMessage={controller.threadComposerErrorMessage}
					composerFileCleanup={controller.threadComposerFileCleanup}
					composerFileLimitReached={controller.threadComposerFileLimitReached}
					composerFileRestorationError={
						controller.threadComposerFileRestorationError
					}
					composerFiles={controller.threadComposerFiles}
					composerHasAuthoredMentions={
						controller.threadComposerHasAuthoredMentions
					}
					composerMembers={
						controller.membersSnapshot
							? undefined
							: {
									state: controller.membersError ? "error" : "loading",
									onRetry: controller.onRefreshMembers,
								}
					}
					composerMentionPickerItems={
						controller.threadComposerMentionPickerItems
					}
					composerReplyToSignalId={controller.threadComposerReplyToSignalId}
					composerText={controller.threadComposerText}
					currentOwnerUserId={currentOwnerUserId}
					ephemeralActivityItems={controller.presentedWakeProgressItems}
					filePreviewUrlsById={controller.threadFilePreviewUrlsById}
					initialFocusRequestId={
						controller.threadUnreadFocus?.requestId ??
						input.initialFocusRequestId
					}
					initialFocusSignalId={
						controller.threadUnreadFocus?.signalId ?? input.initialFocusSignalId
					}
					initialFocusThreadRootSignalId={
						controller.threadUnreadFocus?.rootSignalId ??
						input.initialFocusThreadRootSignalId
					}
					isAgentRecoveryPending={controller.isAgentRecoveryPending}
					isCenterAgentDirectMessage={currentSpaceIsCenterAgentDirectMessage}
					isDiagnosticReportPending={controller.isDiagnosticReportPending}
					isDiagnosticReportSent={controller.isDiagnosticReportSent}
					isDirectMessage={state.isDirectMessage}
					isPersonalContext={input.isPersonalContext === true}
					isSendingMessage={controller.isSendingThreadMessage}
					membersSnapshot={controller.presentationMembersSnapshot}
					modelCatalog={modelCatalog}
					onAddComposerFiles={controller.onAddThreadComposerFiles}
					onAddPeopleOrAgents={currentSpaceControls.onAddAgentsFromBanner}
					onAgentInteractionResponse={controller.onAgentInteractionResponse}
					onAgentRecoveryAction={handleAgentRecoveryAction}
					onClearComposerReplyTo={controller.onClearThreadComposerReplyTo}
					onClose={controller.onCloseThread}
					onComposeExpiredDeviceWait={
						controller.status?.allowedActions.includes("post_message")
							? controller.onThreadComposeExpiredDeviceWait
							: undefined
					}
					onComposerEditorChange={controller.onThreadComposerEditorChange}
					onMentionButtonClick={controller.onThreadMentionButtonClick}
					onOpenSpaceFile={(fileId, revision) => {
						controller.onCloseThread();
						openSpaceFile(fileId, revision);
					}}
					onOpenUnreadThread={controller.onOpenUnreadThread}
					onRecoverExecution={controller.onRecoverExecution}
					onRemoveComposerFile={controller.onRemoveThreadComposerFile}
					onReplyToMessage={controller.onThreadReplyToMessage}
					onReportMessage={controller.onReportMessage}
					onRetryComposerFile={controller.onRetryThreadComposerFile}
					onRetryComposerFileCleanup={
						controller.onRetryThreadComposerFileCleanup
					}
					onRetryComposerFileRestoration={
						controller.onRetryThreadComposerFileRestoration
					}
					onSend={controller.onThreadSend}
					onSendText={controller.onThreadSendText}
					onShowMessageInMain={onShowMessageInMain}
					onViewedUpdates={
						input.readingEnabled !== false
							? controller.onConversationViewedUpdates
							: undefined
					}
					onWakeStopRequest={controller.onWakeStopRequest}
					open={threadPanelVisible}
					organizationId={organizationId}
					orgSlug={input.orgSlug}
					pendingActionSurface={pendingActionSurface}
					prepareSetupHref={prepareSetupHref}
					profileControl={composerProfileControl}
					readOnly={
						Boolean(controller.status?.deletedAt) ||
						!currentProfileIsActiveSpaceMember
					}
					selfAvatarImageUrl={currentUserAvatarImageUrl}
					selfProfileId={controller.profileId}
					signals={controller.threadSignals}
					signalsErrorMessage={controller.threadSignalsErrorMessage}
					signalsIsLoading={controller.threadSignalsIsLoading}
					spaceReferencesById={spaceReferencesById}
					spaceTimelineItems={controller.timelineItems}
					textareaRef={controller.threadTextareaRef}
					unreadBoundaryVersion={spaceInboxReadPosition.readBoundaryVersion}
					unreadScopes={spaceInboxReadPosition.scopes}
					unreadStateReady={spaceInboxReadPosition.isReady}
					unreadTargets={spaceInboxReadPosition.targets}
					wakeFailureTargetContextsByProfileId={
						wakeFailureTargetContextsByProfileId
					}
					wakeRecommendationsEnabled={
						controller.threadWakeRecommendationsEnabled
					}
					wakeStopRequestStatusBySelectorKey={
						controller.wakeStopRequestStatusBySelectorKey
					}
				/>
			</SpaceTaskReferencesProvider>
			{input.orgSlug ? (
				<SpaceLandingMembersChrome
					drawerProps={{
						...sharedMembersProps,
						orgSlug: input.orgSlug,
						onOpenChange: handleMembersOpenChange,
						open: !isDesktopMembersPanel && membersOpen,
					}}
					sidePanelProps={{
						...sharedMembersProps,
						orgSlug: input.orgSlug,
						onOpenChange: handleMembersOpenChange,
						onPanelWidthChange: membersPanelWidth.onWidthChange,
						open: isDesktopMembersPanel && membersOpen,
						panelWidth: membersPanelWidth.width,
					}}
				/>
			) : null}
		</>
	);
}

function resolveSpaceLandingBodySlotName(
	presentation: "compact" | "full" | undefined
) {
	return presentation === "compact"
		? "center-agent-compact-conversation"
		: undefined;
}

function resolveSpaceReferenceInputs(
	controller: ReturnType<typeof useSpaceLandingController>
) {
	if (controller.mode !== "ready") {
		return {
			currentSpace: null,
			membersSnapshot: null,
			threadSignals: null,
			timelineItems: null,
		};
	}

	return {
		currentSpace: {
			name: controller.status.name ?? null,
			spaceId: controller.spaceId,
		},
		membersSnapshot: controller.membersSnapshot,
		threadSignals: controller.threadSignals,
		timelineItems: controller.timelineItems,
	};
}

function SpaceLandingMembersChrome(input: {
	drawerProps: ComponentProps<typeof SpaceMembersDrawer>;
	sidePanelProps: ComponentProps<typeof SpaceMembersSidePanel>;
}) {
	return (
		<>
			<SpaceAddMembersLauncher
				key={input.drawerProps.spaceId}
				{...input.drawerProps}
			/>
			<SpaceMembersSidePanel {...input.sidePanelProps} />
			<SpaceMembersDrawer {...input.drawerProps} />
		</>
	);
}

function resolveSpaceMemberRemovalHandler(input: {
	canRemoveMembers: boolean;
	isDirectMessage: boolean;
	onRemoveMember: (profileId: string) => Promise<SpaceRemoveMemberResult>;
}) {
	if (input.isDirectMessage || !input.canRemoveMembers) {
		return undefined;
	}
	return input.onRemoveMember;
}

function resolveSpaceMembersLoadErrorMessage(error: unknown) {
	return error ? SPACE_MEMBERS_LOAD_ERROR_MESSAGE : null;
}

function resolveAgentProfileEditDialogContext(input: {
	onSaved: (profileId: string) => Promise<void>;
	organizationId: string | null;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
}): AgentProfileEditDialogContext | undefined {
	if (!(input.organizationId && input.recovery.selectedHumanProfileId)) {
		return undefined;
	}
	return {
		actorProfileId: input.recovery.selectedHumanProfileId,
		deviceId: input.recovery.deviceId,
		executionTarget: resolveProfileBindingCatalogExecutionTarget(
			input.recovery
		),
		onSaved: input.onSaved,
		organizationId: input.organizationId,
		runtimeLane: input.recovery.runtimeLane,
		storageScope: input.recovery.storageScope,
	};
}

function SpaceLoadFailure(input: {
	currentSpaceWasDeleted: boolean;
	isCheckingForDeletion: boolean;
	error: StructuredApiClientFailure | null;
	onRetry: () => Promise<void>;
	spaceId: string;
}) {
	// A deleted Space is redirected away by useRedirectAwayFromDeletedSpace; show the
	// neutral loading shell while we confirm deletion and during the redirect, rather
	// than flashing a futile "Try Again".
	if (input.currentSpaceWasDeleted || input.isCheckingForDeletion) {
		return <SpaceLandingLoadingShell />;
	}
	return (
		<SpaceLandingFailureSurface
			error={input.error}
			onRetry={input.onRetry}
			spaceId={input.spaceId}
		/>
	);
}

function resolveAutomaticWakeConversationKind(
	status: GetSpaceStatusResponse | null
): SpaceAutomaticWakeComposerHintKind | null {
	if (!status) {
		return null;
	}
	const state = {
		automaticWakeEnabled: status.automaticWakeEnabled,
		activeMemberCount: status.members.totalCount,
		agentMemberCount: status.members.agentCount,
		humanMemberCount: status.members.humanCount,
		purpose: status.spacePurpose,
	};
	if (!isAutomaticWakeSpace(state)) {
		return null;
	}
	return "one_human_agent";
}

function useRedirectAwayFromDeletedSpace(input: {
	controllerMode: string;
	orgSlug?: string;
	profileId: string;
	spaceId: string;
}): { currentSpaceWasDeleted: boolean; isCheckingForDeletion: boolean } {
	const navigate = useNavigate();
	const isFailureMode = input.controllerMode === "failure";
	const accountSpacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: isFailureMode,
			profileId: input.profileId,
			scope: "account",
		})
	);
	// The durable Space Index projection is the authoritative "this Space is gone"
	// signal — the deleted DO recreates empty, so its status load can't be trusted.
	const currentSpaceWasDeleted = useMemo(
		() =>
			(accountSpacesQuery.data?.recentlyDeletedItems ?? []).some(
				(item) => item.spaceId === input.spaceId
			),
		[accountSpacesQuery.data, input.spaceId]
	);
	useEffect(() => {
		if (isFailureMode && currentSpaceWasDeleted) {
			navigate({
				replace: true,
				to: input.orgSlug
					? buildOrganizationSpacesPath(input.orgSlug)
					: "/invitations",
			}).catch((error: unknown) => {
				console.error(
					"Failed to redirect away from a deleted Space's URL.",
					error
				);
			});
		}
	}, [isFailureMode, currentSpaceWasDeleted, input.orgSlug, navigate]);
	return {
		currentSpaceWasDeleted,
		isCheckingForDeletion: isFailureMode && accountSpacesQuery.isPending,
	};
}

function prepareWelcomeDraft(
	input: {
		controller: SpaceConversationController;
		storageScope: string;
	},
	response: {
		addedMemberIds: string[];
		items: readonly {
			profileId: string;
			profileKind: "human" | "agent";
			profileName: string;
		}[];
	}
) {
	const { controller } = input;
	const step = readWelcomeSpace(input.storageScope, controller.spaceId);
	if (
		(step !== "add" && step !== "send") ||
		response.addedMemberIds.length === 0
	) {
		return;
	}
	const members = response.items.filter((member) =>
		response.addedMemberIds.includes(member.profileId)
	);
	if (members.length === 0) {
		return;
	}
	saveWelcomeRecipients(
		input.storageScope,
		controller.spaceId,
		members.map((member) => member.profileId)
	);
	if (
		!controller.composerText.trim() &&
		controller.composerFiles.length === 0 &&
		!controller.composerReplyToSignalId
	) {
		controller.onComposerEditorChange(buildWelcomeSpaceDraft(members));
	}
	saveWelcomeSpace(input.storageScope, controller.spaceId, "send");
}

function useSpaceAddProfilesHandler(input: {
	accountProfiles: readonly AuthProfileView[];
	controller: ReturnType<typeof useSpaceLandingController>;
	organizationId: string | null;
	organizationSlug?: string;
	queryClient: ReturnType<typeof useQueryClient>;
	storageScope: string;
}): (profileIds: readonly string[]) => Promise<SpaceAddProfilesResult> {
	return useCallback(
		async (profileIds: readonly string[]) => {
			if (!input.organizationSlug) {
				throw new Error("Join the organization to add people or Agents.");
			}
			const memberProfileIds = normalizeSpaceMemberProfileIds(profileIds);
			if (memberProfileIds.length === 0) {
				return { addedCount: 0, alreadyMemberCount: 0 };
			}
			const controller = input.controller;
			if (controller.mode !== "ready") {
				throw new Error(
					"OpenMeld cannot add profiles until this Space is ready."
				);
			}
			const actingProfile = input.accountProfiles.find(
				(profile) => profile.openMeldProfileId === controller.profileId
			);
			if (!actingProfile) {
				throw new Error(
					"OpenMeld could not confirm the current acting profile."
				);
			}

			const addMembersResult = await createOrganizationScopedWebSpaceApi({
				openMeldProfileId: controller.profileId,
				...resolveWebOrganizationSelector({
					organizationId: input.organizationId,
					organizationSlug: input.organizationSlug,
				}),
			}).addMembers({
				memberProfileIds,
				requestContext: buildProfileRequestContext(actingProfile),
				spaceId: controller.spaceId,
			});
			const agentProfileIdsToRefresh = listSelectedAgentProfileIds({
				accountProfiles: input.accountProfiles,
				memberProfileIds,
			});
			prepareWelcomeDraft(
				{ controller, storageScope: input.storageScope },
				addMembersResult
			);

			applySpaceMembersResponseToCache({
				pendingWakeReadinessProfileIds: agentProfileIdsToRefresh,
				queryClient: input.queryClient,
				response: addMembersResult,
				spaceId: controller.spaceId,
				viewerProfileId: controller.profileId,
			});

			recordProfileSpaceHistory({
				creatorKind: actingProfile.profileKind,
				creatorProfileId: actingProfile.openMeldProfileId,
				profileIds: memberProfileIds,
				spaceId: controller.spaceId,
				spaceName: controller.status.name ?? null,
			}).catch((error) => {
				console.warn(
					"OpenMeld added Space members but could not update history.",
					{
						error,
						profileIds: memberProfileIds,
						spaceId: controller.spaceId,
					}
				);
			});

			(async () => {
				if (input.organizationId && agentProfileIdsToRefresh.length > 0) {
					await refreshWebAgentReadinessAfterCoreFactsChanged({
						agentProfileIds: agentProfileIdsToRefresh,
						includeLocalRuntimeCaches: false,
						organizationId: input.organizationId,
						queryClient: input.queryClient,
						storageScope: input.storageScope,
					});
				}
				await Promise.all([
					input.queryClient.invalidateQueries({
						queryKey: accountSpaceQueryKeys.all,
					}),
					input.queryClient.invalidateQueries({
						queryKey: spaceQueryKeys.members(
							controller.spaceId,
							controller.profileId
						),
					}),
					input.queryClient.invalidateQueries({
						queryKey: spaceQueryKeys.status(
							controller.spaceId,
							controller.profileId
						),
					}),
				]);
				await controller.onRefreshStatusAndMembers();
			})().catch((error) => {
				console.warn(
					"OpenMeld added Space members but could not refresh Space data.",
					{
						error,
						profileIds: memberProfileIds,
						spaceId: controller.spaceId,
					}
				);
			});

			return {
				addedCount: addMembersResult.addedMemberIds.length,
				alreadyMemberCount: addMembersResult.alreadyMemberIds.length,
			};
		},
		[
			input.accountProfiles,
			input.controller,
			input.organizationId,
			input.organizationSlug,
			input.queryClient,
			input.storageScope,
		]
	);
}

function useSpaceAddOrganizationDirectoryProfilesHandler(input: {
	controller: ReturnType<typeof useSpaceLandingController>;
	organizationId: string | null;
	organizationSlug?: string;
	queryClient: ReturnType<typeof useQueryClient>;
	storageScope: string;
}): (
	input: SpaceAddOrganizationDirectoryProfilesInput
) => Promise<SpaceAddProfilesResult> {
	return useCallback(
		async (selection: SpaceAddOrganizationDirectoryProfilesInput) => {
			if (!input.organizationSlug) {
				throw new Error("Join the organization to use its directory.");
			}
			const directoryProfileIds = normalizeSpaceMemberProfileIds(
				selection.directoryProfileIds
			);
			if (directoryProfileIds.length === 0) {
				return { addedCount: 0, alreadyMemberCount: 0 };
			}
			const controller = input.controller;
			if (controller.mode !== "ready") {
				throw new Error(
					"OpenMeld cannot add Organization Directory profiles until this Space is ready."
				);
			}
			const addMembersResult = await createOrganizationScopedWebSpaceApi({
				openMeldProfileId: controller.profileId,
				...resolveWebOrganizationSelector({
					organizationId: input.organizationId,
					organizationSlug: input.organizationSlug,
				}),
			}).addOrganizationDirectoryProfilesToSpace({
				directoryProfileIds,
				...(selection.expectedCenterAgentProfileId
					? {
							expectedCenterAgentProfileId:
								selection.expectedCenterAgentProfileId,
						}
					: {}),
				spaceId: controller.spaceId,
			});
			prepareWelcomeDraft(
				{ controller, storageScope: input.storageScope },
				addMembersResult
			);

			applySpaceMembersResponseToCache({
				queryClient: input.queryClient,
				response: addMembersResult,
				spaceId: controller.spaceId,
				viewerProfileId: controller.profileId,
			});

			(async () => {
				if (input.organizationId) {
					await refreshWebAgentReadinessAfterCoreFactsChanged({
						includeLocalRuntimeCaches: false,
						organizationId: input.organizationId,
						queryClient: input.queryClient,
						storageScope: input.storageScope,
					});
				}
				await Promise.all([
					input.queryClient.invalidateQueries({
						queryKey: accountSpaceQueryKeys.all,
					}),
					input.queryClient.invalidateQueries({
						queryKey: spaceQueryKeys.members(
							controller.spaceId,
							controller.profileId
						),
					}),
					input.queryClient.invalidateQueries({
						queryKey: spaceQueryKeys.status(
							controller.spaceId,
							controller.profileId
						),
					}),
				]);
				await controller.onRefreshStatusAndMembers();
			})().catch((error) => {
				console.warn(
					"OpenMeld added Organization Directory profiles but could not refresh Space data.",
					{ directoryProfileIds, error, spaceId: controller.spaceId }
				);
			});

			return {
				addedCount: addMembersResult.addedMemberIds.length,
				alreadyMemberCount: addMembersResult.alreadyMemberIds.length,
			};
		},
		[
			input.controller,
			input.organizationId,
			input.organizationSlug,
			input.queryClient,
			input.storageScope,
		]
	);
}

function useConvertDirectMessageToSpaceHandler(input: {
	accountProfiles: readonly AuthProfileView[];
	controller: ReturnType<typeof useSpaceLandingController>;
	navigate: ReturnType<typeof useNavigate>;
	orgSlug?: string;
	queryClient: ReturnType<typeof useQueryClient>;
}): (input: SpaceConvertDirectMessageInput) => Promise<SpaceAddProfilesResult> {
	return useCallback(
		async (conversion: SpaceConvertDirectMessageInput) => {
			if (!input.orgSlug) {
				throw new Error("Join the organization to manage its Direct Messages.");
			}
			const profileIds = normalizeSpaceMemberProfileIds(conversion.profileIds);
			const controller = input.controller;
			if (controller.mode !== "ready") {
				throw new Error(
					"OpenMeld cannot turn this Direct Message into a Space until it is ready."
				);
			}
			const result = await createDirectMessageApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationSlug: input.orgSlug,
					openMeldProfileId: controller.profileId,
				})
			).convertToSpace({
				includeMemberSnapshots: true,
				name: conversion.name,
				profileIds,
				spaceId: controller.spaceId,
			});
			const joiningHumanProfile = findActiveProfileById(input.accountProfiles, {
				profileId: controller.profileId,
				profileKind: "human",
			});
			const confirmedJoiningHuman = Boolean(
				joiningHumanProfile &&
					result.addedMemberIds.includes(joiningHumanProfile.openMeldProfileId)
			);
			const addedMemberIds = new Set(result.addedMemberIds);
			const addedItems = result.items?.filter((member) =>
				addedMemberIds.has(member.profileId)
			);
			const confirmedAddedCounts = {
				humanCount:
					addedItems?.filter((member) => member.profileKind === "human")
						.length ?? Number(confirmedJoiningHuman),
				agentCount:
					addedItems?.filter((member) => member.profileKind === "agent")
						.length ?? 0,
			};
			const statusQueryKey = spaceQueryKeys.status(
				controller.spaceId,
				controller.profileId
			);
			// Pre-conversion reads must not replace the confirmed membership on navigation.
			await Promise.all([
				input.queryClient.cancelQueries({
					queryKey: accountSpaceQueryKeys.all,
				}),
				input.queryClient.cancelQueries({ queryKey: statusQueryKey }),
				input.queryClient.cancelQueries({
					queryKey: spaceQueryKeys.members(
						controller.spaceId,
						controller.profileId
					),
				}),
				input.queryClient.cancelQueries({
					queryKey: spaceQueryKeys.bootstrap(
						controller.spaceId,
						controller.profileId
					),
				}),
			]);
			if (result.items) {
				applySpaceMembersResponseToCache({
					generatedAt: result.convertedAt,
					queryClient: input.queryClient,
					response: { ...result, items: result.items },
					spaceId: controller.spaceId,
					viewerProfileId: controller.profileId,
				});
			} else if (joiningHumanProfile && confirmedJoiningHuman) {
				// Older Core responses omit items during a receiver-first rollout.
				applyConfirmedHumanSpaceMemberToCache({
					addedAt: result.convertedAt,
					profile: joiningHumanProfile,
					queryClient: input.queryClient,
					spaceId: controller.spaceId,
					viewerProfileId: controller.profileId,
				});
			}
			input.queryClient.setQueryData<GetSpaceStatusResponse>(
				statusQueryKey,
				(status) =>
					status
						? applyDirectMessageConversionToSpaceStatus(
								status,
								result,
								confirmedAddedCounts
							)
						: status
			);
			input.queryClient.setQueryData<SpaceBootstrapSnapshot>(
				spaceQueryKeys.bootstrap(controller.spaceId, controller.profileId),
				(bootstrap) =>
					bootstrap
						? {
								...bootstrap,
								status: applyDirectMessageConversionToSpaceStatus(
									bootstrap.status,
									result,
									confirmedAddedCounts
								),
							}
						: bootstrap
			);
			input.queryClient.setQueriesData<AccountSpaceSections>(
				{ queryKey: accountSpaceQueryKeys.all },
				(sections) =>
					applyDirectMessageConversionToAccountSpaceSections(
						sections,
						result,
						confirmedAddedCounts
					)
			);

			const navigation = input.navigate({
				replace: true,
				search: { profileId: controller.profileId },
				to: buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					spaceId: controller.spaceId,
				}),
			});
			Promise.all([
				input.queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				}),
				input.queryClient.invalidateQueries({
					queryKey: spaceQueryKeys.members(
						controller.spaceId,
						controller.profileId
					),
				}),
				input.queryClient.invalidateQueries({
					queryKey: statusQueryKey,
				}),
			]).catch((error) => {
				console.warn(
					"OpenMeld turned the Direct Message into a Space but could not refresh Space data.",
					{ error, spaceId: controller.spaceId }
				);
			});
			await navigation;
			return {
				addedCount: result.addedMemberIds.length,
				alreadyMemberCount: result.alreadyMemberIds.length,
			};
		},
		[
			input.accountProfiles,
			input.controller,
			input.navigate,
			input.orgSlug,
			input.queryClient,
		]
	);
}

function applyDirectMessageConversionToSpaceStatus(
	status: GetSpaceStatusResponse,
	result: ConvertDirectMessageToSpaceResponse,
	addedCounts: { humanCount: number; agentCount: number }
): GetSpaceStatusResponse {
	const counts = status.directMessageConvertedAt
		? { humanCount: 0, agentCount: 0 }
		: addedCounts;
	return {
		...status,
		accessMode: result.accessMode,
		directMessageConvertedAt: result.convertedAt,
		generatedAt: result.convertedAt,
		members: {
			...status.members,
			humanCount: status.members.humanCount + counts.humanCount,
			agentCount: status.members.agentCount + counts.agentCount,
			totalCount:
				status.members.totalCount + counts.humanCount + counts.agentCount,
		},
		name: result.name,
	};
}

function applyDirectMessageConversionToAccountSpaceSections(
	sections: AccountSpaceSections | undefined,
	result: ConvertDirectMessageToSpaceResponse,
	addedCounts: { humanCount: number; agentCount: number }
): AccountSpaceSections | undefined {
	if (!sections) {
		return sections;
	}

	const updateItem = (
		item: AccountSpaceSections["spaceItems"][number]
	): AccountSpaceSections["spaceItems"][number] => {
		if (item.spaceId !== result.spaceId) {
			return item;
		}
		const counts = item.directMessageConvertedAt
			? { humanCount: 0, agentCount: 0 }
			: addedCounts;
		return {
			...item,
			activeHumanCount:
				item.activeHumanCount === null
					? null
					: item.activeHumanCount + counts.humanCount,
			activeAgentCount:
				item.activeAgentCount === null
					? null
					: item.activeAgentCount + counts.agentCount,
			activeMemberCount:
				item.activeMemberCount === null
					? null
					: item.activeMemberCount + counts.humanCount + counts.agentCount,
			directMessageConvertedAt: result.convertedAt,
			spaceName: result.name,
		};
	};

	return {
		...sections,
		pinnedItems: sections.pinnedItems.map(updateItem),
		spaceItems: sections.spaceItems.map(updateItem),
	};
}

function useSpaceRemoveMemberHandler(input: {
	accountProfiles: readonly AuthProfileView[];
	controller: ReturnType<typeof useSpaceLandingController>;
	organizationId: string | null;
	organizationSlug?: string;
	queryClient: ReturnType<typeof useQueryClient>;
}): (profileId: string) => Promise<SpaceRemoveMemberResult> {
	return useCallback(
		async (profileId: string) => {
			if (!input.organizationSlug) {
				throw new Error("Join the organization to manage Space members.");
			}
			const memberProfileIds = normalizeSpaceMemberProfileIds([profileId]);
			if (memberProfileIds.length === 0) {
				return { removedCount: 0, alreadyAbsentCount: 0 };
			}
			const controller = input.controller;
			if (controller.mode !== "ready") {
				throw new Error(
					"OpenMeld cannot remove members until this Space is ready."
				);
			}
			const actingProfile = input.accountProfiles.find(
				(profile) => profile.openMeldProfileId === controller.profileId
			);
			if (actingProfile?.profileKind !== "human") {
				throw new Error("OpenMeld could not confirm your current profile.");
			}

			const membersQueryKey = spaceQueryKeys.members(
				controller.spaceId,
				controller.profileId
			);
			const bootstrapQueryKey = spaceQueryKeys.bootstrap(
				controller.spaceId,
				controller.profileId
			);
			await Promise.all([
				input.queryClient.cancelQueries({ queryKey: membersQueryKey }),
				input.queryClient.cancelQueries({ queryKey: bootstrapQueryKey }),
			]);
			const previousMembersSnapshot =
				input.queryClient.getQueryData<SpaceMembersSnapshot>(membersQueryKey);
			const previousBootstrapSnapshot =
				input.queryClient.getQueryData<SpaceBootstrapSnapshot>(
					bootstrapQueryKey
				);

			applySpaceMemberRemovalToCache({
				memberProfileIds,
				queryClient: input.queryClient,
				spaceId: controller.spaceId,
				viewerProfileId: controller.profileId,
			});

			let removeMembersResult: RemoveSpaceMembersResponse;
			try {
				removeMembersResult = await createOrganizationScopedWebSpaceApi({
					openMeldProfileId: controller.profileId,
					...resolveWebOrganizationSelector({
						organizationId: input.organizationId,
						organizationSlug: input.organizationSlug,
					}),
				}).removeMembers({
					memberProfileIds,
					requestContext: buildProfileRequestContext(actingProfile),
					spaceId: controller.spaceId,
				});
			} catch (error) {
				input.queryClient.setQueryData(
					membersQueryKey,
					previousMembersSnapshot
				);
				input.queryClient.setQueryData(
					bootstrapQueryKey,
					previousBootstrapSnapshot
				);
				throw error;
			}

			await Promise.all([
				input.queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				}),
				input.queryClient.invalidateQueries({
					queryKey: membersQueryKey,
				}),
				input.queryClient.invalidateQueries({
					queryKey: spaceQueryKeys.status(
						controller.spaceId,
						controller.profileId
					),
				}),
			]);
			await controller.onRefreshStatusAndMembers();

			return {
				alreadyAbsentCount: removeMembersResult.alreadyAbsentMemberIds.length,
				removedCount: removeMembersResult.removedMemberIds.length,
			};
		},
		[
			input.accountProfiles,
			input.controller,
			input.organizationId,
			input.organizationSlug,
			input.queryClient,
		]
	);
}

function resolveSpaceLandingAccountProfiles(
	profiles: readonly AuthProfileView[] | undefined
): readonly AuthProfileView[] {
	return profiles ?? EMPTY_ACCOUNT_PROFILES;
}

function subscribeDocumentVisibility(onStoreChange: () => void): () => void {
	document.addEventListener("visibilitychange", onStoreChange);
	return () => document.removeEventListener("visibilitychange", onStoreChange);
}

function getDocumentVisibilitySnapshot(): boolean {
	return document.visibilityState === "visible";
}

function getServerDocumentVisibilitySnapshot(): boolean {
	return true;
}

function isCurrentOwnerSpaceAgentMember(input: {
	agent: SpaceMembersSnapshot["agents"][number];
	currentOwnerUserId: string | null;
}): boolean {
	return isSameOwnerUserId({
		currentOwnerUserId: input.currentOwnerUserId,
		ownerUserId: input.agent.ownerUserId,
	});
}

type LocalRuntimeReadinessEventState = {
	canReplyFromThisComputer: boolean;
	serviceConnected: boolean;
};

function resolveLocalRuntimeReadinessEventState(
	readiness: CurrentLocalRuntimeReplyReadinessResponse
): LocalRuntimeReadinessEventState {
	return {
		canReplyFromThisComputer: readiness.canReplyFromThisComputer,
		serviceConnected: readiness.service.connected,
	};
}

function listCurrentOwnerActiveAgentProfileIds(input: {
	currentOwnerUserId: string | null;
	snapshot: SpaceMembersSnapshot | null;
}): string[] {
	const profileIds: string[] = [];
	for (const agent of input.snapshot?.agents ?? []) {
		if (
			agent.status === "active" &&
			agent.removedAt === null &&
			isCurrentOwnerSpaceAgentMember({
				agent,
				currentOwnerUserId: input.currentOwnerUserId,
			})
		) {
			profileIds.push(agent.profileId);
		}
	}
	return profileIds;
}

function normalizeAgentProfileIds(profileIds: readonly string[]): string[] {
	const normalizedProfileIds = new Set<string>();
	for (const profileId of profileIds) {
		const normalizedProfileId = normalizeAgentProfileId(profileId);
		if (normalizedProfileId) {
			normalizedProfileIds.add(normalizedProfileId);
		}
	}
	return [...normalizedProfileIds];
}

function normalizeSpaceMemberProfileIds(
	profileIds: readonly string[]
): string[] {
	const normalizedProfileIds = new Set<string>();
	for (const profileId of profileIds) {
		const normalizedProfileId = profileId.trim();
		if (normalizedProfileId.length > 0) {
			normalizedProfileIds.add(normalizedProfileId);
		}
	}
	return [...normalizedProfileIds];
}

function listSelectedAgentProfileIds(input: {
	accountProfiles: readonly AuthProfileView[];
	memberProfileIds: readonly string[];
}): string[] {
	const profileById = new Map(
		input.accountProfiles.map((profile) => [profile.openMeldProfileId, profile])
	);
	return input.memberProfileIds.filter(
		(profileId) => profileById.get(profileId)?.profileKind === "agent"
	);
}

function normalizeAgentProfileId(profileId: string): string | null {
	const normalizedProfileId = profileId.trim();
	return normalizedProfileId.startsWith("agt_") ? normalizedProfileId : null;
}

function normalizeSignalIds(signalIds: readonly string[]): string[] {
	const normalizedSignalIds = new Set<string>();
	for (const signalId of signalIds) {
		const normalizedSignalId = signalId.trim();
		if (normalizedSignalId.length > 0) {
			normalizedSignalIds.add(normalizedSignalId);
		}
	}
	return [...normalizedSignalIds];
}

function filterCurrentOwnerAgentProfileIds(input: {
	agentProfileIds: readonly string[];
	currentOwnerUserId: string | null;
	snapshot: SpaceMembersSnapshot | null;
}): string[] {
	const currentOwnerAgentProfileIds = new Set(
		listCurrentOwnerActiveAgentProfileIds({
			currentOwnerUserId: input.currentOwnerUserId,
			snapshot: input.snapshot,
		})
	);
	return input.agentProfileIds.filter((profileId) =>
		currentOwnerAgentProfileIds.has(profileId)
	);
}

async function runWakeFinalOutcomeRefreshStep(input: {
	action: () => Promise<unknown> | unknown;
	agentProfileIds: readonly string[];
	maxAttempts?: number;
	signalIds: readonly string[];
	spaceId: string;
	step: string;
}) {
	const maxAttempts = Math.max(1, input.maxAttempts ?? 1);
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			await input.action();
			return;
		} catch (error) {
			warnWakeFinalOutcomeRefreshFailure({
				agentProfileIds: input.agentProfileIds,
				attempt,
				error,
				maxAttempts,
				signalIds: input.signalIds,
				spaceId: input.spaceId,
				step: input.step,
				willRetry: attempt < maxAttempts,
			});
		}
	}
}

function warnWakeFinalOutcomeRefreshFailure(
	input: Pick<
		WebAgentReadinessRefreshFailure,
		"agentProfileIds" | "attempt" | "error" | "maxAttempts" | "willRetry"
	> & {
		signalIds: readonly string[];
		spaceId: string;
		step: string;
	}
) {
	if (isQueryCancellationError(input.error)) {
		return;
	}
	console.warn("[openmeld.web.space.wake_final_outcome_refresh_failed]", {
		agentProfileId: input.agentProfileIds[0] ?? null,
		agentProfileIds: input.agentProfileIds,
		attempt: input.attempt,
		error:
			input.error instanceof Error ? input.error.message : String(input.error),
		maxAttempts: input.maxAttempts,
		signalId: input.signalIds[0] ?? null,
		signalIds: input.signalIds,
		spaceId: input.spaceId,
		step: input.step,
		willRetry: input.willRetry,
	});
}

function warnSpaceRefreshFailure(message: string, error: unknown) {
	if (isQueryCancellationError(error)) {
		return;
	}
	console.warn(message, error);
}

function resolveActiveWakeWaitingTargetProfileIds(
	...itemGroups: readonly (readonly WakeProgressItem[])[]
): ReadonlySet<string> {
	const targetProfileIds = new Set<string>();
	for (const itemGroup of itemGroups) {
		for (const item of itemGroup) {
			if (
				!item.terminal &&
				(item.phase === "queued" ||
					item.phase === "connecting" ||
					item.phase === "retrying")
			) {
				targetProfileIds.add(item.targetProfileId);
			}
		}
	}
	return targetProfileIds;
}

function resolveActiveWakeDisplayTargetProfileIds(
	...itemGroups: readonly (readonly WakeProgressItem[])[]
): ReadonlySet<string> {
	const targetProfileIds = new Set<string>();
	for (const itemGroup of itemGroups) {
		for (const item of itemGroup) {
			if (
				isActiveWakeProgressItem(item) &&
				!isFolderWaitWakeProgressItem(item)
			) {
				targetProfileIds.add(item.targetProfileId);
			}
		}
	}
	return targetProfileIds;
}

/** Agents whose Wake is queued on the computer behind a task in its folder. */
function resolveActiveWakeFolderWaitTargetProfileIds(
	...itemGroups: readonly (readonly WakeProgressItem[])[]
): ReadonlySet<string> {
	const targetProfileIds = new Set<string>();
	for (const itemGroup of itemGroups) {
		for (const item of itemGroup) {
			if (
				isActiveWakeProgressItem(item) &&
				isFolderWaitWakeProgressItem(item)
			) {
				targetProfileIds.add(item.targetProfileId);
			}
		}
	}
	return targetProfileIds;
}

function isFolderWaitWakeProgressItem(item: WakeProgressItem): boolean {
	return (
		item.waitReasonCode === WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE
	);
}

function buildSpaceAgentRecoveryPlansByProfileId(input: {
	autoRefreshActive: boolean;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	computerReplyReadiness: ReturnType<typeof resolveSpaceComputerReplyReadiness>;
	currentOwnerUserId: string | null;
	deviceAgentCatalog: WebAgentProfileReplyRecoveryLocalAgentCatalog | null;
	snapshot: SpaceMembersSnapshot | null;
}): ReadonlyMap<string, AgentProfileReplyRecoveryPlan> {
	const plansByProfileId = new Map<string, AgentProfileReplyRecoveryPlan>();
	if (!input.snapshot) {
		return plansByProfileId;
	}

	// TODO: This is the short-term Web filter for owner-only local controls.
	// The medium/long-term fix is a viewer-scoped Core/Gateway projection so
	// non-owners never receive setup, service, repair, or recovery plan facts.
	for (const agent of input.snapshot.agents) {
		if (
			!isCurrentOwnerSpaceAgentMember({
				agent,
				currentOwnerUserId: input.currentOwnerUserId,
			})
		) {
			continue;
		}
		const plan = planAgentProfileReplyRecoveryFromWebEvidence({
			autoRefreshExhausted: input.autoRefreshExhaustedProfileIds.has(
				agent.profileId
			),
			currentLocalRuntimeReplyReadiness: input.computerReplyReadiness,
			localAgentCatalog: input.deviceAgentCatalog,
			member: agent,
		});
		if (plan.kind !== "none") {
			plansByProfileId.set(agent.profileId, plan);
		}
	}

	return plansByProfileId;
}

function buildWakeFailureTargetContextsByProfileId(input: {
	currentOwnerUserId: string | null;
	snapshot: SpaceMembersSnapshot | null;
}): ReadonlyMap<string, WakeFailureTargetContext> {
	const contextsByProfileId = new Map<string, WakeFailureTargetContext>();
	if (!input.snapshot) {
		return contextsByProfileId;
	}

	for (const agent of input.snapshot.agents) {
		contextsByProfileId.set(
			agent.profileId,
			resolveWakeFailureTargetContext({
				controllerDisplayName: agent.runtimeDeviceDisplayName ?? null,
				currentOwnerUserId: input.currentOwnerUserId,
				ownerDisplayName: agent.ownerName,
				ownerUserId: agent.ownerUserId,
			})
		);
	}

	return contextsByProfileId;
}

function resolveSpaceComputerReplyReadiness(input: {
	isFetching?: boolean;
	isPending: boolean;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null;
}) {
	return mapCurrentLocalRuntimeReplyReadinessQueryState(input);
}

function shouldAutoRefreshSpaceAgentRecovery(input: {
	activeWakeWaitingTargetProfileIds: ReadonlySet<string>;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	currentOwnerUserId: string | null;
	recoveryRefreshWindowActive: boolean;
	snapshot: SpaceMembersSnapshot | null;
}): boolean {
	if (!input.snapshot) {
		return false;
	}

	for (const agent of input.snapshot.agents) {
		if (
			isCurrentOwnerSpaceAgentMember({
				agent,
				currentOwnerUserId: input.currentOwnerUserId,
			}) &&
			(input.recoveryRefreshWindowActive ||
				input.activeWakeWaitingTargetProfileIds.has(agent.profileId)) &&
			isSpaceWakeStatusAutoRefreshable({
				agent,
				allowResolvedAgentWakeAvailabilityRefresh:
					input.recoveryRefreshWindowActive ||
					input.activeWakeWaitingTargetProfileIds.has(agent.profileId),
				autoRefreshExhaustedProfileIds: input.autoRefreshExhaustedProfileIds,
				plan: input.agentRecoveryPlansByProfileId.get(agent.profileId),
			})
		) {
			return true;
		}
	}

	return false;
}

function shouldStartPassiveLocalAgentRecoveryRefresh(input: {
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	currentOwnerUserId: string | null;
	recoveryRefreshWindowActive: boolean;
	snapshot: SpaceMembersSnapshot | null;
}): boolean {
	if (input.recoveryRefreshWindowActive || !input.snapshot) {
		return false;
	}

	for (const agent of input.snapshot.agents) {
		if (
			isCurrentOwnerSpaceAgentMember({
				agent,
				currentOwnerUserId: input.currentOwnerUserId,
			}) &&
			!input.autoRefreshExhaustedProfileIds.has(agent.profileId) &&
			isSpaceWakeStatusPassiveRefreshCandidate({
				agent,
				plan: input.agentRecoveryPlansByProfileId.get(agent.profileId),
			})
		) {
			return true;
		}
	}

	return false;
}

function resolveAutoRefreshProfileIds(input: {
	activeWakeWaitingTargetProfileIds: ReadonlySet<string>;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	attemptsByProfileId: Map<string, number>;
	currentOwnerUserId: string | null;
	recoveryRefreshWindowActive: boolean;
	snapshot: SpaceMembersSnapshot;
}): string[] {
	const refreshableProfileIds: string[] = [];
	for (const agent of input.snapshot.agents) {
		const wakeIsActive =
			input.recoveryRefreshWindowActive ||
			input.activeWakeWaitingTargetProfileIds.has(agent.profileId);
		if (
			isCurrentOwnerSpaceAgentMember({
				agent,
				currentOwnerUserId: input.currentOwnerUserId,
			}) &&
			wakeIsActive &&
			isSpaceWakeStatusAutoRefreshable({
				agent,
				allowResolvedAgentWakeAvailabilityRefresh: wakeIsActive,
				autoRefreshExhaustedProfileIds: input.autoRefreshExhaustedProfileIds,
				plan: input.agentRecoveryPlansByProfileId.get(agent.profileId),
			})
		) {
			refreshableProfileIds.push(agent.profileId);
		}
	}
	const refreshableProfileIdSet = new Set(refreshableProfileIds);
	for (const profileId of [...input.attemptsByProfileId.keys()]) {
		if (!refreshableProfileIdSet.has(profileId)) {
			input.attemptsByProfileId.delete(profileId);
		}
	}

	return refreshableProfileIds.filter((profileId) => {
		const attempts = input.attemptsByProfileId.get(profileId) ?? 0;
		return attempts < SPACE_WAKE_STATUS_AUTO_REFRESH_ATTEMPTS;
	});
}

function resolveExhaustedAutoRefreshProfileIds(input: {
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	attemptsByProfileId: Map<string, number>;
	currentOwnerUserId: string | null;
	snapshot: SpaceMembersSnapshot;
}): string[] {
	const exhaustedProfileIds: string[] = [];
	for (const agent of input.snapshot.agents) {
		if (
			isCurrentOwnerSpaceAgentMember({
				agent,
				currentOwnerUserId: input.currentOwnerUserId,
			}) &&
			isSpaceWakeStatusRefreshCandidate({
				agent,
				plan: input.agentRecoveryPlansByProfileId.get(agent.profileId),
			}) &&
			(input.attemptsByProfileId.get(agent.profileId) ?? 0) >=
				SPACE_WAKE_STATUS_AUTO_REFRESH_ATTEMPTS
		) {
			exhaustedProfileIds.push(agent.profileId);
		}
	}
	return exhaustedProfileIds;
}

function replaceSetIfChanged(
	current: ReadonlySet<string>,
	nextItems: readonly string[]
): ReadonlySet<string> {
	if (
		current.size === nextItems.length &&
		nextItems.every((item) => current.has(item))
	) {
		return current;
	}
	return new Set(nextItems);
}

function shouldOpenMembersPanelOnSpaceEntry(input: {
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	currentOwnerUserId: string | null;
	snapshot: SpaceMembersSnapshot | null;
}): boolean {
	if (!input.snapshot) {
		return false;
	}

	for (const agent of input.snapshot.agents) {
		if (
			!isCurrentOwnerSpaceAgentMember({
				agent,
				currentOwnerUserId: input.currentOwnerUserId,
			})
		) {
			continue;
		}
		const plan = input.agentRecoveryPlansByProfileId.get(agent.profileId);
		if (!plan || plan.kind === "none") {
			continue;
		}
		if (isManualOnlyAgentRecoveryPlan(plan)) {
			continue;
		}
		if (
			!input.autoRefreshExhaustedProfileIds.has(agent.profileId) &&
			isSpaceWakeStatusPassiveRefreshCandidate({ agent, plan })
		) {
			continue;
		}
		if (
			isAgentStatusUpdating({
				agent,
				autoRefreshExhaustedProfileIds: input.autoRefreshExhaustedProfileIds,
				plan,
			})
		) {
			return true;
		}
		if (isReconnectingAgentRouteRecovery({ agent, plan })) {
			continue;
		}

		return true;
	}

	return false;
}

// Builds the in-Space identity control passed to Space composers. Kept at module
// scope so SpaceLanding's body stays flat: returns the interactive switcher only
// when there is more than one human profile to switch between.
function buildSpaceProfileControl(input: {
	currentProfileId: string;
	currentProfileName: string | null;
	humanProfiles: readonly AuthProfileView[];
	navigate: ReturnType<typeof useNavigate>;
	orgSlug?: string;
	spaceId: string;
}): ReactNode {
	const orgSlug = input.orgSlug;
	if (!orgSlug || input.humanProfiles.length < 2) {
		return;
	}
	return (
		<SpaceProfileSwitcher
			currentProfileId={input.currentProfileId}
			currentProfileName={input.currentProfileName}
			humanProfiles={input.humanProfiles}
			onSelectProfile={(nextProfileId) => {
				input
					.navigate({
						replace: true,
						search: { profileId: nextProfileId },
						to: buildOrganizationSpacePath({
							orgSlug,
							spaceId: input.spaceId,
						}),
					})
					.catch((error: unknown) => {
						console.error("Failed to switch the Space profile.", error);
					});
			}}
		/>
	);
}

function isAgentStatusUpdating(input: {
	agent: SpaceMembersSnapshot["agents"][number];
	autoRefreshExhaustedProfileIds: ReadonlySet<string>;
	plan: AgentProfileReplyRecoveryPlan;
}): boolean {
	return (
		resolveSpaceWakeStatusTransientState({
			activeWakeWaitingTargetProfileIds: new Set(),
			agent: input.agent,
			autoRefreshExhaustedProfileIds: input.autoRefreshExhaustedProfileIds,
			isAgentRecoveryPending: false,
			plan: input.plan,
		}) !== null
	);
}

function isReconnectingAgentRouteRecovery(input: {
	agent: SpaceMembersSnapshot["agents"][number];
	plan: AgentProfileReplyRecoveryPlan;
}): boolean {
	const wakeRouteEvidence = resolveOwnerWakeRouteEvidence(input.agent);
	return (
		input.agent.liveNow === false &&
		wakeRouteEvidence?.status !== "unavailable" &&
		isAgentExecutionNotReady(input.agent) &&
		input.plan.kind === "review_computer" &&
		isRouteReconnectRecoveryReasonCode(input.plan.recoveryReasonCode)
	);
}

function isAgentExecutionNotReady(
	agent: SpaceMembersSnapshot["agents"][number]
): boolean {
	const readiness = resolveOwnerWakeDiagnosticsReadiness(agent);
	if (readiness) {
		return readiness.displayState !== "ready";
	}

	return true;
}

function resolveOwnerWakeDiagnosticsReadiness(
	agent: SpaceMembersSnapshot["agents"][number]
): ReturnType<
	typeof resolveSpaceMemberAgentOwnerWakeDiagnosticsView
>["agentExecutionReadiness"] {
	return resolveSpaceMemberAgentOwnerWakeDiagnosticsView(agent)
		.agentExecutionReadiness;
}

function resolveOwnerWakeRouteEvidence(
	agent: SpaceMembersSnapshot["agents"][number]
): ReturnType<
	typeof resolveSpaceMemberAgentOwnerWakeDiagnosticsView
>["wakeRouteEvidence"] {
	return resolveSpaceMemberAgentOwnerWakeDiagnosticsView(agent)
		.wakeRouteEvidence;
}

function isRouteReconnectRecoveryReasonCode(reasonCode: string): boolean {
	return (
		reasonCode === "agent_execution.route_missing" ||
		reasonCode === "agent_execution.route_offline" ||
		reasonCode === "agent_execution.route_unavailable" ||
		reasonCode === "route.not_registered" ||
		reasonCode === "route.offline" ||
		reasonCode === "route.unavailable"
	);
}

function resolveCurrentUserAvatarImageUrl(input: {
	canonicalAvatarImageUrl: string | null | undefined;
	providedAvatarImageUrl: string | null | undefined;
}): string | null {
	if (input.providedAvatarImageUrl !== undefined) {
		return input.providedAvatarImageUrl;
	}
	return input.canonicalAvatarImageUrl ?? null;
}

function useSpaceLandingCurrentUserAvatarImageUrl(
	providedAvatarImageUrl?: string | null
): string | null {
	const { data: currentAccountAvatar } = useAccountAvatar({
		enabled: providedAvatarImageUrl === undefined,
	});
	return resolveCurrentUserAvatarImageUrl({
		canonicalAvatarImageUrl: currentAccountAvatar?.avatar,
		providedAvatarImageUrl,
	});
}

function resolveInitialMembersPanelOpen(input: { spaceId: string }): boolean {
	return readSpaceMembersPanelOpen({ spaceId: input.spaceId }) ?? false;
}
