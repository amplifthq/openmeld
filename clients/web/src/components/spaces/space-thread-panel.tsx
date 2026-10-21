import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type {
	ModelCatalog,
	SignalEnvelope,
	SpaceInboxUnreadTarget,
	SpaceInboxUnreadTargetsResponse,
	SpaceMembersSnapshot,
	SpaceThread,
	SpaceThreadPreview,
} from "@openmeld/schemas/types";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";
import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import {
	buildActiveWakeConversationItems,
	isWakeProgressInConversation,
} from "#/lib/spaces/active-wake-conversation";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import type { ComposerFileDraftCleanup } from "#/lib/spaces/composer-file-drafts";
import type { SpaceConversationVisibleStreamProjection } from "#/lib/spaces/conversation-stream";
import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import {
	buildAnchoredSpaceOutcomeNoticesBySourceSignalId,
	buildSpaceConversationEntries,
	orderSpaceTimelineItemsForConversation,
} from "#/lib/spaces/presentation";
import {
	buildSpaceTimelineItems,
	isSpaceOutcomeNoticeItem,
	resolveSpaceConversationItemKey,
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
	type SpaceWakeStopTargetResolution,
} from "#/lib/spaces/wake-stop-target";
import {
	type CenterAgentComputerSetupContext,
	resolveLatestComputerSetupActionSignalId,
} from "./center-agent-computer-setup-card";
import {
	MessageScroller,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "./primitives/message-scroller";
import { restoreRecalledMessage } from "./restore-recalled-message";
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
} from "./space-composer-copy";
import type { SpaceComposerSendOptions } from "./space-composer-device-wait";
import type {
	SpaceComposerEditorChange,
	SpaceComposerInputRef,
} from "./space-composer-editor";
import { SpaceComposerReplyBanner } from "./space-composer-reply-banner";
import { SpaceConversationCompactionMarker } from "./space-conversation-compaction-marker";
import {
	SpaceConversationSendScrollController,
	type SpaceMessageScrollAction,
	SpaceMessageScrollController,
	scrollMessageIntoConversationViewport,
} from "./space-conversation-scroll-controller";
import {
	type ComposeExpiredDeviceWait,
	SpaceDeviceWaitOutcomeScope,
} from "./space-device-wait-outcome";
import type { SpaceExecutionRecoveryHandler } from "./space-execution-recovery-actions";
import { SpaceHistoryJumpControl } from "./space-history-jump-control";
import { SpaceInlineSidePanel } from "./space-inline-side-panel";
import { SpaceInputQueue } from "./space-input-queue";
import { SPACE_MESSAGE_ROW_LAYOUT_CLASS } from "./space-message-bubble-style";
import { SpaceMessageDetailsDrawer } from "./space-message-details-drawer";
import { resolveMessageDetailsDiagnosticReportStatus } from "./space-message-details-presentation";
import {
	SpaceMessageEditingScope,
	useOptimisticSpaceMessages,
} from "./space-message-editing";
import type { SpaceProfileTriggerRenderer } from "./space-message-profile-mention";
import { SpaceMessageReadObserver } from "./space-message-read-observer";
import type { SpaceMessageReferencesById } from "./space-message-reference";
import { SpaceMessageRun } from "./space-message-run";
import { SpaceOutcomeRow } from "./space-outcome-row";
import { resolveSpaceOutcomeRowTone } from "./space-outcome-tone";
import {
	ThreadMessagesLoading,
	ThreadPanelHeader,
} from "./space-thread-loading";
import { SpaceConversationUnreadControl } from "./space-unread-control";
import { SpaceWakeRecommendationScope } from "./space-wake-recommendation";
import {
	type SpaceWakeStopRequestHandler,
	SpaceWakeStopScope,
} from "./space-wake-stop-control";
import { SpaceComposerWorkBookmarks } from "./space-work-bookmarks";
import { useSpaceConversationPosition } from "./use-space-conversation-position";
import type {
	SpaceComposerAddressingTarget,
	SpaceMentionPickerItem,
} from "./use-space-mention-authoring";
import { useSpaceMessageTaskAction } from "./use-space-message-task-action";
import { useSpacePanelWidth } from "./use-space-panel-width";
import { useSpaceProfileDetailsPopover } from "./use-space-profile-details-popover";
import { useSpaceUnread } from "./use-space-unread";

type ThreadMessageDetailsSelection = {
	item: SpaceTimelineItem;
	rootSignalId: string;
	threadId: string;
};

function resolveThreadMessageDetailsItem(input: {
	activeThread: SpaceThread | null;
	selection: ThreadMessageDetailsSelection | null;
}): SpaceTimelineItem | null {
	if (
		!input.activeThread ||
		input.selection?.threadId !== input.activeThread.threadId ||
		input.selection.rootSignalId !== input.activeThread.rootSignalId
	) {
		return null;
	}
	return input.selection.item;
}

function createThreadExecutionRecoveryHandler(input: {
	handler: SpaceExecutionRecoveryHandler;
	rootSignalId: string | null;
	threadId: string | null;
}): SpaceExecutionRecoveryHandler {
	const inspectionsByExecution = new Map<
		string,
		ReturnType<SpaceExecutionRecoveryHandler>
	>();

	return async (request) => {
		const executionKey = JSON.stringify([
			input.threadId,
			input.rootSignalId,
			request.dispatchId,
			request.targetProfileId,
			request.resultRef,
		]);
		if (request.action === null) {
			const existingInspection = inspectionsByExecution.get(executionKey);
			if (existingInspection) {
				return existingInspection;
			}
			const inspection = input.handler(request);
			inspectionsByExecution.set(executionKey, inspection);
			try {
				return await inspection;
			} catch (error) {
				if (inspectionsByExecution.get(executionKey) === inspection) {
					inspectionsByExecution.delete(executionKey);
				}
				throw error;
			}
		}

		const resolution = await input.handler(request);
		inspectionsByExecution.set(executionKey, Promise.resolve(resolution));
		return resolution;
	};
}

type SpaceThreadPanelProps = {
	canSendMessage: boolean;
	organizationId?: string | null;
	open?: boolean;
	wakeRecommendationsEnabled?: boolean;
	activeThread: SpaceThread | null;
	automaticWakeConversationKind: SpaceAutomaticWakeComposerHintKind | null;
	agentStreams: readonly SpaceConversationVisibleStreamProjection[];
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	centerAgentProfileId?: string | null;
	className?: string;
	composerAddressingTargets?: readonly SpaceComposerAddressingTarget[];
	composerAuthoredMentions?: readonly ComposerDraftAuthoredMention[];
	composerMentionPickerItems?: readonly SpaceMentionPickerItem[];
	composerBlockedWakeProfileId: string | null;
	composerErrorMessage: string | null;
	composerMembers?: SpaceComposerProps["members"];
	composerHasAuthoredMentions?: boolean;
	composerText: string;
	composerReplyToSignalId?: string | null;
	onClearComposerReplyTo?: () => void;
	composerFiles: readonly SpaceComposerFile[];
	composerFileLimitReached: boolean;
	currentOwnerUserId: string | null;
	pendingActionSurface?: ReactNode;
	profileControl?: ReactNode;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	wakeFailureTargetContextsByProfileId: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	isAgentRecoveryPending: (profileId: string) => boolean;
	isDiagnosticReportPending: (signalId: string) => boolean;
	isDiagnosticReportSent: (signalId: string) => boolean;
	isCenterAgentDirectMessage?: boolean;
	isDirectMessage?: boolean;
	initialFocusRequestId?: number | string;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	actionableAgentInteractionPlacement?: SpaceAgentInteractionPlacement;
	isPersonalContext?: boolean;
	isSendingMessage: boolean;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	onClose: () => void;
	onShowMessageInMain?: (signalId: string) => void;
	onOpenUnreadThread?: (input: {
		rootSignalId: string;
		signalId: string;
		threadId?: string;
	}) => boolean | Promise<boolean>;
	onReplyToMessage?: (item: SpaceTimelineItem) => void;
	onComposeExpiredDeviceWait?: ComposeExpiredDeviceWait;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onComposerEditorChange: (change: SpaceComposerEditorChange) => void;
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onAddPeopleOrAgents?: () => void;
	onRemoveComposerFile: (localId: string) => void;
	onRetryComposerFile?: (localId: string) => Promise<void>;
	onRetryComposerFileCleanup?: (localId: string) => Promise<void>;
	onRetryComposerFileRestoration?: () => void;
	composerFileCleanup?: readonly ComposerFileDraftCleanup[];
	composerFileRestorationError?: unknown | null;
	onMentionButtonClick: () => void;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onSendText?: (text: string) => Promise<void>;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	onSend: (options?: SpaceComposerSendOptions) => Promise<void>;
	onViewedUpdates?: (
		targets: readonly SpaceInboxUnreadTarget[]
	) => Promise<void> | void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	orgSlug?: string;
	prepareSetupHref?: string;
	readOnly?: boolean;
	selfProfileId: string;
	selfAvatarImageUrl?: string | null;
	signals: readonly SignalEnvelope[];
	filePreviewUrlsById?: ReadonlyMap<string, string>;
	spaceReferencesById?: SpaceMessageReferencesById;
	spaceTimelineItems: readonly SpaceTimelineItem[];
	signalsErrorMessage: string | null;
	signalsIsLoading: boolean;
	textareaRef: SpaceComposerInputRef;
	wakeStopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	unreadTargets?: readonly SpaceInboxUnreadTarget[];
	unreadScopes?: SpaceInboxUnreadTargetsResponse["scopes"];
	unreadBoundaryVersion?: number;
	unreadStateReady?: boolean;
};

export function SpaceThreadPanel(input: SpaceThreadPanelProps) {
	return (
		<SpaceWakeStopScope
			key={`${input.activeThread?.rootSignalId ?? input.initialFocusThreadRootSignalId}:${input.selfProfileId}`}
			progressItems={input.ephemeralActivityItems}
			stopRequestStatusBySelectorKey={input.wakeStopRequestStatusBySelectorKey}
		>
			<SpaceMessageEditingScope
				draftKey={JSON.stringify([input.composerText, input.composerFiles])}
				hasDraft={Boolean(input.composerText || input.composerFiles.length)}
				mentionPickerItems={input.composerMentionPickerItems}
				onRestore={(message, canReplaceDraft) =>
					restoreRecalledMessage({ ...input, message, canReplaceDraft })
				}
				orgSlug={input.orgSlug}
				readOnly={input.readOnly}
				selfProfileId={input.selfProfileId}
			>
				<SpaceDeviceWaitOutcomeScope
					onComposeAgain={
						input.readOnly ? undefined : input.onComposeExpiredDeviceWait
					}
				>
					<SpaceThreadPanelContent {...input} />
				</SpaceDeviceWaitOutcomeScope>
			</SpaceMessageEditingScope>
		</SpaceWakeStopScope>
	);
}

function SpaceThreadPanelContent(input: SpaceThreadPanelProps) {
	const panelWidth = useSpacePanelWidth({ panel: "thread" });
	const {
		registerMessageElement,
		jumpToMessage,
		messageScrollActionRef,
		messageElementsRef,
	} = useThreadInitialFocus({
		signals: input.signals,
		activeThread: input.activeThread,
		initialFocusRequestId: input.initialFocusRequestId,
		initialFocusSignalId: input.initialFocusSignalId,
		initialFocusThreadRootSignalId: input.initialFocusThreadRootSignalId,
	});
	const activeThreadId = input.activeThread?.threadId ?? null;
	const activeThreadRootSignalId = input.activeThread?.rootSignalId ?? null;
	const onRecoverExecution = useMemo(
		() =>
			input.onRecoverExecution
				? createThreadExecutionRecoveryHandler({
						handler: input.onRecoverExecution,
						rootSignalId: activeThreadRootSignalId,
						threadId: activeThreadId,
					})
				: undefined,
		[activeThreadId, activeThreadRootSignalId, input.onRecoverExecution]
	);
	const storedThreadTimelineItems = useMemo(
		() =>
			buildSpaceTimelineItems({
				agentStreams: input.agentStreams,
				agentStreamScope: input.activeThread
					? {
							kind: "thread",
							rootSignalId: input.activeThread.rootSignalId,
						}
					: undefined,
				envelopes: input.signals,
				membersSnapshot: input.membersSnapshot,
				pendingFilePreviewUrlsById: input.filePreviewUrlsById,
			}),
		[
			input.activeThread,
			input.agentStreams,
			input.membersSnapshot,
			input.signals,
			input.filePreviewUrlsById,
		]
	);
	const rawThreadTimelineItems = useOptimisticSpaceMessages(
		storedThreadTimelineItems
	);
	const profileEntriesById = useMemo(
		() => buildSpaceMemberDirectoryEntryByProfileId(input.membersSnapshot),
		[input.membersSnapshot]
	);
	const scopedActivityItems = useMemo(
		() =>
			input.ephemeralActivityItems.filter((progress) =>
				isWakeProgressInConversation({
					progress,
					agentStreams: input.agentStreams,
					threadId: activeThreadId,
					threadRootSignalId: activeThreadRootSignalId,
					source: rawThreadTimelineItems.find(
						(item) =>
							item.id === progress.sourceSignalId ||
							Boolean(
								progress.clientMessageId &&
									(item.clientMessageId === progress.clientMessageId ||
										item.wakeClientMessageId === progress.clientMessageId)
							)
					),
				})
			),
		[
			input.ephemeralActivityItems,
			input.agentStreams,
			activeThreadId,
			activeThreadRootSignalId,
			rawThreadTimelineItems,
		]
	);
	const threadTimelineItems = useMemo(
		() =>
			orderSpaceTimelineItemsForConversation(
				buildActiveWakeConversationItems({
					activityItems: input.ephemeralActivityItems,
					agentStreams: input.agentStreams,
					threadRootSignalId: activeThreadRootSignalId,
					profileEntriesById,
					spaceId: input.activeThread?.spaceId,
					threadId: activeThreadId,
					timelineItems: rawThreadTimelineItems,
				})
			),
		[
			rawThreadTimelineItems,
			input.ephemeralActivityItems,
			input.agentStreams,
			activeThreadRootSignalId,
			profileEntriesById,
			input.activeThread?.spaceId,
			activeThreadId,
		]
	);
	const activeUnreadTargets = useMemo(
		() =>
			(input.unreadTargets ?? []).filter(
				(target) => target.threadRootSignalId === activeThreadRootSignalId
			),
		[activeThreadRootSignalId, input.unreadTargets]
	);
	const unreadState = useSpaceUnread({
		identity: [
			input.unreadBoundaryVersion,
			input.activeThread?.spaceId ?? "pending",
			input.selfProfileId,
			activeThreadRootSignalId ?? "no-thread",
		].join(":"),
		isReady: input.unreadStateReady === true,
		targets: input.unreadTargets ?? [],
		scopes: input.unreadScopes,
		threadRootSignalId: activeThreadRootSignalId,
	});
	const firstUnreadSignalId = unreadState.firstSignalId;

	const focusStatusMessage = resolveThreadFocusStatusMessage({
		activeThread: input.activeThread,
		hasTargetSignal: rawThreadTimelineItems.some(
			(item) => item.id === input.initialFocusSignalId
		),
		rootSignalId: input.initialFocusThreadRootSignalId,
		signalsErrorMessage: input.signalsErrorMessage,
		signalsIsLoading: input.signalsIsLoading,
		targetSignalId: input.initialFocusSignalId,
	});
	const computerSetupContext = resolveThreadComputerSetupContext({
		activeThread: input.activeThread,
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage === true,
		orgSlug: input.orgSlug,
		selfProfileId: input.selfProfileId,
	});
	const computerSetupActionSignalId = resolveThreadComputerSetupActionSignalId({
		context: computerSetupContext,
		timelineItems: threadTimelineItems,
	});
	const wakeOutcomeIndex = useMemo(
		() =>
			buildThreadWakeOutcomeIndex({
				spaceItems: input.spaceTimelineItems,
				threadItems: rawThreadTimelineItems,
			}),
		[input.spaceTimelineItems, rawThreadTimelineItems]
	);
	const anchoredOutcomeNoticesBySourceSignalId = useMemo(
		() =>
			buildAnchoredSpaceOutcomeNoticesBySourceSignalId(rawThreadTimelineItems),
		[rawThreadTimelineItems]
	);
	const wakeStopTargetLabelsByProfileId = useMemo(
		() => buildWakeStopTargetLabelsByProfileId(profileEntriesById),
		[profileEntriesById]
	);
	const profilePresentationsById = useMemo(
		() =>
			buildSpaceCollaborationProfilePresentations({
				centerAgentProfileId: input.centerAgentProfileId ?? null,
				entriesByProfileId: profileEntriesById,
			}),
		[input.centerAgentProfileId, profileEntriesById]
	);
	const profileDetailsDialog = useSpaceProfileDetailsPopover({
		centerAgentProfileId: input.centerAgentProfileId,
		currentOwnerUserId: input.currentOwnerUserId,
		entriesByProfileId: profileEntriesById,
		entry: null,
		modelCatalog: input.modelCatalog,
		orgSlug: input.orgSlug,
	});
	const {
		closeMessageDetails,
		messageDetailsItem,
		messageDetailsReplyItems,
		messageDetailsWakeProgressState,
		messageDetailsWakeStopTarget,
		onOpenMessageDetails,
	} = useThreadMessageDetailsController({
		activeThread: input.activeThread,
		agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
		ephemeralActivityItems: scopedActivityItems,
		isPersonalContext: input.isPersonalContext === true,
		rawThreadTimelineItems,
		wakeFailureTargetContextsByProfileId:
			input.wakeFailureTargetContextsByProfileId,
		wakeOutcomeIndex,
		wakeStopRequestStatusBySelectorKey:
			input.wakeStopRequestStatusBySelectorKey,
		wakeStopTargetLabelsByProfileId,
	});
	const onWakeStopRequest = useLatestCallback(
		input.onWakeStopRequest ?? UNAVAILABLE_SPACE_WAKE_STOP_REQUEST
	);
	return (
		<SpaceWakeRecommendationScope
			disabled={!input.wakeRecommendationsEnabled}
			items={rawThreadTimelineItems}
			orgSlug={input.orgSlug}
			selfProfileId={input.selfProfileId}
			spaceId={input.activeThread?.spaceId}
			threadId={input.activeThread?.threadId}
		>
			<SpaceInlineSidePanel
				ariaLabel="Thread"
				className={input.className}
				id="space-thread-panel"
				maxWidth={panelWidth.maxWidth}
				minRemainingWidth={512}
				minWidth={panelWidth.minWidth}
				onWidthChange={panelWidth.onWidthChange}
				open={input.open ?? input.activeThread !== null}
				resizeHandleLabel="Resize Thread panel"
				width={panelWidth.width}
			>
				<ThreadPanelHeader
					onClose={input.onClose}
					onGoToMessage={
						activeThreadRootSignalId && input.onShowMessageInMain
							? () => input.onShowMessageInMain?.(activeThreadRootSignalId)
							: undefined
					}
				/>
				{renderThreadFocusStatus(focusStatusMessage)}
				<ThreadTimeline
					actionableAgentInteractionPlacement={resolveSpaceAgentInteractionPlacement(
						input.actionableAgentInteractionPlacement
					)}
					agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
					allItems={threadTimelineItems}
					anchoredOutcomeNoticesBySourceSignalId={
						anchoredOutcomeNoticesBySourceSignalId
					}
					centerAgentProfileId={input.centerAgentProfileId ?? null}
					computerSetupActionSignalId={computerSetupActionSignalId}
					computerSetupContext={computerSetupContext}
					ephemeralActivityItems={scopedActivityItems}
					errorMessage={input.signalsErrorMessage}
					firstUnreadSignalId={firstUnreadSignalId}
					isDirectMessage={input.isDirectMessage === true}
					isLoading={input.signalsIsLoading}
					isPersonalContext={input.isPersonalContext === true}
					items={threadTimelineItems}
					key={`${input.selfProfileId}:${input.activeThread?.spaceId}:${activeThreadRootSignalId}`}
					membersSnapshot={input.membersSnapshot}
					messageElementsRef={messageElementsRef}
					messageScrollActionRef={messageScrollActionRef}
					modelCatalog={input.modelCatalog}
					onAgentInteractionResponse={input.onAgentInteractionResponse}
					onJumpToMessage={jumpToMessage}
					onOpenMessageDetails={onOpenMessageDetails}
					onOpenSpaceFile={input.onOpenSpaceFile}
					onRecoverExecution={
						messageDetailsItem ? undefined : onRecoverExecution
					}
					onViewedUpdates={input.onViewedUpdates}
					onWakeStopRequest={
						input.onWakeStopRequest ? onWakeStopRequest : undefined
					}
					orgSlug={input.orgSlug}
					panelInput={input}
					prepareSetupHref={input.prepareSetupHref}
					profilePresentationsById={profilePresentationsById}
					readOnly={input.readOnly === true}
					readScopeKey={`${input.selfProfileId}:${input.activeThread?.spaceId}:${activeThreadRootSignalId}`}
					registerMessageElement={registerMessageElement}
					renderProfileTrigger={
						profileDetailsDialog.profileDetailsPopoverTriggerById
					}
					selfAvatarImageUrl={input.selfAvatarImageUrl ?? null}
					selfProfileId={input.selfProfileId}
					spaceReferencesById={input.spaceReferencesById}
					unreadScopes={input.unreadScopes}
					unreadTargets={activeUnreadTargets}
					wakeFailureTargetContextsByProfileId={
						input.wakeFailureTargetContextsByProfileId
					}
					wakeOutcomeIndex={wakeOutcomeIndex}
					wakeStopRequestStatusBySelectorKey={
						input.wakeStopRequestStatusBySelectorKey
					}
					wakeStopTargetLabelsByProfileId={wakeStopTargetLabelsByProfileId}
				/>
				{renderThreadComposer(
					input,
					buildSpaceTaskSources(rawThreadTimelineItems, input.selfProfileId),
					<SpaceComposerReplyBanner
						onClear={input.onClearComposerReplyTo ?? (() => undefined)}
						profilePresentationsById={profilePresentationsById}
						signalId={input.composerReplyToSignalId ?? null}
						timelineItems={threadTimelineItems}
					/>
				)}
				<ThreadSelectedMessageDetails
					activeThread={input.activeThread}
					messageDetailsItem={messageDetailsItem}
					onClose={closeMessageDetails}
					onRecoverExecution={onRecoverExecution}
					onWakeStopRequest={onWakeStopRequest}
					panelInput={input}
					profilePresentationsById={profilePresentationsById}
					replyItems={messageDetailsReplyItems}
					wakeIssueEntries={messageDetailsWakeProgressState?.issueEntries ?? []}
					wakeStopTarget={messageDetailsWakeStopTarget}
					wakeStopTargetLabelsByProfileId={wakeStopTargetLabelsByProfileId}
				/>
			</SpaceInlineSidePanel>
		</SpaceWakeRecommendationScope>
	);
}

function ThreadSelectedMessageDetails(input: {
	activeThread: SpaceThread | null;
	messageDetailsItem: SpaceTimelineItem | null;
	onClose: () => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onWakeStopRequest: SpaceWakeStopRequestHandler;
	panelInput: SpaceThreadPanelProps;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	replyItems: readonly SpaceTimelineItem[];
	wakeIssueEntries: ReturnType<
		typeof resolveSpaceMessageWakeProgressState
	>["issueEntries"];
	wakeStopTarget: SpaceWakeStopTargetResolution | null;
	wakeStopTargetLabelsByProfileId: ReadonlyMap<string, string>;
}) {
	if (!(input.messageDetailsItem && input.activeThread)) {
		return null;
	}
	const panelInput = input.panelInput;
	return (
		<SpaceMessageDetailsDrawer
			agentRecoveryPlansByProfileId={panelInput.agentRecoveryPlansByProfileId}
			canJumpToMessage={(signalId) =>
				Boolean(panelInput.onShowMessageInMain) &&
				signalId === input.activeThread?.rootSignalId
			}
			canStartNewTask={
				panelInput.readOnly !== true && panelInput.canSendMessage
			}
			diagnosticReportStatus={resolveMessageDetailsDiagnosticReportStatus({
				isPending: panelInput.isDiagnosticReportPending(
					input.messageDetailsItem.id
				),
				isSent: panelInput.isDiagnosticReportSent(input.messageDetailsItem.id),
			})}
			errorLogMessage="Failed to report a space thread message."
			isAgentRecoveryPending={panelInput.isAgentRecoveryPending}
			isPersonalContext={panelInput.isPersonalContext}
			item={input.messageDetailsItem}
			onAgentRecoveryAction={panelInput.onAgentRecoveryAction}
			onJumpToMessage={(signalId) => panelInput.onShowMessageInMain?.(signalId)}
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			onRecoverExecution={input.onRecoverExecution}
			onReportMessage={panelInput.onReportMessage}
			onWakeStopRequest={
				panelInput.onWakeStopRequest ? input.onWakeStopRequest : undefined
			}
			open={true}
			openMeldProfileId={panelInput.selfProfileId}
			orgSlug={panelInput.orgSlug}
			prepareSetupHref={panelInput.prepareSetupHref}
			profilePresentationsById={input.profilePresentationsById}
			replyItems={input.replyItems}
			spaceId={input.activeThread.spaceId}
			spaceReferencesById={panelInput.spaceReferencesById}
			targetProfileDisplayNamesByProfileId={
				input.wakeStopTargetLabelsByProfileId
			}
			threadId={input.activeThread.threadId}
			threadRootSignalId={input.activeThread.rootSignalId}
			wakeFailureTargetContextsByProfileId={
				panelInput.wakeFailureTargetContextsByProfileId
			}
			wakeIssueEntries={input.wakeIssueEntries}
			wakeStopTarget={input.wakeStopTarget}
		/>
	);
}

function useThreadMessageDetailsController(input: {
	activeThread: SpaceThread | null;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	isPersonalContext: boolean;
	rawThreadTimelineItems: readonly SpaceTimelineItem[];
	wakeFailureTargetContextsByProfileId: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	wakeOutcomeIndex: SpaceWakeOutcomeIndex;
	wakeStopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	wakeStopTargetLabelsByProfileId: ReadonlyMap<string, string>;
}) {
	const [selection, setSelection] =
		useState<ThreadMessageDetailsSelection | null>(null);
	const messageDetailsItem = resolveThreadMessageDetailsItem({
		activeThread: input.activeThread,
		selection,
	});
	const openMessageDetails = useCallback(
		(item: SpaceTimelineItem) => {
			if (!input.activeThread) {
				return;
			}
			setSelection({
				item,
				rootSignalId: input.activeThread.rootSignalId,
				threadId: input.activeThread.threadId,
			});
		},
		[input.activeThread]
	);
	const onOpenMessageDetails = useLatestCallback(openMessageDetails);
	const messageDetailsWakeProgressState = useMemo(
		() =>
			messageDetailsItem
				? resolveSpaceMessageWakeProgressState({
						agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
						isPersonalContext: input.isPersonalContext,
						item: messageDetailsItem,
						items: input.ephemeralActivityItems,
						timelineItems: input.rawThreadTimelineItems,
						wakeFailureTargetContextsByProfileId:
							input.wakeFailureTargetContextsByProfileId,
						wakeOutcomeIndex: input.wakeOutcomeIndex,
					})
				: null,
		[input, messageDetailsItem]
	);
	const messageDetailsWakeStopTarget = useMemo(
		() =>
			messageDetailsItem
				? resolveSpaceMessageWakeStopTarget({
						item: messageDetailsItem,
						stopRequestStatusBySelectorKey:
							input.wakeStopRequestStatusBySelectorKey,
						timelineItems: input.rawThreadTimelineItems,
						wakeOutcomeIndex: input.wakeOutcomeIndex,
						wakeProgressItems: input.ephemeralActivityItems,
					})
				: null,
		[input, messageDetailsItem]
	);
	const messageDetailsReplyItems = messageDetailsItem
		? resolveReplyItemsForMessage({
				item: messageDetailsItem,
				timelineItems: input.rawThreadTimelineItems,
			})
		: [];
	return {
		closeMessageDetails: () => setSelection(null),
		messageDetailsItem,
		messageDetailsReplyItems,
		messageDetailsWakeProgressState,
		messageDetailsWakeStopTarget,
		onOpenMessageDetails,
	};
}

function useThreadInitialFocus(input: {
	initialFocusRequestId?: number | string;
	signals: SpaceThreadPanelProps["signals"];
	activeThread: SpaceThread | null;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
}) {
	const messageElements = useRef(new Map<string, HTMLElement>());
	const messageScrollActionRef = useRef<SpaceMessageScrollAction | null>(null);
	const highlightedElementRef = useRef<HTMLElement | null>(null);
	const highlightMessageTimerRef = useRef<number | null>(null);
	const appliedInitialFocusRef = useRef<string | null>(null);
	const registerMessageElement = useCallback(
		(signalId: string, element: HTMLElement | null) => {
			if (element) {
				messageElements.current.set(signalId, element);
			} else {
				messageElements.current.delete(signalId);
			}
		},
		[]
	);

	useEffect(() => {
		const targetSignalId = input.initialFocusSignalId;
		const targetRootSignalId = input.initialFocusThreadRootSignalId;
		const targetLoaded =
			targetSignalId === input.activeThread?.rootSignalId ||
			input.signals.some((signal) => signal.id === targetSignalId);
		if (
			!(targetSignalId && targetRootSignalId && input.activeThread) ||
			input.activeThread.rootSignalId !== targetRootSignalId
		) {
			appliedInitialFocusRef.current = null;
			highlightedElementRef.current?.removeAttribute("data-highlighted");
			highlightedElementRef.current = null;
			return;
		}
		const targetKey = `${input.activeThread.threadId}:${targetSignalId}:${input.initialFocusRequestId ?? 0}`;
		if (appliedInitialFocusRef.current === targetKey) {
			return;
		}
		const targetElement = messageElements.current.get(targetSignalId);
		if (!(targetLoaded && targetElement)) {
			return;
		}
		appliedInitialFocusRef.current = targetKey;
		messageScrollActionRef.current?.(targetSignalId, {
			align: "center",
			behavior: "instant",
		});
		const viewport = targetElement.closest<HTMLElement>(
			'[data-slot="message-scroller-viewport"]'
		);
		if (viewport) {
			scrollMessageIntoConversationViewport({
				messageElement: targetElement,
				scrollElement: viewport,
			});
		}
		targetElement.focus({ preventScroll: true });
		highlightedElementRef.current?.removeAttribute("data-highlighted");
		targetElement.setAttribute("data-highlighted", "true");
		highlightedElementRef.current = targetElement;
		if (highlightMessageTimerRef.current !== null) {
			window.clearTimeout(highlightMessageTimerRef.current);
		}
		highlightMessageTimerRef.current = window.setTimeout(() => {
			highlightMessageTimerRef.current = null;
			targetElement.removeAttribute("data-highlighted");
			if (highlightedElementRef.current === targetElement) {
				highlightedElementRef.current = null;
			}
		}, 1800);
	}, [
		input.activeThread,
		input.initialFocusRequestId,
		input.initialFocusSignalId,
		input.initialFocusThreadRootSignalId,
		input.signals,
	]);

	useEffect(
		() => () => {
			if (highlightMessageTimerRef.current !== null) {
				window.clearTimeout(highlightMessageTimerRef.current);
			}
			highlightedElementRef.current?.removeAttribute("data-highlighted");
		},
		[]
	);

	const jumpToMessage = useCallback((signalId: string) => {
		const element = messageElements.current.get(signalId);
		messageScrollActionRef.current?.(signalId, {
			align: "center",
			behavior: "instant",
		});
		const viewport = element?.closest<HTMLElement>(
			'[data-slot="message-scroller-viewport"]'
		);
		if (element && viewport) {
			scrollMessageIntoConversationViewport({
				messageElement: element,
				scrollElement: viewport,
			});
		}
		element?.focus({ preventScroll: true });
	}, []);
	return {
		registerMessageElement,
		jumpToMessage,
		messageScrollActionRef,
		messageElementsRef: messageElements,
	};
}

function renderThreadComposer(
	input: SpaceThreadPanelProps,
	taskSources: readonly SpaceTaskSource[],
	replyBanner: ReactNode
): ReactNode {
	if (input.readOnly) {
		return null;
	}
	return (
		<ThreadComposer
			agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
			automaticWakeConversationKind={input.automaticWakeConversationKind}
			blockedWakeProfileId={input.composerBlockedWakeProfileId}
			canSendMessage={input.canSendMessage && input.activeThread !== null}
			centerAgentProfileId={input.centerAgentProfileId ?? null}
			composerAddressingTargets={input.composerAddressingTargets ?? []}
			composerAuthoredMentions={input.composerAuthoredMentions ?? []}
			composerErrorMessage={input.composerErrorMessage}
			composerFileCleanup={input.composerFileCleanup}
			composerFileLimitReached={input.composerFileLimitReached}
			composerFileRestorationError={input.composerFileRestorationError}
			composerFiles={input.composerFiles}
			composerHasAuthoredMentions={input.composerHasAuthoredMentions}
			composerMembers={input.composerMembers}
			composerMentionPickerItems={input.composerMentionPickerItems ?? []}
			composerText={input.composerText}
			isAgentRecoveryPending={input.isAgentRecoveryPending}
			isCenterAgentDirectMessage={input.isCenterAgentDirectMessage === true}
			isDirectMessage={input.isDirectMessage === true}
			isSendingMessage={input.isSendingMessage}
			onAddComposerFiles={input.onAddComposerFiles}
			onAddPeopleOrAgents={input.onAddPeopleOrAgents}
			onAgentRecoveryAction={input.onAgentRecoveryAction}
			onComposerEditorChange={input.onComposerEditorChange}
			onMentionButtonClick={input.onMentionButtonClick}
			onRemoveComposerFile={input.onRemoveComposerFile}
			onRetryComposerFile={input.onRetryComposerFile}
			onRetryComposerFileCleanup={input.onRetryComposerFileCleanup}
			onRetryComposerFileRestoration={input.onRetryComposerFileRestoration}
			onSend={input.onSend}
			organizationId={input.organizationId}
			orgSlug={input.orgSlug}
			pendingActionSurface={input.pendingActionSurface}
			prepareSetupHref={input.prepareSetupHref}
			profileControl={input.profileControl}
			queuedMessages={
				input.activeThread ? (
					<SpaceInputQueue
						agents={input.membersSnapshot?.agents}
						onEdit={(text) => {
							const draft = [input.composerText, text]
								.filter(Boolean)
								.join("\n\n");
							input.onComposerEditorChange({
								text: draft,
								selection: { start: draft.length, end: draft.length },
								authoredMentions: [...(input.composerAuthoredMentions ?? [])],
							});
							input.textareaRef.current?.focus();
						}}
						profileId={input.selfProfileId}
						progressItems={input.ephemeralActivityItems}
						spaceId={input.activeThread.spaceId}
						threadId={input.activeThread.threadId}
					/>
				) : null
			}
			replyBanner={replyBanner}
			taskSources={taskSources}
			textareaRef={input.textareaRef}
		/>
	);
}

function renderThreadFocusStatus(message: string | null) {
	if (!message) {
		return null;
	}
	return (
		<output
			aria-label="Linked reply isn't available"
			className="border-border border-b bg-muted/40 px-4 py-3 text-muted-foreground text-sm"
		>
			{message}
		</output>
	);
}

function resolveThreadFocusStatusMessage(input: {
	activeThread: SpaceThread | null;
	hasTargetSignal: boolean;
	rootSignalId?: string;
	signalsErrorMessage: string | null;
	signalsIsLoading: boolean;
	targetSignalId?: string;
}): string | null {
	if (
		!(input.targetSignalId && input.rootSignalId && input.activeThread) ||
		input.activeThread.rootSignalId !== input.rootSignalId ||
		input.hasTargetSignal ||
		input.signalsIsLoading
	) {
		return null;
	}
	return input.signalsErrorMessage
		? "Couldn’t load the linked thread reply. Refresh this Space and try again."
		: "This linked reply isn’t available in the thread. It may have been removed or you may no longer have access.";
}

function buildThreadWakeOutcomeIndex(input: {
	spaceItems: readonly SpaceTimelineItem[];
	threadItems: readonly SpaceTimelineItem[];
}): SpaceWakeOutcomeIndex {
	const threadItemIds = new Set<string>();
	const threadWakeSourceSignalIds = new Set<string>();
	for (const item of input.threadItems) {
		threadItemIds.add(item.id);
		if (item.wakeTargetProfileIds.length > 0) {
			threadWakeSourceSignalIds.add(item.id);
		}
	}
	const exactSpaceOutcomeItems = input.spaceItems.filter(
		(item) =>
			!threadItemIds.has(item.id) &&
			item.replyToSignalId !== null &&
			threadWakeSourceSignalIds.has(item.replyToSignalId)
	);
	return buildSpaceWakeOutcomeIndex([
		...input.threadItems,
		...exactSpaceOutcomeItems,
	]);
}

function resolveReplyItemsForMessage(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): readonly SpaceTimelineItem[] {
	return input.timelineItems.filter(
		(candidate) => candidate.replyToSignalId === input.item.id
	);
}

function resolveThreadComputerSetupContext(input: {
	activeThread: SpaceThread | null;
	isCenterAgentDirectMessage: boolean;
	orgSlug?: string;
	selfProfileId: string;
}): CenterAgentComputerSetupContext | undefined {
	if (
		!(input.activeThread && input.isCenterAgentDirectMessage && input.orgSlug)
	) {
		return undefined;
	}
	return {
		orgSlug: input.orgSlug,
		profileId: input.selfProfileId,
		spaceId: input.activeThread.spaceId,
	};
}

function resolveThreadComputerSetupActionSignalId(input: {
	context?: CenterAgentComputerSetupContext;
	timelineItems: readonly SpaceTimelineItem[];
}): string | null {
	if (!input.context) {
		return null;
	}
	return resolveLatestComputerSetupActionSignalId({
		timelineItems: input.timelineItems,
	});
}

function ThreadTimeline(input: {
	messageElementsRef: { current: Map<string, HTMLElement> };
	panelInput: SpaceThreadPanelProps;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	isDirectMessage: boolean;
	messageScrollActionRef: { current: SpaceMessageScrollAction | null };
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	allItems: readonly SpaceTimelineItem[];
	anchoredOutcomeNoticesBySourceSignalId: ReadonlyMap<
		string,
		readonly SpaceTimelineItem[]
	>;
	errorMessage: string | null;
	firstUnreadSignalId: string | null;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	centerAgentProfileId: string | null;
	computerSetupActionSignalId: string | null;
	computerSetupContext?: CenterAgentComputerSetupContext;
	items: readonly SpaceTimelineItem[];
	isLoading: boolean;
	unreadTargets: readonly SpaceInboxUnreadTarget[];
	unreadScopes?: SpaceInboxUnreadTargetsResponse["scopes"];
	readScopeKey: string;
	actionableAgentInteractionPlacement: SpaceAgentInteractionPlacement;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenProfile?: (profileId: string) => void;
	renderProfileTrigger: SpaceProfileTriggerRenderer;
	onViewedUpdates?: (
		targets: readonly SpaceInboxUnreadTarget[]
	) => Promise<void> | void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	orgSlug?: string;
	prepareSetupHref?: string;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	readOnly: boolean;
	onJumpToMessage: (signalId: string) => void;
	registerMessageElement: (
		signalId: string,
		element: HTMLElement | null
	) => void;
	selfAvatarImageUrl: string | null;
	selfProfileId: string;
	spaceReferencesById?: SpaceMessageReferencesById;
	wakeFailureTargetContextsByProfileId: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	isPersonalContext: boolean;
	wakeOutcomeIndex: SpaceWakeOutcomeIndex;
	wakeStopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	wakeStopTargetLabelsByProfileId: ReadonlyMap<string, string>;
}) {
	const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
		null
	);
	const wakeProblemSourceSignalIds = useMemo(
		() =>
			buildWakeProblemSourceSignalIds({
				items: input.allItems,
				wakeProgressItems: input.ephemeralActivityItems,
			}),
		[input.allItems, input.ephemeralActivityItems]
	);
	const profileEntriesById = useMemo(
		() => buildSpaceMemberDirectoryEntryByProfileId(input.membersSnapshot),
		[input.membersSnapshot]
	);
	const entries = useMemo(
		() =>
			buildSpaceConversationEntries({
				selfProfileId: input.selfProfileId,
				timelineItems: input.items,
				groupBoundarySignalIds: new Set(
					[
						input.items[0]?.id === input.panelInput.activeThread?.rootSignalId
							? input.items[1]?.id
							: undefined,
						input.firstUnreadSignalId,
					].filter((id): id is string => Boolean(id))
				),
			}),
		[
			input.items,
			input.selfProfileId,
			input.firstUnreadSignalId,
			input.panelInput.activeThread?.rootSignalId,
		]
	);
	const loadedSignalIds = useMemo(
		() => new Set(input.items.map((item) => item.id)),
		[input.items]
	);
	const panel = input.panelInput;
	const taskAction = useSpaceMessageTaskAction({
		disabled: input.readOnly,
		openMeldProfileId: input.selfProfileId,
		organizationSlug: panel.orgSlug,
		spaceId: panel.activeThread?.spaceId,
	});
	const conversationPosition = useSpaceConversationPosition({
		historyIsPending: input.isLoading,
		isLiveHistory: true,
		historyVersion: input.items,
		hasExplicitFocus: Boolean(panel.initialFocusSignalId),
		messageElementsRef: input.messageElementsRef,
		restorationId: `space-thread:${panel.activeThread?.spaceId}:${panel.activeThread?.threadId}`,
		selfProfileId: input.selfProfileId,
		viewport: scrollElement,
	});
	const [navigationError, setNavigationError] = useState<string | null>(null);
	const unreadCount =
		input.unreadScopes?.find(
			(scope) => scope.threadRootSignalId === panel.activeThread?.rootSignalId
		)?.unreadCount ?? input.unreadTargets.length;
	const navigateUnread = async (
		target: SpaceInboxUnreadTarget
	): Promise<boolean> => {
		conversationPosition.releaseReadingPosition();
		setNavigationError(null);
		try {
			if (input.messageElementsRef.current.has(target.signalId)) {
				input.onJumpToMessage(target.signalId);
				return true;
			}
			if (
				target.threadRootSignalId &&
				(await panel.onOpenUnreadThread?.({
					rootSignalId: target.threadRootSignalId,
					signalId: target.signalId,
				}))
			) {
				return true;
			}
			throw new Error(
				"Couldn’t find this unread reply. Refresh this Thread and try again."
			);
		} catch (error) {
			setNavigationError(
				error instanceof Error
					? error.message
					: "Couldn’t open this unread reply. Try again."
			);
			return false;
		}
	};
	if (input.errorMessage) {
		return (
			<p className="m-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm">
				{input.errorMessage}
			</p>
		);
	}
	return (
		<MessageScrollerProvider
			autoScroll={conversationPosition.autoScroll}
			defaultScrollPosition={conversationPosition.defaultScrollPosition}
		>
			<SpaceConversationSendScrollController
				isSendingMessage={panel.isSendingMessage}
				onSendStart={conversationPosition.followLatest}
			/>
			<SpaceMessageScrollController
				actionRef={input.messageScrollActionRef}
				latestMessageId={input.items.at(-1)?.id}
				scrollElement={scrollElement}
			/>
			<MessageScroller className="min-h-0 flex-1">
				<MessageScrollerViewport
					aria-label="Thread history"
					aria-live="polite"
					className="space-conversation-inline-padding py-4"
					onScroll={(event) =>
						conversationPosition.onScroll(event.currentTarget)
					}
					onScrollEnd={(event) =>
						conversationPosition.onScrollEnd(event.currentTarget)
					}
					ref={setScrollElement}
					role="log"
				>
					<SpaceMessageReadObserver
						key={input.readScopeKey}
						onViewedUpdates={
							conversationPosition.restorationStatus === "ready"
								? input.onViewedUpdates
								: undefined
						}
						unreadTargets={input.unreadTargets}
					/>
					<div className="pointer-events-none sticky top-0 z-20 flex justify-center">
						<SpaceConversationUnreadControl
							count={unreadCount}
							firstUnreadSignalId={input.firstUnreadSignalId}
							onNavigate={navigateUnread}
							scope="thread"
							targets={input.unreadTargets}
							threadRootSignalId={panel.activeThread?.rootSignalId}
						/>
					</div>
					{navigationError && (
						<p className="text-destructive text-sm" role="alert">
							{navigationError}
						</p>
					)}
					<MessageScrollerContent className="gap-0">
						{input.isLoading && input.items.length === 0 ? (
							<ThreadMessagesLoading />
						) : null}
						{entries.map((entry) => {
							if (entry.kind === "conversation_compaction") {
								return (
									<SpaceConversationCompactionMarker
										id={entry.id}
										key={entry.id}
									/>
								);
							}
							const item =
								entry.kind === "bubble_run" ? entry.run.items[0] : entry.item;
							if (!item) {
								return null;
							}
							if (
								isSpaceOutcomeNoticeItem(item) &&
								!(
									item.systemNoticeType === "wake_stopped" &&
									item.actorProfileKind === "agent"
								)
							) {
								return (
									<MessageScrollerItem key={item.id} messageId={item.id}>
										<div
											className={cn(
												"flex w-full justify-start",
												SPACE_MESSAGE_ROW_LAYOUT_CLASS,
												"focus-visible:outline-none data-[highlighted=true]:rounded-md data-[highlighted=true]:bg-muted/50"
											)}
											data-message-row-id={item.id}
											data-message-source-at={item.createdAtMs}
											data-signal-id={item.id}
											ref={(element) => {
												input.registerMessageElement(item.id, element);
											}}
											tabIndex={-1}
										>
											<SpaceOutcomeRow
												onOpenDetails={
													input.readOnly
														? null
														: () => input.onOpenMessageDetails(item)
												}
												spaceReferencesById={input.spaceReferencesById}
												text={item.text}
												tone={resolveSpaceOutcomeRowTone({
													failureStage: item.systemNoticeFailureStage,
													noticeType: item.systemNoticeType,
													reasonCode: item.systemNoticeReasonCode,
												})}
											/>
										</div>
									</MessageScrollerItem>
								);
							}

							return (
								<Fragment key={resolveSpaceConversationItemKey(item)}>
									{item.id === input.firstUnreadSignalId ? (
										<div className="my-2 flex items-center gap-3 text-unread text-xs before:h-px before:flex-1 before:bg-unread after:h-px after:flex-1 after:bg-unread">
											<span>New messages</span>
										</div>
									) : null}

									<SpaceMessageRun
										actionableAgentInteractionPlacement={
											input.actionableAgentInteractionPlacement
										}
										addressingWakeProgressItems={input.ephemeralActivityItems}
										agentRecoveryPlansByProfileId={
											input.agentRecoveryPlansByProfileId
										}
										anchoredOutcomeNoticesBySourceSignalId={
											input.anchoredOutcomeNoticesBySourceSignalId
										}
										centerAgentProfileId={input.centerAgentProfileId}
										currentOwnerUserId={panel.currentOwnerUserId}
										ephemeralActivityItems={input.ephemeralActivityItems}
										highlightedSignalId={null}
										inlineComputerSetupActionSignalId={
											input.computerSetupActionSignalId
										}
										isCenterAgentDirectMessage={
											panel.isCenterAgentDirectMessage === true
										}
										isCreatingThread={false}
										isDirectMessage={input.isDirectMessage}
										isPersonalContext={input.isPersonalContext}
										loadedMainTimelineSignalIds={loadedSignalIds}
										membersSnapshot={input.membersSnapshot}
										modelCatalog={input.modelCatalog}
										onAddMessageToTasks={taskAction.onAdd}
										onAgentInteractionResponse={
											input.onAgentInteractionResponse
										}
										onJumpToMessage={input.onJumpToMessage}
										onOpenMessageDetails={input.onOpenMessageDetails}
										onOpenSpaceFile={input.onOpenSpaceFile}
										onRecoverExecution={input.onRecoverExecution}
										onReplyToMessage={panel.onReplyToMessage}
										onWakeStopRequest={input.onWakeStopRequest}
										orgSlug={input.orgSlug}
										prepareSetupHref={input.prepareSetupHref}
										profileDetailsEntry={
											profileEntriesById.get(item.actorProfileId) ?? null
										}
										profileEntriesById={profileEntriesById}
										profilePresentationsById={input.profilePresentationsById}
										readOnly={input.readOnly}
										registerMessageElement={input.registerMessageElement}
										run={
											entry.kind === "bubble_run"
												? entry.run
												: {
														id: item.id,
														isSelf: item.actorProfileId === input.selfProfileId,
														items: [item],
														speaker: {
															profileId: item.actorProfileId,
															profileKind: item.actorProfileKind,
															displayName: item.actorName,
															profileName: item.actorProfileName,
															ownerUserId: item.actorOwnerUserId,
															ownerDisplay: item.actorOwnerDisplay,
															avatarImageUrl: item.actorAvatarImageUrl,
															agentControllerRef: item.actorAgentControllerRef,
															agentControllerPending:
																item.actorAgentControllerPending,
															controllerDisplay: item.actorControllerDisplay,
															runtimeDeviceDisplayName:
																item.actorRuntimeDeviceDisplayName,
														},
													}
										}
										selfAvatarImageUrl={input.selfAvatarImageUrl}
										selfProfileId={input.selfProfileId}
										spaceId={panel.activeThread?.spaceId}
										spaceReferencesById={input.spaceReferencesById}
										taskCreationSourceSignalId={
											taskAction.pendingSourceSignalId
										}
										threadId={panel.activeThread?.threadId}
										threadPreviewByThreadId={EMPTY_THREAD_PREVIEWS}
										threadStreamsByRootSignalId={EMPTY_THREAD_STREAMS}
										threadsByRootSignalId={EMPTY_THREADS}
										threadWakeProgressByRootSignalId={EMPTY_THREAD_PROGRESS}
										timelineItems={input.allItems}
										unreadTargets={[]}
										wakeFailureTargetContextsByProfileId={
											input.wakeFailureTargetContextsByProfileId
										}
										wakeOutcomeIndex={input.wakeOutcomeIndex}
										wakeProblemSourceSignalIds={wakeProblemSourceSignalIds}
										wakeStopRequestStatusBySelectorKey={
											input.wakeStopRequestStatusBySelectorKey
										}
										wakeStopTargetLabelsByProfileId={
											input.wakeStopTargetLabelsByProfileId
										}
									/>
								</Fragment>
							);
						})}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<SpaceHistoryJumpControl />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

function ThreadComposer(input: {
	queuedMessages: ReactNode;
	replyBanner: ReactNode;
	organizationId?: string | null;
	taskSources: readonly SpaceTaskSource[];
	canSendMessage: boolean;
	composerMembers?: SpaceComposerProps["members"];
	pendingActionSurface?: ReactNode;
	automaticWakeConversationKind: SpaceAutomaticWakeComposerHintKind | null;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	blockedWakeProfileId: string | null;
	centerAgentProfileId: string | null;
	composerAddressingTargets: readonly SpaceComposerAddressingTarget[];
	composerAuthoredMentions: readonly ComposerDraftAuthoredMention[];
	composerErrorMessage: string | null;
	composerHasAuthoredMentions?: boolean;
	composerText: string;
	composerMentionPickerItems: readonly SpaceMentionPickerItem[];
	composerMentionEmptyMessage?: string;
	composerFiles: readonly SpaceComposerFile[];
	composerFileLimitReached: boolean;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
	isAgentRecoveryPending: (profileId: string) => boolean;
	profileControl?: ReactNode;
	isSendingMessage: boolean;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onComposerEditorChange: (change: SpaceComposerEditorChange) => void;
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onAddPeopleOrAgents?: () => void;
	onRemoveComposerFile: (localId: string) => void;
	onRetryComposerFile?: (localId: string) => Promise<void>;
	onRetryComposerFileCleanup?: (localId: string) => Promise<void>;
	onRetryComposerFileRestoration?: () => void;
	composerFileCleanup?: readonly ComposerFileDraftCleanup[];
	composerFileRestorationError?: unknown | null;
	onMentionButtonClick: () => void;
	onSend: (options?: SpaceComposerSendOptions) => Promise<void>;
	orgSlug?: string;
	prepareSetupHref?: string;
	textareaRef: SpaceComposerInputRef;
}) {
	const sendBlocked = resolveSpaceComposerSendBlocked({
		files: input.composerFiles,
		text: input.composerText,
	});
	const submitComposer = (options?: SpaceComposerSendOptions) => {
		const blocked = resolveSpaceComposerSendBlocked({
			files: input.composerFiles,
			text: input.composerText || options?.taskDraft?.title || "",
		});
		if (!input.canSendMessage || input.isSendingMessage || blocked) {
			return;
		}
		input.onSend(options).catch((error) => {
			console.error("Failed to send a thread message.", error);
		});
	};
	return (
		<SpaceComposer
			actions={{
				onAddFiles: input.onAddComposerFiles,
				onAddPeopleOrAgents: input.onAddPeopleOrAgents,
				onEditorChange: input.onComposerEditorChange,
				onMentionButtonClick: input.onMentionButtonClick,
				onRemoveFile: input.onRemoveComposerFile,
				onRetryFile: input.onRetryComposerFile,
				onRetryFileCleanup: input.onRetryComposerFileCleanup,
				onRetryFileRestoration: input.onRetryComposerFileRestoration,
				onSubmit: submitComposer,
			}}
			availability={{
				canSendMessage: input.canSendMessage,
				fileLimitReached: input.composerFileLimitReached,
				isSendingMessage: input.isSendingMessage,
				sendBlocked,
			}}
			centerAgentProfileId={input.centerAgentProfileId}
			composerRef={input.textareaRef}
			content={{
				addressingTargets: input.composerAddressingTargets,
				authoredMentions: input.composerAuthoredMentions,
				files: input.composerFiles,
				fileCleanup: input.composerFileCleanup,
				fileRestorationError: input.composerFileRestorationError,
				hasAuthoredMentions: input.composerHasAuthoredMentions,
				mentionPickerItems: input.composerMentionPickerItems,
				mentionEmptyMessage: input.composerMentionEmptyMessage,
				text: input.composerText,
			}}
			context={{
				conversationKind: resolveSpaceComposerConversationKind({
					hasAutomaticWakeTarget: Boolean(input.automaticWakeConversationKind),
					isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
					isDirectMessage: input.isDirectMessage,
				}),
				placement: "thread",
			}}
			members={input.composerMembers}
			organizationId={input.organizationId}
			presentation={{
				className: "space-conversation-inline-padding py-4",
				dataSlot: "thread-composer",
				maxHeight: 180,
			}}
			recovery={{
				blockedWakeProfileId: input.blockedWakeProfileId,
				agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
				isAgentRecoveryPending: input.isAgentRecoveryPending,
				onAgentRecoveryAction: input.onAgentRecoveryAction,
				orgSlug: input.orgSlug,
				prepareSetupHref: input.prepareSetupHref,
			}}
			slots={{
				pendingActionSurface: input.pendingActionSurface,
				beforeInput: input.replyBanner,
				queuedMessages: input.queuedMessages,
				beforePrimaryAction: <SpaceComposerWorkBookmarks placement="thread" />,
				error: input.composerErrorMessage ? (
					<p className="text-destructive text-sm" role="alert">
						{input.composerErrorMessage}
					</p>
				) : null,
				profileControl: input.profileControl,
			}}
			taskSources={input.taskSources}
		/>
	);
}

const EMPTY_THREADS = new Map<string, SpaceThread>();
const EMPTY_THREAD_PREVIEWS = new Map<string, SpaceThreadPreview>();
const EMPTY_THREAD_PROGRESS = new Map<
	string,
	readonly SpaceEphemeralActivityItem[]
>();
const EMPTY_THREAD_STREAMS = new Map<
	string,
	readonly SpaceConversationVisibleStreamProjection[]
>();
const UNAVAILABLE_SPACE_WAKE_STOP_REQUEST: SpaceWakeStopRequestHandler = () =>
	Promise.reject(new Error("Space Wake Stop is unavailable."));

import {
	buildSpaceTaskSources,
	type SpaceTaskSource,
} from "./space-composer-task-menu";

function useLatestCallback<Arguments extends unknown[], Result>(
	callback: (...args: Arguments) => Result
): (...args: Arguments) => Result {
	const callbackRef = useRef(callback);
	useLayoutEffect(() => {
		callbackRef.current = callback;
	}, [callback]);
	return useCallback((...args: Arguments) => callbackRef.current(...args), []);
}
