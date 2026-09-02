import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type {
	ModelCatalog,
	SpaceInboxUnreadTarget,
	SpaceMembersSnapshot,
	SpaceThread,
	SpaceThreadPreview,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { Badge } from "@openmeld/ui/components/badge";
import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import { OpenMeldLetterLogoStrong } from "@openmeld/ui/components/openmeld-letter-logo-strong";
import { ProgressiveBlur } from "@openmeld/ui/components/progressive-blur";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowUpIcon,
	CaretDoubleDownIcon,
	ChatCircleIcon,
	InfoIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMessageScrollerScrollable } from "@shadcn/react/message-scroller";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
	Fragment,
	memo,
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { APP_MOBILE_TOUCH_TARGET_CLASS_NAME } from "#/components/app/app-touch-target";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
} from "#/components/ibelick/prompt-input";
import {
	SpaceComposerFileMenu,
	SpaceComposerFileTray,
	useSpaceComposerFileInput,
} from "#/components/spaces/space-composer-attachments";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import { resolveSpaceMessageAgentInteractionItems } from "#/lib/spaces/agent-interactions";
import { buildCenterAgentOptimisticReplyItem } from "#/lib/spaces/center-agent-optimistic-reply";
import {
	isSpaceComposerFileFailed,
	isSpaceComposerFileInProgress,
	type SpaceComposerFile,
} from "#/lib/spaces/composer-attachment";
import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import {
	buildAnchoredSpaceOutcomeNoticesBySourceSignalId,
	buildSpaceConversationEntries,
	type SpaceConversationBubbleRun,
	type SpaceConversationEntry,
} from "#/lib/spaces/presentation";
import {
	buildSpaceTimelineItems,
	isSpaceOutcomeNoticeItem,
	resolveRecordedSpaceMessageDetailsItem,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import type { WakeFailureTargetContext } from "#/lib/spaces/wake-failure-display";
import {
	buildWakeProblemSourceSignalIds,
	resolveSpaceMessageWakeProgressFallbackEntries,
	resolveSpaceMessageWakeProgressState,
} from "#/lib/spaces/wake-progress-presentation";
import {
	buildSpaceWakeOutcomeIndex,
	resolveSpaceMessageWakeStopTarget,
	resolveSpaceMessageWakeStopTargets,
	type SpaceWakeOutcomeIndex,
	type SpaceWakeStopRequestStatus,
} from "#/lib/spaces/wake-stop-target";
import {
	CenterAgentComputerSetupCard,
	type CenterAgentComputerSetupContext,
	resolveLatestComputerSetupActionSignalId,
} from "./center-agent-computer-setup-card";
import { CenterAgentStarterActions } from "./center-agent-starter-actions";
import type { OnboardingSetupPresentation } from "./onboarding-setup-presentation";
import { Bubble, BubbleContent, BubbleGroup } from "./primitives/bubble";
import { Marker, MarkerContent, MarkerIcon } from "./primitives/marker";
import { Message, MessageContent, MessageHeader } from "./primitives/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "./primitives/message-scroller";
import { formatSpaceAgentControlLabel } from "./space-agent-control-label";
import {
	SpaceAgentInteractionCard,
	type SpaceAgentInteractionResponseHandler,
	type SpaceAgentProfileEditHandler,
} from "./space-agent-interaction-card";
import {
	resolveSpaceAgentInteractionPlacement,
	type SpaceAgentInteractionPlacement,
} from "./space-agent-interaction-placement";
import {
	type SpaceAgentProfileBindingRecoveryPlan,
	SpaceAgentRecoveryActionControl,
} from "./space-agent-recovery-action";
import { SpaceAgentToolActivity } from "./space-agent-tool-activity";
import {
	buildSpaceCollaborationProfilePresentations,
	buildSpaceMemberDirectoryEntryByProfileId,
	buildWakeStopTargetLabelsByProfileId,
	type SpaceCollaborationProfilePresentation,
} from "./space-collaboration-profile";
import {
	resolveSpaceComposerAccessibleName,
	resolveSpaceComposerPlaceholder,
	resolveSpaceComposerWakeTextHint,
	type SpaceAgentDirectConversationComposerHintKind,
	type SpaceComposerPlaceholderContext,
} from "./space-composer-copy";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorChange,
	type SpaceComposerInputRef,
} from "./space-composer-editor";
import { SpaceConversationCompactionMarker } from "./space-conversation-compaction-marker";
import { resolveLocalDateKey } from "./space-conversation-date";
import { SpaceConversationDateMarker } from "./space-conversation-date-marker";
import { SpaceConversationSendScrollController } from "./space-conversation-scroll-controller";
import { buildSpaceConversationScrollRestorationId } from "./space-conversation-scroll-restoration";
import { SpaceConversationStickyDate } from "./space-conversation-sticky-date";
import { SpaceGraph, type SpaceGraphFocusRequest } from "./space-graph";
import { buildSpaceGraphPresentation } from "./space-graph-presentation";
import { SpaceMessageBody } from "./space-message-body";
import {
	resolveSpaceMessageBubblePresentationClass,
	resolveSpaceMessageContentLayoutClassName,
	resolveSpaceMessageContentPaddingClassName,
	resolveSpaceMessageRowLayoutClassName,
	SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS,
	SPACE_MESSAGE_ROW_LAYOUT_CLASS,
	SPACE_MESSAGE_SURFACE_WIDTH_CLASS,
} from "./space-message-bubble-style";
import { copySpaceTimelineItemWithFeedback } from "./space-message-copy";
import { SpaceMessageDetailsDrawer } from "./space-message-details-drawer";
import { resolveMessageDetailsDiagnosticReportStatus } from "./space-message-details-presentation";
import {
	resolveSpaceMessageFooterAddressingTargets,
	resolveSpaceMessageFooterFailureSummary,
	SpaceMessageFooter,
} from "./space-message-footer";
import { SpaceMessageInteractionSource } from "./space-message-interaction-source";
import { SpaceMessageProfileAvatar } from "./space-message-profile-avatar";
import { shouldPlaceSpaceMessageProgressInAnswer } from "./space-message-progress-placement";
import { SpaceMessageProgressStatus } from "./space-message-progress-status";
import {
	EMPTY_SPACE_MESSAGE_REFERENCES,
	hasResolvedSpaceMessageReference,
	type SpaceMessageReferencesById,
	SpaceMessageReferenceText,
} from "./space-message-reference";
import {
	resolveSpaceMessageStateTuningTimelineItems,
	resolveSpaceMessageStateTuningVisibility,
	useSpaceMessageStateTuningPreviewItems,
} from "./space-message-state-tuning-preview";
import {
	groupAnchoredOutcomeNotices,
	resolveGroupedOutcomeRowText,
	SpaceOutcomeRow,
} from "./space-outcome-row";
import { resolveSpaceOutcomeRowTone } from "./space-outcome-tone";
import { resolveSpacePendingAgentActionIdentity } from "./space-pending-agent-action-model";
import { getSpaceViewIndex, type SpaceView } from "./space-view";
import {
	resolveAnchoredSpaceExecutionRecoveryRequest,
	resolveAnchoredSpaceWakeRetryRequest,
	type SpaceExecutionRecoveryHandler,
	type SpaceWakeRetryHandler,
} from "./space-wake-retry";
import {
	SpaceWakeStopControl,
	type SpaceWakeStopRequestHandler,
	shouldRenderSpaceWakeStopControl,
} from "./space-wake-stop-control";
import { useSpaceGraphLayout } from "./use-space-graph-layout";
import type {
	SpaceComposerAddressingTarget,
	SpaceMentionPickerItem,
} from "./use-space-mention-authoring";
import { useSpaceProfileDetailsDialog } from "./use-space-profile-details-dialog";

type SpaceConversationPanelProps = {
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
	composerFiles: readonly SpaceComposerFile[];
	composerFileLimitReached: boolean;
	composerAddressingTargets?: readonly SpaceComposerAddressingTarget[];
	composerAuthoredMentions?: readonly ComposerDraftAuthoredMention[];
	composerMentionPickerItems?: readonly SpaceMentionPickerItem[];
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
	emptyStateTitle?: string;
	editableAgentProfileIds?: ReadonlySet<string>;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	presentedWakeProgressItems: readonly SpaceEphemeralActivityItem[];
	firstUnreadSignalId: string | null;
	files?: ReactNode;
	hasEarlierHistory: boolean;
	historyActionErrorMessage: string | null;
	historyErrorMessage: string | null;
	historyIsPending: boolean;
	actionableAgentInteractionPlacement?: SpaceAgentInteractionPlacement;
	initialFocusInteractionId?: string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	agentDirectConversationKind?: SpaceAgentDirectConversationComposerHintKind | null;
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
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onClearComposerReplyTo: () => void;
	onLoadEarlierHistory: () => Promise<void>;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onJumpToDate?: (date: Date) => Promise<string | null>;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onOpenThread: (threadId: string) => void;
	onOpenUnreadThread?: (input: {
		rootSignalId: string;
		signalId: string;
		threadId?: string;
	}) => boolean | Promise<boolean>;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onReplyToMessage: (item: SpaceTimelineItem) => void;
	onRemoveComposerFile: (localId: string) => void;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	onMentionButtonClick: () => void;
	onSend: () => Promise<void>;
	onSendStarterPrompt: (prompt: string) => Promise<void>;
	onSpaceViewChange: (view: SpaceView) => void;
	orgSlug?: string;
	// Fired with whether the conversation is scrolled to the latest message, so
	// the unread watermark only advances while the user is actually at the bottom.
	onViewingLatestChange?: (isViewingLatest: boolean) => void;
	prepareSetupHref?: string;
	pendingActionSurface?: ReactNode;
	readOnly?: boolean;
	readOnlyComposerPlaceholder?: string;
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
	unreadCount: number;
	unreadStateReady: boolean;
};

const MAX_SPACE_FOCUS_HISTORY_LOAD_ATTEMPTS = 9;

type SpaceUnreadNavigationState = {
	aboveCount: number;
	aboveTargetKeys: readonly string[];
	belowCount: number;
	belowTargetKeys: readonly string[];
	nearestAbove: SpaceInboxUnreadTarget | null;
	nearestBelow: SpaceInboxUnreadTarget | null;
};

const EMPTY_SPACE_UNREAD_NAVIGATION_STATE: SpaceUnreadNavigationState = {
	aboveCount: 0,
	aboveTargetKeys: [],
	belowCount: 0,
	belowTargetKeys: [],
	nearestAbove: null,
	nearestBelow: null,
};

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

function hasCurrentUserAuthoredSpaceMessage(input: {
	items: readonly SpaceTimelineItem[];
	selfProfileId: string;
}): boolean {
	return input.items.some(
		(item) =>
			item.actorProfileId === input.selfProfileId &&
			item.actorProfileKind === "human" &&
			item.signalType === "signal.text"
	);
}

function hasSpaceComposerDraft(input: {
	files: readonly SpaceComposerFile[];
	replyToSignalId: string | null;
	text: string;
}): boolean {
	return (
		input.text.trim().length > 0 ||
		input.files.length > 0 ||
		input.replyToSignalId !== null
	);
}

function shouldShowCenterAgentStarterActions(input: {
	canSendMessage: boolean;
	hasComposerDraft: boolean;
	hasCurrentUserAuthoredMessage: boolean;
	isCenterAgentDirectMessage: boolean;
}): boolean {
	return (
		input.isCenterAgentDirectMessage &&
		input.canSendMessage &&
		!input.hasComposerDraft &&
		!input.hasCurrentUserAuthoredMessage
	);
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
	agentDirectConversationKind?: SpaceAgentDirectConversationComposerHintKind | null;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
}): SpaceComposerPlaceholderContext {
	if (input.isCenterAgentDirectMessage) {
		return "center_agent_direct_message";
	}
	if (input.agentDirectConversationKind) {
		return "agent_direct_message";
	}
	if (input.isDirectMessage) {
		return "human_direct_message";
	}
	return "space";
}

export function SpaceConversationPanel(input: SpaceConversationPanelProps) {
	const isReadOnly = input.readOnly === true;
	const canSendMessage =
		!isReadOnly && input.allowedActions.includes("post_message");
	const composerFileUploadInProgress = input.composerFiles.some(
		isSpaceComposerFileInProgress
	);
	const composerHasReadyFile = input.composerFiles.some(
		(file) => file.status === "ready"
	);
	const composerSendBlocked =
		composerFileUploadInProgress ||
		(!composerHasReadyFile && input.composerText.trim().length === 0);
	const showComposer = shouldRenderSpaceComposer({
		activeView: input.activeSpaceView,
		isReadOnly,
		showComposerWhenReadOnly: input.readOnlyComposerPlaceholder !== undefined,
	});
	const conversationScrollRef = useRef<HTMLDivElement | null>(null);
	const unreadMeasurementRequestRef = useRef<() => void>(() => undefined);
	const [conversationScrollElement, setConversationScrollElement] =
		useState<HTMLDivElement | null>(null);
	const [stuckConversationDateMs, setStuckConversationDateMs] = useState<
		number | null
	>(null);
	const registerConversationScrollElement = useCallback(
		(element: HTMLDivElement | null) => {
			conversationScrollRef.current = element;
			setConversationScrollElement(element);
		},
		[]
	);
	const [conversationTopOverlayElement, setConversationTopOverlayElement] =
		useState<HTMLDivElement | null>(null);
	const messageElementsBySignalIdRef = useRef(new Map<string, HTMLElement>());
	const highlightMessageTimerRef = useRef<number | null>(null);
	const appliedInitialFocusRef = useRef<string | null>(null);
	const appliedInitialThreadFocusRef = useRef<string | null>(null);
	const focusHistorySearchRef = useRef({ attempts: 0, targetKey: "" });
	const graphFocusRequestIdRef = useRef(0);
	const [messageDetailsItem, setMessageDetailsItem] =
		useState<SpaceTimelineItem | null>(null);
	const [spaceGraphFocusRequest, setSpaceGraphFocusRequest] =
		useState<SpaceGraphFocusRequest | null>(null);
	const spaceGraphLayout = useSpaceGraphLayout(input.spaceId);
	const [highlightedSignalId, setHighlightedSignalId] = useState<string | null>(
		null
	);
	const [mainFocusStatusMessage, setMainFocusStatusMessage] = useState<
		string | null
	>(null);
	const [unreadNavigation, setUnreadNavigation] =
		useState<SpaceUnreadNavigationState>(EMPTY_SPACE_UNREAD_NAVIGATION_STATE);
	const [dismissedUnreadTargetKeys, setDismissedUnreadTargetKeys] = useState(
		() => new Set<string>()
	);
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
			centerAgentProfileId: input.centerAgentProfileId,
			profileEntriesById,
			selfProfileId: input.selfProfileId,
			spaceId: input.spaceId,
		}
	);
	const optimisticCenterAgentReplyItem = useMemo(
		() =>
			buildCenterAgentOptimisticReplyItem({
				activityItems: input.presentedWakeProgressItems,
				isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
				profileEntriesById,
				selfProfileId: input.selfProfileId,
				timelineItems: baseMainTimelineItems,
			}),
		[
			baseMainTimelineItems,
			input.isCenterAgentDirectMessage,
			input.presentedWakeProgressItems,
			input.selfProfileId,
			profileEntriesById,
		]
	);
	const mainTimelineItems = useMemo(
		() =>
			resolveSpaceMessageStateTuningTimelineItems({
				baseItems: baseMainTimelineItems,
				optimisticItem: optimisticCenterAgentReplyItem,
				previewItems: messageStateTuningPreviewItems,
			}),
		[
			baseMainTimelineItems,
			messageStateTuningPreviewItems,
			optimisticCenterAgentReplyItem,
		]
	);
	const hasCurrentUserAuthoredMessage = hasCurrentUserAuthoredSpaceMessage({
		items: input.timelineItems,
		selfProfileId: input.selfProfileId,
	});
	const hasComposerDraft = hasSpaceComposerDraft({
		files: input.composerFiles,
		replyToSignalId: input.composerReplyToSignalId,
		text: input.composerText,
	});
	const messageStateTuningVisibility = resolveSpaceMessageStateTuningVisibility(
		{
			isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
			previewItems: messageStateTuningPreviewItems,
			showCenterAgentStarterActions: shouldShowCenterAgentStarterActions({
				canSendMessage,
				hasComposerDraft,
				hasCurrentUserAuthoredMessage,
				isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
			}),
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
	const spaceGraph = useMemo(
		() =>
			buildSpaceGraphPresentation({
				profileNamesById: wakeStopTargetLabelsByProfileId,
				profilePresentationsById,
				timelineItems: mainTimelineItems,
				wakeProgressItems: input.ephemeralActivityItems,
			}),
		[
			input.ephemeralActivityItems,
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
	const threadPreviewByThreadId = useMemo(
		() => buildThreadPreviewByThreadId(input.threadPreviews),
		[input.threadPreviews]
	);
	const composerContext = resolveConversationComposerContext(input);
	const composerTargetName = resolveDirectMessageTargetName(input);
	const composerAccessibleName = resolveSpaceComposerAccessibleName({
		context: composerContext,
		targetName: composerTargetName,
	});
	const composerPlaceholder = resolveSpaceComposerPlaceholder({
		canSendMessage,
		context: composerContext,
		readOnlyPlaceholder: isReadOnly
			? input.readOnlyComposerPlaceholder
			: undefined,
		targetName: composerTargetName,
	});
	const sendButtonLabel = resolveSendButtonLabel(input.isSendingMessage);
	const wakeTextHint = input.agentDirectConversationKind
		? null
		: resolveSpaceComposerWakeTextHint(input.composerText, {
				hasAuthoredMentions: input.composerHasAuthoredMentions,
			});
	const showEarlierHistoryLoadingIndicator =
		mainTimelineItems.length > 0 && input.isLoadingEarlierHistory;
	const loadedMainTimelineSignalIds = useMemo(
		() => new Set(mainTimelineItems.map((item) => item.id)),
		[mainTimelineItems]
	);
	const wakeProblemSourceSignalIds = useMemo(
		() =>
			buildWakeProblemSourceSignalIds({
				items: mainTimelineItems,
				wakeProgressItems: input.ephemeralActivityItems,
			}),
		[mainTimelineItems, input.ephemeralActivityItems]
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
						items: input.ephemeralActivityItems,
						timelineItems: mainTimelineItems,
						wakeOutcomeIndex,
						wakeFailureTargetContextsByProfileId:
							input.wakeFailureTargetContextsByProfileId,
					})
				: null,
		[
			input.agentRecoveryPlansByProfileId,
			input.ephemeralActivityItems,
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
						targetLabelsByProfileId: wakeStopTargetLabelsByProfileId,
						timelineItems: mainTimelineItems,
						wakeOutcomeIndex,
						wakeProgressItems: input.ephemeralActivityItems,
					})
				: null,
		[
			input.ephemeralActivityItems,
			input.wakeStopRequestStatusBySelectorKey,
			mainTimelineItems,
			messageDetailsItem,
			wakeOutcomeIndex,
			wakeStopTargetLabelsByProfileId,
		]
	);
	const messageDetailsReplyItems = messageDetailsItem
		? resolveReplyItemsForMessage({
				item: messageDetailsItem,
				timelineItems: mainTimelineItems,
			})
		: [];
	const registerMessageElement = useCallback(
		(signalId: string, element: HTMLElement | null) => {
			if (element) {
				messageElementsBySignalIdRef.current.set(signalId, element);
				unreadMeasurementRequestRef.current();
				return;
			}
			messageElementsBySignalIdRef.current.delete(signalId);
			unreadMeasurementRequestRef.current();
		},
		[]
	);
	const jumpToMessage = useCallback((signalId: string) => {
		const messageElement = messageElementsBySignalIdRef.current.get(signalId);
		if (!messageElement) {
			return;
		}
		const scrollElement = conversationScrollRef.current;
		if (scrollElement) {
			scrollMessageIntoConversationViewport({
				messageElement,
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
	}, []);
	const onJumpToMessage = useLatestCallback((signalId: string) => {
		if (input.activeSpaceView === "messages") {
			jumpToMessage(signalId);
			return;
		}
		input.onSpaceViewChange("messages");
		window.requestAnimationFrame(() => jumpToMessage(signalId));
	});
	const centerAgentComputerSetupContext =
		resolveCenterAgentComputerSetupContext({
			isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
			orgSlug: input.orgSlug,
			profileId: input.selfProfileId,
			spaceId: input.spaceId,
		});
	const setupGuidance = resolveSpaceSetupGuidanceSlots({
		hasConversationEntries: entries.length > 0,
		renderSetupGuidance: input.renderSetupGuidance,
	});
	const conversationBody = renderConversationBody({
		agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
		anchoredOutcomeNoticesBySourceSignalId,
		centerAgentProfileId: input.centerAgentProfileId,
		computerSetupContext: centerAgentComputerSetupContext,
		currentOwnerUserId: input.currentOwnerUserId,
		emptyStateActions: setupGuidance.emptyStateActions,
		emptyStateDescription: input.emptyStateDescription,
		emptyStateTitle: input.emptyStateTitle,
		editableAgentProfileIds: input.editableAgentProfileIds,
		entries,
		ephemeralActivityItems: input.ephemeralActivityItems,
		firstUnreadSignalId: input.firstUnreadSignalId,
		historyIsPending: input.historyIsPending,
		actionableAgentInteractionPlacement: resolveSpaceAgentInteractionPlacement(
			input.actionableAgentInteractionPlacement
		),
		isAgentRecoveryPending: input.isAgentRecoveryPending,
		isCenterAgentDirectMessage:
			messageStateTuningVisibility.isCenterAgentDirectMessage,
		isSendingMessage: input.isSendingMessage,
		isCreatingThread: input.isCreatingThread,
		isPersonalContext: input.isPersonalContext === true,
		loadedMainTimelineSignalIds,
		membersSnapshot: input.membersSnapshot,
		modelCatalog: input.modelCatalog,
		onAgentRecoveryAction,
		onAgentInteractionResponse: input.onAgentInteractionResponse,
		onEditAgentProfile: input.onEditAgentProfile,
		onCreateThread,
		onJumpToDate: input.onJumpToDate,
		onJumpToMessage,
		onOpenMessageDetails: setMessageDetailsItem,
		onOpenThread,
		onOpenSpaceFile: input.onOpenSpaceFile,
		onReplyToMessage,
		onReportMessage,
		// The details panel renders the same exact recovery action. Suppress the
		// timeline copy while details are open so one execution has one CTA.
		onRecoverExecution: messageDetailsItem
			? undefined
			: input.onRecoverExecution,
		onRetryWakeTarget: input.onRetryWakeTarget,
		onSendStarterPrompt: input.onSendStarterPrompt,
		onStartComputerSetup: () => setStarterComputerSetupOpen(true),
		onWakeStopRequest: input.onWakeStopRequest ? onWakeStopRequest : undefined,
		orgSlug: input.orgSlug,
		prepareSetupHref: input.prepareSetupHref,
		profileEntriesById,
		profilePresentationsById,
		readOnly: isReadOnly,
		showCenterAgentStarterActions:
			messageStateTuningVisibility.showCenterAgentStarterActions,
		showStarterComputerSetup: starterComputerSetupOpen,
		registerMessageElement,
		selfAvatarImageUrl: input.selfAvatarImageUrl ?? null,
		selfProfileId: input.selfProfileId,
		spaceId: input.spaceId,
		spaceReferencesById: input.spaceReferencesById,
		stuckDateMs: stuckConversationDateMs,
		highlightedSignalId,
		timelineItems: mainTimelineItems,
		wakeOutcomeIndex,
		threadsByRootSignalId,
		threadPreviewByThreadId,
		wakeFailureTargetContextsByProfileId:
			input.wakeFailureTargetContextsByProfileId,
		wakeProblemSourceSignalIds,
		wakeStopRequestStatusBySelectorKey:
			input.wakeStopRequestStatusBySelectorKey,
		wakeStopTargetLabelsByProfileId,
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
	const measureUnreadNavigation = useCallback(() => {
		setUnreadNavigation(
			resolveSpaceUnreadNavigationState({
				hasEarlierHistory: input.hasEarlierHistory,
				messageElementsBySignalId: messageElementsBySignalIdRef.current,
				scrollElement: conversationScrollRef.current,
				targets: input.unreadTargets ?? [],
			})
		);
	}, [input.hasEarlierHistory, input.unreadTargets]);
	const requestUnreadMeasurement = useMemo(() => {
		let frameId: number | null = null;
		return () => {
			if (frameId !== null) {
				return;
			}
			frameId = window.requestAnimationFrame(() => {
				frameId = null;
				measureUnreadNavigation();
			});
		};
	}, [measureUnreadNavigation]);
	useLayoutEffect(() => {
		unreadMeasurementRequestRef.current = requestUnreadMeasurement;
		return () => {
			unreadMeasurementRequestRef.current = () => undefined;
		};
	}, [requestUnreadMeasurement]);
	useLayoutEffect(() => {
		measureUnreadNavigation();
	}, [measureUnreadNavigation]);
	useEffect(() => {
		const scrollElement = conversationScrollElement;
		if (!scrollElement) {
			return;
		}
		const observer = new ResizeObserver(requestUnreadMeasurement);
		observer.observe(scrollElement);
		return () => observer.disconnect();
	}, [conversationScrollElement, requestUnreadMeasurement]);
	const openUnreadThreadTarget = useLatestCallback(
		async (target: SpaceInboxUnreadTarget): Promise<boolean> => {
			if (!target.threadRootSignalId) {
				return true;
			}
			const thread = threadsByRootSignalId.get(target.threadRootSignalId);
			return (
				(await input.onOpenUnreadThread?.({
					rootSignalId: target.threadRootSignalId,
					signalId: target.signalId,
					...(thread ? { threadId: thread.threadId } : {}),
				})) === true
			);
		}
	);
	const revealUnreadTarget = useLatestCallback(
		async (target: SpaceInboxUnreadTarget) => {
			const anchorSignalId = target.threadRootSignalId ?? target.signalId;
			for (
				let attempt = 0;
				attempt <= MAX_SPACE_FOCUS_HISTORY_LOAD_ATTEMPTS;
				attempt += 1
			) {
				if (messageElementsBySignalIdRef.current.has(anchorSignalId)) {
					jumpToMessage(anchorSignalId);
					if (!target.threadRootSignalId) {
						return;
					}
					await openUnreadThreadTarget(target);
					return;
				}
				if (
					!(
						input.hasEarlierHistory &&
						attempt < MAX_SPACE_FOCUS_HISTORY_LOAD_ATTEMPTS
					)
				) {
					return;
				}
				await loadEarlierHistory();
				await new Promise<void>((resolve) => {
					window.requestAnimationFrame(() =>
						window.requestAnimationFrame(() => resolve())
					);
				});
			}
		}
	);
	const initialMainFocusSignalId = resolveInitialMainFocusSignalId({
		ephemeralActivityItems: input.ephemeralActivityItems,
		initialFocusInteractionId: input.initialFocusInteractionId,
		initialFocusSignalId: input.initialFocusSignalId,
		presentedWakeProgressItems: input.presentedWakeProgressItems,
	});
	const initialFocusThread = input.initialFocusThreadRootSignalId
		? threadsByRootSignalId.get(input.initialFocusThreadRootSignalId)
		: undefined;
	const threadFocusStatusMessage = resolveInitialThreadFocusStatusMessage({
		hasTargetThread: initialFocusThread !== undefined,
		isLoading: input.threadsIsLoading === true,
		rootSignalId: input.initialFocusThreadRootSignalId,
		threadsErrorMessage: input.threadsErrorMessage,
	});
	useEffect(() => {
		const rootSignalId = input.initialFocusThreadRootSignalId;
		if (!rootSignalId) {
			appliedInitialThreadFocusRef.current = null;
			return;
		}
		const targetKey = `${input.spaceId ?? "space"}:${rootSignalId}`;
		if (appliedInitialThreadFocusRef.current === targetKey) {
			return;
		}
		if (initialFocusThread) {
			appliedInitialThreadFocusRef.current = targetKey;
			onOpenThread(initialFocusThread.threadId);
		}
	}, [
		input.initialFocusThreadRootSignalId,
		input.spaceId,
		initialFocusThread,
		onOpenThread,
	]);
	useEffect(() => {
		if (input.initialFocusThreadRootSignalId) {
			return;
		}
		const targetKey =
			input.initialFocusInteractionId ?? input.initialFocusSignalId ?? null;
		if (!targetKey) {
			appliedInitialFocusRef.current = null;
			focusHistorySearchRef.current = { attempts: 0, targetKey: "" };
			setMainFocusStatusMessage(null);
			return;
		}
		if (focusHistorySearchRef.current.targetKey !== targetKey) {
			focusHistorySearchRef.current = { attempts: 0, targetKey };
			appliedInitialFocusRef.current = null;
			setMainFocusStatusMessage(null);
		}
		if (appliedInitialFocusRef.current === targetKey) {
			return;
		}
		if (input.activeSpaceView === "graph") {
			input.onSpaceViewChange("messages");
			return;
		}
		continueInitialMainTimelineFocusSearch({
			appliedInitialFocusRef,
			focusHistorySearchRef,
			hasEarlierHistory: input.hasEarlierHistory,
			historyActionErrorMessage: input.historyActionErrorMessage,
			historyIsPending: input.historyIsPending,
			isLoadingEarlierHistory: input.isLoadingEarlierHistory,
			jumpToMessage,
			loadEarlierHistory,
			mainTimelineItemCount: mainTimelineItems.length,
			messageElementsBySignalIdRef,
			setMainFocusStatusMessage,
			signalId: initialMainFocusSignalId,
			spaceId: input.spaceId,
			targetKey,
		});
	}, [
		input.hasEarlierHistory,
		input.historyActionErrorMessage,
		input.historyIsPending,
		input.initialFocusInteractionId,
		input.initialFocusSignalId,
		input.initialFocusThreadRootSignalId,
		input.isLoadingEarlierHistory,
		input.spaceId,
		initialMainFocusSignalId,
		jumpToMessage,
		loadEarlierHistory,
		mainTimelineItems,
		input.activeSpaceView,
		input.onSpaceViewChange,
	]);
	useEffect(() => {
		if (input.activeSpaceView === "graph") {
			input.onViewingLatestChange?.(false);
		}
	}, [input.activeSpaceView, input.onViewingLatestChange]);
	const submitComposer = () => {
		if (composerSendBlocked || !canSendMessage || input.isSendingMessage) {
			return;
		}
		input.onSend().catch((error) => {
			console.error("Failed to send a space message from composer.", error);
		});
	};
	useEffect(() => {
		const conversationScrollElement = conversationScrollRef.current;
		if (
			input.initialFocusInteractionId ||
			input.initialFocusSignalId ||
			input.initialFocusThreadRootSignalId ||
			!(conversationScrollElement && input.hasEarlierHistory) ||
			input.isLoadingEarlierHistory ||
			mainTimelineItems.length === 0 ||
			conversationScrollElement.clientHeight === 0 ||
			conversationScrollElement.scrollHeight >
				conversationScrollElement.clientHeight
		) {
			return;
		}

		loadEarlierHistory().catch((error) => {
			console.error("Failed to auto-load earlier space history.", error);
		});
	}, [
		input.hasEarlierHistory,
		input.initialFocusInteractionId,
		input.initialFocusSignalId,
		input.initialFocusThreadRootSignalId,
		input.isLoadingEarlierHistory,
		loadEarlierHistory,
		mainTimelineItems.length,
	]);

	useEffect(
		() => () => {
			if (highlightMessageTimerRef.current !== null) {
				window.clearTimeout(highlightMessageTimerRef.current);
			}
		},
		[]
	);

	return (
		<section
			aria-label="Space conversation"
			className={cn(
				"flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
				input.className
			)}
		>
			{input.historyActionErrorMessage || input.historyErrorMessage ? (
				<div className="border-border border-b bg-destructive/10 px-4 py-3 text-destructive text-sm sm:px-5">
					{input.historyActionErrorMessage ?? input.historyErrorMessage}
				</div>
			) : null}
			{renderInitialSpaceFocusStatus({
				mainMessage: mainFocusStatusMessage,
				threadMessage: threadFocusStatusMessage,
			})}

			<SpacePrimaryView
				activeView={input.activeSpaceView}
				files={input.files}
				graph={
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
				}
				idPrefix={input.spaceViewIdPrefix}
				messages={
					<MessageScrollerProvider
						autoScroll={true}
						defaultScrollPosition="end"
					>
						<SpaceConversationSendScrollController
							isSendingMessage={input.isSendingMessage}
						/>
						<MessageScroller className="relative min-h-0 flex-1">
							<ConversationLatestObserver
								onChange={input.onViewingLatestChange}
							/>
							<SpaceConversationTopOverlay
								overlayRef={setConversationTopOverlayElement}
							>
								<EarlierHistoryLoadingIndicator
									visible={showEarlierHistoryLoadingIndicator}
								/>
								{setupGuidance.banner}
								<SpaceUnreadAboveControl
									dismissedTargetKeys={dismissedUnreadTargetKeys}
									navigation={unreadNavigation}
									onDismiss={() => {
										setDismissedUnreadTargetKeys((current) =>
											mergeUnreadTargetKeys(
												current,
												unreadNavigation.aboveTargetKeys
											)
										);
									}}
									onNavigate={revealUnreadTarget}
								/>
							</SpaceConversationTopOverlay>
							<MessageScrollerViewport
								aria-busy={
									input.historyIsPending || input.isLoadingEarlierHistory
								}
								aria-label="Conversation history"
								aria-live="polite"
								className="h-full py-4"
								data-scroll-restoration-id={buildSpaceConversationScrollRestorationId(
									input.spaceId
								)}
								onScroll={(event) => {
									const conversationScrollElement = event.currentTarget;
									requestUnreadMeasurement();
									if (conversationScrollElement.scrollTop > 48) {
										return;
									}

									loadEarlierHistory().catch((error) => {
										console.error(
											"Failed to lazy-load earlier space history from scroll.",
											error
										);
									});
								}}
								ref={registerConversationScrollElement}
								role="log"
							>
								<SpaceConversationStickyDate
									loadedSignalCount={loadedMainTimelineSignalIds.size}
									onActiveDateMsChange={setStuckConversationDateMs}
									onJumpToDate={input.onJumpToDate}
									scrollElement={conversationScrollElement}
									topOverlayElement={conversationTopOverlayElement}
								/>
								<MessageScrollerContent
									className="w-full gap-0 pt-[var(--space-conversation-top-overlay-height,0px)]"
									data-space-conversation-content-width=""
								>
									{conversationBody}
								</MessageScrollerContent>
							</MessageScrollerViewport>

							<ConversationJumpButton
								dismissedTargetKeys={dismissedUnreadTargetKeys}
								navigation={unreadNavigation}
								onDismissUnread={() => {
									setDismissedUnreadTargetKeys((current) =>
										mergeUnreadTargetKeys(
											current,
											unreadNavigation.belowTargetKeys
										)
									);
								}}
								onNavigateUnread={revealUnreadTarget}
							/>
						</MessageScroller>
					</MessageScrollerProvider>
				}
			/>

			{showComposer ? (
				<>
					{input.pendingActionSurface}
					<SpaceComposerSection
						canSendMessage={canSendMessage}
						composerAccessibleName={composerAccessibleName}
						composerPlaceholder={composerPlaceholder}
						composerSendBlocked={composerSendBlocked}
						input={input}
						sendButtonLabel={sendButtonLabel}
						submitComposer={submitComposer}
						wakeTextHint={wakeTextHint}
					/>
				</>
			) : null}
			{messageDetailsItem && input.spaceId ? (
				<SpaceMessageDetailsDrawer
					canJumpToMessage={(signalId) =>
						loadedMainTimelineSignalIds.has(signalId)
					}
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
					onRetryWakeTarget={resolveWritableSpaceAction(
						isReadOnly,
						input.onRetryWakeTarget
					)}
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

function SpacePrimaryView(input: {
	activeView: SpaceView;
	files?: ReactNode;
	graph: ReactNode;
	idPrefix: string;
	messages: ReactNode;
}) {
	const selectedIndex = getSpaceViewIndex(input.activeView);
	let activeContent = input.files;
	if (input.activeView === "messages") {
		activeContent = input.messages;
	} else if (input.activeView === "graph") {
		activeContent = input.graph;
	}
	return (
		<div
			aria-labelledby={`${input.idPrefix}-tab-${selectedIndex}`}
			className="flex min-h-0 flex-1 flex-col"
			id={`${input.idPrefix}-panel-${selectedIndex}`}
			role="tabpanel"
		>
			{activeContent}
		</div>
	);
}

function resolveInitialMainFocusSignalId(
	input: Pick<
		SpaceConversationPanelProps,
		| "ephemeralActivityItems"
		| "initialFocusInteractionId"
		| "initialFocusSignalId"
		| "presentedWakeProgressItems"
	>
): string | undefined {
	if (input.initialFocusSignalId) {
		return input.initialFocusSignalId;
	}
	if (!input.initialFocusInteractionId) {
		return undefined;
	}
	return (
		[...input.ephemeralActivityItems, ...input.presentedWakeProgressItems].find(
			(item) =>
				item.pendingInteraction?.interactionId ===
				input.initialFocusInteractionId
		)?.sourceSignalId ?? undefined
	);
}

function resolveInitialThreadFocusStatusMessage(input: {
	hasTargetThread: boolean;
	isLoading: boolean;
	rootSignalId?: string;
	threadsErrorMessage?: string | null;
}): string | null {
	if (!input.rootSignalId || input.hasTargetThread || input.isLoading) {
		return null;
	}
	return input.threadsErrorMessage
		? "Couldn’t open the linked thread. Refresh this Space and try again."
		: "This linked thread isn’t available. It may have been removed or you may no longer have access.";
}

function continueInitialMainTimelineFocusSearch(input: {
	appliedInitialFocusRef: { current: string | null };
	focusHistorySearchRef: {
		current: { attempts: number; targetKey: string };
	};
	hasEarlierHistory: boolean;
	historyActionErrorMessage: string | null;
	historyIsPending: boolean;
	isLoadingEarlierHistory: boolean;
	jumpToMessage: (signalId: string) => void;
	loadEarlierHistory: () => Promise<void>;
	mainTimelineItemCount: number;
	messageElementsBySignalIdRef: {
		current: ReadonlyMap<string, HTMLElement>;
	};
	setMainFocusStatusMessage: (message: string | null) => void;
	signalId?: string;
	spaceId?: string;
	targetKey: string;
}) {
	if (
		input.signalId &&
		input.messageElementsBySignalIdRef.current.has(input.signalId)
	) {
		input.appliedInitialFocusRef.current = input.targetKey;
		input.setMainFocusStatusMessage(null);
		input.jumpToMessage(input.signalId);
		return;
	}
	if (input.historyIsPending || input.isLoadingEarlierHistory) {
		return;
	}
	if (input.historyActionErrorMessage) {
		input.setMainFocusStatusMessage(
			"Couldn’t load older messages to find this link. Try loading earlier messages again."
		);
		return;
	}
	if (
		input.hasEarlierHistory &&
		input.mainTimelineItemCount > 0 &&
		input.focusHistorySearchRef.current.attempts <
			MAX_SPACE_FOCUS_HISTORY_LOAD_ATTEMPTS
	) {
		input.focusHistorySearchRef.current.attempts += 1;
		input.loadEarlierHistory().catch((error: unknown) => {
			console.warn("[openmeld.web.space.inbox_focus_history_failed]", {
				error: error instanceof Error ? error.message : String(error),
				signalId: input.signalId,
				spaceId: input.spaceId,
			});
			input.setMainFocusStatusMessage(
				"Couldn’t load older messages to find this link. Try loading earlier messages again."
			);
		});
		return;
	}
	input.setMainFocusStatusMessage(
		"This linked message isn’t available. It may have been removed or be outside the available Space history."
	);
}

function renderInitialSpaceFocusStatus(input: {
	mainMessage: string | null;
	threadMessage: string | null;
}) {
	const message = input.threadMessage ?? input.mainMessage;
	if (!message) {
		return null;
	}
	return (
		<output
			aria-label={
				input.threadMessage
					? "Linked thread isn't available"
					: "Linked message isn't available"
			}
			className="border-border border-b bg-muted/40 px-4 py-3 text-muted-foreground text-sm sm:px-5"
		>
			{message}
		</output>
	);
}

function ConversationLatestObserver(input: {
	onChange?: (isViewingLatest: boolean) => void;
}) {
	const { end: canScrollToEnd } = useMessageScrollerScrollable();

	useEffect(() => {
		input.onChange?.(!canScrollToEnd);
	}, [canScrollToEnd, input.onChange]);

	return null;
}

function ConversationJumpButton(input: {
	dismissedTargetKeys: ReadonlySet<string>;
	navigation: SpaceUnreadNavigationState;
	onDismissUnread: () => void;
	onNavigateUnread: (target: SpaceInboxUnreadTarget) => Promise<void>;
}) {
	const shouldReduceMotion = useReducedMotion();
	const showUnread =
		input.navigation.belowCount > 0 &&
		hasUndismissedUnreadTarget(
			input.navigation.belowTargetKeys,
			input.dismissedTargetKeys
		);
	if (showUnread && input.navigation.nearestBelow) {
		return (
			<div className="absolute inset-x-0 bottom-4 z-20 flex justify-center">
				<SpaceUnreadNavigationPill
					count={input.navigation.belowCount}
					direction="below"
					onDismiss={input.onDismissUnread}
					onNavigate={() => {
						runUnreadNavigation(
							input.navigation.nearestBelow,
							input.onNavigateUnread
						);
					}}
				/>
			</div>
		);
	}

	return (
		<MessageScrollerButton
			aria-label="Jump to latest message"
			behavior={shouldReduceMotion ? "auto" : "smooth"}
			className="z-20 min-h-11 min-w-11 gap-1.5 rounded-full border border-border bg-background/95 px-3 text-foreground shadow-md backdrop-blur-sm hover:bg-muted"
			direction="end"
			size="icon-lg"
			type="button"
			variant="secondary"
		>
			<CaretDoubleDownIcon aria-hidden="true" weight="bold" />
		</MessageScrollerButton>
	);
}

function SpaceUnreadAboveControl(input: {
	dismissedTargetKeys: ReadonlySet<string>;
	navigation: SpaceUnreadNavigationState;
	onDismiss: () => void;
	onNavigate: (target: SpaceInboxUnreadTarget) => Promise<void>;
}) {
	if (
		input.navigation.aboveCount <= 0 ||
		!hasUndismissedUnreadTarget(
			input.navigation.aboveTargetKeys,
			input.dismissedTargetKeys
		) ||
		!input.navigation.nearestAbove
	) {
		return null;
	}
	return (
		<SpaceUnreadNavigationPill
			count={input.navigation.aboveCount}
			direction="above"
			onDismiss={input.onDismiss}
			onNavigate={() => {
				runUnreadNavigation(input.navigation.nearestAbove, input.onNavigate);
			}}
		/>
	);
}

function runUnreadNavigation(
	target: SpaceInboxUnreadTarget | null,
	navigate: (target: SpaceInboxUnreadTarget) => Promise<void>
): void {
	if (!target) {
		return;
	}
	navigate(target).catch((error: unknown) => {
		console.error("Failed to reveal an unread Space message.", error);
	});
}

function SpaceUnreadNavigationPill(input: {
	count: number;
	direction: "above" | "below";
	onDismiss: () => void;
	onNavigate: () => void;
}) {
	const label = `${String(input.count)} new ${input.count === 1 ? "message" : "messages"}${input.direction === "above" ? " above" : ""}`;
	const navigateLabel = `${label}. Jump to the nearest new message`;
	const dismissLabel = `Hide ${label}`;
	return (
		<div
			className="pointer-events-auto inline-flex self-center overflow-hidden rounded-full border border-border bg-background/95 text-foreground shadow-md backdrop-blur-sm"
			data-unread-direction={input.direction}
		>
			<Button
				aria-label={navigateLabel}
				className="min-h-10 gap-1.5 rounded-none border-0 bg-transparent px-3 hover:bg-muted focus-visible:z-10"
				onClick={input.onNavigate}
				size="sm"
				type="button"
				variant="secondary"
			>
				{input.direction === "above" ? (
					<ArrowUpIcon aria-hidden="true" weight="bold" />
				) : (
					<CaretDoubleDownIcon aria-hidden="true" weight="bold" />
				)}
				<span>{label}</span>
			</Button>
			<Button
				aria-label={dismissLabel}
				className="min-h-10 min-w-10 rounded-none border-0 border-border border-l bg-transparent px-0 hover:bg-muted focus-visible:z-10"
				onClick={input.onDismiss}
				size="icon"
				type="button"
				variant="secondary"
			>
				<XIcon aria-hidden="true" />
			</Button>
		</div>
	);
}

function resolveSpaceUnreadNavigationState(input: {
	hasEarlierHistory: boolean;
	messageElementsBySignalId: ReadonlyMap<string, HTMLElement>;
	scrollElement: HTMLElement | null;
	targets: readonly SpaceInboxUnreadTarget[];
}): SpaceUnreadNavigationState {
	if (!(input.scrollElement && input.targets.length > 0)) {
		return EMPTY_SPACE_UNREAD_NAVIGATION_STATE;
	}
	const viewport = input.scrollElement.getBoundingClientRect();
	const above: Array<{
		distance: number;
		target: SpaceInboxUnreadTarget;
	}> = [];
	const below: Array<{
		distance: number;
		target: SpaceInboxUnreadTarget;
	}> = [];
	for (const target of input.targets) {
		const anchorSignalId = target.threadRootSignalId ?? target.signalId;
		const element = input.messageElementsBySignalId.get(anchorSignalId);
		if (!element) {
			if (input.hasEarlierHistory) {
				above.push({ distance: Number.POSITIVE_INFINITY, target });
			}
			continue;
		}
		const rect = element.getBoundingClientRect();
		if (rect.bottom < viewport.top) {
			above.push({ distance: viewport.top - rect.bottom, target });
		} else if (rect.top > viewport.bottom) {
			below.push({ distance: rect.top - viewport.bottom, target });
		}
	}
	above.sort((left, right) => left.distance - right.distance);
	below.sort((left, right) => left.distance - right.distance);
	return {
		aboveCount: above.length,
		aboveTargetKeys: above.map((item) => unreadTargetKey(item.target)),
		belowCount: below.length,
		belowTargetKeys: below.map((item) => unreadTargetKey(item.target)),
		nearestAbove: above[0]?.target ?? null,
		nearestBelow: below[0]?.target ?? null,
	};
}

function scrollMessageIntoConversationViewport(input: {
	messageElement: HTMLElement;
	scrollElement: HTMLElement;
}): void {
	const alignMessage = () => {
		const messageRect = input.messageElement.getBoundingClientRect();
		const viewportRect = input.scrollElement.getBoundingClientRect();
		const messageCenter = (messageRect.top + messageRect.bottom) / 2;
		const viewportCenter = (viewportRect.top + viewportRect.bottom) / 2;
		input.scrollElement.scrollTop += messageCenter - viewportCenter;
	};
	alignMessage();
	window.requestAnimationFrame(() => {
		window.requestAnimationFrame(alignMessage);
	});
}

function unreadTargetKey(target: SpaceInboxUnreadTarget): string {
	return `${target.threadRootSignalId ?? "main"}:${target.signalId}`;
}

function hasUndismissedUnreadTarget(
	targetKeys: readonly string[],
	dismissedTargetKeys: ReadonlySet<string>
): boolean {
	return targetKeys.some((key) => !dismissedTargetKeys.has(key));
}

function mergeUnreadTargetKeys(
	current: ReadonlySet<string>,
	targetKeys: readonly string[]
): Set<string> {
	return new Set([...current, ...targetKeys]);
}

function EarlierHistoryLoadingIndicator(input: { visible: boolean }) {
	const shouldReduceMotion = useReducedMotion();
	const hiddenFrame = shouldReduceMotion
		? { opacity: 0 }
		: { opacity: 0, transform: "translateY(-4px)" };
	const visibleFrame = shouldReduceMotion
		? { opacity: 1 }
		: { opacity: 1, transform: "translateY(0px)" };

	return (
		<AnimatePresence initial={false}>
			{input.visible ? (
				<motion.div
					animate={visibleFrame}
					className="pointer-events-none h-16 shrink-0"
					data-slot="earlier-history-loading"
					exit={hiddenFrame}
					initial={hiddenFrame}
					key="earlier-history-loading"
					transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
				>
					<div
						className="relative mx-auto flex h-full items-center justify-center"
						data-space-conversation-content-width=""
					>
						<ProgressiveBlur blurAmount="6px" height="100%" />
						<output className="relative z-10 inline-flex max-w-full items-center gap-2 overflow-hidden px-3 text-muted-foreground text-xs">
							<Bars aria-hidden="true" className="h-3 w-5 shrink-0" />
							<span className="truncate">Loading earlier messages...</span>
						</output>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
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

function SpaceComposerSection(input: {
	canSendMessage: boolean;
	composerAccessibleName: string;
	composerSendBlocked: boolean;
	composerPlaceholder: string;
	input: SpaceConversationPanelProps;
	sendButtonLabel: string;
	submitComposer: () => void;
	wakeTextHint: string | null;
}) {
	const panel = input.input;
	const fileUploadInProgress = panel.composerFiles.some(
		isSpaceComposerFileInProgress
	);
	const composerActionsDisabled =
		panel.isSendingMessage || !input.canSendMessage;
	const {
		addFiles,
		handleDragLeave,
		handleDragOver,
		handleDrop,
		handlePaste,
		isDraggingFiles,
	} = useSpaceComposerFileInput({
		disabled: composerActionsDisabled,
		onAddFiles: panel.onAddComposerFiles,
	});
	const fileHint = resolveSpaceComposerFileHint({
		files: panel.composerFiles,
		fileLimitReached: panel.composerFileLimitReached,
		fileUploadInProgress,
	});
	const composerHint = fileHint ?? input.wakeTextHint;
	const composerHintClassName = input.wakeTextHint
		? "text-foreground"
		: "text-muted-foreground";

	return (
		<div className="shrink-0 bg-background" data-slot="space-composer-section">
			<div
				className="flex w-full flex-col gap-3 py-4"
				data-space-conversation-content-width=""
			>
				<div className="relative">
					{isDraggingFiles ? (
						<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border border-foreground/30 bg-background/90 text-foreground text-sm shadow-sm backdrop-blur-sm">
							Drop files to add them
						</div>
					) : null}
					{panel.composerReplyToSignalId ? (
						<div
							className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm"
							data-slot="composer-reply-banner"
						>
							<p className="min-w-0 truncate text-muted-foreground">
								Replying to{" "}
								<span className="font-bold text-foreground">
									{resolveReplyToDisplayText({
										signalId: panel.composerReplyToSignalId,
										timelineItems: panel.timelineItems,
									})}
								</span>
							</p>
							<Button
								aria-label="Cancel reply"
								className="size-7 shrink-0"
								onClick={panel.onClearComposerReplyTo}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<XIcon aria-hidden="true" />
							</Button>
						</div>
					) : null}
					<PromptInput
						className="w-full"
						maxHeight={240}
						onSubmit={input.submitComposer}
						value={panel.composerText}
					>
						<SpaceComposerFileTray
							disabled={panel.isSendingMessage}
							files={panel.composerFiles}
							onRemove={panel.onRemoveComposerFile}
						/>
						<SpaceComposerEditor
							addressingTargets={panel.composerAddressingTargets ?? []}
							ariaLabel={input.composerAccessibleName}
							authoredMentions={panel.composerAuthoredMentions ?? []}
							composerRef={panel.textareaRef}
							mentionPickerItems={panel.composerMentionPickerItems ?? []}
							onChange={(change) => {
								panel.onComposerEditorChange(change);
							}}
							onDragEnter={handleDragOver}
							onDragLeave={handleDragLeave}
							onDragOver={handleDragOver}
							onDrop={handleDrop}
							onPaste={handlePaste}
							onSend={input.submitComposer}
							placeholder={input.composerPlaceholder}
							text={panel.composerText}
						/>
						<PromptInputActions className="min-w-0 justify-between gap-3 border-border border-t pt-2">
							<div className="flex min-w-0 flex-1 items-center gap-0">
								<SpaceComposerFileMenu
									addFiles={addFiles}
									disabled={composerActionsDisabled}
									limitReached={panel.composerFileLimitReached}
								/>
								{panel.isCenterAgentDirectMessage ||
								panel.agentDirectConversationKind ? null : (
									<Button
										aria-label="Mention a member"
										className="size-8 text-base"
										disabled={composerActionsDisabled}
										onClick={panel.onMentionButtonClick}
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<span aria-hidden="true">@</span>
									</Button>
								)}
								{composerHint ? (
									<p
										aria-live="polite"
										className={cn(
											"min-w-0 flex-1 text-xs leading-5 max-sm:line-clamp-2 max-sm:whitespace-normal sm:truncate",
											composerHintClassName
										)}
									>
										{composerHint}
									</p>
								) : null}
							</div>
							<div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
								{panel.profileControl}
								{panel.composerPrimaryAction ?? (
									<PromptInputAction
										className="hidden sm:inline-flex"
										tooltip={
											panel.isSendingMessage ? "Sending…" : "Send message"
										}
									>
										<Button
											aria-label={input.sendButtonLabel}
											disabled={
												panel.isSendingMessage ||
												!input.canSendMessage ||
												input.composerSendBlocked
											}
											onClick={input.submitComposer}
											size="icon-sm"
											type="button"
										>
											<ArrowUpIcon aria-hidden="true" weight="bold" />
										</Button>
									</PromptInputAction>
								)}
							</div>
						</PromptInputActions>
					</PromptInput>
				</div>
				{panel.composerErrorMessage ? (
					<div className="flex flex-col items-start gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm">
						<p>{panel.composerErrorMessage}</p>
						{renderComposerBlockedWakeRecoveryAction({
							agentRecoveryPlansByProfileId:
								panel.agentRecoveryPlansByProfileId,
							blockedWakeProfileId: panel.composerBlockedWakeProfileId,
							isAgentRecoveryPending: panel.isAgentRecoveryPending,
							onAgentRecoveryAction: panel.onAgentRecoveryAction,
							orgSlug: panel.orgSlug,
							prepareSetupHref: panel.prepareSetupHref,
						})}
					</div>
				) : null}
			</div>
		</div>
	);
}

function resolveSpaceComposerFileHint(input: {
	files: readonly SpaceComposerFile[];
	fileLimitReached: boolean;
	fileUploadInProgress: boolean;
}): string | null {
	if (input.fileUploadInProgress) {
		return "Uploading files before sending…";
	}
	const failedCount = input.files.filter(isSpaceComposerFileFailed).length;
	if (failedCount > 0) {
		return `${String(failedCount)} ${failedCount === 1 ? "file" : "files"} couldn't be uploaded and won't be sent.`;
	}
	if (input.fileLimitReached) {
		return "You can add up to 10 files.";
	}
	const readyCount = input.files.filter(
		(file) => file.status === "ready"
	).length;
	if (readyCount > 0) {
		return `${String(readyCount)} ${readyCount === 1 ? "file" : "files"} ready to send`;
	}
	return null;
}

function renderConversationBody(input: {
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
	emptyStateTitle?: string;
	editableAgentProfileIds?: ReadonlySet<string>;
	entries: ReturnType<typeof buildSpaceConversationEntries>;
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
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onJumpToDate?: (date: Date) => Promise<string | null>;
	onJumpToMessage: (signalId: string) => void;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenThread: (threadId: string) => void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onReplyToMessage: (item: SpaceTimelineItem) => void;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	onSendStarterPrompt: (prompt: string) => Promise<void>;
	onStartComputerSetup: () => void;
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
	spaceReferencesById?: SpaceMessageReferencesById;
	stuckDateMs: number | null;
	highlightedSignalId: string | null;
	timelineItems: readonly SpaceTimelineItem[];
	wakeOutcomeIndex: SpaceWakeOutcomeIndex;
	threadsByRootSignalId: ReadonlyMap<string, SpaceThread>;
	threadPreviewByThreadId: ReadonlyMap<string, SpaceThreadPreview>;
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
				onSelectStarterAction={input.onSendStarterPrompt}
				onStartComputerSetup={input.onStartComputerSetup}
				showStarterActions={input.showCenterAgentStarterActions}
				showStarterComputerSetup={input.showStarterComputerSetup}
			/>
		</MessageScrollerItem>
	) : null;

	if (input.historyIsPending) {
		return (
			<>
				{Array.from({ length: 4 }).map((_, index) => (
					<MessageScrollerItem
						key={`space-conversation-loading-${String(index)}`}
						messageId={`space-conversation-loading-${String(index)}`}
					>
						<div className="h-20 border border-border bg-muted" />
					</MessageScrollerItem>
				))}
			</>
		);
	}

	if (input.entries.length === 0) {
		if (centerAgentDirectMessageIntroItem) {
			return centerAgentDirectMessageIntroItem;
		}

		return (
			<MessageScrollerItem
				className="flex flex-1 [content-visibility:visible]"
				messageId="space-conversation-empty"
			>
				<div className="flex min-h-56 w-full flex-1 items-center justify-center px-6 py-8">
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

	return (
		<>
			{centerAgentDirectMessageIntroItem}
			{input.entries.map((entry) => {
				const createdAtMs = resolveConversationEntryCreatedAtMs(entry);
				const date = new Date(createdAtMs);
				const dateKey = resolveLocalDateKey(date);
				const shouldRenderDateMarker = dateKey !== previousDateKey;
				previousDateKey = dateKey;
				const firstSignalId = resolveConversationEntryFirstSignalId(entry);
				const shouldRenderUnreadBoundary =
					!unreadBoundaryRendered &&
					input.firstUnreadSignalId !== null &&
					firstSignalId === input.firstUnreadSignalId;
				if (shouldRenderUnreadBoundary) {
					unreadBoundaryRendered = true;
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
									stuck={createdAtMs === input.stuckDateMs}
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
									className="py-3 font-medium text-foreground"
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
					<ConversationBubbleRun
						actionableAgentInteractionPlacement={
							input.actionableAgentInteractionPlacement
						}
						agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
						anchoredOutcomeNoticesBySourceSignalId={
							input.anchoredOutcomeNoticesBySourceSignalId
						}
						centerAgentProfileId={input.centerAgentProfileId}
						currentOwnerUserId={input.currentOwnerUserId}
						editableAgentProfileIds={input.editableAgentProfileIds}
						ephemeralActivityItems={input.ephemeralActivityItems}
						highlightedSignalId={input.highlightedSignalId}
						inlineComputerSetupActionSignalId={
							inlineComputerSetupActionSignalId
						}
						isAgentRecoveryPending={input.isAgentRecoveryPending}
						isCenterAgentDirectMessage={input.isCenterAgentDirectMessage}
						isCreatingThread={input.isCreatingThread}
						isPersonalContext={input.isPersonalContext === true}
						loadedMainTimelineSignalIds={input.loadedMainTimelineSignalIds}
						membersSnapshot={input.membersSnapshot}
						modelCatalog={input.modelCatalog}
						onAgentInteractionResponse={input.onAgentInteractionResponse}
						onAgentRecoveryAction={input.onAgentRecoveryAction}
						onCreateThread={input.onCreateThread}
						onEditAgentProfile={input.onEditAgentProfile}
						onJumpToMessage={input.onJumpToMessage}
						onOpenMessageDetails={input.onOpenMessageDetails}
						onOpenSpaceFile={input.onOpenSpaceFile}
						onOpenThread={input.onOpenThread}
						onRecoverExecution={input.onRecoverExecution}
						onReplyToMessage={input.onReplyToMessage}
						onRetryWakeTarget={input.onRetryWakeTarget}
						onSendStarterPrompt={input.onSendStarterPrompt}
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
						threadPreviewByThreadId={input.threadPreviewByThreadId}
						threadsByRootSignalId={input.threadsByRootSignalId}
						timelineItems={input.timelineItems}
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
		</>
	);
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

function CenterAgentDirectMessageIntro(input: {
	computerSetupContext?: CenterAgentComputerSetupContext;
	disabled: boolean;
	isPersonalContext: boolean;
	onSelectStarterAction: (prompt: string) => Promise<void>;
	onStartComputerSetup: () => void;
	showStarterActions: boolean;
	showStarterComputerSetup: boolean;
}) {
	let starterContent: ReactNode = null;
	if (input.showStarterComputerSetup && input.computerSetupContext) {
		starterContent = (
			<CenterAgentComputerSetupCard
				context={input.computerSetupContext}
				target={{ kind: "computer_setup", mode: "setup" }}
			/>
		);
	} else if (input.showStarterActions) {
		starterContent = (
			<CenterAgentStarterActions
				disabled={input.disabled}
				onConnectComputer={input.onStartComputerSetup}
				onSelect={input.onSelectStarterAction}
			/>
		);
	}

	return (
		<div
			className="flex min-h-72 flex-col justify-end pt-12 pb-10"
			data-center-agent-direct-message-intro=""
		>
			<div className="flex flex-col gap-6">
				<div className="flex items-end gap-5">
					<div className="flex h-28 shrink-0 items-center text-foreground">
						<OpenMeldLetterLogoStrong
							ariaLabel="OpenMeld O logo"
							className="translate-y-2"
							pointerTracking="viewport"
							size={16}
						/>
					</div>
					<div className="min-w-0 pb-1">
						<div className="flex min-w-0 items-center gap-2">
							<h2 className="break-words font-semibold text-3xl text-foreground">
								Center Agent
							</h2>
							<Badge
								className="h-6 bg-muted px-2 text-muted-foreground uppercase leading-none"
								variant="outline"
							>
								Remote
							</Badge>
							<span
								aria-label="Online"
								className={cn(
									"size-3 shrink-0 rounded-full",
									resolveStatusToneIndicatorClassName("ready", "solid")
								)}
								role="img"
							/>
						</div>
					</div>
				</div>
				<div className="flex max-w-3xl flex-col gap-4">
					<p className="text-foreground text-xl leading-8">
						{input.isPersonalContext
							? "Your private chat with the Center Agent — your always-on coordinator."
							: "Your private chat with the Center Agent — your organization's always-on coordinator."}
					</p>
					{starterContent}
				</div>
			</div>
		</div>
	);
}

const ConversationBubbleRun = memo(function ConversationBubbleRun(input: {
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	anchoredOutcomeNoticesBySourceSignalId: ReadonlyMap<
		string,
		readonly SpaceTimelineItem[]
	>;
	centerAgentProfileId: string | null;
	currentOwnerUserId: string | null;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	editableAgentProfileIds?: ReadonlySet<string>;
	highlightedSignalId: string | null;
	actionableAgentInteractionPlacement: SpaceAgentInteractionPlacement;
	inlineComputerSetupActionSignalId: string | null;
	isAgentRecoveryPending: (profileId: string) => boolean;
	isCenterAgentDirectMessage: boolean;
	isCreatingThread: boolean;
	isPersonalContext: boolean;
	loadedMainTimelineSignalIds: ReadonlySet<string>;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onJumpToMessage: (signalId: string) => void;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenThread: (threadId: string) => void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onReplyToMessage: (item: SpaceTimelineItem) => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	onSendStarterPrompt: (prompt: string) => Promise<void>;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	orgSlug?: string;
	prepareSetupHref?: string;
	profileDetailsEntry: SpaceMemberDirectoryEntry | null;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	readOnly: boolean;
	registerMessageElement: (
		signalId: string,
		element: HTMLElement | null
	) => void;
	run: SpaceConversationBubbleRun;
	selfAvatarImageUrl: string | null;
	selfProfileId: string;
	spaceId?: string;
	spaceReferencesById?: SpaceMessageReferencesById;
	timelineItems: readonly SpaceTimelineItem[];
	wakeOutcomeIndex: SpaceWakeOutcomeIndex;
	threadsByRootSignalId: ReadonlyMap<string, SpaceThread>;
	threadPreviewByThreadId: ReadonlyMap<string, SpaceThreadPreview>;
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
	const agentControlLabel = formatSpaceAgentControlLabel({
		agentControllerRef: input.run.speaker.agentControllerRef,
		controllerDisplay: input.run.speaker.controllerDisplay,
		profileKind: input.run.speaker.profileKind,
		runtimeDeviceDisplayName: input.run.speaker.runtimeDeviceDisplayName,
	});
	const messageAlign = resolveSpaceMessageDirectionalAlign(input.run.isSelf);
	const selfMessageContentLayoutClassName =
		resolveSpaceMessageContentLayoutClassName({ isSelf: input.run.isSelf });
	const messageContentPaddingClassName =
		resolveSpaceMessageContentPaddingClassName({ isSelf: input.run.isSelf });
	const isCenterAgentRun = resolveIsCenterAgentConversationRun({
		centerAgentProfileId: input.centerAgentProfileId,
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		run: input.run,
	});
	const detailsDialog = useSpaceProfileDetailsDialog({
		currentOwnerUserId: input.currentOwnerUserId,
		entry: input.profileDetailsEntry,
		entriesByProfileId: input.profileEntriesById,
		modelCatalog: input.modelCatalog,
	});
	const computerSetupContext = resolveCenterAgentComputerSetupContext({
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		orgSlug: input.orgSlug,
		profileId: input.selfProfileId,
		spaceId: input.spaceId,
	});
	const speakerHeaderContent = (
		<>
			<SpaceMessageProfileAvatar
				agentControllerPending={input.run.speaker.agentControllerPending}
				agentControllerRef={input.run.speaker.agentControllerRef}
				avatarImageUrl={
					input.run.speaker.avatarImageUrl ??
					(input.run.speaker.profileId === input.selfProfileId
						? input.selfAvatarImageUrl
						: null)
				}
				displayName={input.run.speaker.displayName}
				isCenterAgent={isCenterAgentRun}
				profileId={input.run.speaker.profileId}
				profileKind={input.run.speaker.profileKind}
			/>
			<span className="min-w-0 break-words font-bold text-foreground text-sm">
				{input.run.speaker.displayName}
			</span>
			{agentControlLabel ? (
				<>
					<span className="shrink-0 text-muted-foreground">·</span>
					<span className="min-w-0 text-muted-foreground">
						{agentControlLabel}
					</span>
				</>
			) : null}
		</>
	);

	return (
		<>
			{input.run.items.map((item, index) => {
				const anchoredOutcomeNotices =
					input.anchoredOutcomeNoticesBySourceSignalId.get(item.id) ??
					EMPTY_ANCHORED_OUTCOME_NOTICES;
				const wakePresentationItem = resolveSpaceMessageWakePresentationItem({
					item,
					timelineItems: input.timelineItems,
				});
				const wakeProgressState = resolveSpaceMessageWakeProgressState({
					agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
					isPersonalContext: input.isPersonalContext === true,
					item: wakePresentationItem,
					items: input.ephemeralActivityItems,
					timelineItems: input.timelineItems,
					wakeOutcomeIndex: input.wakeOutcomeIndex,
					wakeFailureTargetContextsByProfileId:
						input.wakeFailureTargetContextsByProfileId,
				});
				const wakeStopTargets = resolveSpaceMessageWakeStopTargets({
					item: wakePresentationItem,
					stopRequestStatusBySelectorKey:
						input.wakeStopRequestStatusBySelectorKey,
					targetLabelsByProfileId: input.wakeStopTargetLabelsByProfileId,
					timelineItems: input.timelineItems,
					wakeOutcomeIndex: input.wakeOutcomeIndex,
					wakeProgressItems: input.ephemeralActivityItems,
				});
				const wakeStopControl =
					!input.readOnly &&
					input.onWakeStopRequest &&
					shouldRenderSpaceWakeStopControl(wakeStopTargets) ? (
						<SpaceWakeStopControl
							onStopWake={input.onWakeStopRequest}
							targets={wakeStopTargets}
						/>
					) : null;
				const agentInteractionItems = resolveSpaceMessageAgentInteractionItems({
					sourceItem: item,
					wakeProgressItems: input.ephemeralActivityItems,
				});
				const wakeThinkingEntries = resolveSpaceMessageWakeThinkingEntries({
					item,
					wakePresentationItem,
					wakeProgressState,
					wakeStopTargets,
				});
				const hasWakeProblem =
					wakeProgressState.hasProblem ||
					input.wakeProblemSourceSignalIds.has(item.id);
				const isHighlighted = input.highlightedSignalId === item.id;
				const canUseMessageActions = canUseTimelineItemActions({
					item,
					readOnly: input.readOnly,
				});
				const messageDetailsItem = resolveConversationMessageDetailsItem({
					item,
					readOnly: input.readOnly,
					timelineItems: input.timelineItems,
				});
				const isCenterAgentOptimisticReplySource =
					hasCenterAgentOptimisticReplyForSource({
						item,
						timelineItems: input.timelineItems,
					});
				const bubblePresentationClass =
					resolveSpaceMessageBubblePresentationClass({
						isHighlighted,
						isSelf: input.run.isSelf,
					});
				const showProgressInAnswerArea =
					shouldPlaceSpaceMessageProgressInAnswer(item);
				const messageBubbleVisibilityClassName =
					resolveSpaceMessageBubbleVisibilityClassName({
						item,
						showProgressInAnswerArea,
					});
				const messageProgressStatus = renderConversationMessageProgressStatus({
					align: messageAlign,
					control: wakeStopControl,
					entries: wakeThinkingEntries,
					hideForCenterAgentOptimisticReplySource:
						isCenterAgentOptimisticReplySource,
					item,
					messageDetailsItem,
					onOpenMessageDetails: input.onOpenMessageDetails,
				});
				const answerProgressStatus = renderSpaceMessageProgressAt({
					placement: "answer",
					showProgressInAnswerArea,
					status: messageProgressStatus,
				});
				const rowProgressStatus = renderSpaceMessageProgressAt({
					placement: "row",
					showProgressInAnswerArea,
					status: messageProgressStatus,
				});
				const computerSetupPresentation =
					resolveInlineComputerSetupPresentation({
						actionSignalId: input.inlineComputerSetupActionSignalId,
						context: computerSetupContext,
						itemId: item.id,
					});

				const isGroupedRow = index !== 0;
				const isLastGroupedRow = index === input.run.items.length - 1;

				return (
					<MessageScrollerItem key={item.id} messageId={item.id}>
						<Message
							align={messageAlign}
							className={resolveSpaceMessageRunLayoutClassName({
								isFirstInGroup: index === 0,
								isGroupedRow,
								isLastInGroup: isLastGroupedRow,
							})}
							data-space-self-message={String(input.run.isSelf)}
						>
							<MessageContent
								className={cn(
									"w-full min-w-0 gap-0",
									SPACE_MESSAGE_SURFACE_WIDTH_CLASS
								)}
							>
								{index === 0 ? (
									<>
										<MessageHeader className="px-0">
											{detailsDialog.canOpenProfileDetails ? (
												<button
													aria-label={`About ${input.run.speaker.displayName}`}
													className={cn(
														APP_MOBILE_TOUCH_TARGET_CLASS_NAME,
														"inline-flex min-w-0 max-w-full cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-1 self-start rounded-md text-left text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
													)}
													onClick={detailsDialog.openProfileDetails}
													type="button"
												>
													{speakerHeaderContent}
												</button>
											) : (
												<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
													{speakerHeaderContent}
												</div>
											)}
										</MessageHeader>
										{detailsDialog.profileDetailsDialog}
									</>
								) : null}
								<BubbleGroup className="w-full gap-0">
									<div
										className={cn(
											"group/message-row relative flex w-full min-w-0 max-w-full flex-col gap-0",
											SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS
										)}
										data-message-row-id={item.id}
									>
										<Bubble
											align={messageAlign}
											className={messageBubbleVisibilityClassName}
										>
											<BubbleContent
												className={cn(
													"group/message relative flex w-full min-w-0 flex-col gap-2 transition-colors motion-reduce:transition-none",
													messageContentPaddingClassName,
													SPACE_MESSAGE_SURFACE_WIDTH_CLASS,
													selfMessageContentLayoutClassName,
													bubblePresentationClass,
													getTimelineItemDeliveryClass(item)
												)}
												data-highlighted={isHighlighted ? "true" : undefined}
												data-signal-id={item.id}
												ref={(element) => {
													input.registerMessageElement(item.id, element);
												}}
												tabIndex={-1}
											>
												<ReplyPreview
													align={messageAlign}
													item={item}
													loadedMainTimelineSignalIds={
														input.loadedMainTimelineSignalIds
													}
													onJumpToMessage={input.onJumpToMessage}
													spaceReferencesById={input.spaceReferencesById}
												/>
												<SpaceMessageBody
													computerSetupContext={
														computerSetupPresentation.context
													}
													computerSetupSourceSignalId={item.id}
													containerClassName={selfMessageContentLayoutClassName}
													item={item}
													onOpenAgentProfile={
														detailsDialog.openProfileDetailsById
													}
													onOpenSpaceFile={input.onOpenSpaceFile}
													openMeldProfileId={input.selfProfileId}
													orgSlug={input.orgSlug}
													profilePresentationsById={
														input.profilePresentationsById
													}
													spaceReferencesById={input.spaceReferencesById}
												/>
												{answerProgressStatus}
												<SpaceMessageInteractionSource
													source={item.centerAgentInteractionSource}
												/>
												{agentInteractionItems.map((interactionItem) =>
													input.actionableAgentInteractionPlacement ===
														"pending-surface" &&
													interactionItem.pendingInteraction
														?.canRespond ? null : (
														<SpaceAgentInteractionCard
															item={interactionItem}
															key={resolveSpacePendingAgentActionIdentity(
																interactionItem
															)}
															onEditAgentProfile={
																input.editableAgentProfileIds?.has(
																	interactionItem.targetProfileId
																)
																	? input.onEditAgentProfile
																	: undefined
															}
															onRespond={
																input.readOnly
																	? undefined
																	: input.onAgentInteractionResponse
															}
														/>
													)
												)}
												{renderDurableAgentActivity({
													item,
													onOpenDetails: getOpenMessageDetailsHandler({
														enabled: canUseMessageActions,
														item,
														onOpenMessageDetails: input.onOpenMessageDetails,
													}),
												})}
												<ReplyStalenessMarker
													align={messageAlign}
													item={item}
												/>
												<ThreadPreview
													membersSnapshot={input.membersSnapshot}
													onOpenThread={input.onOpenThread}
													preview={
														input.threadPreviewByThreadId.get(
															input.threadsByRootSignalId.get(item.id)
																?.threadId ?? ""
														) ?? null
													}
													spaceReferencesById={input.spaceReferencesById}
													thread={
														input.threadsByRootSignalId.get(item.id) ?? null
													}
												/>
												{renderAnchoredSpaceOutcomeRows({
													align: messageAlign,
													notices: anchoredOutcomeNotices,
													onOpenMessageDetails: input.onOpenMessageDetails,
													onRecoverExecution: input.onRecoverExecution,
													onRetryWakeTarget: input.onRetryWakeTarget,
													profileEntriesById: input.profileEntriesById,
													readOnly: input.readOnly,
													sourceItem: item,
													spaceReferencesById: input.spaceReferencesById,
												})}
											</BubbleContent>
										</Bubble>
										{renderConversationMessageFooter({
											anchoredOutcomeNotices,
											canUseMessageActions,
											hasWakeProblem,
											isCreatingThread: input.isCreatingThread,
											item,
											messageAlign,
											messageDetailsItem,
											onCreateThread: input.onCreateThread,
											onOpenMessageDetails: input.onOpenMessageDetails,
											onOpenThread: input.onOpenThread,
											onReplyToMessage: input.onReplyToMessage,
											orgSlug: input.orgSlug,
											profileEntriesById: input.profileEntriesById,
											profilePresentationsById: input.profilePresentationsById,
											selfProfileId: input.selfProfileId,
											threadsByRootSignalId: input.threadsByRootSignalId,
										})}
										{rowProgressStatus}
									</div>
								</BubbleGroup>
							</MessageContent>
						</Message>
					</MessageScrollerItem>
				);
			})}
		</>
	);
});

function useLatestCallback<Arguments extends unknown[], Result>(
	callback: (...args: Arguments) => Result
): (...args: Arguments) => Result {
	const callbackRef = useRef(callback);
	useLayoutEffect(() => {
		callbackRef.current = callback;
	}, [callback]);
	return useCallback((...args: Arguments) => callbackRef.current(...args), []);
}

function resolveSpaceMessageRunLayoutClassName(input: {
	isFirstInGroup: boolean;
	isGroupedRow: boolean;
	isLastInGroup: boolean;
}): string {
	return cn(resolveSpaceMessageRowLayoutClassName(input), "px-0");
}

function canUseTimelineItemActions(input: {
	item: SpaceTimelineItem;
	readOnly: boolean;
}) {
	return (
		!input.readOnly &&
		input.item.deliveryState === "sent" &&
		input.item.agentStreamState === undefined
	);
}

function resolveConversationMessageDetailsItem(input: {
	item: SpaceTimelineItem;
	readOnly: boolean;
	timelineItems: readonly SpaceTimelineItem[];
}): SpaceTimelineItem | null {
	if (input.readOnly) {
		return null;
	}
	return resolveRecordedSpaceMessageDetailsItem(input);
}

function getTimelineItemDeliveryClass(item: SpaceTimelineItem) {
	return item.deliveryState === "pending" ? "opacity-70" : null;
}

function resolveSpaceMessageBubbleVisibilityClassName(input: {
	item: SpaceTimelineItem;
	showProgressInAnswerArea: boolean;
}): string | undefined {
	return input.showProgressInAnswerArea ||
		input.item.text.trim().length > 0 ||
		Boolean(input.item.agentStreamState?.thinking) ||
		input.item.attachments.length > 0 ||
		(input.item.files?.length ?? 0) > 0
		? undefined
		: "hidden";
}

function resolveSpaceMessageWakePresentationItem(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): SpaceTimelineItem {
	const sourceItemId = input.item.optimisticAgentReplySourceItemId;
	if (!sourceItemId) {
		return input.item;
	}
	return (
		input.timelineItems.find((candidate) => candidate.id === sourceItemId) ??
		input.item
	);
}

function resolveSpaceMessageWakeThinkingEntries(input: {
	item: SpaceTimelineItem;
	wakePresentationItem: SpaceTimelineItem;
	wakeProgressState: ReturnType<typeof resolveSpaceMessageWakeProgressState>;
	wakeStopTargets: ReturnType<typeof resolveSpaceMessageWakeStopTargets>;
}) {
	if (input.item.optimisticAgentReplyState !== undefined) {
		return [];
	}
	if (input.wakeProgressState.thinkingEntries.length > 0) {
		return input.wakeProgressState.thinkingEntries;
	}
	return resolveSpaceMessageWakeProgressFallbackEntries({
		item: input.wakePresentationItem,
		wakeStopTargets: input.wakeStopTargets,
	});
}

function renderConversationMessageProgressStatus(input: {
	align: "start" | "end";
	containerClassName?: string;
	control: ReactNode;
	entries: ReturnType<
		typeof resolveSpaceMessageWakeProgressState
	>["thinkingEntries"];
	hideForCenterAgentOptimisticReplySource: boolean;
	item: SpaceTimelineItem;
	messageDetailsItem: SpaceTimelineItem | null;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
}): ReactNode {
	if (input.hideForCenterAgentOptimisticReplySource) {
		return null;
	}
	return (
		<SpaceMessageProgressStatus
			align={input.align}
			containerClassName={input.containerClassName}
			control={input.control}
			entries={input.entries}
			item={input.item}
			onOpenMessageDetails={getOpenMessageDetailsHandler({
				enabled: input.messageDetailsItem !== null,
				item: input.messageDetailsItem ?? input.item,
				onOpenMessageDetails: input.onOpenMessageDetails,
			})}
		/>
	);
}

function hasCenterAgentOptimisticReplyForSource(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): boolean {
	return input.timelineItems.some(
		(candidate) => candidate.optimisticAgentReplySourceItemId === input.item.id
	);
}

function resolveIsCenterAgentConversationRun(input: {
	centerAgentProfileId: string | null;
	isCenterAgentDirectMessage: boolean;
	run: SpaceConversationBubbleRun;
}): boolean {
	if (input.run.speaker.profileKind !== "agent") {
		return false;
	}
	return (
		input.isCenterAgentDirectMessage ||
		input.run.items.some(
			(item) => item.optimisticAgentReplyState !== undefined
		) ||
		input.run.speaker.profileId === input.centerAgentProfileId
	);
}

function renderSpaceMessageProgressAt(input: {
	placement: "answer" | "row";
	showProgressInAnswerArea: boolean;
	status: ReactNode;
}): ReactNode {
	if (input.placement === "answer") {
		return input.showProgressInAnswerArea ? input.status : null;
	}
	return input.showProgressInAnswerArea ? null : input.status;
}

function resolveSpaceMessageDirectionalAlign(isSelf: boolean): "start" | "end" {
	return isSelf ? "end" : "start";
}

function resolveInlineComputerSetupPresentation(input: {
	actionSignalId: string | null;
	context?: CenterAgentComputerSetupContext;
	itemId: string;
}): {
	context?: CenterAgentComputerSetupContext;
} {
	if (input.actionSignalId !== input.itemId) {
		return {};
	}
	return {
		...(input.context ? { context: input.context } : {}),
	};
}

function resolveCenterAgentComputerSetupContext(input: {
	isCenterAgentDirectMessage: boolean;
	orgSlug?: string;
	profileId: string;
	spaceId?: string;
}) {
	if (!(input.isCenterAgentDirectMessage && input.orgSlug && input.spaceId)) {
		return undefined;
	}

	return {
		orgSlug: input.orgSlug,
		profileId: input.profileId,
		spaceId: input.spaceId,
	};
}

function getOpenMessageDetailsHandler(input: {
	enabled: boolean;
	item: SpaceTimelineItem;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
}) {
	if (!input.enabled) {
		return undefined;
	}
	return () => input.onOpenMessageDetails(input.item);
}

function renderDurableAgentActivity(input: {
	item: SpaceTimelineItem;
	onOpenDetails?: () => void;
}) {
	if (!input.item.agentActivity) {
		return null;
	}
	return (
		<SpaceAgentToolActivity
			item={input.item}
			onOpenDetails={input.onOpenDetails}
			placement="message"
		/>
	);
}

function resolveConversationMessageFooterThreadAction(input: {
	isCreatingThread: boolean;
	item: SpaceTimelineItem;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onOpenThread: (threadId: string) => void;
	thread: SpaceThread | null;
}) {
	return {
		disabled: input.isCreatingThread,
		label: input.thread ? "Open thread" : "Reply in thread",
		onSelect: () => {
			if (input.thread) {
				input.onOpenThread(input.thread.threadId);
				return;
			}
			input.onCreateThread({ rootSignalId: input.item.id }).catch((error) => {
				console.error("Failed to open a thread from the message.", error);
			});
		},
	};
}

function renderConversationMessageFooter(input: {
	anchoredOutcomeNotices: readonly SpaceTimelineItem[];
	canUseMessageActions: boolean;
	hasWakeProblem: boolean;
	isCreatingThread: boolean;
	item: SpaceTimelineItem;
	messageAlign: "end" | "start";
	messageDetailsItem: SpaceTimelineItem | null;
	onCreateThread: (input: { rootSignalId: string }) => Promise<void>;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenThread: (threadId: string) => void;
	onReplyToMessage: (item: SpaceTimelineItem) => void;
	orgSlug?: string;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	selfProfileId: string;
	threadsByRootSignalId: ReadonlyMap<string, SpaceThread>;
}) {
	if (input.item.transientActivityPurpose !== null) {
		return null;
	}
	const failureSummary = resolveSpaceMessageFooterFailureSummary({
		notices: input.anchoredOutcomeNotices,
		resolveTargetLabel: (targetProfileId) =>
			input.profileEntriesById.get(targetProfileId)?.profileName ?? null,
	});
	const canUseCollaborationActions =
		input.canUseMessageActions && input.item.signalType === "signal.text";
	const addressingTargets = resolveSpaceMessageFooterAddressingTargets({
		item: input.item,
		profilePresentationsById: input.profilePresentationsById,
	});
	const messageDetailsItem = input.messageDetailsItem;

	return (
		<SpaceMessageFooter
			addressingTargets={addressingTargets}
			align={input.messageAlign}
			details={
				messageDetailsItem
					? {
							hasProblem: input.hasWakeProblem || failureSummary !== null,
							onSelect: () => input.onOpenMessageDetails(messageDetailsItem),
						}
					: undefined
			}
			failureSummary={failureSummary}
			onCopy={() =>
				copySpaceTimelineItemWithFeedback({
					item: input.item,
					openMeldProfileId: input.selfProfileId,
					organizationSlug: input.orgSlug,
				})
			}
			reply={
				canUseCollaborationActions
					? {
							label: "Reply",
							onSelect: () => input.onReplyToMessage(input.item),
						}
					: undefined
			}
			thread={
				canUseCollaborationActions
					? resolveConversationMessageFooterThreadAction({
							isCreatingThread: input.isCreatingThread,
							item: input.item,
							onCreateThread: input.onCreateThread,
							onOpenThread: input.onOpenThread,
							thread: input.threadsByRootSignalId.get(input.item.id) ?? null,
						})
					: undefined
			}
			timestamp={TIMELINE_TIME_FORMATTER.format(input.item.createdAtMs)}
		/>
	);
}

function ReplyPreview(input: {
	align: "start" | "end";
	item: SpaceTimelineItem;
	loadedMainTimelineSignalIds: ReadonlySet<string>;
	onJumpToMessage: (signalId: string) => void;
	spaceReferencesById?: SpaceMessageReferencesById;
}) {
	if (!input.item.replyPreviewText) {
		return null;
	}

	const replyToSignalId = input.item.replyToSignalId;
	const canJump =
		replyToSignalId !== null &&
		input.loadedMainTimelineSignalIds.has(replyToSignalId);
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;
	const hasSpaceReference = hasResolvedSpaceMessageReference({
		referencesById: spaceReferencesById,
		text: input.item.replyPreviewText,
	});
	const replyLabel = (
		<>
			Replying to{" "}
			{input.item.replyToProfileName ? (
				<span className="font-bold">{input.item.replyToProfileName}</span>
			) : (
				"earlier message"
			)}
		</>
	);
	const content = (
		<>
			<p className="text-muted-foreground text-xs leading-5">{replyLabel}</p>
			<p className="line-clamp-2 text-foreground/78">
				<SpaceMessageReferenceText
					referencesById={spaceReferencesById}
					text={input.item.replyPreviewText}
				/>
			</p>
		</>
	);

	if (!(canJump && replyToSignalId)) {
		return (
			<div
				className={cn(
					"flex flex-col gap-1 border-border text-sm",
					input.align === "end"
						? "items-end border-r pr-3 text-right"
						: "border-l pl-3 text-left"
				)}
				data-align={input.align}
				data-slot="reply-preview"
			>
				{content}
			</div>
		);
	}
	if (hasSpaceReference) {
		return (
			<div
				className={cn(
					"flex flex-col gap-1 border-border text-sm",
					input.align === "end"
						? "items-end border-r pr-3 text-right"
						: "border-l pl-3 text-left"
				)}
				data-align={input.align}
				data-slot="reply-preview"
			>
				<button
					aria-label="Jump to original message"
					className="text-muted-foreground text-xs leading-5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => input.onJumpToMessage(replyToSignalId)}
					type="button"
				>
					{replyLabel}
				</button>
				<p className="line-clamp-2 text-foreground/78">
					<SpaceMessageReferenceText
						referencesById={spaceReferencesById}
						text={input.item.replyPreviewText}
					/>
				</p>
			</div>
		);
	}

	return (
		<button
			aria-label="Jump to original message"
			className={cn(
				"flex flex-col gap-1 border-border text-sm hover:border-foreground/50 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
				input.align === "end"
					? "items-end border-r pr-3 text-right"
					: "border-l pl-3 text-left"
			)}
			data-align={input.align}
			data-slot="reply-preview"
			onClick={() => input.onJumpToMessage(replyToSignalId)}
			type="button"
		>
			{content}
		</button>
	);
}

function resolveReplyItemsForMessage(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): readonly SpaceTimelineItem[] {
	return input.timelineItems.filter(
		(candidate) => candidate.replyToSignalId === input.item.id
	);
}

function ThreadPreview(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	onOpenThread: (threadId: string) => void;
	preview: SpaceThreadPreview | null;
	spaceReferencesById?: SpaceMessageReferencesById;
	thread: SpaceThread | null;
}) {
	const thread = input.thread;
	if (!thread) {
		return null;
	}

	const previewItems = buildSpaceTimelineItems({
		envelopes: input.preview?.signals ?? [],
		membersSnapshot: input.membersSnapshot,
	}).slice(0, 2);
	const replyCount = input.preview?.replyCount ?? 0;
	const replyCountText = formatThreadReplyCount(replyCount);
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;

	return (
		<div className="flex w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden border-border border-t pt-2">
			{previewItems.length > 0 ? (
				<section
					aria-label="Thread preview"
					className="flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden pe-2"
				>
					{previewItems.map((item) => (
						<div
							className="flex min-w-0 items-start gap-2 overflow-hidden"
							key={item.id}
						>
							<span className="max-w-[40%] shrink-0 truncate font-bold text-foreground/88 text-xs leading-5">
								{item.actorName}
							</span>
							<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs leading-5">
								<SpaceMessageReferenceText
									referencesById={spaceReferencesById}
									text={item.text}
								/>
							</span>
						</div>
					))}
				</section>
			) : null}
			<button
				aria-label={
					replyCount > 0 ? `Open thread (${replyCountText})` : "Open thread"
				}
				className="inline-flex h-7 w-fit items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
				onClick={() => input.onOpenThread(thread.threadId)}
				type="button"
			>
				<ChatCircleIcon aria-hidden="true" className="size-3.5" />
				<span>Open thread</span>
				{replyCount > 0 ? (
					<span className="text-muted-foreground/75">{replyCountText}</span>
				) : null}
			</button>
		</div>
	);
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

function readMessageDetailsProgressEntries(
	state: ReturnType<typeof resolveSpaceMessageWakeProgressState> | null
) {
	return {
		issueEntries: state?.issueEntries ?? [],
		thinkingEntries: state?.thinkingEntries ?? [],
	};
}

function ReplyStalenessMarker(input: {
	align: "start" | "end";
	item: SpaceTimelineItem;
}) {
	const count = input.item.newMessagesDuringComposition;
	if (count === null) {
		return null;
	}
	const messageLabel = count === 1 ? "message" : "messages";

	return (
		<p
			className={cn(
				"text-muted-foreground text-xs leading-5",
				input.align === "end" ? "self-end text-right" : "self-start text-left"
			)}
			data-slot="reply-staleness-marker"
		>
			written before {count} newer {messageLabel}
		</p>
	);
}

function buildThreadSignalIds(
	previews: readonly SpaceThreadPreview[]
): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const preview of previews) {
		for (const placement of preview.placements) {
			if (placement.placement === "thread") {
				ids.add(placement.signalId);
			}
		}
	}
	return ids;
}

function formatThreadReplyCount(replyCount: number): string {
	return `${replyCount.toLocaleString("en-US")} ${
		replyCount === 1 ? "reply" : "replies"
	}`;
}

function resolveReplyToDisplayText(input: {
	signalId: string;
	timelineItems: readonly SpaceTimelineItem[];
}): string {
	const item = input.timelineItems.find(
		(candidate) => candidate.id === input.signalId
	);
	return item?.actorName ?? "message";
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
				data-signal-id={input.item.id}
				ref={(element) => {
					input.registerMessageElement(input.item.id, element);
				}}
				tabIndex={-1}
			>
				<SpaceOutcomeRow
					className="max-w-[min(92vw,44rem)]"
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

const EMPTY_ANCHORED_OUTCOME_NOTICES: readonly SpaceTimelineItem[] = [];
const UNAVAILABLE_SPACE_WAKE_STOP_REQUEST: SpaceWakeStopRequestHandler = () =>
	Promise.reject(new Error("Space Wake Stop is unavailable."));

// Renders the terminal_failure/wake_stopped notices anchored to this source
// message inside its own bubble content, right after the local wake
// failure/fallback block (Space collaboration's "one final visible outcome"
// projected onto the request it closes, now visually part of that message's
// card instead of a trailing sibling row below it). BubbleContent already
// carries the card's hover coloring, rounded corners, and self/other
// alignment, so this no longer needs its own align or max-width handling --
// it renders start-aligned, matching the local wake failure/fallback block
// right above it.
//
// The Details action always opens the SOURCE message's details (not the
// notice's own), because the notice's own record carries little the user can
// act on -- the source message's Wake context/failure history is the useful
// destination, and it is already the thing the reader is looking at.
function renderAnchoredSpaceOutcomeRows(input: {
	align?: "end" | "start";
	notices: readonly SpaceTimelineItem[];
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	readOnly: boolean;
	sourceItem: SpaceTimelineItem;
	spaceReferencesById?: SpaceMessageReferencesById;
}) {
	if (input.notices.length === 0) {
		return null;
	}

	const outcomeNotices = input.notices.filter(
		(notice) =>
			isSpaceOutcomeNoticeItem(notice) &&
			notice.systemNoticeType !== "terminal_failure"
	);
	if (outcomeNotices.length === 0) {
		return null;
	}
	const groups = groupAnchoredOutcomeNotices(outcomeNotices);

	return (
		<>
			{groups.map((group) => {
				const outcomeNotice =
					group.notices.length === 1 ? (group.notices[0] ?? null) : null;
				const recoveryRequest = outcomeNotice
					? resolveAnchoredSpaceExecutionRecoveryRequest({
							notices: input.notices,
							outcomeNotice,
						})
					: null;
				const retryRequest = outcomeNotice
					? resolveAnchoredSpaceWakeRetryRequest({
							notices: input.notices,
							outcomeNotice,
							sourceItem: input.sourceItem,
						})
					: null;
				return (
					<SpaceOutcomeRow
						align={input.align}
						key={group.key}
						onOpenDetails={
							input.readOnly
								? null
								: () => input.onOpenMessageDetails(input.sourceItem)
						}
						onRecoverExecution={
							input.readOnly ? undefined : input.onRecoverExecution
						}
						onRetryWakeTarget={
							input.readOnly ? undefined : input.onRetryWakeTarget
						}
						recoveryRequest={recoveryRequest}
						retryRequest={retryRequest}
						spaceReferencesById={input.spaceReferencesById}
						text={resolveGroupedOutcomeRowText({
							notices: group.notices,
							resolveTargetLabel: (targetProfileId) =>
								input.profileEntriesById.get(targetProfileId)?.profileName ??
								null,
							tone: group.tone,
						})}
						tone={group.tone}
					/>
				);
			})}
		</>
	);
}

function renderComposerBlockedWakeRecoveryAction(input: {
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	blockedWakeProfileId: string | null;
	isAgentRecoveryPending: (profileId: string) => boolean;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	orgSlug?: string;
	prepareSetupHref?: string;
}) {
	if (!input.blockedWakeProfileId) {
		return null;
	}

	if (!input.orgSlug) {
		return null;
	}

	const plan =
		input.agentRecoveryPlansByProfileId.get(input.blockedWakeProfileId) ?? null;
	if (!plan || plan.kind === "none") {
		return null;
	}

	return (
		<SpaceAgentRecoveryActionControl
			className="mt-0 border-destructive/50 text-destructive hover:text-destructive"
			isPending={input.isAgentRecoveryPending(plan.profileId)}
			onAction={input.onAgentRecoveryAction}
			orgSlug={input.orgSlug}
			plan={plan}
			prepareSetupHref={input.prepareSetupHref}
		/>
	);
}

function resolveDirectMessageTargetName(
	input: Pick<
		SpaceConversationPanelProps,
		| "agentDirectConversationKind"
		| "isCenterAgentDirectMessage"
		| "isDirectMessage"
		| "membersSnapshot"
		| "selfProfileId"
	>
): string | null {
	if (input.isCenterAgentDirectMessage) {
		return "Center Agent";
	}
	if (input.agentDirectConversationKind) {
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

function resolveSendButtonLabel(isSendingMessage: boolean): string {
	if (isSendingMessage) {
		return "Sending…";
	}

	return "Send message";
}

const TIMELINE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
});
