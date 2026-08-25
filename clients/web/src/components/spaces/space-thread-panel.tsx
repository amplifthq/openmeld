import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type { MessageMentionType } from "@openmeld/schemas";
import type {
	SignalEnvelope,
	SpaceMembersSnapshot,
	SpaceThread,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowUpIcon, XIcon } from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";
import {
	Fragment,
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
	PromptInputTextarea,
} from "#/components/ibelick/prompt-input";
import {
	SpaceComposerFileMenu,
	SpaceComposerFileTray,
	useSpaceComposerFileInput,
} from "#/components/spaces/space-composer-attachments";
import { resolveSpaceMessageAgentInteractionItems } from "#/lib/spaces/agent-interactions";
import {
	isSpaceComposerFileFailed,
	isSpaceComposerFileInProgress,
	type SpaceComposerFile,
} from "#/lib/spaces/composer-attachment";
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
	type SpaceWakeStopTargetResolution,
} from "#/lib/spaces/wake-stop-target";
import {
	type CenterAgentComputerSetupContext,
	resolveLatestComputerSetupActionSignalId,
} from "./center-agent-computer-setup-card";
import { Bubble, BubbleContent } from "./primitives/bubble";
import { Message, MessageContent, MessageHeader } from "./primitives/message";
import {
	MessageScroller,
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
import type { SpaceAgentProfileBindingRecoveryPlan } from "./space-agent-recovery-action";
import { SpaceAgentToolActivity } from "./space-agent-tool-activity";
import {
	buildSpaceCollaborationProfilePresentations,
	buildSpaceMemberDirectoryEntryByProfileId,
	buildWakeStopTargetLabelsByProfileId,
} from "./space-collaboration-profile";
import { SpaceComposerAddressingChips } from "./space-composer-addressing";
import {
	resolveSpaceAgentDirectConversationComposerHint,
	resolveSpaceComposerWakeTextHint,
	SPACE_WAKE_COMPOSER_HINT,
	type SpaceAgentDirectConversationComposerHintKind,
} from "./space-composer-copy";
import { SpaceConversationCompactionMarker } from "./space-conversation-compaction-marker";
import { SpaceInlineSidePanel } from "./space-inline-side-panel";
import { SpaceMentionPopover } from "./space-mention-popover";
import {
	MessageDetailsActionButton,
	MessageHoverActionSlot,
} from "./space-message-actions";
import { SpaceMessageBody } from "./space-message-body";
import {
	resolveSpaceMessageActionButtonClassName,
	resolveSpaceMessageActionPlacementClassName,
	resolveSpaceMessageBubblePresentationClass,
	resolveSpaceMessageContentLayoutClassName,
	resolveSpaceMessageContentPaddingClassName,
	resolveSpaceMessageRowLayoutClassName,
	SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS,
	SPACE_MESSAGE_ROW_LAYOUT_CLASS,
	SPACE_MESSAGE_SURFACE_WIDTH_CLASS,
} from "./space-message-bubble-style";
import { SpaceMessageDetailsDrawer } from "./space-message-details-drawer";
import { resolveMessageDetailsDiagnosticReportStatus } from "./space-message-details-presentation";
import { SpaceMessageInteractionSource } from "./space-message-interaction-source";
import { SpaceMessageProfileAvatar } from "./space-message-profile-avatar";
import { SpaceMessageProgressStatus } from "./space-message-progress-status";
import type { SpaceMessageReferencesById } from "./space-message-reference";
import { SpaceMessageWakeReceipt } from "./space-message-wake-receipt";
import {
	groupAnchoredOutcomeNotices,
	resolveGroupedOutcomeRowText,
	SpaceOutcomeRow,
} from "./space-outcome-row";
import { resolveSpaceOutcomeRowTone } from "./space-outcome-tone";
import {
	resolveAnchoredSpaceExecutionRecoveryRequest,
	resolveAnchoredSpaceWakeRetryRequest,
	type SpaceExecutionRecoveryHandler,
	type SpaceWakeRetryAttempt,
	type SpaceWakeRetryHandler,
} from "./space-wake-retry";
import {
	SpaceWakeStopControl,
	type SpaceWakeStopRequestHandler,
	shouldRenderSpaceWakeStopControl,
} from "./space-wake-stop-control";
import type {
	SpaceComposerAddressingTarget,
	SpaceComposerSelection,
	SpaceMentionPopoverState,
} from "./use-space-mention-authoring";
import { useSpacePanelWidth } from "./use-space-panel-width";

const SINGLE_MESSAGE_GROUP_POSITION = {
	isFirstInGroup: true,
	isLastInGroup: true,
} as const;

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

export function SpaceThreadPanel(input: {
	activeThread: SpaceThread | null;
	agentDirectConversationKind: SpaceAgentDirectConversationComposerHintKind | null;
	agentStreams: readonly SpaceConversationVisibleStreamProjection[];
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	centerAgentProfileId?: string | null;
	className?: string;
	composerAddressingSummary?: string | null;
	composerAddressingTargets?: readonly SpaceComposerAddressingTarget[];
	composerBlockedWakeProfileId: string | null;
	composerErrorMessage: string | null;
	composerHasAuthoredMentions?: boolean;
	composerSelection: SpaceComposerSelection;
	composerText: string;
	composerFiles: readonly SpaceComposerFile[];
	composerFileLimitReached: boolean;
	profileControl?: ReactNode;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	editableAgentProfileIds?: ReadonlySet<string>;
	wakeFailureTargetContextsByProfileId: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	isAgentRecoveryPending: (profileId: string) => boolean;
	isDiagnosticReportPending: (signalId: string) => boolean;
	isDiagnosticReportSent: (signalId: string) => boolean;
	isCenterAgentDirectMessage?: boolean;
	initialFocusSignalId?: string;
	initialFocusThreadRootSignalId?: string;
	isPersonalContext?: boolean;
	isSendingMessage: boolean;
	mentionPopoverState: SpaceMentionPopoverState;
	membersSnapshot: SpaceMembersSnapshot | null;
	onClose: () => void;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onComposerChange: (value: string, selection: SpaceComposerSelection) => void;
	onComposerKeyDown: (
		event: KeyboardEvent<HTMLTextAreaElement>
	) => Promise<void>;
	onComposerSelectionChange: (selection: SpaceComposerSelection) => void;
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onRemoveComposerFile: (localId: string) => void;
	onMentionItemHover: (index: number) => void;
	onMentionItemSelect: (index: number, relation?: MessageMentionType) => void;
	onMentionRelationChange?: (
		profileId: string,
		relation: MessageMentionType
	) => void;
	onMentionPopoverClose: () => void;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	onSendText?: (text: string) => Promise<void>;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	onSend: () => Promise<void>;
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
	textareaRef: { current: HTMLTextAreaElement | null };
	wakeStopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
}) {
	const panelWidth = useSpacePanelWidth({ panel: "thread" });
	const initialFocusElementRef = useRef<{
		element: HTMLElement;
		signalId: string;
	} | null>(null);
	const highlightedElementRef = useRef<HTMLElement | null>(null);
	const highlightMessageTimerRef = useRef<number | null>(null);
	const appliedInitialFocusRef = useRef<string | null>(null);
	const [messageDetailsSelection, setMessageDetailsSelection] =
		useState<ThreadMessageDetailsSelection | null>(null);
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
	const messageDetailsItem = resolveThreadMessageDetailsItem({
		activeThread: input.activeThread,
		selection: messageDetailsSelection,
	});
	const rawThreadTimelineItems = useMemo(
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
	const threadTimelineItems = useMemo(
		() => orderSpaceTimelineItemsForConversation(rawThreadTimelineItems),
		[rawThreadTimelineItems]
	);
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
	const profileEntriesById = useMemo(
		() => buildSpaceMemberDirectoryEntryByProfileId(input.membersSnapshot),
		[input.membersSnapshot]
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
	const openMessageDetails = useCallback(
		(item: SpaceTimelineItem) => {
			if (!(activeThreadId && activeThreadRootSignalId)) {
				return;
			}
			setMessageDetailsSelection({
				item,
				rootSignalId: activeThreadRootSignalId,
				threadId: activeThreadId,
			});
		},
		[activeThreadId, activeThreadRootSignalId]
	);
	const onOpenMessageDetails = useLatestCallback(openMessageDetails);
	const onWakeStopRequest = useLatestCallback(
		input.onWakeStopRequest ?? UNAVAILABLE_SPACE_WAKE_STOP_REQUEST
	);
	const retryWakeTargetInThread = useCallback(
		async (request: SpaceWakeRetryAttempt) => {
			const thread = input.activeThread;
			if (!(thread && input.onRetryWakeTarget)) {
				throw new Error("The originating thread is no longer open.");
			}
			await input.onRetryWakeTarget({
				...request,
				threadContext: {
					rootSignalId: thread.rootSignalId,
					threadId: thread.threadId,
				},
			});
		},
		[input.activeThread, input.onRetryWakeTarget]
	);
	const onThreadRetryWakeTarget =
		input.activeThread && input.onRetryWakeTarget
			? retryWakeTargetInThread
			: undefined;
	const messageDetailsWakeProgressState = useMemo(
		() =>
			messageDetailsItem
				? resolveSpaceMessageWakeProgressState({
						agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
						isPersonalContext: input.isPersonalContext === true,
						item: messageDetailsItem,
						items: input.ephemeralActivityItems,
						timelineItems: rawThreadTimelineItems,
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
			messageDetailsItem,
			rawThreadTimelineItems,
			wakeOutcomeIndex,
		]
	);
	const messageDetailsWakeStopTarget = useMemo(
		() =>
			messageDetailsItem
				? resolveSpaceMessageWakeStopTarget({
						item: messageDetailsItem,
						stopRequestStatusBySelectorKey:
							input.wakeStopRequestStatusBySelectorKey,
						targetLabelsByProfileId: wakeStopTargetLabelsByProfileId,
						timelineItems: rawThreadTimelineItems,
						wakeOutcomeIndex,
						wakeProgressItems: input.ephemeralActivityItems,
					})
				: null,
		[
			input.ephemeralActivityItems,
			input.wakeStopRequestStatusBySelectorKey,
			messageDetailsItem,
			rawThreadTimelineItems,
			wakeOutcomeIndex,
			wakeStopTargetLabelsByProfileId,
		]
	);
	const messageDetailsReplyItems = messageDetailsItem
		? resolveReplyItemsForMessage({
				item: messageDetailsItem,
				timelineItems: rawThreadTimelineItems,
			})
		: [];
	const registerMessageElement = useCallback(
		(signalId: string, element: HTMLElement | null) => {
			if (element) {
				if (signalId === input.initialFocusSignalId) {
					initialFocusElementRef.current = { element, signalId };
				}
				return;
			}
			if (initialFocusElementRef.current?.signalId === signalId) {
				initialFocusElementRef.current = null;
			}
		},
		[input.initialFocusSignalId]
	);

	useEffect(() => {
		const targetSignalId = input.initialFocusSignalId;
		const targetRootSignalId = input.initialFocusThreadRootSignalId;
		if (
			!(targetSignalId && targetRootSignalId && input.activeThread) ||
			input.activeThread.rootSignalId !== targetRootSignalId
		) {
			appliedInitialFocusRef.current = null;
			highlightedElementRef.current?.removeAttribute("data-highlighted");
			highlightedElementRef.current = null;
			return;
		}
		const targetKey = `${input.activeThread.threadId}:${targetSignalId}`;
		if (appliedInitialFocusRef.current === targetKey) {
			return;
		}
		const targetElement =
			initialFocusElementRef.current?.signalId === targetSignalId
				? initialFocusElementRef.current.element
				: null;
		if (targetElement) {
			appliedInitialFocusRef.current = targetKey;
			targetElement.scrollIntoView({ block: "center" });
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
			return;
		}
	}, [
		input.activeThread,
		input.initialFocusSignalId,
		input.initialFocusThreadRootSignalId,
	]);

	useEffect(() => {
		setMessageDetailsSelection((currentSelection) => {
			if (
				currentSelection?.threadId === activeThreadId &&
				currentSelection.rootSignalId === activeThreadRootSignalId
			) {
				return currentSelection;
			}
			return null;
		});
	}, [activeThreadId, activeThreadRootSignalId]);

	useEffect(
		() => () => {
			if (highlightMessageTimerRef.current !== null) {
				window.clearTimeout(highlightMessageTimerRef.current);
			}
			highlightedElementRef.current?.removeAttribute("data-highlighted");
		},
		[]
	);

	return (
		<SpaceInlineSidePanel
			ariaLabel="Thread"
			className={input.className}
			id="space-thread-panel"
			maxWidth={panelWidth.maxWidth}
			minWidth={panelWidth.minWidth}
			onWidthChange={panelWidth.onWidthChange}
			open={input.activeThread !== null}
			resizeHandleLabel="Resize Thread panel"
			width={panelWidth.width}
		>
			<ThreadPanelHeader onClose={input.onClose} />
			{renderThreadFocusStatus(focusStatusMessage)}
			<ThreadTimeline
				agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
				allItems={rawThreadTimelineItems}
				anchoredOutcomeNoticesBySourceSignalId={
					anchoredOutcomeNoticesBySourceSignalId
				}
				centerAgentProfileId={input.centerAgentProfileId ?? null}
				computerSetupActionSignalId={computerSetupActionSignalId}
				computerSetupContext={computerSetupContext}
				editableAgentProfileIds={input.editableAgentProfileIds}
				ephemeralActivityItems={input.ephemeralActivityItems}
				errorMessage={input.signalsErrorMessage}
				isLoading={input.signalsIsLoading}
				isPersonalContext={input.isPersonalContext === true}
				items={threadTimelineItems}
				onAgentInteractionResponse={input.onAgentInteractionResponse}
				onEditAgentProfile={input.onEditAgentProfile}
				onOpenMessageDetails={onOpenMessageDetails}
				onOpenSpaceFile={input.onOpenSpaceFile}
				onRecoverExecution={messageDetailsItem ? undefined : onRecoverExecution}
				onRetryWakeTarget={onThreadRetryWakeTarget}
				onWakeStopRequest={
					input.onWakeStopRequest ? onWakeStopRequest : undefined
				}
				orgSlug={input.orgSlug}
				prepareSetupHref={input.prepareSetupHref}
				readOnly={input.readOnly === true}
				registerMessageElement={registerMessageElement}
				selfAvatarImageUrl={input.selfAvatarImageUrl ?? null}
				selfProfileId={input.selfProfileId}
				spaceReferencesById={input.spaceReferencesById}
				wakeFailureTargetContextsByProfileId={
					input.wakeFailureTargetContextsByProfileId
				}
				wakeOutcomeIndex={wakeOutcomeIndex}
				wakeStopRequestStatusBySelectorKey={
					input.wakeStopRequestStatusBySelectorKey
				}
				wakeStopTargetLabelsByProfileId={wakeStopTargetLabelsByProfileId}
			/>
			{input.readOnly ? null : (
				<ThreadComposer
					agentDirectConversationKind={input.agentDirectConversationKind}
					blockedWakeProfileId={input.composerBlockedWakeProfileId}
					centerAgentProfileId={input.centerAgentProfileId ?? null}
					composerAddressingSummary={input.composerAddressingSummary ?? null}
					composerAddressingTargets={input.composerAddressingTargets ?? []}
					composerErrorMessage={input.composerErrorMessage}
					composerFileLimitReached={input.composerFileLimitReached}
					composerFiles={input.composerFiles}
					composerHasAuthoredMentions={input.composerHasAuthoredMentions}
					composerSelection={input.composerSelection}
					composerText={input.composerText}
					isSendingMessage={input.isSendingMessage}
					mentionPopoverState={input.mentionPopoverState}
					onAddComposerFiles={input.onAddComposerFiles}
					onComposerChange={input.onComposerChange}
					onComposerKeyDown={input.onComposerKeyDown}
					onComposerSelectionChange={input.onComposerSelectionChange}
					onMentionItemHover={input.onMentionItemHover}
					onMentionItemSelect={input.onMentionItemSelect}
					onMentionPopoverClose={input.onMentionPopoverClose}
					onMentionRelationChange={
						input.onMentionRelationChange ?? NOOP_MENTION_RELATION_CHANGE
					}
					onRemoveComposerFile={input.onRemoveComposerFile}
					onSend={input.onSend}
					profileControl={input.profileControl}
					textareaRef={input.textareaRef}
				/>
			)}
			{messageDetailsItem && input.activeThread ? (
				<SpaceMessageDetailsDrawer
					canJumpToMessage={() => false}
					diagnosticReportStatus={resolveMessageDetailsDiagnosticReportStatus({
						isPending: input.isDiagnosticReportPending(messageDetailsItem.id),
						isSent: input.isDiagnosticReportSent(messageDetailsItem.id),
					})}
					errorLogMessage="Failed to report a space thread message."
					isAgentRecoveryPending={input.isAgentRecoveryPending}
					isPersonalContext={input.isPersonalContext}
					item={messageDetailsItem}
					onAgentRecoveryAction={input.onAgentRecoveryAction}
					onJumpToMessage={() => undefined}
					onOpenChange={(open) => {
						if (!open) {
							setMessageDetailsSelection(null);
						}
					}}
					onRecoverExecution={onRecoverExecution}
					onReportMessage={input.onReportMessage}
					onRetryWakeTarget={onThreadRetryWakeTarget}
					onWakeStopRequest={
						input.onWakeStopRequest ? onWakeStopRequest : undefined
					}
					open={true}
					openMeldProfileId={input.selfProfileId}
					orgSlug={input.orgSlug}
					prepareSetupHref={input.prepareSetupHref}
					profilePresentationsById={profilePresentationsById}
					replyItems={messageDetailsReplyItems}
					spaceId={input.activeThread.spaceId}
					spaceReferencesById={input.spaceReferencesById}
					targetProfileDisplayNamesByProfileId={wakeStopTargetLabelsByProfileId}
					wakeFailureTargetContextsByProfileId={
						input.wakeFailureTargetContextsByProfileId
					}
					wakeIssueEntries={messageDetailsWakeProgressState?.issueEntries ?? []}
					wakeStopTarget={messageDetailsWakeStopTarget}
				/>
			) : null}
		</SpaceInlineSidePanel>
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
	const threadItemIds = new Set(input.threadItems.map((item) => item.id));
	const threadWakeSourceSignalIds = new Set(
		input.threadItems
			.filter((item) => item.wakeTargetProfileIds.length > 0)
			.map((item) => item.id)
	);
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

function ThreadPanelHeader(input: { onClose: () => void }) {
	return (
		<div className="flex items-center justify-between gap-3 border-border border-b px-4 py-3">
			<p className="font-medium text-sm">Thread</p>
			<Button
				aria-label="Close thread"
				onClick={input.onClose}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<XIcon aria-hidden="true" />
			</Button>
		</div>
	);
}

function renderThreadWakeStopControl(input: {
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	readOnly: boolean;
	wakeStopTargets: readonly SpaceWakeStopTargetResolution[];
}): ReactNode {
	if (
		input.readOnly ||
		!input.onWakeStopRequest ||
		!shouldRenderSpaceWakeStopControl(input.wakeStopTargets)
	) {
		return null;
	}
	return (
		<SpaceWakeStopControl
			onStopWake={input.onWakeStopRequest}
			targets={input.wakeStopTargets}
		/>
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

function resolveThreadComputerSetupPresentation(input: {
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

function ThreadTimeline(input: {
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
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	editableAgentProfileIds?: ReadonlySet<string>;
	centerAgentProfileId: string | null;
	computerSetupActionSignalId: string | null;
	computerSetupContext?: CenterAgentComputerSetupContext;
	items: readonly SpaceTimelineItem[];
	isLoading: boolean;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	orgSlug?: string;
	prepareSetupHref?: string;
	readOnly: boolean;
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
	const wakeProblemSourceSignalIds = useMemo(
		() =>
			buildWakeProblemSourceSignalIds({
				items: input.allItems,
				wakeProgressItems: input.ephemeralActivityItems,
			}),
		[input.allItems, input.ephemeralActivityItems]
	);
	const messageGroupPositionBySignalId = buildThreadMessageGroupPositions({
		items: input.items,
		selfProfileId: input.selfProfileId,
	});
	if (input.errorMessage) {
		return (
			<p className="m-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm">
				{input.errorMessage}
			</p>
		);
	}
	if (input.isLoading) {
		return (
			<p className="flex-1 p-4 text-muted-foreground text-sm">
				Loading thread…
			</p>
		);
	}

	return (
		<MessageScrollerProvider autoScroll={true} defaultScrollPosition="end">
			<MessageScroller className="min-h-0 flex-1">
				<MessageScrollerViewport className="px-4 py-4">
					<MessageScrollerContent className="gap-0">
						{input.items.map((item) => {
							if (isSpaceOutcomeNoticeItem(item)) {
								return (
									<MessageScrollerItem key={item.id} messageId={item.id}>
										<div
											className={cn(
												"flex w-full justify-start",
												SPACE_MESSAGE_ROW_LAYOUT_CLASS,
												"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[highlighted=true]:rounded-md data-[highlighted=true]:bg-ring/10 data-[highlighted=true]:ring-1 data-[highlighted=true]:ring-ring/50"
											)}
											data-message-row-id={item.id}
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

							const messageGroupPosition =
								messageGroupPositionBySignalId.get(item.id) ??
								SINGLE_MESSAGE_GROUP_POSITION;
							return (
								<Fragment key={item.id}>
									{item.conversationCompaction ? (
										<SpaceConversationCompactionMarker
											id={`${item.id}:conversation-compaction`}
										/>
									) : null}
									<ThreadTimelineMessageRow
										agentRecoveryPlansByProfileId={
											input.agentRecoveryPlansByProfileId
										}
										allItems={input.allItems}
										anchoredOutcomeNoticesBySourceSignalId={
											input.anchoredOutcomeNoticesBySourceSignalId
										}
										centerAgentProfileId={input.centerAgentProfileId}
										computerSetupActionSignalId={
											input.computerSetupActionSignalId
										}
										computerSetupContext={input.computerSetupContext}
										editableAgentProfileIds={input.editableAgentProfileIds}
										ephemeralActivityItems={input.ephemeralActivityItems}
										isFirstInGroup={messageGroupPosition.isFirstInGroup}
										isLastInGroup={messageGroupPosition.isLastInGroup}
										isPersonalContext={input.isPersonalContext}
										item={item}
										onAgentInteractionResponse={
											input.onAgentInteractionResponse
										}
										onEditAgentProfile={input.onEditAgentProfile}
										onOpenMessageDetails={input.onOpenMessageDetails}
										onOpenSpaceFile={input.onOpenSpaceFile}
										onRecoverExecution={input.onRecoverExecution}
										onRetryWakeTarget={input.onRetryWakeTarget}
										onWakeStopRequest={input.onWakeStopRequest}
										orgSlug={input.orgSlug}
										readOnly={input.readOnly}
										registerMessageElement={input.registerMessageElement}
										selfAvatarImageUrl={input.selfAvatarImageUrl}
										selfProfileId={input.selfProfileId}
										spaceReferencesById={input.spaceReferencesById}
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
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

const ThreadTimelineMessageRow = memo(function ThreadTimelineMessageRow(input: {
	centerAgentProfileId: string | null;
	computerSetupActionSignalId: string | null;
	computerSetupContext?: CenterAgentComputerSetupContext;
	agentRecoveryPlansByProfileId: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	allItems: readonly SpaceTimelineItem[];
	anchoredOutcomeNoticesBySourceSignalId: ReadonlyMap<
		string,
		readonly SpaceTimelineItem[]
	>;
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	editableAgentProfileIds?: ReadonlySet<string>;
	isFirstInGroup: boolean;
	isLastInGroup: boolean;
	isPersonalContext: boolean;
	item: SpaceTimelineItem;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onEditAgentProfile?: SpaceAgentProfileEditHandler;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	orgSlug?: string;
	readOnly: boolean;
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
	wakeOutcomeIndex: SpaceWakeOutcomeIndex;
	wakeProblemSourceSignalIds: ReadonlySet<string>;
	wakeStopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	wakeStopTargetLabelsByProfileId: ReadonlyMap<string, string>;
}) {
	const wakeProgressState = resolveSpaceMessageWakeProgressState({
		agentRecoveryPlansByProfileId: input.agentRecoveryPlansByProfileId,
		isPersonalContext: input.isPersonalContext,
		item: input.item,
		items: input.ephemeralActivityItems,
		timelineItems: input.allItems,
		wakeOutcomeIndex: input.wakeOutcomeIndex,
		wakeFailureTargetContextsByProfileId:
			input.wakeFailureTargetContextsByProfileId,
	});
	const wakeStopTargets = resolveSpaceMessageWakeStopTargets({
		item: input.item,
		stopRequestStatusBySelectorKey: input.wakeStopRequestStatusBySelectorKey,
		targetLabelsByProfileId: input.wakeStopTargetLabelsByProfileId,
		timelineItems: input.allItems,
		wakeOutcomeIndex: input.wakeOutcomeIndex,
		wakeProgressItems: input.ephemeralActivityItems,
	});
	const agentInteractionItems = resolveSpaceMessageAgentInteractionItems({
		sourceItem: input.item,
		wakeProgressItems: input.ephemeralActivityItems,
	});
	const wakeStopControl = renderThreadWakeStopControl({
		onWakeStopRequest: input.onWakeStopRequest,
		readOnly: input.readOnly,
		wakeStopTargets,
	});
	const wakeThinkingEntries =
		wakeProgressState.thinkingEntries.length > 0
			? wakeProgressState.thinkingEntries
			: resolveSpaceMessageWakeProgressFallbackEntries({
					item: input.item,
					wakeStopTargets,
				});
	const hasWakeProblem =
		wakeProgressState.hasProblem ||
		input.wakeProblemSourceSignalIds.has(input.item.id) ||
		input.item.systemNoticeType === "terminal_failure";
	const messageDetailsItem = input.readOnly
		? null
		: resolveRecordedSpaceMessageDetailsItem({
				item: input.item,
				timelineItems: input.allItems,
			});
	const agentControlLabel = formatSpaceAgentControlLabel({
		agentControllerRef: input.item.actorAgentControllerRef,
		controllerDisplay: input.item.actorControllerDisplay,
		profileKind: input.item.actorProfileKind,
		runtimeDeviceDisplayName: input.item.actorRuntimeDeviceDisplayName,
	});
	const isSelfMessage = input.item.actorProfileId === input.selfProfileId;
	const messageAlign = resolveThreadMessageDirectionalAlign(isSelfMessage);
	const actionPlacementClassName = resolveSpaceMessageActionPlacementClassName({
		isSelf: isSelfMessage,
	});
	const selfMessageContentLayoutClassName =
		resolveSpaceMessageContentLayoutClassName({ isSelf: isSelfMessage });
	const messageContentPaddingClassName =
		resolveSpaceMessageContentPaddingClassName({ isSelf: isSelfMessage });
	const computerSetupPresentation = resolveThreadComputerSetupPresentation({
		actionSignalId: input.computerSetupActionSignalId,
		context: input.computerSetupContext,
		itemId: input.item.id,
	});
	return (
		<MessageScrollerItem messageId={input.item.id}>
			<Message
				align={messageAlign}
				className={cn(
					"group/message-row",
					resolveSpaceMessageRowLayoutClassName({
						isFirstInGroup: input.isFirstInGroup,
						isLastInGroup: input.isLastInGroup,
					}),
					SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS
				)}
				data-message-row-id={input.item.id}
				data-space-self-message={String(isSelfMessage)}
			>
				<MessageContent
					className={cn(
						"w-full min-w-0 gap-0",
						SPACE_MESSAGE_SURFACE_WIDTH_CLASS
					)}
				>
					<MessageHeader className="flex-wrap gap-x-1.5 gap-y-1 px-0">
						<SpaceMessageProfileAvatar
							agentControllerRef={input.item.actorAgentControllerRef}
							avatarImageUrl={resolveThreadMessageAvatarImageUrl({
								item: input.item,
								selfAvatarImageUrl: input.selfAvatarImageUrl,
								selfProfileId: input.selfProfileId,
							})}
							displayName={input.item.actorName}
							isCenterAgent={
								input.item.actorProfileKind === "agent" &&
								input.item.actorProfileId === input.centerAgentProfileId
							}
							profileId={input.item.actorProfileId}
							profileKind={input.item.actorProfileKind}
						/>
						<span className="min-w-0 truncate font-bold text-foreground text-sm">
							{input.item.actorName}
						</span>
						<span className="shrink-0 text-muted-foreground">·</span>
						<span className="shrink-0 text-muted-foreground">
							{THREAD_TIME_FORMATTER.format(input.item.createdAtMs)}
						</span>
						{agentControlLabel ? (
							<>
								<span className="shrink-0 text-muted-foreground">·</span>
								<span className="min-w-0 text-muted-foreground">
									{agentControlLabel}
								</span>
							</>
						) : null}
					</MessageHeader>
					<Bubble align={messageAlign}>
						{messageDetailsItem ? (
							<div
								className={cn(
									"pointer-events-none absolute -top-6 z-20",
									actionPlacementClassName
								)}
								data-slot="message-hover-actions"
								data-space-message-actions-offset="outside"
							>
								<MessageHoverActionSlot>
									<MessageDetailsActionButton
										buttonClassName={resolveSpaceMessageActionButtonClassName(
											{}
										)}
										hasWakeProblem={hasWakeProblem}
										onClick={() =>
											input.onOpenMessageDetails(messageDetailsItem)
										}
									/>
								</MessageHoverActionSlot>
							</div>
						) : null}
						<BubbleContent
							className={cn(
								"group/thread-message relative flex w-full flex-col gap-2 transition-colors motion-reduce:transition-none",
								messageContentPaddingClassName,
								SPACE_MESSAGE_SURFACE_WIDTH_CLASS,
								selfMessageContentLayoutClassName,
								resolveSpaceMessageBubblePresentationClass({
									isSelf: isSelfMessage,
								}),
								"data-[highlighted=true]:border-ring/40 data-[highlighted=true]:bg-ring/10 data-[highlighted=true]:ring-1 data-[highlighted=true]:ring-ring/50",
								input.item.deliveryState === "pending" ? "opacity-70" : null
							)}
							data-signal-id={input.item.id}
							ref={(element) => {
								input.registerMessageElement(input.item.id, element);
							}}
							tabIndex={-1}
						>
							<SpaceMessageBody
								computerSetupContext={computerSetupPresentation.context}
								computerSetupSourceSignalId={input.item.id}
								containerClassName={selfMessageContentLayoutClassName}
								item={input.item}
								onOpenSpaceFile={input.onOpenSpaceFile}
								openMeldProfileId={input.selfProfileId}
								orgSlug={input.orgSlug}
								spaceReferencesById={input.spaceReferencesById}
							/>
							<SpaceMessageInteractionSource
								source={input.item.centerAgentInteractionSource}
							/>
							{agentInteractionItems.map((interactionItem) => (
								<SpaceAgentInteractionCard
									item={interactionItem}
									key={
										interactionItem.pendingInteraction?.interactionId ??
										`${interactionItem.targetProfileId}:interaction`
									}
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
							))}
							{input.item.agentActivity ? (
								<SpaceAgentToolActivity
									item={input.item}
									onOpenDetails={
										messageDetailsItem
											? () => input.onOpenMessageDetails(messageDetailsItem)
											: undefined
									}
									placement="message"
								/>
							) : null}
							<SpaceMessageWakeReceipt
								targetLabelsByProfileId={input.wakeStopTargetLabelsByProfileId}
								targetProfileIds={input.item.wakeTargetProfileIds}
							/>
							{renderAnchoredThreadOutcomeRows({
								align: messageAlign,
								notices:
									input.anchoredOutcomeNoticesBySourceSignalId.get(
										input.item.id
									) ?? EMPTY_ANCHORED_OUTCOME_NOTICES,
								onOpenMessageDetails: input.onOpenMessageDetails,
								onRecoverExecution: input.onRecoverExecution,
								onRetryWakeTarget: input.onRetryWakeTarget,
								readOnly: input.readOnly,
								sourceItem: input.item,
								spaceReferencesById: input.spaceReferencesById,
								targetLabelsByProfileId: input.wakeStopTargetLabelsByProfileId,
							})}
						</BubbleContent>
					</Bubble>
					<SpaceMessageProgressStatus
						align={messageAlign}
						control={wakeStopControl}
						entries={wakeThinkingEntries}
						item={input.item}
						onOpenMessageDetails={
							messageDetailsItem
								? () => input.onOpenMessageDetails(messageDetailsItem)
								: undefined
						}
					/>
				</MessageContent>
			</Message>
		</MessageScrollerItem>
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

function buildThreadMessageGroupPositions(input: {
	items: readonly SpaceTimelineItem[];
	selfProfileId: string;
}): ReadonlyMap<string, { isFirstInGroup: boolean; isLastInGroup: boolean }> {
	const positions = new Map<
		string,
		{ isFirstInGroup: boolean; isLastInGroup: boolean }
	>();
	const entries = buildSpaceConversationEntries({
		selfProfileId: input.selfProfileId,
		timelineItems: input.items,
	});

	for (const entry of entries) {
		if (entry.kind !== "bubble_run") {
			continue;
		}
		entry.run.items.forEach((item, index) => {
			positions.set(item.id, {
				isFirstInGroup: index === 0,
				isLastInGroup: index === entry.run.items.length - 1,
			});
		});
	}

	return positions;
}

function resolveThreadMessageDirectionalAlign(
	isSelf: boolean
): "start" | "end" {
	return isSelf ? "end" : "start";
}

function resolveThreadMessageAvatarImageUrl(input: {
	item: SpaceTimelineItem;
	selfAvatarImageUrl: string | null;
	selfProfileId: string;
}): string | null {
	if (input.item.actorProfileKind !== "human") {
		return null;
	}

	// Show every human author's avatar from their message snapshot; fall back to
	// the viewer's own avatar so self messages still render optimistically when
	// the author snapshot has not captured an image yet.
	if (input.item.actorAvatarImageUrl) {
		return input.item.actorAvatarImageUrl;
	}
	if (input.item.actorProfileId === input.selfProfileId) {
		return input.selfAvatarImageUrl;
	}

	return null;
}

function ThreadComposer(input: {
	agentDirectConversationKind: SpaceAgentDirectConversationComposerHintKind | null;
	centerAgentProfileId: string | null;
	blockedWakeProfileId: string | null;
	composerAddressingSummary: string | null;
	composerAddressingTargets: readonly SpaceComposerAddressingTarget[];
	composerErrorMessage: string | null;
	composerHasAuthoredMentions?: boolean;
	composerSelection: SpaceComposerSelection;
	composerText: string;
	composerFiles: readonly SpaceComposerFile[];
	composerFileLimitReached: boolean;
	profileControl?: ReactNode;
	isSendingMessage: boolean;
	mentionPopoverState: SpaceMentionPopoverState;
	onComposerChange: (value: string, selection: SpaceComposerSelection) => void;
	onComposerKeyDown: (
		event: KeyboardEvent<HTMLTextAreaElement>
	) => Promise<void>;
	onComposerSelectionChange: (selection: SpaceComposerSelection) => void;
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onRemoveComposerFile: (localId: string) => void;
	onMentionItemHover: (index: number) => void;
	onMentionItemSelect: (index: number, relation?: MessageMentionType) => void;
	onMentionRelationChange: (
		profileId: string,
		relation: MessageMentionType
	) => void;
	onMentionPopoverClose: () => void;
	onSend: () => Promise<void>;
	textareaRef: { current: HTMLTextAreaElement | null };
}) {
	const uploadInProgress = input.composerFiles.some(
		isSpaceComposerFileInProgress
	);
	const uploadFailed = input.composerFiles.some(isSpaceComposerFileFailed);
	const composerHasContent =
		input.composerFiles.length > 0 || input.composerText.trim().length > 0;
	const {
		addFiles,
		handleDragLeave,
		handleDragOver,
		handleDrop,
		handlePaste,
		isDraggingFiles,
	} = useSpaceComposerFileInput({
		disabled: input.isSendingMessage,
		onAddFiles: input.onAddComposerFiles,
	});
	const wakeTextHint = resolveSpaceComposerWakeTextHint(input.composerText, {
		hasAuthoredMentions: input.composerHasAuthoredMentions,
	});
	const defaultComposerHint = input.agentDirectConversationKind
		? resolveSpaceAgentDirectConversationComposerHint(
				input.agentDirectConversationKind
			)
		: SPACE_WAKE_COMPOSER_HINT;
	const composerHintClassName = wakeTextHint
		? "text-foreground"
		: "text-muted-foreground";
	let composerHint =
		input.composerAddressingSummary ?? wakeTextHint ?? defaultComposerHint;
	if (uploadInProgress) {
		composerHint = "Uploading files before sending…";
	}
	if (uploadFailed) {
		composerHint = "Remove files that could not be uploaded before sending.";
	}
	if (!(uploadInProgress || uploadFailed) && input.composerFiles.length > 0) {
		composerHint = `${input.composerFiles.length} ${input.composerFiles.length === 1 ? "file" : "files"} ready to send`;
	}
	const submitComposer = () => {
		if (
			input.isSendingMessage ||
			uploadInProgress ||
			uploadFailed ||
			!composerHasContent
		) {
			return;
		}
		input.onSend().catch((error) => {
			console.error("Failed to send a thread message.", error);
		});
	};
	return (
		<div className="px-4 py-4" data-slot="thread-composer">
			<div className="relative">
				{isDraggingFiles ? (
					<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border border-foreground/30 bg-background/90 text-foreground text-sm shadow-sm backdrop-blur-sm">
						Drop files to add them
					</div>
				) : null}
				<SpaceMentionPopover
					centerAgentProfileId={input.centerAgentProfileId}
					composerSelection={input.composerSelection}
					composerText={input.composerText}
					onHoverItem={input.onMentionItemHover}
					onRequestClose={input.onMentionPopoverClose}
					onSelectItem={input.onMentionItemSelect}
					state={input.mentionPopoverState}
					textareaRef={input.textareaRef}
				/>
				<PromptInput
					className="w-full"
					isLoading={input.isSendingMessage}
					maxHeight={180}
					onSubmit={submitComposer}
					value={input.composerText}
				>
					<SpaceComposerFileTray
						disabled={input.isSendingMessage}
						files={input.composerFiles}
						onRemove={input.onRemoveComposerFile}
					/>
					<PromptInputTextarea
						aria-label="Reply in thread"
						autoComplete="off"
						className="px-1 py-2 text-sm leading-6 placeholder:text-muted-foreground"
						name="thread-message"
						onChange={(event) => {
							input.onComposerChange(event.target.value, {
								end: event.target.selectionEnd,
								start: event.target.selectionStart,
							});
						}}
						onDragEnter={handleDragOver}
						onDragLeave={handleDragLeave}
						onDragOver={handleDragOver}
						onDrop={handleDrop}
						onKeyDown={(event) => {
							input.onComposerKeyDown(event).catch((error) => {
								console.error(
									"Failed to handle thread composer keyboard input.",
									error
								);
							});
						}}
						onPaste={handlePaste}
						onSelect={(event) => {
							input.onComposerSelectionChange({
								end: event.currentTarget.selectionEnd,
								start: event.currentTarget.selectionStart,
							});
						}}
						placeholder="Reply..."
						ref={(element) => {
							input.textareaRef.current = element;
						}}
					/>
					<SpaceComposerAddressingChips
						onRelationChange={input.onMentionRelationChange}
						targets={input.composerAddressingTargets}
					/>
					<PromptInputActions className="min-w-0 justify-between gap-3 border-border border-t pt-2">
						<div className="flex min-w-0 flex-1 items-center gap-2">
							<SpaceComposerFileMenu
								addFiles={addFiles}
								disabled={input.isSendingMessage}
								limitReached={input.composerFileLimitReached}
							/>
							<p
								aria-live="polite"
								className={cn(
									"min-w-0 flex-1 truncate text-xs leading-5",
									composerHintClassName
								)}
							>
								{composerHint}
							</p>
						</div>
						<div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
							{input.profileControl}
							<PromptInputAction
								tooltip={input.isSendingMessage ? "Sending…" : "Send reply"}
							>
								<Button
									aria-label="Send reply"
									disabled={
										input.isSendingMessage ||
										uploadInProgress ||
										uploadFailed ||
										!composerHasContent
									}
									onClick={submitComposer}
									size="icon-sm"
									type="button"
								>
									<ArrowUpIcon aria-hidden="true" weight="bold" />
								</Button>
							</PromptInputAction>
						</div>
					</PromptInputActions>
				</PromptInput>
			</div>
			{input.composerErrorMessage ? (
				<p className="mt-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm">
					{input.composerErrorMessage}
					{input.blockedWakeProfileId
						? ` Profile: ${input.blockedWakeProfileId}`
						: ""}
				</p>
			) : null}
		</div>
	);
}

const EMPTY_ANCHORED_OUTCOME_NOTICES: readonly SpaceTimelineItem[] = [];
const NOOP_MENTION_RELATION_CHANGE = () => undefined;
const UNAVAILABLE_SPACE_WAKE_STOP_REQUEST: SpaceWakeStopRequestHandler = () =>
	Promise.reject(new Error("Space Wake Stop is unavailable."));

// Renders the terminal_failure/wake_stopped notices anchored to this thread
// message inside its own bubble content -- the same BubbleContent-nested
// projection the main conversation panel uses, kept in sync so a Wake
// outcome reads the same way and inherits the same card hover/rounded/padding
// treatment whether it closed a thread reply or a main-timeline message. The
// Details action always opens the SOURCE thread message (not the notice's
// own record), matching the main panel.
function renderAnchoredThreadOutcomeRows(input: {
	align?: "end" | "start";
	notices: readonly SpaceTimelineItem[];
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onRetryWakeTarget?: SpaceWakeRetryHandler;
	readOnly: boolean;
	sourceItem: SpaceTimelineItem;
	spaceReferencesById?: SpaceMessageReferencesById;
	targetLabelsByProfileId: ReadonlyMap<string, string>;
}) {
	if (input.notices.length === 0) {
		return null;
	}

	const outcomeNotices = input.notices.filter(isSpaceOutcomeNoticeItem);
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
								input.targetLabelsByProfileId.get(targetProfileId) ?? null,
							tone: group.tone,
						})}
						tone={group.tone}
					/>
				);
			})}
		</>
	);
}

const THREAD_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
});
