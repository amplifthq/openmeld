import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type {
	ModelCatalog,
	SpaceInboxUnreadTarget,
	SpaceInboxUnreadTargetsResponse,
	SpaceMembersSnapshot,
	SpaceThread,
	SpaceThreadPreview,
} from "@openmeld/schemas/types";
import {
	isActiveWakeProgressItem,
	type SpaceMemberDirectoryEntry,
} from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { cn } from "@openmeld/ui/lib/utils";
import { InfoIcon } from "@phosphor-icons/react";
import { useQueries } from "@tanstack/react-query";
import {
	Activity,
	Fragment,
	lazy,
	type ReactNode,
	type Ref,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type DirectMessageAccessRequest,
	DirectMessageRequestCardStatus,
	directMessageAccessRequestCopy,
	directMessageSendsRequest,
	resolveDirectMessageRequestCardStatus,
} from "#/components/agent-access/direct-message-access-request";
import {
	SpaceAgentAccessBar,
	SpaceAgentAccessPreviews,
	type SpaceAgentAccessRequestsState,
	useSpaceAgentAccessRequests,
} from "#/components/agent-access/space-agent-access-requests";
import type { SpaceAgentRequestMentions } from "#/components/agent-access/space-agent-request-mentions";
import {
	isMemberAgentIssueCard,
	MemberAgentDirectMessageCard,
	type MemberAgentDirectMessageCardState,
	useMemberAgentDirectMessageCard,
} from "#/components/member-agents/member-agent-direct-message-card";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import { useSpaceConversationOpenPaint } from "#/lib/observability/use-space-open-paint";
import { getSpaceConversationHistorySignalId } from "#/lib/space-conversation-position";
import {
	buildActiveWakeConversationItems,
	isWakeProgressInConversation,
	resolveWakeReplyThreadRoot,
} from "#/lib/spaces/active-wake-conversation";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import type { ComposerFileDraftCleanup } from "#/lib/spaces/composer-file-drafts";
import type { SpaceConversationVisibleStreamProjection } from "#/lib/spaces/conversation-stream";
import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import { useHistorySliderPreference } from "#/lib/spaces/history-slider-preference";
import {
	buildAnchoredSpaceOutcomeNoticesBySourceSignalId,
	buildSpaceConversationEntries,
	type SpaceConversationEntry,
} from "#/lib/spaces/presentation";
import {
	isSpaceOutcomeNoticeItem,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import type { WakeFailureTargetContext } from "#/lib/spaces/wake-failure-display";
import {
	buildWakeProblemSourceSignalIds,
	resolveSpaceMessageWakeProgressState,
} from "#/lib/spaces/wake-progress-presentation";
import {
	buildSpaceWakeOutcomeIndex,
	resolveSpaceMessageWakeStopTarget,
	type SpaceWakeOutcomeIndex,
	type SpaceWakeStopRequestStatus,
} from "#/lib/spaces/wake-stop-target";
import { SPACE_INITIAL_HISTORY_MAX_MESSAGES } from "#/query/spaces/history";
import { spaceMessageDetailsQueryOptions } from "#/query/spaces/message-details";
import {
	type CenterAgentComputerSetupContext,
	resolveLatestComputerSetupActionSignalId,
} from "./center-agent-computer-setup-card";
import { CenterAgentDirectMessageIntro } from "./center-agent-direct-message-intro";
import type { OnboardingSetupPresentation } from "./onboarding-setup-presentation";
import { Marker, MarkerContent, MarkerIcon } from "./primitives/marker";
import {
	MessageScroller,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "./primitives/message-scroller";
import {
	readRecalledReplyTarget,
	restoreRecalledMessage,
} from "./restore-recalled-message";
import type { SpaceAgentInteractionResponseHandler } from "./space-agent-interaction-card";
import {
	resolveSpaceAgentInteractionPlacement,
	type SpaceAgentInteractionPlacement,
} from "./space-agent-interaction-placement";
import type { SpaceAgentProfileBindingRecoveryPlan } from "./space-agent-recovery-action";
import {
	buildSpaceCollaborationProfilePresentations,
	buildSpaceMemberDirectoryEntryByProfileId,
	buildWakeStopTargetLabelsByProfileId,
	type SpaceCollaborationProfilePresentation,
} from "./space-collaboration-profile";
import {
	resolveSpaceComposerSendBlocked,
	SpaceComposer,
	type SpaceComposerProps,
} from "./space-composer";
import {
	resolveSpaceComposerConversationKind,
	type SpaceAutomaticWakeComposerHintKind,
	type SpaceComposerConversationKind,
} from "./space-composer-copy";
import type { SpaceComposerSendOptions } from "./space-composer-device-wait";
import type {
	SpaceComposerEditorChange,
	SpaceComposerInputRef,
} from "./space-composer-editor";
import { SpaceComposerReplyBanner } from "./space-composer-reply-banner";
import { buildSpaceTaskSources } from "./space-composer-task-menu";
import { SpaceConversationCompactionMarker } from "./space-conversation-compaction-marker";
import { resolveLocalDateKey } from "./space-conversation-date";
import { SpaceConversationDateMarker } from "./space-conversation-date-marker";
import {
	getSpaceMessageJumpSpacer,
	SpaceConversationSendScrollController,
	type SpaceMessageScrollAction,
	SpaceMessageScrollController,
	scrollMessageIntoConversationViewport,
} from "./space-conversation-scroll-controller";
import { buildSpaceConversationScrollRestorationId } from "./space-conversation-scroll-restoration";
import { SpaceConversationSkeleton } from "./space-conversation-skeleton";
import { SpaceConversationStickyDate } from "./space-conversation-sticky-date";
import {
	type ComposeExpiredDeviceWait,
	SpaceDeviceWaitOutcomeScope,
} from "./space-device-wait-outcome";
import type { SpaceExecutionRecoveryHandler } from "./space-execution-recovery-actions";
import type { SpaceGraphFocusRequest } from "./space-graph";
import { buildSpaceGraphPresentation } from "./space-graph-presentation";
import { SpaceHistoryJumpControl } from "./space-history-jump-control";
import { SpaceHistoryRail } from "./space-history-rail";
import { SpaceInputQueue } from "./space-input-queue";
import { SPACE_MESSAGE_ROW_LAYOUT_CLASS } from "./space-message-bubble-style";
import { SpaceMessageDetailsDrawer } from "./space-message-details-drawer";
import { resolveMessageDetailsDiagnosticReportStatus } from "./space-message-details-presentation";
import {
	SpaceMessageEditingScope,
	useOptimisticSpaceMessages,
} from "./space-message-editing";
import {
	SpaceMessageReadObserver,
	spaceMessageReadSourceAt,
} from "./space-message-read-observer";
import type { SpaceMessageReferencesById } from "./space-message-reference";
import {
	buildThreadSignalIds,
	readMessageDetailsProgressEntries,
	resolveCenterAgentComputerSetupContext,
	resolveReplyItemsForMessage,
	SpaceMessageRun,
} from "./space-message-run";
import {
	resolveSpaceMessageStateTuningVisibility,
	useSpaceMessageStateTuningPreviewItems,
} from "./space-message-state-tuning-preview";
import { SpaceOutcomeRow } from "./space-outcome-row";
import { resolveSpaceOutcomeRowTone } from "./space-outcome-tone";
import { SpaceGraphSkeleton } from "./space-panel-skeletons";
import { SpacePinnedItemsBar } from "./space-pins";
import { useSpaceReadingHeader } from "./space-reading-header";
import { SpaceTaskReferencesProvider } from "./space-task-references";
import { SpaceConversationUnreadControl } from "./space-unread-control";
import { getSpaceViewIndex, type SpaceView } from "./space-view";
import { SpaceWakeRecommendationScope } from "./space-wake-recommendation";
import {
	type SpaceWakeStopRequestHandler,
	SpaceWakeStopScope,
} from "./space-wake-stop-control";
import { SpaceComposerWorkBookmarks } from "./space-work-bookmarks";
import { useSpaceComposerTraySpace } from "./use-space-composer-region";
import {
	type SpaceConversationRestorationStatus,
	useSpaceConversationPosition,
} from "./use-space-conversation-position";
import { useSpaceConversationRenderWindow } from "./use-space-conversation-render-window";
import { useSpaceGraphLayout } from "./use-space-graph-layout";
import type { SpaceHistoryNavigationController } from "./use-space-history-navigation";
import type {
	SpaceComposerAddressingTarget,
	SpaceMentionPickerItem,
} from "./use-space-mention-authoring";
import { useSpaceMessageTaskAction } from "./use-space-message-task-action";

const SpaceGraph = lazy(() =>
	import("./space-graph").then((module) => ({ default: module.SpaceGraph }))
);

type SpaceConversationPanelResolvedProps = {
	organizationId?: string | null;
	agentStreams?: readonly SpaceConversationVisibleStreamProjection[];
	historyNavigation?: SpaceHistoryNavigationController;
	activeSpaceView: SpaceView;
	allowedActions: readonly string[];
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	centerAgentProfileId: string | null;
	className?: string;
	composerPrimaryAction?: ReactNode;
	composerErrorMessage: string | null;
	composerMembers?: SpaceComposerProps["members"];
	composerFiles: readonly SpaceComposerFile[];
	composerFileLimitReached: boolean;
	composerAddressingTargets?: readonly SpaceComposerAddressingTarget[];
	composerAuthoredMentions?: readonly ComposerDraftAuthoredMention[];
	composerMentionPickerItems?: readonly SpaceMentionPickerItem[];
	composerAgentRequestMentions?: SpaceAgentRequestMentions;
	composerMentionEmptyMessage?: string;
	composerBlockedWakeProfileId: string | null;
	composerHasAuthoredMentions?: boolean;
	composerReplyToSignalId: string | null;
	composerText: string;
	profileControl?: ReactNode;
	currentOwnerUserId: string | null;
	wakeFailureTargetContextsByProfileId: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	wakeStopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	emptyStateDescription?: string | null;
	emptyStateAlignment?: "start" | "center";
	emptyStateTitle?: string;
	/** A teammate's Agent that asks its owner first; the first message is the request. */
	directMessageAccessRequest?: DirectMessageAccessRequest | null;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	firstUnreadSignalId: string | null;
	files?: ReactNode;
	guide?: ReactNode;
	tasks?: ReactNode;
	hasEarlierHistory: boolean;
	historyActionErrorMessage: string | null;
	historyErrorMessage: string | null;
	historyIsPending: boolean;
	actionableAgentInteractionPlacement?: SpaceAgentInteractionPlacement;
	initialFocusInteractionId?: string;
	initialFocusRequestId?: string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	automaticWakeConversationKind?: SpaceAutomaticWakeComposerHintKind | null;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
	isPersonalContext?: boolean;
	isAgentRecoveryPending: (profileId: string) => boolean;
	isLoadingEarlierHistory: boolean;
	isDiagnosticReportPending: (signalId: string) => boolean;
	isDiagnosticReportSent: (signalId: string) => boolean;
	isSendingMessage: boolean;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	onComposerEditorChange: (change: SpaceComposerEditorChange) => void;
	onPrepareMarkAllRead?: () => Promise<{
		unreadCount: number;
		commit: () => Promise<void>;
	}>;
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onAddPeopleOrAgents?: () => void;
	onClearComposerReplyTo: () => void;
	onLoadEarlierHistory: () => Promise<void>;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onJumpToDate?: (date: Date) => Promise<string | null>;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onOpenThread: (threadId: string) => void;
	onOpenUnreadThread?: (input: {
		rootSignalId: string;
		signalId: string;
		threadId?: string;
	}) => boolean | Promise<boolean>;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onReplyToMessage: (item: SpaceTimelineItem) => void;
	onComposeExpiredDeviceWait?: ComposeExpiredDeviceWait;
	onRemoveComposerFile: (localId: string) => void;
	onRetryComposerFile?: (localId: string) => Promise<void>;
	onRetryComposerFileCleanup?: (localId: string) => Promise<void>;
	onRetryComposerFileRestoration?: () => void;
	composerFileCleanup?: readonly ComposerFileDraftCleanup[];
	composerFileRestorationError?: unknown | null;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onAddMessageToTasks?: (
		item: SpaceTimelineItem,
		threadId: string | null
	) => void;
	taskCreationSourceSignalId?: string | null;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	onMentionButtonClick: () => void;
	onSend: (options?: SpaceComposerSendOptions) => Promise<void>;
	onSendStarterPrompt: (prompt: string) => Promise<void>;
	onOpenTask?: (taskId: string) => void;
	onSpaceViewChange: (view: SpaceView) => void;
	orgSlug?: string;
	// The shared observer acknowledges only visible Core unread targets.
	onViewedUpdates?: (
		targets: readonly SpaceInboxUnreadTarget[]
	) => Promise<void> | void;
	prepareSetupHref?: string;
	pendingActionSurface?: ReactNode;
	liveNotice?: ReactNode;
	readOnly?: boolean;
	readOnlyComposerPlaceholder?: string;
	/** Membership is still loading; the composer shows a neutral bar. */
	composerAccessPending?: boolean;
	/** Composer trays wait to appear together; see useSpaceComposerTraysHeld. */
	composerTraysHeld?: boolean;
	allowSendWhileAccessSettles?: boolean;
	renderSetupGuidance?: (
		presentation: OnboardingSetupPresentation
	) => ReactNode;
	selfProfileId: string;
	selfAvatarImageUrl?: string | null;
	spaceId?: string;
	spaceViewIdPrefix: string;
	spaceReferencesById?: SpaceMessageReferencesById;
	textareaRef: SpaceComposerInputRef;
	threads: readonly SpaceThread[];
	threadsErrorMessage?: string | null;
	threadsIsLoading?: boolean;
	threadPreviews: readonly SpaceThreadPreview[];
	isCreatingThread: boolean;
	timelineItems: readonly SpaceTimelineItem[];
	unreadTargets?: readonly SpaceInboxUnreadTarget[];
	unreadScopes?: SpaceInboxUnreadTargetsResponse["scopes"];
	unreadCount: number;
	unreadStateReady: boolean;
};

type SpaceConversationPanelViewState = Pick<
	SpaceConversationPanelResolvedProps,
	| "composerFileLimitReached"
	| "composerHasAuthoredMentions"
	| "hasEarlierHistory"
	| "historyIsPending"
	| "isCenterAgentDirectMessage"
	| "isCreatingThread"
	| "isDirectMessage"
	| "isLoadingEarlierHistory"
	| "isPersonalContext"
	| "isSendingMessage"
	| "readOnly"
	| "composerAccessPending"
	| "composerTraysHeld"
	| "threadsIsLoading"
	| "unreadStateReady"
>;

type SpaceConversationPanelProps = Omit<
	SpaceConversationPanelResolvedProps,
	keyof SpaceConversationPanelViewState
> & {
	viewState: SpaceConversationPanelViewState;
};

const SPACE_CONVERSATION_END_THRESHOLD_PX = 48;

type SpaceSetupGuidanceSlots = {
	banner: ReactNode;
	emptyStateActions: ReactNode;
};

function resolveSpaceSetupGuidanceSlots(input: {
	hasConversationEntries: boolean;
	renderSetupGuidance?: (
		presentation: OnboardingSetupPresentation
	) => ReactNode;
}): SpaceSetupGuidanceSlots {
	if (!input.renderSetupGuidance) {
		return { banner: null, emptyStateActions: null };
	}
	if (input.hasConversationEntries) {
		return {
			banner: input.renderSetupGuidance("banner"),
			emptyStateActions: null,
		};
	}
	return {
		banner: null,
		emptyStateActions: input.renderSetupGuidance("empty-state"),
	};
}

function resolveWritableSpaceAction<T>(
	isReadOnly: boolean,
	action: T | undefined
): T | undefined {
	if (isReadOnly) {
		return undefined;
	}
	return action;
}

/** Live request previews belong after the newest loaded message only. */
function showsLatestConversation(input: {
	historyIsPending?: boolean;
	historyNavigation?: SpaceHistoryNavigationController;
}): boolean {
	return !(
		input.historyIsPending || input.historyNavigation?.activeWindow?.hasAfter
	);
}

function shouldRenderSpaceComposer(input: {
	activeView: SpaceView;
	isReadOnly: boolean;
	showComposerWhenReadOnly: boolean;
}): boolean {
	return (
		input.activeView === "messages" &&
		(!input.isReadOnly || input.showComposerWhenReadOnly)
	);
}

function resolveConversationComposerContext(input: {
	automaticWakeConversationKind?: SpaceAutomaticWakeComposerHintKind | null;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
}): SpaceComposerConversationKind {
	return resolveSpaceComposerConversationKind({
		hasAutomaticWakeTarget: Boolean(input.automaticWakeConversationKind),
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		isDirectMessage: input.isDirectMessage,
	});
}

export function SpaceConversationPanel(
	publicInput: SpaceConversationPanelProps
) {
	const content = (
		<SpaceWakeStopScope
			key={`${publicInput.spaceId}:${publicInput.selfProfileId}`}
			progressItems={publicInput.ephemeralActivityItems}
			stopRequestStatusBySelectorKey={
				publicInput.wakeStopRequestStatusBySelectorKey
			}
		>
			<SpaceMessageEditingScope
				draftKey={JSON.stringify([
					publicInput.composerText,
					publicInput.composerFiles,
					publicInput.composerReplyToSignalId,
				])}
				hasDraft={Boolean(
					publicInput.composerText ||
						publicInput.composerFiles.length ||
						publicInput.composerReplyToSignalId
				)}
				mentionPickerItems={publicInput.composerMentionPickerItems}
				onRestore={async (message, canReplaceDraft) => {
					const target = await readRecalledReplyTarget(
						message,
						publicInput.selfProfileId,
						publicInput.timelineItems
					);
					await restoreRecalledMessage({
						...publicInput,
						message,
						canReplaceDraft,
					});
					if (target) {
						publicInput.onReplyToMessage(target);
					} else {
						publicInput.onClearComposerReplyTo();
					}
				}}
				orgSlug={publicInput.orgSlug}
				readOnly={publicInput.viewState.readOnly}
				selfProfileId={publicInput.selfProfileId}
			>
				<SpaceWakeRecommendationScope
					items={publicInput.timelineItems}
					orgSlug={publicInput.orgSlug}
					selfProfileId={publicInput.selfProfileId}
					spaceId={publicInput.spaceId}
				>
					<SpaceDeviceWaitOutcomeScope
						onComposeAgain={
							publicInput.viewState.readOnly
								? undefined
								: publicInput.onComposeExpiredDeviceWait
						}
					>
						<SpaceConversationPanelContent {...publicInput} />
					</SpaceDeviceWaitOutcomeScope>
				</SpaceWakeRecommendationScope>
			</SpaceMessageEditingScope>
		</SpaceWakeStopScope>
	);
	return (
		<SpaceTaskReferencesProvider
			disabled={false}
			onOpen={(taskId) => publicInput.onOpenTask?.(taskId)}
			organizationSlug={publicInput.orgSlug}
			profileId={publicInput.selfProfileId}
			spaceId={publicInput.spaceId}
		>
			{content}
		</SpaceTaskReferencesProvider>
	);
}

function SpaceConversationPanelContent(
	publicInput: SpaceConversationPanelProps
) {
	const readingHeader = useSpaceReadingHeader();
	const { viewState, ...props } = publicInput;
	const timelineItems = useOptimisticSpaceMessages(props.timelineItems);
	const taskAction = useSpaceMessageTaskAction({
		disabled: false,
		openMeldProfileId: props.selfProfileId,
		organizationSlug: props.orgSlug,
		spaceId: props.spaceId,
	});
	const input: SpaceConversationPanelResolvedProps = {
		...props,
		...viewState,
		onAddMessageToTasks: taskAction.onAdd,
		taskCreationSourceSignalId: taskAction.pendingSourceSignalId,
		timelineItems,
	};
	const presentation = useSpaceConversationPresentationController(input);
	const {
		canSendMessage,
		canUploadFiles,
		composerContext,
		composerSendBlocked,
		composerTargetName,
		conversationTopOverlayElement,
		entries,
		isReadOnly,
		loadedMainTimelineSignalIds,
		mainTimelineItems,
		messageDetailsItem,
		messageDetailsProgressEntries,
		messageDetailsReplyItems,
		messageDetailsWakeStopTarget,
		onOpenThread,
		onReportMessage,
		onViewMessageInGraph,
		profilePresentationsById,
		setConversationTopOverlayElement,
		setMessageDetailsItem,
		showComposer,
		spaceGraph,
		spaceGraphFocusRequest,
		spaceGraphLayout,
		threadsByRootSignalId,
		wakeStopTargetLabelsByProfileId,
	} = presentation;
	useSpaceConversationOpenPaint({
		spaceId: input.spaceId,
		messagesVisible: input.activeSpaceView === "messages",
		historyPending: input.historyIsPending,
		historyError: Boolean(input.historyErrorMessage),
		hasMessages: entries.length > 0,
		canEdit: canSendMessage,
		showComposer,
	});
	const navigation = useSpaceConversationNavigationController({
		activeSpaceView: input.activeSpaceView,
		entries,
		historyWindowIdentity: input.historyNavigation?.activeWindow?.identity,
		isLiveHistory: !input.historyNavigation?.activeWindow,
		ephemeralActivityItems: input.ephemeralActivityItems,
		hasEarlierHistory: input.hasEarlierHistory,
		historyActionErrorMessage: input.historyActionErrorMessage,
		historyIsPending: input.historyIsPending,
		initialFocusInteractionId: input.initialFocusInteractionId,
		initialFocusRequestId: input.initialFocusRequestId,
		initialFocusSignalId: input.initialFocusSignalId,
		initialFocusThreadRootSignalId: input.initialFocusThreadRootSignalId,
		isLoadingEarlierHistory: input.isLoadingEarlierHistory,
		mainTimelineItems,
		onLoadEarlierHistory: input.onLoadEarlierHistory,
		onLoadHistoryAround: input.historyNavigation?.open,
		onOpenThread,
		onOpenUnreadThread: input.onOpenUnreadThread,
		onSpaceViewChange: input.onSpaceViewChange,
		selfProfileId: input.selfProfileId,
		spaceId: input.spaceId,
		spaceViewIdPrefix: input.spaceViewIdPrefix,
		threadsByRootSignalId,
		threadsErrorMessage: input.threadsErrorMessage,
		threadsIsLoading: input.threadsIsLoading === true,
		unreadTargets: input.unreadTargets ?? [],
	});
	const {
		conversationAutoScroll,
		conversationDefaultScrollPosition,
		conversationRestorationStatus,
		conversationScrollElement,
		messageScrollActionRef,
		followLatest,
		latestNavigationRequest,
		releaseReadingPosition,
		loadEarlierConversation,
		loadEarlierHistory,
		mainFocusStatusMessage,
		onConversationScroll,
		onConversationScrollEnd,
		onJumpToMessage,
		registerConversationScrollElement,
		renderWindow,
		revealUnreadTarget,
	} = navigation;
	const registerReadingScrollElement = useCallback(
		(element: HTMLDivElement | null) => {
			registerConversationScrollElement(element);
			readingHeader?.setScrollElement(element);
		},
		[readingHeader, registerConversationScrollElement]
	);
	const supportsHistoryRail = useMediaQuery(
		"(min-width: 640px) and (hover: hover) and (pointer: fine)"
	);
	const historySlider = useHistorySliderPreference();
	const showHistoryRail =
		historySlider.enabled &&
		supportsHistoryRail &&
		input.activeSpaceView === "messages" &&
		(input.historyNavigation?.directory?.total ?? 0) >
			SPACE_INITIAL_HISTORY_MAX_MESSAGES;
	const setupGuidance = resolveSpaceSetupGuidanceSlots({
		hasConversationEntries: entries.length > 0,
		renderSetupGuidance: input.renderSetupGuidance,
	});
	const memberAgentCard = useMemberAgentDirectMessageCard({
		isCenterAgentDirectMessage:
			presentation.messageStateTuningVisibility.isCenterAgentDirectMessage,
		isDirectMessage: input.isDirectMessage,
		readOnly: isPossibleConversationObserver(input),
		hasMessages: entries.length > 0,
		membersSnapshot: input.membersSnapshot,
		modelCatalog: input.modelCatalog,
		profileEntriesById: presentation.profileEntriesById,
	});
	const agentAccess = useSpaceAgentAccessRequests(input.spaceId);
	const requestCard = useDirectMessageRequestCard({
		agentAccess,
		loadedSignalIds: loadedMainTimelineSignalIds,
		request: input.directMessageAccessRequest,
	});
	const conversationBody = renderPanelConversationBody({
		emptyStateActions: setupGuidance.emptyStateActions,
		memberAgentCard,
		messageFootersBySignalId: requestCard.footersBySignalId,
		input,
		navigation,
		presentation,
	});
	const restorationPresentation = resolveConversationRestorationPresentation({
		historyIsPending: input.historyIsPending,
		onViewedUpdates: input.onViewedUpdates,
		status: conversationRestorationStatus,
	});
	const submitComposer = (options?: SpaceComposerSendOptions) => {
		const blocked = resolveSpaceComposerSendBlocked({
			files: input.composerFiles,
			text: input.composerText || options?.taskDraft?.title || "",
		});
		if (blocked || !canSendMessage || input.isSendingMessage) {
			return;
		}
		input.onSend(options).catch((error) => {
			console.error("Failed to send a space message from composer.", error);
		});
	};
	return (
		<section
			aria-label="Space conversation"
			className={cn(
				"flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
				input.className
			)}
			data-space-history-rail={showHistoryRail}
		>
			<SpaceHistoryErrorBanner
				message={input.historyActionErrorMessage ?? input.historyErrorMessage}
				navigation={input.historyNavigation}
			/>
			{renderInitialSpaceFocusStatus({
				mainMessage:
					input.historyNavigation?.error ||
					input.historyNavigation?.pending ||
					input.historyNavigation?.notice
						? null
						: mainFocusStatusMessage,
				historyNotice: input.historyNavigation?.notice,
			})}
			{input.activeSpaceView === "messages" ? (
				<SpacePinnedItemsBar
					onJump={navigation.onJumpToPinnedMessage}
					onOpen={input.onOpenSpaceFile}
				/>
			) : null}

			<SpacePrimaryView
				activeView={input.activeSpaceView}
				files={input.files}
				graph={
					spaceGraph ? (
						<Suspense fallback={<SpaceGraphSkeleton />}>
							<SpaceGraph
								focusRequest={spaceGraphFocusRequest}
								graph={spaceGraph}
								hasEarlierHistory={input.hasEarlierHistory}
								isLoadingEarlierHistory={input.isLoadingEarlierHistory}
								nodePositions={spaceGraphLayout.nodePositions}
								onLoadEarlierHistory={() => {
									loadEarlierHistory().catch((error) => {
										console.error(
											"Failed to load earlier activity in the Space Graph.",
											error
										);
									});
								}}
								onNodePositionChange={spaceGraphLayout.onNodePositionChange}
								onOpenMessageDetails={setMessageDetailsItem}
								onResetNodePositions={spaceGraphLayout.onResetNodePositions}
							/>
						</Suspense>
					) : null
				}
				guide={input.guide}
				idPrefix={input.spaceViewIdPrefix}
				messages={
					<MessageScrollerProvider
						autoScroll={
							input.historyNavigation?.activeWindow
								? false
								: conversationAutoScroll
						}
						defaultScrollPosition={conversationDefaultScrollPosition}
						key={buildSpaceConversationScrollRestorationId(
							input.spaceId ?? input.spaceViewIdPrefix
						)}
						scrollEdgeThreshold={SPACE_CONVERSATION_END_THRESHOLD_PX}
					>
						{input.liveNotice}
						<SpaceConversationSendScrollController
							isSendingMessage={input.isSendingMessage}
							onSendStart={followLatest}
						/>
						<SpaceMessageScrollController
							actionRef={messageScrollActionRef}
							latestMessageId={
								input.historyNavigation?.activeWindow
									? null
									: mainTimelineItems.at(-1)?.id
							}
							latestNavigationRequest={latestNavigationRequest}
							scrollElement={conversationScrollElement}
						/>
						<MessageScroller className="relative min-h-0 flex-1">
							{input.historyNavigation && (
								<SpaceHistoryRail
									controller={input.historyNavigation}
									items={mainTimelineItems}
									onFollowLatest={followLatest}
									onJumpToMessage={onJumpToMessage}
									onNavigateStart={releaseReadingPosition}
									renderNavigation={(history) => (
										<SpaceHistoryJumpControl history={history} />
									)}
									scrollElement={conversationScrollElement}
									visible={showHistoryRail}
								/>
							)}

							<SpaceConversationTopOverlay
								overlayRef={setConversationTopOverlayElement}
							>
								{setupGuidance.banner}
							</SpaceConversationTopOverlay>
							<MessageScrollerViewport
								aria-busy={
									input.isLoadingEarlierHistory || restorationPresentation.busy
								}
								aria-hidden={restorationPresentation.ariaHidden}
								aria-label="Conversation history"
								aria-live="polite"
								className={restorationPresentation.className}
								data-scroll-restoration-id={buildSpaceConversationScrollRestorationId(
									input.spaceId ?? input.spaceViewIdPrefix
								)}
								inert={restorationPresentation.inert}
								onScroll={(event) => {
									const conversationScrollElement = event.currentTarget;
									onConversationScroll(conversationScrollElement);
									const historyWindow = input.historyNavigation?.activeWindow;
									if (
										historyWindow?.confirmedAtLiveTail &&
										!historyWindow.hasAfter &&
										!getSpaceMessageJumpSpacer(conversationScrollElement) &&
										conversationScrollElement.scrollHeight -
											conversationScrollElement.clientHeight -
											conversationScrollElement.scrollTop <=
											SPACE_CONVERSATION_END_THRESHOLD_PX
									) {
										input.historyNavigation?.latest();
										followLatest();
									}
									// Mount loaded history a viewport ahead of the reader, and
									// only fetch more once every loaded entry is mounted.
									if (
										renderWindow.hasHiddenEntries &&
										conversationScrollElement.scrollTop <=
											conversationScrollElement.clientHeight
									) {
										renderWindow.revealEarlier();
										return;
									}
									if (conversationScrollElement.scrollTop > 48) {
										return;
									}

									loadEarlierConversation().catch((error) => {
										console.error(
											"Failed to lazy-load earlier space history from scroll.",
											error
										);
									});
								}}
								onScrollEnd={(event) => {
									onConversationScrollEnd(event.currentTarget);
								}}
								ref={registerReadingScrollElement}
								role="log"
							>
								<SpaceMessageReadObserver
									key={`${input.spaceId}:${input.selfProfileId}`}
									onViewedUpdates={restorationPresentation.onViewedUpdates}
									unreadTargets={(input.unreadTargets ?? []).filter(
										(target) => target.threadRootSignalId === null
									)}
								/>
								<SpaceConversationStickyDate
									afterDate={
										<SpaceConversationUnreadControl
											count={input.unreadCount}
											firstUnreadSignalId={input.firstUnreadSignalId}
											key={`${input.spaceId}:${input.selfProfileId}`}
											onNavigate={revealUnreadTarget}
											onPrepareMarkAllRead={input.onPrepareMarkAllRead}
											targets={input.unreadTargets ?? []}
										/>
									}
									leadingDateMs={resolveConversationLeadingDateMs(
										entries,
										renderWindow.startIndex
									)}
									loadedSignalCount={loadedMainTimelineSignalIds.size}
									onJumpToDate={input.onJumpToDate}
									scrollElement={conversationScrollElement}
									topOverlayElement={conversationTopOverlayElement}
								/>
								<MessageScrollerContent
									className="w-full gap-0 pt-[var(--space-conversation-top-overlay-height,0px)]"
									data-space-conversation-content-width=""
								>
									{conversationBody}
									<SpaceAgentAccessPreviews
										showsLatestMessages={showsLatestConversation(input)}
										state={agentAccess}
									/>
									<LoadNewerMessagesControl
										history={input.historyNavigation}
										scrollElement={conversationScrollElement}
									/>
								</MessageScrollerContent>
							</MessageScrollerViewport>
							{!input.historyNavigation && <SpaceHistoryJumpControl />}
						</MessageScroller>
					</MessageScrollerProvider>
				}
				tasks={input.tasks}
			/>

			{showComposer ? (
				<SpaceComposerSection
					agentRequests={
						<SpaceAgentAccessBar
							previewsVisible={showsLatestConversation(input)}
							state={requestCard.barState}
						/>
					}
					canSendMessage={canSendMessage}
					canUploadFiles={canUploadFiles}
					composerContext={composerContext}
					composerSendBlocked={composerSendBlocked}
					composerTargetName={composerTargetName}
					input={input}
					profilePresentationsById={profilePresentationsById}
					recoveryShownInConversation={isMemberAgentIssueCard(memberAgentCard)}
					submitComposer={submitComposer}
				/>
			) : null}
			{messageDetailsItem && input.spaceId ? (
				<SpaceMessageDetailsDrawer
					agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
					canJumpToMessage={(signalId) =>
						loadedMainTimelineSignalIds.has(signalId)
					}
					canStartNewTask={canSendMessage}
					diagnosticReportStatus={resolveMessageDetailsDiagnosticReportStatus({
						isPending: input.isDiagnosticReportPending(messageDetailsItem.id),
						isSent: input.isDiagnosticReportSent(messageDetailsItem.id),
					})}
					errorLogMessage="Failed to report a space message."
					isAgentRecoveryPending={input.isAgentRecoveryPending}
					isPersonalContext={input.isPersonalContext}
					item={messageDetailsItem}
					onAgentRecoveryAction={input.onAgentRecoveryAction}
					onJumpToMessage={onJumpToMessage}
					onOpenChange={(open) => {
						if (!open) {
							setMessageDetailsItem(null);
						}
					}}
					onRecoverExecution={resolveWritableSpaceAction(
						isReadOnly,
						input.onRecoverExecution
					)}
					onReportMessage={onReportMessage}
					onViewInGraph={onViewMessageInGraph}
					onWakeStopRequest={input.onWakeStopRequest}
					open={true}
					openMeldProfileId={input.selfProfileId}
					orgSlug={input.orgSlug}
					prepareSetupHref={input.prepareSetupHref}
					profilePresentationsById={profilePresentationsById}
					replyItems={messageDetailsReplyItems}
					spaceId={input.spaceId}
					spaceReferencesById={input.spaceReferencesById}
					targetProfileDisplayNamesByProfileId={wakeStopTargetLabelsByProfileId}
					wakeFailureTargetContextsByProfileId={
						input.wakeFailureTargetContextsByProfileId
					}
					wakeIssueEntries={messageDetailsProgressEntries.issueEntries}
					wakeProgressEntries={messageDetailsProgressEntries.thinkingEntries}
					wakeStopTarget={messageDetailsWakeStopTarget}
				/>
			) : null}
		</section>
	);
}

function SpaceHistoryErrorBanner({
	message,
	navigation,
}: {
	message?: string | null;
	navigation?: SpaceHistoryNavigationController;
}) {
	if (!message) {
		return null;
	}
	return (
		<div
			className="flex items-center justify-between gap-3 border-border border-b bg-destructive/10 px-4 py-3 text-destructive text-sm sm:px-5"
			role="alert"
		>
			<span>{message}</span>
			{navigation?.error && navigation.retry && (
				<Button
					className="shrink-0"
					disabled={navigation.pending}
					onClick={() => navigation.retry?.()}
					size="sm"
					variant="outline"
				>
					{navigation.pending ? "Retrying…" : "Retry"}
				</Button>
			)}
		</div>
	);
}

function renderPanelConversationBody(input: {
	emptyStateActions: ReactNode;
	memberAgentCard: MemberAgentDirectMessageCardState | null;
	messageFootersBySignalId: ReadonlyMap<string, ReactNode>;
	input: SpaceConversationPanelResolvedProps;
	navigation: ReturnType<typeof useSpaceConversationNavigationController>;
	presentation: ReturnType<typeof useSpaceConversationPresentationController>;
}): ReactNode {
	const panel = input.input;
	const navigation = input.navigation;
	const presentation = input.presentation;
	return renderConversationBody({
		memberAgentCard: input.memberAgentCard,
		messageFootersBySignalId: input.messageFootersBySignalId,
		threadStreamsByRootSignalId: presentation.threadStreamsByRootSignalId,
		agentRecoveryPlansByProfileId: panel.agentRecoveryPlansByProfileId,
		anchoredOutcomeNoticesBySourceSignalId:
			presentation.anchoredOutcomeNoticesBySourceSignalId,
		centerAgentProfileId: panel.centerAgentProfileId,
		computerSetupContext: resolveCenterAgentComputerSetupContext({
			isCenterAgentDirectMessage: panel.isCenterAgentDirectMessage,
			orgSlug: panel.orgSlug,
			profileId: panel.selfProfileId,
			spaceId: panel.spaceId,
		}),
		currentOwnerUserId: panel.currentOwnerUserId,
		emptyStateActions: input.emptyStateActions,
		emptyStateDescription: panel.emptyStateDescription,
		emptyStateAlignment: panel.emptyStateAlignment,
		emptyStateTitle: panel.emptyStateTitle,
		entries: presentation.entries,
		entriesStartIndex: navigation.renderWindow.startIndex,
		// A continuation badge belongs to its source even before reply placement is known.
		addressingWakeProgressItems: panel.ephemeralActivityItems,
		ephemeralActivityItems: presentation.mainActivityItems,
		firstUnreadSignalId: panel.firstUnreadSignalId,
		historyIsPending: panel.historyIsPending,
		actionableAgentInteractionPlacement: resolveSpaceAgentInteractionPlacement(
			panel.actionableAgentInteractionPlacement
		),
		isAgentRecoveryPending: panel.isAgentRecoveryPending,
		isDirectMessage: panel.isDirectMessage,
		isCenterAgentDirectMessage:
			presentation.messageStateTuningVisibility.isCenterAgentDirectMessage,
		isSendingMessage: panel.isSendingMessage,
		isCreatingThread: panel.isCreatingThread,
		isPersonalContext: panel.isPersonalContext === true,
		loadedMainTimelineSignalIds: presentation.loadedMainTimelineSignalIds,
		membersSnapshot: panel.membersSnapshot,
		modelCatalog: panel.modelCatalog,
		onAgentRecoveryAction: presentation.onAgentRecoveryAction,
		onAgentInteractionResponse: panel.onAgentInteractionResponse,
		onCreateThread: presentation.onCreateThread,
		onJumpToDate: panel.onJumpToDate,
		onJumpToMessage: navigation.onJumpToMessage,
		onOpenMessageDetails: presentation.setMessageDetailsItem,
		onOpenThread: navigation.onOpenThread,
		onOpenSpaceFile: panel.onOpenSpaceFile,
		onAddMessageToTasks: panel.onAddMessageToTasks,
		onReplyToMessage: presentation.onReplyToMessage,
		onReportMessage: presentation.onReportMessage,
		onRecoverExecution: presentation.messageDetailsItem
			? undefined
			: panel.onRecoverExecution,
		onSendStarterPrompt: panel.onSendStarterPrompt,
		onDraftStarterPrompt: (prompt: string) => {
			const text = panel.composerText
				? `${panel.composerText}\n\n${prompt}`
				: prompt;
			panel.onComposerEditorChange({
				text,
				authoredMentions: [...(panel.composerAuthoredMentions ?? [])],
				selection: { start: text.length, end: text.length },
			});
			panel.textareaRef.current?.focus();
		},
		onStartComputerSetup: () => presentation.setStarterComputerSetupOpen(true),
		onCloseComputerSetup: () => presentation.setStarterComputerSetupOpen(false),
		onWakeStopRequest: panel.onWakeStopRequest
			? presentation.onWakeStopRequest
			: undefined,
		orgSlug: panel.orgSlug,
		prepareSetupHref: panel.prepareSetupHref,
		profileEntriesById: presentation.profileEntriesById,
		profilePresentationsById: presentation.profilePresentationsById,
		readOnly: presentation.isReadOnly,
		showCenterAgentStarterActions:
			presentation.messageStateTuningVisibility.showCenterAgentStarterActions,
		showStarterComputerSetup: presentation.starterComputerSetupOpen,
		registerMessageElement: navigation.registerMessageElement,
		selfAvatarImageUrl: panel.selfAvatarImageUrl ?? null,
		selfProfileId: panel.selfProfileId,
		spaceId: panel.spaceId,
		taskCreationSourceSignalId: panel.taskCreationSourceSignalId,
		spaceReferencesById: panel.spaceReferencesById,
		highlightedSignalId: navigation.highlightedSignalId,
		timelineItems: presentation.mainTimelineItems,
		wakeOutcomeIndex: presentation.wakeOutcomeIndex,
		threadsByRootSignalId: presentation.threadsByRootSignalId,
		unreadTargets: panel.unreadTargets ?? [],
		unreadScopes: panel.unreadScopes,
		threadPreviewByThreadId: presentation.threadPreviewByThreadId,
		threadWakeProgressByRootSignalId:
			presentation.threadWakeProgressByRootSignalId,
		wakeFailureTargetContextsByProfileId:
			panel.wakeFailureTargetContextsByProfileId,
		wakeProblemSourceSignalIds: presentation.wakeProblemSourceSignalIds,
		wakeStopRequestStatusBySelectorKey:
			panel.wakeStopRequestStatusBySelectorKey,
		wakeStopTargetLabelsByProfileId:
			presentation.wakeStopTargetLabelsByProfileId,
	});
}

function useSpaceConversationPresentationController(
	input: SpaceConversationPanelResolvedProps
) {
	const isReadOnly = input.readOnly === true;
	const canSendMessage =
		!isReadOnly &&
		(input.allowedActions.includes("post_message") ||
			input.allowSendWhileAccessSettles === true);
	const canUploadFiles =
		!isReadOnly && input.allowedActions.includes("post_message");
	const composerSendBlocked = resolveSpaceComposerSendBlocked({
		files: input.composerFiles,
		text: input.composerText,
	});
	const showComposer = shouldRenderSpaceComposer({
		activeView: input.activeSpaceView,
		isReadOnly,
		showComposerWhenReadOnly: input.readOnlyComposerPlaceholder !== undefined,
	});
	const [conversationTopOverlayElement, setConversationTopOverlayElement] =
		useState<HTMLDivElement | null>(null);
	const graphFocusRequestIdRef = useRef(0);
	const [messageDetailsItem, setMessageDetailsItem] =
		useState<SpaceTimelineItem | null>(null);
	const [spaceGraphFocusRequest, setSpaceGraphFocusRequest] =
		useState<SpaceGraphFocusRequest | null>(null);
	const spaceGraphLayout = useSpaceGraphLayout(input.spaceId);
	const [starterComputerSetupOpen, setStarterComputerSetupOpen] =
		useState(false);
	const threadSignalIds = useMemo(
		() => buildThreadSignalIds(input.threadPreviews),
		[input.threadPreviews]
	);
	const baseMainTimelineItems = useMemo(
		() => input.timelineItems.filter((item) => !threadSignalIds.has(item.id)),
		[input.timelineItems, threadSignalIds]
	);
	const belongsInMainConversation = useCallback(
		(progress: SpaceEphemeralActivityItem) => {
			if (!isActiveWakeProgressItem(progress)) {
				return true;
			}
			return isWakeProgressInConversation({
				progress,
				agentStreams: input.agentStreams,
				threadId: null,
				source: baseMainTimelineItems.find(
					(item) =>
						item.id === progress.sourceSignalId ||
						Boolean(
							progress.clientMessageId &&
								(item.clientMessageId === progress.clientMessageId ||
									item.wakeClientMessageId === progress.clientMessageId)
						)
				),
			});
		},
		[input.agentStreams, baseMainTimelineItems]
	);
	const mainActivityItems = useMemo(
		() => input.ephemeralActivityItems.filter(belongsInMainConversation),
		[input.ephemeralActivityItems, belongsInMainConversation]
	);
	const profileEntriesById = useMemo(
		() => buildSpaceMemberDirectoryEntryByProfileId(input.membersSnapshot),
		[input.membersSnapshot]
	);
	const profilePresentationsById = useMemo(
		() =>
			buildSpaceCollaborationProfilePresentations({
				centerAgentProfileId: input.centerAgentProfileId,
				entriesByProfileId: profileEntriesById,
			}),
		[input.centerAgentProfileId, profileEntriesById]
	);
	const messageStateTuningPreviewItems = useSpaceMessageStateTuningPreviewItems(
		{
			membersSnapshot: input.membersSnapshot,
			centerAgentProfileId: input.centerAgentProfileId,
			profileEntriesById,
			selfProfileId: input.selfProfileId,
			spaceId: input.spaceId,
		}
	);
	const activeConversationItems = useMemo(
		() =>
			buildActiveWakeConversationItems({
				agentStreams: input.agentStreams,
				activityItems: mainActivityItems,
				profileEntriesById,
				spaceId: input.spaceId,
				threadId: null,
				timelineItems: baseMainTimelineItems,
			}),
		[
			baseMainTimelineItems,
			input.agentStreams,
			mainActivityItems,
			input.spaceId,
			profileEntriesById,
		]
	);
	const mainTimelineItems =
		messageStateTuningPreviewItems ?? activeConversationItems;
	const messageStateTuningVisibility = resolveSpaceMessageStateTuningVisibility(
		{
			isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
			previewItems: messageStateTuningPreviewItems,
			showCenterAgentStarterActions:
				input.isCenterAgentDirectMessage && canSendMessage,
		}
	);
	const wakeOutcomeIndex = useMemo(
		() => buildSpaceWakeOutcomeIndex(mainTimelineItems),
		[mainTimelineItems]
	);
	const entries = useMemo(
		() =>
			buildSpaceConversationEntries({
				groupBoundarySignalIds: input.firstUnreadSignalId
					? new Set([input.firstUnreadSignalId])
					: undefined,
				selfProfileId: input.selfProfileId,
				timelineItems: mainTimelineItems,
			}),
		[input.firstUnreadSignalId, input.selfProfileId, mainTimelineItems]
	);
	const wakeStopTargetLabelsByProfileId = useMemo(
		() => buildWakeStopTargetLabelsByProfileId(profileEntriesById),
		[profileEntriesById]
	);
	const delegationSources = mainTimelineItems.filter(
		(item) =>
			!item.recalledAt &&
			input.centerAgentProfileId &&
			item.wakeTargetProfileIds.includes(input.centerAgentProfileId)
	);
	const delegationQueries = useQueries({
		queries: delegationSources.map((item) =>
			spaceMessageDetailsQueryOptions({
				spaceId: input.spaceId ?? "",
				signalId: item.id,
				openMeldProfileId: input.selfProfileId,
				enabled: Boolean(input.spaceId) && input.activeSpaceView === "graph",
			})
		),
	});
	const delegationsBySourceSignalId = new Map(
		delegationQueries.flatMap((query, index) => {
			const source = delegationSources[index];
			return source && query.data?.delegations
				? [[source.id, query.data.delegations] as const]
				: [];
		})
	);
	const spaceGraph = useMemo(
		() =>
			input.activeSpaceView === "graph"
				? buildSpaceGraphPresentation({
						spaceId: input.spaceId,
						delegationsBySourceSignalId,
						profileNamesById: wakeStopTargetLabelsByProfileId,
						profilePresentationsById,
						timelineItems: mainTimelineItems,
						wakeProgressItems: mainActivityItems,
					})
				: null,
		[
			delegationsBySourceSignalId,
			input.spaceId,
			input.activeSpaceView,
			mainActivityItems,
			mainTimelineItems,
			profilePresentationsById,
			wakeStopTargetLabelsByProfileId,
		]
	);
	const onAgentRecoveryAction = useLatestCallback(input.onAgentRecoveryAction);
	const onCreateThread = useLatestCallback(input.onCreateThread);
	const onOpenThread = useLatestCallback(input.onOpenThread);
	const onReportMessage = useLatestCallback(input.onReportMessage);
	const onReplyToMessage = useLatestCallback(input.onReplyToMessage);
	const onViewMessageInGraph = useLatestCallback((signalId: string) => {
		graphFocusRequestIdRef.current += 1;
		setSpaceGraphFocusRequest({
			requestId: graphFocusRequestIdRef.current,
			signalId,
		});
		input.onSpaceViewChange("graph");
	});
	const onWakeStopRequest = useLatestCallback(
		input.onWakeStopRequest ?? UNAVAILABLE_SPACE_WAKE_STOP_REQUEST
	);
	const threadsByRootSignalId = useMemo(() => {
		const byRootSignalId = new Map<string, SpaceThread>();
		for (const thread of input.threads) {
			byRootSignalId.set(thread.rootSignalId, thread);
		}
		return byRootSignalId;
	}, [input.threads]);
	const threadWakeProgressByRootSignalId = useMemo(() => {
		const byRoot = new Map<string, SpaceEphemeralActivityItem[]>();
		for (const progress of input.ephemeralActivityItems) {
			const selectedRoot = resolveWakeReplyThreadRoot({
				progress,
				agentStreams: input.agentStreams,
			});
			const rootSignalId =
				selectedRoot === undefined
					? input.threads.find(
							(thread) => thread.threadId === progress.sourceContext?.threadId
						)?.rootSignalId
					: selectedRoot;
			if (!rootSignalId) {
				continue;
			}
			const items = byRoot.get(rootSignalId) ?? [];
			items.push(progress);
			byRoot.set(rootSignalId, items);
		}
		return byRoot;
	}, [input.ephemeralActivityItems, input.agentStreams, input.threads]);
	const threadStreamsByRootSignalId = useMemo(() => {
		const byRoot = new Map<
			string,
			SpaceConversationVisibleStreamProjection[]
		>();
		for (const stream of input.agentStreams ?? []) {
			if (stream.status !== "streaming" || !stream.replyThreadRootSignalId) {
				continue;
			}
			const items = byRoot.get(stream.replyThreadRootSignalId) ?? [];
			items.push(stream);
			byRoot.set(stream.replyThreadRootSignalId, items);
		}
		return byRoot;
	}, [input.agentStreams]);
	const threadPreviewByThreadId = useMemo(
		() => buildThreadPreviewByThreadId(input.threadPreviews),
		[input.threadPreviews]
	);
	const composerContext = resolveConversationComposerContext(input);
	const composerTargetName = resolveDirectMessageTargetName(input);
	const loadedMainTimelineSignalIds = useMemo(
		() => new Set(mainTimelineItems.map((item) => item.id)),
		[mainTimelineItems]
	);
	const wakeProblemSourceSignalIds = useMemo(
		() =>
			buildWakeProblemSourceSignalIds({
				items: mainTimelineItems,
				wakeProgressItems: mainActivityItems,
			}),
		[mainTimelineItems, mainActivityItems]
	);
	const anchoredOutcomeNoticesBySourceSignalId = useMemo(
		() => buildAnchoredSpaceOutcomeNoticesBySourceSignalId(mainTimelineItems),
		[mainTimelineItems]
	);
	const messageDetailsWakeProgressState = useMemo(
		() =>
			messageDetailsItem
				? resolveSpaceMessageWakeProgressState({
						agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
						isPersonalContext: input.isPersonalContext === true,
						item: messageDetailsItem,
						items: mainActivityItems,
						timelineItems: mainTimelineItems,
						wakeOutcomeIndex,
						wakeFailureTargetContextsByProfileId:
							input.wakeFailureTargetContextsByProfileId,
					})
				: null,
		[
			input.agentRecoveryPlansByProfileId,
			mainActivityItems,
			input.isPersonalContext,
			input.wakeFailureTargetContextsByProfileId,
			mainTimelineItems,
			messageDetailsItem,
			wakeOutcomeIndex,
		]
	);
	const messageDetailsProgressEntries = readMessageDetailsProgressEntries(
		messageDetailsWakeProgressState
	);
	const messageDetailsWakeStopTarget = useMemo(
		() =>
			messageDetailsItem
				? resolveSpaceMessageWakeStopTarget({
						item: messageDetailsItem,
						stopRequestStatusBySelectorKey:
							input.wakeStopRequestStatusBySelectorKey,
						timelineItems: mainTimelineItems,
						wakeOutcomeIndex,
						wakeProgressItems: mainActivityItems,
					})
				: null,
		[
			mainActivityItems,
			input.wakeStopRequestStatusBySelectorKey,
			mainTimelineItems,
			messageDetailsItem,
			wakeOutcomeIndex,
		]
	);
	const messageDetailsReplyItems = messageDetailsItem
		? resolveReplyItemsForMessage({
				item: messageDetailsItem,
				timelineItems: mainTimelineItems,
			})
		: [];

	return {
		anchoredOutcomeNoticesBySourceSignalId,
		canSendMessage,
		canUploadFiles,
		composerContext,
		composerSendBlocked,
		composerTargetName,
		conversationTopOverlayElement,
		entries,
		isReadOnly,
		loadedMainTimelineSignalIds,
		mainTimelineItems,
		mainActivityItems,
		messageDetailsItem,
		messageDetailsProgressEntries,
		messageDetailsReplyItems,
		messageDetailsWakeStopTarget,
		messageStateTuningVisibility,
		onAgentRecoveryAction,
		onCreateThread,
		onOpenThread,
		onReportMessage,
		onReplyToMessage,
		onViewMessageInGraph,
		onWakeStopRequest,
		profileEntriesById,
		profilePresentationsById,
		setConversationTopOverlayElement,
		setMessageDetailsItem,
		setStarterComputerSetupOpen,
		showComposer,
		spaceGraph,
		spaceGraphFocusRequest,
		spaceGraphLayout,
		starterComputerSetupOpen,
		threadPreviewByThreadId,
		threadStreamsByRootSignalId,
		threadWakeProgressByRootSignalId,
		threadsByRootSignalId,
		wakeOutcomeIndex,
		wakeProblemSourceSignalIds,
		wakeStopTargetLabelsByProfileId,
	};
}

function useSpaceConversationNavigationController(input: {
	activeSpaceView: SpaceView;
	entries: readonly SpaceConversationEntry[];
	historyWindowIdentity: string | undefined;
	isLiveHistory: boolean;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	hasEarlierHistory: boolean;
	historyActionErrorMessage: string | null;
	historyIsPending: boolean;
	initialFocusInteractionId?: string;
	initialFocusRequestId?: string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	isLoadingEarlierHistory: boolean;
	mainTimelineItems: readonly SpaceTimelineItem[];
	onLoadEarlierHistory: () => Promise<void>;
	onLoadHistoryAround?: SpaceHistoryNavigationController["open"] | undefined;
	onOpenThread: (threadId: string) => void;
	onOpenUnreadThread?: SpaceConversationPanelResolvedProps["onOpenUnreadThread"];
	onSpaceViewChange: (view: SpaceView) => void;
	selfProfileId: string;
	spaceId?: string;
	spaceViewIdPrefix: string;
	threadsByRootSignalId: ReadonlyMap<string, SpaceThread>;
	threadsErrorMessage?: string | null;
	threadsIsLoading: boolean;
	unreadTargets: readonly SpaceInboxUnreadTarget[];
	unreadScopes?: SpaceInboxUnreadTargetsResponse["scopes"];
}) {
	const scrollRestorationId = buildSpaceConversationScrollRestorationId(
		input.spaceId ?? input.spaceViewIdPrefix
	);
	const conversationScrollRef = useRef<HTMLDivElement | null>(null);
	const messageScrollActionRef = useRef<SpaceMessageScrollAction | null>(null);
	const [conversationScrollElement, setConversationScrollElement] =
		useState<HTMLDivElement | null>(null);
	const messageElementsBySignalIdRef = useRef(new Map<string, HTMLElement>());
	const conversationPosition = useSpaceConversationPosition({
		historyIsPending: input.historyIsPending,
		isLiveHistory: input.isLiveHistory,
		historyVersion: input.mainTimelineItems,
		hasExplicitFocus: Boolean(
			input.initialFocusSignalId ||
				input.initialFocusInteractionId ||
				input.initialFocusThreadRootSignalId
		),
		messageElementsRef: messageElementsBySignalIdRef,
		restorationId: scrollRestorationId,
		selfProfileId: input.selfProfileId,
		viewport: conversationScrollElement,
	});
	const requestedMainFocusSignalId = resolveInitialMainFocusSignalId(input);
	const initialMainFocusSignalId = requestedMainFocusSignalId
		? resolveConversationFocusSignalId(
				input.mainTimelineItems,
				requestedMainFocusSignalId
			)
		: undefined;
	const renderWindow = useSpaceConversationRenderWindow({
		entries: input.entries,
		requiredSignalIds: [
			conversationPosition.restorationAnchorSignalId,
			initialMainFocusSignalId,
		],
		scopeKey: `${scrollRestorationId}:${input.selfProfileId}:${input.historyWindowIdentity ?? "live"}`,
	});
	const conversationAutoScroll = conversationPosition.autoScroll;
	const [latestNavigationRequest, setLatestNavigationRequest] = useState(0);
	const followLatest = useLatestCallback(() => {
		conversationPosition.followLatest();
		setLatestNavigationRequest((request) => request + 1);
	});
	const conversationDefaultScrollPosition =
		conversationPosition.defaultScrollPosition;
	const onConversationScroll = conversationPosition.onScroll;
	const onConversationScrollEnd = conversationPosition.onScrollEnd;
	const highlightMessageTimerRef = useRef<number | null>(null);
	const appliedInitialFocusRef = useRef<string | null>(null);
	const focusHistoryRequestRef = useRef<AbortController | null>(null);
	const [highlightedSignalId, setHighlightedSignalId] = useState<string | null>(
		null
	);
	const [mainFocusStatusMessage, setMainFocusStatusMessage] = useState<
		string | null
	>(null);
	const registerConversationScrollElement = useCallback(
		(element: HTMLDivElement | null) => {
			conversationScrollRef.current = element;
			setConversationScrollElement(element);
		},
		[]
	);
	const registerMessageElement = useCallback(
		(signalId: string, element: HTMLElement | null) => {
			if (element) {
				messageElementsBySignalIdRef.current.set(signalId, element);
				return;
			}
			messageElementsBySignalIdRef.current.delete(signalId);
		},
		[]
	);
	const [pendingPinJump, setPendingPinJump] =
		useState<SpaceConversationPendingJump | null>(null);
	// Loaded covers messages above the mounted window, which jumps mount first.
	const isConversationMessageLoaded = (signalId: string) =>
		messageElementsBySignalIdRef.current.has(signalId) ||
		renderWindow.isHiddenSignal(signalId);
	const jumpToMessage = useLatestCallback(
		(requestedSignalId: string, options?: SpaceConversationJumpOptions) => {
			const signalId = resolveConversationFocusSignalId(
				input.mainTimelineItems,
				requestedSignalId
			);
			const messageElement = messageElementsBySignalIdRef.current.get(signalId);
			if (!messageElement) {
				// A loaded message above the mounted window: mount it, then jump
				// once its element exists (see the pending jump effect below).
				if (renderWindow.revealSignal(signalId)) {
					setPendingPinJump({ ...options, signalId });
				}
				return;
			}
			conversationPosition.releaseReadingPosition();
			messageScrollActionRef.current?.(signalId, {
				align: "center",
				behavior: "instant",
			});
			const scrollElement = conversationScrollRef.current;
			if (scrollElement) {
				scrollMessageIntoConversationViewport({
					messageElement,
					offsetFromVisibleTop: options?.offsetFromVisibleTop,
					scrollElement,
				});
			} else {
				messageElement.scrollIntoView({ block: "center" });
			}
			messageElement.focus({ preventScroll: true });
			setHighlightedSignalId(signalId);
			if (highlightMessageTimerRef.current !== null) {
				window.clearTimeout(highlightMessageTimerRef.current);
			}
			highlightMessageTimerRef.current = window.setTimeout(() => {
				highlightMessageTimerRef.current = null;
				setHighlightedSignalId(null);
			}, 1800);
		}
	);
	const onJumpToMessage = useLatestCallback(
		(signalId: string, options?: SpaceConversationJumpOptions) => {
			if (input.activeSpaceView === "messages") {
				jumpToMessage(signalId, options);
				return;
			}
			input.onSpaceViewChange("messages");
			window.requestAnimationFrame(() => jumpToMessage(signalId, options));
		}
	);
	const onOpenThread = useLatestCallback(
		async (threadId: string, signalId?: string) => {
			const thread = [...input.threadsByRootSignalId.values()].find(
				(candidate) => candidate.threadId === threadId
			);
			const firstUnread =
				signalId && thread
					? { threadRootSignalId: thread.rootSignalId, signalId }
					: input.unreadTargets
							.filter(
								(target) => target.threadRootSignalId === thread?.rootSignalId
							)
							.sort((left, right) => left.occurredAtMs - right.occurredAtMs)[0];
			if (!(firstUnread?.threadRootSignalId && input.onOpenUnreadThread)) {
				input.onOpenThread(threadId);
				return;
			}
			setMainFocusStatusMessage(null);
			try {
				if (
					!(await input.onOpenUnreadThread({
						rootSignalId: firstUnread.threadRootSignalId,
						signalId: firstUnread.signalId,
						threadId,
					}))
				) {
					throw new Error("Couldn’t open this thread. Try again.");
				}
			} catch (error) {
				setMainFocusStatusMessage(
					error instanceof Error
						? error.message
						: "Couldn’t open this thread. Try again."
				);
			}
		}
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: A grown render window mounts the pending target's element.
	useLayoutEffect(() => {
		if (
			!(
				pendingPinJump &&
				input.mainTimelineItems.some(
					(item) => item.id === pendingPinJump.signalId
				)
			)
		) {
			return;
		}
		if (messageElementsBySignalIdRef.current.has(pendingPinJump.signalId)) {
			jumpToMessage(pendingPinJump.signalId, pendingPinJump);
			setPendingPinJump(null);
			return;
		}
		// A loaded target above the render window, for example one a history
		// load placed beyond the newest entries: mount it, then jump next commit.
		renderWindow.revealSignal(pendingPinJump.signalId);
	}, [
		pendingPinJump,
		input.mainTimelineItems,
		jumpToMessage,
		renderWindow.startIndex,
	]);
	const revealHistoryTarget = async (signalId: string) => {
		setMainFocusStatusMessage(null);
		setPendingPinJump(null);
		const loaded = await input.onLoadHistoryAround?.(
			signalId,
			undefined,
			(result) => {
				setMainFocusStatusMessage(null);
				if (result === "latest") {
					followLatest();
				} else {
					setPendingPinJump({ signalId });
				}
			}
		);
		return Boolean(loaded);
	};
	const onJumpToPinnedMessage = useLatestCallback(async (signalId: string) => {
		if (isConversationMessageLoaded(signalId)) {
			onJumpToMessage(signalId);
			return;
		}
		if (!input.spaceId) {
			return;
		}
		try {
			const entry = await createUnscopedWebSpaceApi({
				openMeldProfileId: input.selfProfileId,
			}).resolveEntry({ spaceId: input.spaceId, signalId });
			if (entry.view.state !== "allowed") {
				throw new Error("This message is no longer available.");
			}
			input.onSpaceViewChange("messages");
			if (entry.target.threadRootSignalId) {
				const opened = await input.onOpenUnreadThread?.({
					rootSignalId: entry.target.threadRootSignalId,
					signalId,
				});
				if (!opened) {
					throw new Error("Couldn’t open this thread. Try again.");
				}
			} else {
				await revealHistoryTarget(signalId);
			}
		} catch (error) {
			setMainFocusStatusMessage(
				error instanceof Error
					? error.message
					: "Couldn’t open this message. Try again."
			);
		}
	});
	const loadEarlierHistory = useCallback(async () => {
		if (!input.hasEarlierHistory || input.isLoadingEarlierHistory) {
			return;
		}
		await input.onLoadEarlierHistory();
	}, [
		input.hasEarlierHistory,
		input.isLoadingEarlierHistory,
		input.onLoadEarlierHistory,
	]);
	// The conversation mounts already loaded history before it asks for more.
	const revealEarlierConversation = renderWindow.revealEarlier;
	const loadEarlierConversation = useCallback(async () => {
		if (revealEarlierConversation()) {
			return;
		}
		await loadEarlierHistory();
	}, [loadEarlierHistory, revealEarlierConversation]);
	const revealUnreadTarget = useLatestCallback(
		async (target: SpaceInboxUnreadTarget): Promise<boolean> => {
			setMainFocusStatusMessage(null);
			conversationPosition.releaseReadingPosition();
			input.onSpaceViewChange("messages");
			try {
				if (target.threadRootSignalId) {
					const opened = await input.onOpenUnreadThread?.({
						rootSignalId: target.threadRootSignalId,
						signalId: target.signalId,
					});
					if (!opened) {
						throw new Error("Couldn’t open this thread. Try again.");
					}
					return true;
				}
				const signalId = target.signalId;
				if (isConversationMessageLoaded(signalId)) {
					jumpToMessage(signalId);
				} else if (!(await revealHistoryTarget(signalId))) {
					// The history owner keeps the failed target and its single Retry
					// banner. Its completion callback also handles later recovery.
					if (input.onLoadHistoryAround) {
						return false;
					}
					throw new Error(
						"Couldn’t find this unread message. Refresh this Space and try again."
					);
				}
				return true;
			} catch (error) {
				setMainFocusStatusMessage(
					error instanceof Error
						? error.message
						: "Couldn’t open this message. Try again."
				);
				return false;
			}
		}
	);
	const targetId =
		input.initialFocusInteractionId ?? input.initialFocusSignalId ?? null;
	const targetKey = targetId
		? `${targetId}:${input.initialFocusRequestId ?? "initial"}`
		: null;
	const loadFocusHistory = useLatestCallback(
		async (signalId: string, signal: AbortSignal) => {
			await input.onLoadHistoryAround?.(signalId, signal, (loaded) => {
				if (!signal.aborted && loaded === "latest") {
					appliedInitialFocusRef.current = targetKey;
					followLatest();
				}
			});
		}
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: A different route target owns a new request lifetime, including a switch to a loaded message or Thread.
	useEffect(() => {
		appliedInitialFocusRef.current = null;
		focusHistoryRequestRef.current = null;
		setMainFocusStatusMessage(null);
		return () => focusHistoryRequestRef.current?.abort();
	}, [targetKey, input.spaceId, input.initialFocusThreadRootSignalId]);
	useEffect(() => {
		if (input.initialFocusThreadRootSignalId) {
			return;
		}
		if (!targetKey) {
			return;
		}
		if (appliedInitialFocusRef.current === targetKey) {
			return;
		}
		if (input.activeSpaceView === "graph") {
			input.onSpaceViewChange("messages");
			return;
		}
		if (
			initialMainFocusSignalId &&
			messageElementsBySignalIdRef.current.has(initialMainFocusSignalId)
		) {
			appliedInitialFocusRef.current = targetKey;
			setMainFocusStatusMessage(null);
			jumpToMessage(initialMainFocusSignalId);
			return;
		}
		if (input.historyIsPending) {
			return;
		}
		if (focusHistoryRequestRef.current) {
			return;
		}
		if (requestedMainFocusSignalId && input.onLoadHistoryAround) {
			const request = new AbortController();
			focusHistoryRequestRef.current = request;
			loadFocusHistory(requestedMainFocusSignalId, request.signal)?.catch(
				(error: unknown) => {
					if (!request.signal.aborted) {
						setMainFocusStatusMessage(
							error instanceof Error
								? error.message
								: "Couldn’t load this message. Try again."
						);
					}
				}
			);
			return;
		}
		setMainFocusStatusMessage(
			"This linked message isn’t available. It may have been removed or be outside the available Space history."
		);
	}, [
		input.activeSpaceView,
		input.historyIsPending,
		input.initialFocusThreadRootSignalId,
		input.onSpaceViewChange,
		initialMainFocusSignalId,
		jumpToMessage,
		loadFocusHistory,
		requestedMainFocusSignalId,
		input.onLoadHistoryAround,
		targetKey,
	]);

	useEffect(() => {
		const scrollElement = conversationScrollRef.current;
		if (
			input.initialFocusInteractionId ||
			input.initialFocusSignalId ||
			input.initialFocusThreadRootSignalId ||
			!(
				scrollElement &&
				(input.hasEarlierHistory || renderWindow.hasHiddenEntries)
			) ||
			input.isLoadingEarlierHistory ||
			input.mainTimelineItems.length === 0 ||
			scrollElement.clientHeight === 0 ||
			scrollElement.scrollHeight > scrollElement.clientHeight
		) {
			return;
		}
		loadEarlierConversation().catch((error) => {
			console.error("Failed to auto-load earlier space history.", error);
		});
	}, [
		input.hasEarlierHistory,
		input.initialFocusInteractionId,
		input.initialFocusSignalId,
		input.initialFocusThreadRootSignalId,
		input.isLoadingEarlierHistory,
		input.mainTimelineItems.length,
		loadEarlierConversation,
		renderWindow.hasHiddenEntries,
	]);
	useEffect(
		() => () => {
			if (highlightMessageTimerRef.current !== null) {
				window.clearTimeout(highlightMessageTimerRef.current);
			}
		},
		[]
	);

	return {
		conversationAutoScroll,
		conversationRestorationStatus: conversationPosition.restorationStatus,
		messageScrollActionRef,
		conversationDefaultScrollPosition,
		conversationScrollElement,
		followLatest,
		latestNavigationRequest,
		releaseReadingPosition: conversationPosition.releaseReadingPosition,
		highlightedSignalId,
		loadEarlierConversation,
		loadEarlierHistory,
		mainFocusStatusMessage,
		onConversationScroll,
		onConversationScrollEnd,
		onJumpToMessage,
		registerConversationScrollElement,
		registerMessageElement,
		onJumpToPinnedMessage,
		onOpenThread,
		renderWindow,
		revealUnreadTarget,
	};
}

function resolveConversationRestorationPresentation(input: {
	historyIsPending: boolean;
	onViewedUpdates: SpaceConversationPanelResolvedProps["onViewedUpdates"];
	status: SpaceConversationRestorationStatus;
}) {
	const ready = input.status === "ready";
	return {
		ariaHidden: undefined,
		busy: input.historyIsPending,
		className: "h-full py-4",
		inert: false,
		onViewedUpdates:
			ready && !input.historyIsPending ? input.onViewedUpdates : undefined,
	};
}

function SpacePrimaryView(input: {
	activeView: SpaceView;
	files?: ReactNode;
	graph: ReactNode;
	guide?: ReactNode;
	idPrefix: string;
	messages: ReactNode;
	tasks?: ReactNode;
}) {
	const selectedIndex = getSpaceViewIndex(input.activeView);
	const [visitedMessages, setVisitedMessages] = useState(
		input.activeView === "messages"
	);
	useEffect(() => {
		if (input.activeView === "messages") {
			setVisitedMessages(true);
		}
	}, [input.activeView]);
	let activeContent = input.files;
	if (input.activeView === "graph") {
		activeContent = input.graph;
	} else if (input.activeView === "tasks") {
		activeContent = input.tasks;
	} else if (input.activeView === "guide") {
		activeContent = input.guide;
	}
	const renderMessages = visitedMessages || input.activeView === "messages";
	return (
		<>
			{input.activeView !== "messages" && (
				<div
					aria-labelledby={`${input.idPrefix}-tab-${selectedIndex}`}
					className="flex min-h-0 flex-1 flex-col"
					id={`${input.idPrefix}-panel-${selectedIndex}`}
					role="tabpanel"
				>
					{activeContent}
				</div>
			)}
			{renderMessages && (
				<Activity mode={input.activeView === "messages" ? "visible" : "hidden"}>
					<div
						aria-labelledby={`${input.idPrefix}-tab-${getSpaceViewIndex("messages")}`}
						className="flex min-h-0 flex-1 flex-col"
						id={`${input.idPrefix}-panel-${getSpaceViewIndex("messages")}`}
						role="tabpanel"
					>
						{input.messages}
					</div>
				</Activity>
			)}
		</>
	);
}

export type SpaceConversationJumpOptions = {
	/** Place the message this far below the visible top, instead of centering it. */
	offsetFromVisibleTop?: number;
};

type SpaceConversationPendingJump = SpaceConversationJumpOptions & {
	signalId: string;
};

function resolveConversationFocusSignalId(
	items: readonly SpaceTimelineItem[],
	signalId: string
): string {
	const outcome = items.find(
		(item) => item.id === signalId && isSpaceOutcomeNoticeItem(item)
	);
	return outcome?.replyToSignalId ?? signalId;
}

function resolveInitialMainFocusSignalId(
	input: Pick<
		SpaceConversationPanelResolvedProps,
		| "ephemeralActivityItems"
		| "initialFocusInteractionId"
		| "initialFocusSignalId"
	>
): string | undefined {
	if (input.initialFocusSignalId) {
		return input.initialFocusSignalId;
	}
	if (!input.initialFocusInteractionId) {
		return undefined;
	}
	return (
		input.ephemeralActivityItems.find(
			(item) =>
				item.pendingInteraction?.interactionId ===
				input.initialFocusInteractionId
		)?.sourceSignalId ?? undefined
	);
}

function renderInitialSpaceFocusStatus(input: {
	mainMessage: string | null;
	historyNotice?: string | null;
}) {
	const message = input.mainMessage ?? input.historyNotice;
	if (!message) {
		return null;
	}
	return (
		<output
			aria-label="Linked message isn't available"
			className="border-border border-b bg-muted/40 px-4 py-3 text-muted-foreground text-sm sm:px-5"
		>
			{message}
		</output>
	);
}

function SpaceConversationTopOverlay(input: {
	children: ReactNode;
	overlayRef: Ref<HTMLDivElement>;
}) {
	return (
		<div
			className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col"
			data-slot="space-conversation-top-overlay"
			ref={input.overlayRef}
		>
			{input.children}
		</div>
	);
}

const NO_MESSAGE_FOOTERS: ReadonlyMap<string, ReactNode> = new Map();

/**
 * The request card under the message that is the request, and the composer
 * bar without that request so the wait shows once.
 */
function useDirectMessageRequestCard(input: {
	agentAccess: SpaceAgentAccessRequestsState;
	loadedSignalIds: ReadonlySet<string>;
	request: DirectMessageAccessRequest | null | undefined;
}) {
	const { agentAccess } = input;
	const request = input.request ?? null;
	const card = request?.access.request ?? null;
	const signalId =
		request &&
		card?.sourceSignalId &&
		input.loadedSignalIds.has(card.sourceSignalId) &&
		resolveDirectMessageRequestCardStatus(request)
			? card.sourceSignalId
			: null;
	const withdrawRef = useRef(agentAccess.withdraw);
	withdrawRef.current = agentAccess.withdraw;
	const footersBySignalId = useMemo(
		() =>
			signalId && request && card
				? new Map<string, ReactNode>([
						[
							signalId,
							<DirectMessageRequestCardStatus
								busy={agentAccess.busy}
								key={card.id}
								onWithdraw={() => withdrawRef.current(card)}
								request={request}
							/>,
						],
					])
				: NO_MESSAGE_FOOTERS,
		[agentAccess.busy, card, request, signalId]
	);
	return {
		footersBySignalId,
		barState:
			signalId && card
				? {
						...agentAccess,
						requests: agentAccess.requests.filter(
							(entry) => entry.id !== card.id
						),
					}
				: agentAccess,
	};
}

/** Draft: the composer writes the request. Waiting: it is locked until the owner answers. */
function resolveComposerAccessRequest(
	request: DirectMessageAccessRequest | null
): { requestPlaceholder: string | null; lockedHint: string | null } {
	if (!request) {
		return { requestPlaceholder: null, lockedHint: null };
	}
	const copy = directMessageAccessRequestCopy(request);
	return {
		requestPlaceholder: directMessageSendsRequest(request.access.state)
			? copy.composerPlaceholder
			: null,
		lockedHint:
			request.access.state === "waiting" ? copy.waitingComposerHint : null,
	};
}

function SpaceComposerSection(input: {
	agentRequests: ReactNode;
	canUploadFiles: boolean;
	canSendMessage: boolean;
	composerContext: SpaceComposerConversationKind;
	composerSendBlocked: boolean;
	composerTargetName: string | null;
	input: SpaceConversationPanelResolvedProps;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	/** The Agent issue card already offers the fix; the composer keeps only its hint. */
	recoveryShownInConversation: boolean;
	submitComposer: (options?: SpaceComposerSendOptions) => void;
}) {
	const panel = input.input;
	const accessRequest = resolveComposerAccessRequest(
		panel.directMessageAccessRequest ?? null
	);
	const traySpace = useSpaceComposerTraySpace({
		held: panel.composerTraysHeld === true,
		profileId: panel.selfProfileId,
		spaceId: panel.spaceId ?? "",
	});

	return (
		<div
			className="shrink-0 bg-background"
			data-slot="space-composer-section"
			ref={traySpace.sectionRef}
		>
			<div
				className="flex w-full flex-col gap-3 py-4"
				data-space-conversation-content-width=""
			>
				<SpaceComposer
					actions={{
						onAddFiles: panel.onAddComposerFiles,
						onAddPeopleOrAgents: panel.onAddPeopleOrAgents,
						onEditorChange: panel.onComposerEditorChange,
						onMentionButtonClick: panel.onMentionButtonClick,
						onRemoveFile: panel.onRemoveComposerFile,
						onRetryFile: panel.onRetryComposerFile,
						onRetryFileCleanup: panel.onRetryComposerFileCleanup,
						onRetryFileRestoration: panel.onRetryComposerFileRestoration,
						onSubmit: input.submitComposer,
					}}
					availability={{
						canUploadFiles: input.canUploadFiles,
						canSendMessage: input.canSendMessage,
						fileLimitReached: panel.composerFileLimitReached,
						isSendingMessage: panel.isSendingMessage,
						sendBlocked: input.composerSendBlocked,
					}}
					centerAgentProfileId={panel.centerAgentProfileId}
					composerRef={panel.textareaRef}
					content={{
						addressingTargets: panel.composerAddressingTargets ?? [],
						authoredMentions: panel.composerAuthoredMentions ?? [],
						files: panel.composerFiles,
						fileCleanup: panel.composerFileCleanup,
						fileRestorationError: panel.composerFileRestorationError,
						hasAuthoredMentions: panel.composerHasAuthoredMentions,
						agentRequestMentions: panel.composerAgentRequestMentions,
						mentionPickerItems: panel.composerMentionPickerItems ?? [],
						mentionEmptyMessage: panel.composerMentionEmptyMessage,
						text: panel.composerText,
					}}
					context={{
						conversationKind: input.composerContext,
						placement: "conversation",
						accessPending: panel.composerAccessPending,
						readOnly: panel.readOnly || Boolean(accessRequest.lockedHint),
						readOnlyPlaceholder: panel.readOnly
							? panel.readOnlyComposerPlaceholder
							: (accessRequest.lockedHint ?? undefined),
						requestPlaceholder: accessRequest.requestPlaceholder ?? undefined,
						targetName: input.composerTargetName,
					}}
					key={`${panel.spaceId}:${panel.selfProfileId}`}
					members={panel.composerMembers}
					organizationId={panel.organizationId}
					recovery={
						input.recoveryShownInConversation
							? undefined
							: {
									blockedWakeProfileId: panel.composerBlockedWakeProfileId,
									agentRecoveryPlansByProfileId:
										panel.agentRecoveryPlansByProfileId,
									isAgentRecoveryPending: panel.isAgentRecoveryPending,
									onAgentRecoveryAction: panel.onAgentRecoveryAction,
									orgSlug: panel.orgSlug,
									prepareSetupHref: panel.prepareSetupHref,
								}
					}
					slots={{
						agentRequests: (
							<SpaceComposerTrayHold
								held={panel.composerTraysHeld}
								reservedHeight={traySpace.reservedHeight}
							>
								{input.agentRequests}
							</SpaceComposerTrayHold>
						),
						pendingActionSurface: (
							<SpaceComposerTrayHold held={panel.composerTraysHeld}>
								{panel.pendingActionSurface}
							</SpaceComposerTrayHold>
						),
						queuedMessages:
							!panel.readOnly && panel.spaceId ? (
								<SpaceComposerTrayHold held={panel.composerTraysHeld}>
									<SpaceInputQueue
										agents={panel.membersSnapshot?.agents}
										key={`${panel.spaceId}:${panel.selfProfileId}`}
										onEdit={(queuedText) => {
											const text = panel.composerText
												? `${panel.composerText}\n\n${queuedText}`
												: queuedText;
											panel.onComposerEditorChange({
												authoredMentions: [
													...(panel.composerAuthoredMentions ?? []),
												],
												selection: { start: text.length, end: text.length },
												text,
											});
											panel.textareaRef.current?.focus();
										}}
										profileId={panel.selfProfileId}
										progressItems={panel.ephemeralActivityItems}
										spaceId={panel.spaceId}
									/>
								</SpaceComposerTrayHold>
							) : null,
						beforePrimaryAction: (
							<SpaceComposerWorkBookmarks placement="conversation" />
						),
						beforeInput: (
							<SpaceComposerReplyBanner
								onClear={() => {
									panel.onClearComposerReplyTo();
									panel.textareaRef.current?.focus();
								}}
								profilePresentationsById={input.profilePresentationsById}
								signalId={panel.composerReplyToSignalId}
								timelineItems={panel.timelineItems}
							/>
						),
						error: panel.composerErrorMessage ? (
							<ComposerError panel={panel} />
						) : null,
						primaryAction: panel.composerPrimaryAction,
						profileControl: panel.profileControl,
					}}
					taskSources={buildSpaceTaskSources(
						panel.timelineItems,
						panel.selfProfileId
					)}
				/>
			</div>
		</div>
	);
}

/**
 * Keeps a held tray mounted, so its read still runs, but out of the layout.
 * The first tray slot also keeps the trays' saved space, in the place the
 * trays appear, so nothing above or below them moves when they are released.
 * Once released the tray renders unwrapped, so the composer's tray stacking
 * and sibling order stay exactly as without a hold.
 */
function SpaceComposerTrayHold(input: {
	children: ReactNode;
	held?: boolean;
	/** Space the trays took last time, kept where the first tray appears. */
	reservedHeight?: number;
}) {
	if (!input.held) {
		return input.children;
	}
	return (
		<>
			{input.reservedHeight ? (
				<div aria-hidden="true" style={{ height: input.reservedHeight }} />
			) : null}
			<div hidden>{input.children}</div>
		</>
	);
}

// Until membership is known the viewer may be an observer, who gets no
// MemberAgent card; showing it and then removing it moves the conversation.
function isPossibleConversationObserver(
	input: Pick<
		SpaceConversationPanelResolvedProps,
		"composerAccessPending" | "readOnly"
	>
): boolean {
	return Boolean(input.readOnly || input.composerAccessPending);
}

function ComposerError(input: { panel: SpaceConversationPanelResolvedProps }) {
	const panel = input.panel;
	if (!panel.composerErrorMessage) {
		return null;
	}
	return (
		<p className="text-destructive text-sm" role="alert">
			{panel.composerErrorMessage}
		</p>
	);
}

function renderConversationBody(input: {
	isDirectMessage: boolean;
	memberAgentCard: MemberAgentDirectMessageCardState | null;
	messageFootersBySignalId: ReadonlyMap<string, ReactNode>;
	threadStreamsByRootSignalId: ReadonlyMap<
		string,
		readonly SpaceConversationVisibleStreamProjection[]
	>;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	anchoredOutcomeNoticesBySourceSignalId: ReadonlyMap<
		string,
		readonly SpaceTimelineItem[]
	>;
	centerAgentProfileId: string | null;
	computerSetupContext?: CenterAgentComputerSetupContext;
	currentOwnerUserId: string | null;
	emptyStateActions?: ReactNode;
	emptyStateDescription?: string | null;
	emptyStateAlignment?: "start" | "center";
	emptyStateTitle?: string;
	entries: ReturnType<typeof buildSpaceConversationEntries>;
	/** Entries before this index are loaded but not mounted yet. */
	entriesStartIndex: number;
	addressingWakeProgressItems: readonly SpaceEphemeralActivityItem[];
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	firstUnreadSignalId: string | null;
	historyIsPending: boolean;
	actionableAgentInteractionPlacement: SpaceAgentInteractionPlacement;
	isAgentRecoveryPending: (profileId: string) => boolean;
	isCenterAgentDirectMessage: boolean;
	isCreatingThread: boolean;
	isPersonalContext: boolean;
	isSendingMessage: boolean;
	loadedMainTimelineSignalIds: ReadonlySet<string>;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onJumpToDate?: (date: Date) => Promise<string | null>;
	onJumpToMessage: (signalId: string) => void;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenThread: (threadId: string) => void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onAddMessageToTasks?: (
		item: SpaceTimelineItem,
		threadId: string | null
	) => void;
	onReplyToMessage: (item: SpaceTimelineItem) => void;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onSendStarterPrompt: (prompt: string) => Promise<void>;
	onStartComputerSetup: () => void;
	onCloseComputerSetup: () => void;
	onDraftStarterPrompt: (prompt: string) => void;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	orgSlug?: string;
	prepareSetupHref?: string;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	readOnly: boolean;
	showCenterAgentStarterActions: boolean;
	showStarterComputerSetup: boolean;
	registerMessageElement: (
		signalId: string,
		element: HTMLElement | null
	) => void;
	selfAvatarImageUrl: string | null;
	selfProfileId: string;
	spaceId?: string;
	taskCreationSourceSignalId?: string | null;
	spaceReferencesById?: SpaceMessageReferencesById;
	highlightedSignalId: string | null;
	timelineItems: readonly SpaceTimelineItem[];
	wakeOutcomeIndex: SpaceWakeOutcomeIndex;
	threadsByRootSignalId: ReadonlyMap<string, SpaceThread>;
	threadPreviewByThreadId: ReadonlyMap<string, SpaceThreadPreview>;
	threadWakeProgressByRootSignalId: ReadonlyMap<
		string,
		readonly SpaceEphemeralActivityItem[]
	>;
	unreadTargets: readonly SpaceInboxUnreadTarget[];
	unreadScopes?: SpaceInboxUnreadTargetsResponse["scopes"];
	wakeFailureTargetContextsByProfileId: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	wakeProblemSourceSignalIds: ReadonlySet<string>;
	wakeStopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	wakeStopTargetLabelsByProfileId: ReadonlyMap<string, string>;
}) {
	const inlineComputerSetupActionSignalId =
		input.computerSetupContext === undefined
			? null
			: resolveLatestComputerSetupActionSignalId({
					timelineItems: input.timelineItems,
				});
	// Regular messages use content-visibility:auto for scroll performance, which
	// also paint-contains their overflow. Keep this one decorative intro visible
	// so the Logo glow can fade outside the centered content rail.
	const centerAgentDirectMessageIntroItem = input.isCenterAgentDirectMessage ? (
		<MessageScrollerItem
			className="[content-visibility:visible]"
			messageId="center-agent-intro"
		>
			<CenterAgentDirectMessageIntro
				computerSetupContext={input.computerSetupContext}
				disabled={input.isSendingMessage}
				isPersonalContext={input.isPersonalContext}
				onCloseComputerSetup={input.onCloseComputerSetup}
				onSelectStarterAction={input.onDraftStarterPrompt}
				onStartComputerSetup={input.onStartComputerSetup}
				showStarterActions={input.showCenterAgentStarterActions}
				showStarterComputerSetup={input.showStarterComputerSetup}
			/>
		</MessageScrollerItem>
	) : null;

	if (input.historyIsPending) {
		return (
			<MessageScrollerItem
				className="py-5"
				messageId="space-conversation-loading"
			>
				<SpaceConversationSkeleton />
			</MessageScrollerItem>
		);
	}

	// A MemberAgent welcome or repair card, shown as posted by the Agent:
	// presentation, never a published message.
	const memberAgentCardItem = input.memberAgentCard ? (
		<MessageScrollerItem
			className="[content-visibility:visible]"
			messageId="member-agent-card"
		>
			<MemberAgentDirectMessageCard
				current={input.memberAgentCard.current}
				entry={input.memberAgentCard.entry}
				// A new state is a new post, with its own time.
				key={`${input.memberAgentCard.model.kind}:${input.memberAgentCard.model.title}`}
				model={input.memberAgentCard.model}
			/>
		</MessageScrollerItem>
	) : null;
	if (input.entries.length === 0) {
		if (centerAgentDirectMessageIntroItem) {
			return centerAgentDirectMessageIntroItem;
		}
		if (memberAgentCardItem) {
			return memberAgentCardItem;
		}

		return (
			<MessageScrollerItem
				className="flex flex-1 [content-visibility:visible]"
				messageId="space-conversation-empty"
			>
				<div
					className={cn(
						"flex min-h-56 w-full flex-1 justify-center px-6 py-8",
						input.emptyStateAlignment === "start"
							? "items-start"
							: "items-center"
					)}
				>
					<div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
						<div className="grid max-w-xl gap-2">
							<h2 className="font-medium text-xl">
								{input.emptyStateTitle ?? "No messages yet"}
							</h2>
							{input.emptyStateDescription === null ? null : (
								<p className="text-muted-foreground text-sm leading-6">
									{input.emptyStateDescription ??
										"Send the first message to start the conversation."}
								</p>
							)}
						</div>
						{input.emptyStateActions ?? null}
					</div>
				</div>
			</MessageScrollerItem>
		);
	}
	let previousDateKey: string | null = null;
	let unreadBoundaryRendered = false;
	// The welcome opens the Session; a problem is the Agent's latest post,
	// next to the composer it blocks.
	const memberAgentCardIsIssue = isMemberAgentIssueCard(input.memberAgentCard);

	// The opening intro and welcome belong above the oldest entry, so they
	// mount with it; mounting them earlier would also defeat the scroller's
	// prepend anchoring, which keys off the first child changing.
	const rendersConversationStart = input.entriesStartIndex === 0;

	return (
		<>
			{rendersConversationStart ? centerAgentDirectMessageIntroItem : null}
			{memberAgentCardIsIssue || !rendersConversationStart
				? null
				: memberAgentCardItem}
			{input.entries.map((entry, entryIndex) => {
				const createdAtMs = resolveConversationEntryCreatedAtMs(entry);
				const date = new Date(createdAtMs);
				const dateKey = resolveLocalDateKey(date);
				const isActiveReply =
					entry.kind === "bubble_run" &&
					entry.run.items.some(
						(item) =>
							item.activeWakeProgress ||
							item.agentStreamState?.status === "streaming"
					);
				const shouldRenderDateMarker =
					!isActiveReply && dateKey !== previousDateKey;
				if (!isActiveReply) {
					previousDateKey = dateKey;
				}
				const firstSignalId = resolveConversationEntryFirstSignalId(entry);
				const shouldRenderUnreadBoundary =
					!unreadBoundaryRendered &&
					input.firstUnreadSignalId !== null &&
					firstSignalId === input.firstUnreadSignalId;
				if (shouldRenderUnreadBoundary) {
					unreadBoundaryRendered = true;
				}
				if (entryIndex < input.entriesStartIndex) {
					return null;
				}
				const entryKey = resolveConversationEntryKey(entry);
				const wrapEntry = (content: ReactNode) => (
					<Fragment key={entryKey}>
						{shouldRenderDateMarker ? (
							<MessageScrollerItem
								className="[content-visibility:visible]"
								data-conversation-date-marker=""
								data-conversation-date-ms={createdAtMs}
								messageId={`date-marker:${dateKey}`}
							>
								<SpaceConversationDateMarker
									date={date}
									loadedSignalCount={input.loadedMainTimelineSignalIds.size}
									onJumpToDate={input.onJumpToDate}
								/>
							</MessageScrollerItem>
						) : null}
						{shouldRenderUnreadBoundary ? (
							<MessageScrollerItem
								className="[content-visibility:visible]"
								messageId={`unread-marker:${input.firstUnreadSignalId}`}
							>
								<Marker
									aria-label="New messages"
									className="py-3 font-medium text-unread before:bg-unread after:bg-unread"
									role="separator"
									variant="separator"
								>
									<MarkerContent>New messages</MarkerContent>
								</Marker>
							</MessageScrollerItem>
						) : null}
						{content}
					</Fragment>
				);
				if (entry.kind === "system_event") {
					return wrapEntry(
						<MessageScrollerItem messageId={entry.item.id}>
							<SystemEventRow
								highlightedSignalId={input.highlightedSignalId}
								isPersonalContext={input.isPersonalContext === true}
								item={entry.item}
								onOpenMessageDetails={input.onOpenMessageDetails}
								orgSlug={input.orgSlug}
								prepareSetupHref={input.prepareSetupHref}
								profileEntriesById={input.profileEntriesById}
								readOnly={input.readOnly}
								registerMessageElement={input.registerMessageElement}
								spaceReferencesById={input.spaceReferencesById}
								wakeFailureTargetContextsByProfileId={
									input.wakeFailureTargetContextsByProfileId
								}
							/>
						</MessageScrollerItem>
					);
				}
				if (entry.kind === "conversation_compaction") {
					return wrapEntry(<SpaceConversationCompactionMarker id={entry.id} />);
				}
				return wrapEntry(
					<SpaceMessageRun
						actionableAgentInteractionPlacement={
							input.actionableAgentInteractionPlacement
						}
						addressingWakeProgressItems={input.addressingWakeProgressItems}
						agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
						anchoredOutcomeNoticesBySourceSignalId={
							input.anchoredOutcomeNoticesBySourceSignalId
						}
						centerAgentProfileId={input.centerAgentProfileId}
						currentOwnerUserId={input.currentOwnerUserId}
						ephemeralActivityItems={input.ephemeralActivityItems}
						highlightedSignalId={input.highlightedSignalId}
						inlineComputerSetupActionSignalId={
							inlineComputerSetupActionSignalId
						}
						isCenterAgentDirectMessage={input.isCenterAgentDirectMessage}
						isCreatingThread={input.isCreatingThread}
						isDirectMessage={input.isDirectMessage}
						isPersonalContext={input.isPersonalContext === true}
						loadedMainTimelineSignalIds={input.loadedMainTimelineSignalIds}
						membersSnapshot={input.membersSnapshot}
						messageFootersBySignalId={input.messageFootersBySignalId}
						modelCatalog={input.modelCatalog}
						onAddMessageToTasks={input.onAddMessageToTasks}
						onAgentInteractionResponse={input.onAgentInteractionResponse}
						onCreateThread={input.onCreateThread}
						onJumpToMessage={input.onJumpToMessage}
						onOpenMessageDetails={input.onOpenMessageDetails}
						onOpenSpaceFile={input.onOpenSpaceFile}
						onOpenThread={input.onOpenThread}
						onRecoverExecution={input.onRecoverExecution}
						onReplyToMessage={input.onReplyToMessage}
						onWakeStopRequest={input.onWakeStopRequest}
						orgSlug={input.orgSlug}
						prepareSetupHref={input.prepareSetupHref}
						profileDetailsEntry={
							input.profileEntriesById.get(entry.run.speaker.profileId) ?? null
						}
						profileEntriesById={input.profileEntriesById}
						profilePresentationsById={input.profilePresentationsById}
						readOnly={input.readOnly}
						registerMessageElement={input.registerMessageElement}
						run={entry.run}
						selfAvatarImageUrl={input.selfAvatarImageUrl}
						selfProfileId={input.selfProfileId}
						spaceId={input.spaceId}
						spaceReferencesById={input.spaceReferencesById}
						taskCreationSourceSignalId={input.taskCreationSourceSignalId}
						threadPreviewByThreadId={input.threadPreviewByThreadId}
						threadStreamsByRootSignalId={input.threadStreamsByRootSignalId}
						threadsByRootSignalId={input.threadsByRootSignalId}
						threadWakeProgressByRootSignalId={
							input.threadWakeProgressByRootSignalId
						}
						timelineItems={input.timelineItems}
						unreadScopes={input.unreadScopes}
						unreadTargets={input.unreadTargets}
						wakeFailureTargetContextsByProfileId={
							input.wakeFailureTargetContextsByProfileId
						}
						wakeOutcomeIndex={input.wakeOutcomeIndex}
						wakeProblemSourceSignalIds={input.wakeProblemSourceSignalIds}
						wakeStopRequestStatusBySelectorKey={
							input.wakeStopRequestStatusBySelectorKey
						}
						wakeStopTargetLabelsByProfileId={
							input.wakeStopTargetLabelsByProfileId
						}
					/>
				);
			})}
			{memberAgentCardIsIssue ? memberAgentCardItem : null}
		</>
	);
}

/**
 * While older entries are not mounted, the first mounted entry can share its
 * day with them, so its date marker is not mounted either. The sticky date
 * still names that day.
 */
function resolveConversationLeadingDateMs(
	entries: readonly SpaceConversationEntry[],
	startIndex: number
): number | null {
	const first = entries[startIndex];
	const previous = entries[startIndex - 1];
	if (!(first && previous)) {
		return null;
	}
	const firstCreatedAtMs = resolveConversationEntryCreatedAtMs(first);
	return resolveLocalDateKey(new Date(firstCreatedAtMs)) ===
		resolveLocalDateKey(new Date(resolveConversationEntryCreatedAtMs(previous)))
		? firstCreatedAtMs
		: null;
}

function resolveConversationEntryCreatedAtMs(
	entry: SpaceConversationEntry
): number {
	if (entry.kind === "system_event") {
		return entry.item.createdAtMs;
	}
	if (entry.kind === "conversation_compaction") {
		return entry.createdAtMs;
	}
	const firstItem = entry.run.items[0];
	if (!firstItem) {
		throw new Error(`Conversation run ${entry.run.id} has no messages.`);
	}
	return firstItem.createdAtMs;
}

function resolveConversationEntryFirstSignalId(
	entry: SpaceConversationEntry
): string {
	if (entry.kind === "system_event") {
		return entry.item.id;
	}
	if (entry.kind === "conversation_compaction") {
		return entry.sourceSignalId;
	}
	const firstItem = entry.run.items[0];
	if (!firstItem) {
		throw new Error(`Conversation run ${entry.run.id} has no messages.`);
	}
	return firstItem.id;
}

function resolveConversationEntryKey(entry: SpaceConversationEntry): string {
	if (entry.kind === "system_event") {
		return entry.item.id;
	}
	return entry.kind === "conversation_compaction" ? entry.id : entry.run.id;
}

function useLatestCallback<Arguments extends unknown[], Result>(
	callback: (...args: Arguments) => Result
): (...args: Arguments) => Result {
	const callbackRef = useRef(callback);
	useLayoutEffect(() => {
		callbackRef.current = callback;
	}, [callback]);
	return useCallback((...args: Arguments) => callbackRef.current(...args), []);
}

function LoadNewerMessagesControl(input: {
	history?: SpaceHistoryNavigationController;
	scrollElement: HTMLElement | null;
}) {
	const requestedSignalIdRef = useRef<string | null>(null);
	const lastSignalId = input.history?.activeWindow?.envelopes.at(-1)?.id;
	const hasAfter = input.history?.activeWindow?.hasAfter;
	const pending = input.history?.pending;
	const pendingDirection = input.history?.pendingDirection;
	const error = input.history?.error;
	useEffect(() => {
		const scrollElement = input.scrollElement;
		if (!hasAfter) {
			requestedSignalIdRef.current = null;
		}
		if (!(scrollElement && hasAfter && !pending && !error)) {
			return;
		}
		const loadWhenNearEnd = () => {
			if (scrollElement.clientHeight <= 0) {
				return;
			}
			const remaining =
				scrollElement.scrollHeight -
				scrollElement.clientHeight -
				scrollElement.scrollTop;
			if (
				lastSignalId &&
				requestedSignalIdRef.current !== lastSignalId &&
				remaining <= Math.max(240, scrollElement.clientHeight / 2)
			) {
				requestedSignalIdRef.current = lastSignalId;
				input.history?.loadAfter().then((loaded) => {
					if (!loaded && requestedSignalIdRef.current === lastSignalId) {
						requestedSignalIdRef.current = null;
					}
				});
			}
		};
		scrollElement.addEventListener("scroll", loadWhenNearEnd, {
			passive: true,
		});
		loadWhenNearEnd();
		return () => scrollElement.removeEventListener("scroll", loadWhenNearEnd);
	}, [
		input.history,
		input.scrollElement,
		hasAfter,
		lastSignalId,
		pending,
		error,
	]);
	return hasAfter && !error && pending && pendingDirection === "after" ? (
		<output className="mx-auto mt-4 mb-16 text-muted-foreground text-sm">
			Loading newer messages…
		</output>
	) : null;
}

function buildThreadPreviewByThreadId(
	previews: readonly SpaceThreadPreview[]
): ReadonlyMap<string, SpaceThreadPreview> {
	const byThreadId = new Map<string, SpaceThreadPreview>();
	for (const preview of previews) {
		byThreadId.set(preview.threadId, preview);
	}
	return byThreadId;
}

function SystemEventRow(input: {
	highlightedSignalId: string | null;
	isPersonalContext: boolean;
	item: SpaceTimelineItem;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	orgSlug?: string;
	prepareSetupHref?: string;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	readOnly: boolean;
	registerMessageElement: (
		signalId: string,
		element: HTMLElement | null
	) => void;
	spaceReferencesById?: SpaceMessageReferencesById;
	wakeFailureTargetContextsByProfileId: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
}) {
	if (isSpaceOutcomeNoticeItem(input.item)) {
		return (
			<div
				className={cn(
					"flex w-full justify-start transition-colors focus-visible:outline-none data-[highlighted=true]:rounded-md data-[highlighted=true]:bg-muted/50 motion-reduce:transition-none",
					SPACE_MESSAGE_ROW_LAYOUT_CLASS,
					"px-0"
				)}
				data-highlighted={
					input.highlightedSignalId === input.item.id ? "true" : undefined
				}
				data-history-signal-id={getSpaceConversationHistorySignalId(input.item)}
				data-message-row-id={input.item.id}
				data-message-source-at={spaceMessageReadSourceAt(input.item)}
				data-signal-id={input.item.id}
				ref={(element) => {
					input.registerMessageElement(input.item.id, element);
				}}
				tabIndex={-1}
			>
				<SpaceOutcomeRow
					onOpenDetails={
						input.readOnly ? null : () => input.onOpenMessageDetails(input.item)
					}
					spaceReferencesById={input.spaceReferencesById}
					text={input.item.text}
					tone={resolveSpaceOutcomeRowTone({
						failureStage: input.item.systemNoticeFailureStage,
						noticeType: input.item.systemNoticeType,
						reasonCode: input.item.systemNoticeReasonCode,
					})}
				/>
			</div>
		);
	}

	const StatusIcon = InfoIcon;
	const markerClassName =
		"max-w-full items-center gap-2 px-3 py-2 text-muted-foreground text-xs leading-6 before:min-w-6 after:min-w-6";
	const markerContent = (
		<MarkerContent className="min-w-0 max-w-[min(80%,44rem)] whitespace-normal break-words text-left text-muted-foreground">
			<span className="flex min-w-0 items-start gap-2">
				<MarkerIcon className="mt-1 shrink-0">
					<StatusIcon aria-hidden="true" className="text-muted-foreground" />
				</MarkerIcon>
				<span className="min-w-0">
					<span className="font-bold text-muted-foreground">
						{input.item.actorName}
					</span>
					<span className="mx-2 text-muted-foreground/60">·</span>
					<span>{input.item.text}</span>
				</span>
			</span>
		</MarkerContent>
	);

	return (
		<div className="flex w-full justify-center">
			{input.readOnly ? (
				<Marker
					className={markerClassName}
					data-highlighted={
						input.highlightedSignalId === input.item.id ? "true" : undefined
					}
					data-history-signal-id={getSpaceConversationHistorySignalId(
						input.item
					)}
					data-signal-id={input.item.id}
					ref={(element) => {
						input.registerMessageElement(input.item.id, element);
					}}
					variant="separator"
				>
					{markerContent}
				</Marker>
			) : (
				<Marker
					aria-label="Message details"
					className={cn(
						markerClassName,
						"cursor-pointer appearance-none border-0 bg-transparent text-inherit focus-visible:rounded-md focus-visible:bg-muted/40 focus-visible:outline-none"
					)}
					data-highlighted={
						input.highlightedSignalId === input.item.id ? "true" : undefined
					}
					data-history-signal-id={getSpaceConversationHistorySignalId(
						input.item
					)}
					data-signal-id={input.item.id}
					onClick={() => input.onOpenMessageDetails(input.item)}
					ref={(element) => {
						input.registerMessageElement(input.item.id, element);
					}}
					render={<button type="button" />}
					variant="separator"
				>
					{markerContent}
				</Marker>
			)}
		</div>
	);
}

const UNAVAILABLE_SPACE_WAKE_STOP_REQUEST: SpaceWakeStopRequestHandler = () =>
	Promise.reject(new Error("Space Wake Stop is unavailable."));

// Participants open terminal failures from the footer; observers read them inline.
function resolveDirectMessageTargetName(
	input: Pick<
		SpaceConversationPanelResolvedProps,
		| "automaticWakeConversationKind"
		| "isCenterAgentDirectMessage"
		| "isDirectMessage"
		| "membersSnapshot"
		| "selfProfileId"
	>
): string | null {
	if (input.isCenterAgentDirectMessage) {
		return "Center Agent";
	}
	if (input.automaticWakeConversationKind) {
		return (
			input.membersSnapshot?.agents.find((member) => member.status === "active")
				?.profileName ?? null
		);
	}
	if (!input.isDirectMessage) {
		return null;
	}
	return (
		input.membersSnapshot?.humans.find(
			(member) =>
				member.status === "active" && member.profileId !== input.selfProfileId
		)?.profileName ?? null
	);
}
