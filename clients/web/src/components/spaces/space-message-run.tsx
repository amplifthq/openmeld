import type {
	AgentProfileReplyRecoveryPlan,
	ProfileDetailsSpaceMemberInput,
} from "@openmeld/agent-profile";
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
	readThreadReplyPreviewLine,
	type SpaceMemberDirectoryEntry,
} from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import { FluidContextMenuScope } from "@openmeld/ui/fluid/context-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { memo, type ReactNode, useRef } from "react";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import { useMemberAgentProfileDisplayName } from "#/components/member-agents/use-member-agent-profile-display-name";
import { getSpaceConversationHistorySignalId } from "#/lib/space-conversation-position";
import {
	hasActiveWakeReplyForSource,
	resolveActiveWakeSourceItem,
} from "#/lib/spaces/active-wake-conversation";
import { resolveSpaceMessageAgentInteractionItems } from "#/lib/spaces/agent-interactions";
import type { SpaceConversationVisibleStreamProjection } from "#/lib/spaces/conversation-stream";
import type { SpaceEphemeralActivityItem } from "#/lib/spaces/dispatch-activity";
import { isSpaceMessageAgentWorking } from "#/lib/spaces/message-state";
import type { SpaceConversationBubbleRun } from "#/lib/spaces/presentation";
import {
	buildSpaceTimelineItems,
	resolveRecordedSpaceMessageDetailsItem,
	resolveSpaceConversationItemKey,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import type { WakeFailureTargetContext } from "#/lib/spaces/wake-failure-display";
import {
	resolveSpaceMessageWakeProgressFallbackEntries,
	resolveSpaceMessageWakeProgressState,
} from "#/lib/spaces/wake-progress-presentation";
import {
	presentWorkingStatus,
	resolveWakeProgressStatus,
} from "#/lib/spaces/wake-progress-status";
import {
	resolveSpaceMessageWakeStopTargets,
	resolveWakeStopTargetForProgressItem,
	type SpaceWakeOutcomeIndex,
	type SpaceWakeStopRequestStatus,
} from "#/lib/spaces/wake-stop-target";
import { useCenterAgentCurrentModelName } from "#/query/profiles/agent-avatar-context";
import { spaceThreadSignalsQueryOptions } from "#/query/spaces/threads";
import type { CenterAgentComputerSetupContext } from "./center-agent-computer-setup-card";
import { formatDirectMessageTime } from "./direct-message-preview";
import { Bubble, BubbleGroup } from "./primitives/bubble";
import { Message, MessageContent, MessageHeader } from "./primitives/message";
import { MessageScrollerItem } from "./primitives/message-scroller";
import { formatSpaceAgentAttribution } from "./space-agent-attribution";
import {
	SpaceAgentInteractionCard,
	type SpaceAgentInteractionResponseHandler,
} from "./space-agent-interaction-card";
import type { SpaceAgentInteractionPlacement } from "./space-agent-interaction-placement";
import { SpaceAgentOrb } from "./space-agent-orb";
import { WAKE_STATUS_ORB_STATE } from "./space-agent-orb-state";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import {
	resolveAnchoredSpaceExecutionRecoveryRequest,
	type SpaceExecutionRecoveryHandler,
} from "./space-execution-recovery-actions";
import {
	hasSpaceMessageAttachments,
	SpaceMessageAttachments,
} from "./space-message-attachments";
import { SpaceMessageBody } from "./space-message-body";
import {
	resolveSpaceMessageBubblePresentationClass,
	resolveSpaceMessageContentLayoutClassName,
	resolveSpaceMessageRowLayoutClassName,
	SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS,
	SPACE_MESSAGE_SURFACE_WIDTH_CLASS,
} from "./space-message-bubble-style";
import { SpaceMessageContinuationNotice } from "./space-message-continuation-notice";
import {
	copySpaceTimelineItemWithFeedback,
	isSpaceMessageCopyPending,
} from "./space-message-copy";
import { SpaceMessageDelegationSummary } from "./space-message-delegation-summary";
import {
	resolveSpaceMessageFooterAddressingTargets,
	resolveSpaceMessageFooterFailureSummary,
	SpaceMessageFooter,
} from "./space-message-footer";
import { SpaceMessageInteractionSource } from "./space-message-interaction-source";
import { SpaceMessagePluginRequests } from "./space-message-plugin-requests";
import { SpaceMessageProfileAvatar } from "./space-message-profile-avatar";
import {
	buildSpaceMessageProfileMentionProfiles,
	splitSpaceMessageProfileMentionText,
} from "./space-message-profile-mention";
import { shouldPlaceSpaceMessageProgressInAnswer } from "./space-message-progress-placement";
import { SpaceMessageProgressStatus } from "./space-message-progress-status";
import {
	MessageBubbleReactions,
	MessageReactionsProvider,
	resolveMessageReactionInput,
} from "./space-message-reactions";
import { spaceMessageReadSourceAt } from "./space-message-read-observer";
import {
	EMPTY_SPACE_MESSAGE_REFERENCES,
	hasResolvedSpaceMessageReference,
	type SpaceMessageReferencesById,
	SpaceMessageReferenceText,
} from "./space-message-reference";
import { SpaceMessageSurface } from "./space-message-surface";
import { SpaceMessageTime } from "./space-message-time";
import { SpaceMessageWork } from "./space-message-work";
import {
	groupAnchoredOutcomeNotices,
	resolveGroupedOutcomeRowText,
	SpaceOutcomeRow,
	visibleAnchoredOutcomeNotices,
} from "./space-outcome-row";
import { resolveSpacePendingAgentActionIdentity } from "./space-pending-agent-action-model";
import { SpaceMessageTaskReference } from "./space-task-references";
import {
	SpaceWakeStopControl,
	type SpaceWakeStopRequestHandler,
	shouldRenderSpaceWakeStopControl,
} from "./space-wake-stop-control";
import { useSpaceProfileDetailsPopover } from "./use-space-profile-details-popover";

type SpaceMessageRunInput = {
	threadId?: string;
	isDirectMessage: boolean;
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
	/** Rows under a message's bubble, such as the request card's status. */
	messageFootersBySignalId?: ReadonlyMap<string, ReactNode>;
	centerAgentProfileId: string | null;
	currentOwnerUserId: string | null;
	addressingWakeProgressItems: readonly SpaceEphemeralActivityItem[];
	ephemeralActivityItems: readonly SpaceEphemeralActivityItem[];
	highlightedSignalId: string | null;
	actionableAgentInteractionPlacement: SpaceAgentInteractionPlacement;
	inlineComputerSetupActionSignalId: string | null;
	isCenterAgentDirectMessage: boolean;
	isCreatingThread: boolean;
	isPersonalContext: boolean;
	loadedMainTimelineSignalIds: ReadonlySet<string>;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	onAgentInteractionResponse?: SpaceAgentInteractionResponseHandler;
	onCreateThread?: (input: { rootSignalId: string }) => Promise<void>;
	onJumpToMessage: (signalId: string) => void;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenThread?: (threadId: string) => void;
	onOpenSpaceFile: (fileId: string, revision: number) => void;
	onAddMessageToTasks?: (
		item: SpaceTimelineItem,
		threadId: string | null
	) => void;
	onReplyToMessage?: (item: SpaceTimelineItem) => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
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
	taskCreationSourceSignalId?: string | null;
	spaceReferencesById?: SpaceMessageReferencesById;
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
};

export const SpaceMessageRun = memo(function SpaceMessageRun(
	input: SpaceMessageRunInput
) {
	const messageAlign = resolveSpaceMessageDirectionalAlign(input.run.isSelf);
	const selfMessageContentLayoutClassName =
		resolveSpaceMessageContentLayoutClassName({ isSelf: input.run.isSelf });
	const detailsDialog = useSpaceProfileDetailsPopover({
		centerAgentProfileId: input.centerAgentProfileId,
		currentOwnerUserId: input.currentOwnerUserId,
		entry: input.profileDetailsEntry,
		entriesByProfileId: input.profileEntriesById,
		fallbackEntry: buildConversationSpeakerProfileDetailsEntry(input.run),
		modelCatalog: input.modelCatalog,
		orgSlug: input.orgSlug,
	});
	const computerSetupContext = resolveCenterAgentComputerSetupContext({
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		orgSlug: input.orgSlug,
		profileId: input.selfProfileId,
		spaceId: input.spaceId,
	});
	return (
		<>
			{input.run.items.map((item, index) => {
				if (item.recalledAt) {
					const thread = input.threadsByRootSignalId.get(item.id);
					return (
						<MessageScrollerItem key={item.id} messageId={item.id}>
							<div
								className="flex flex-col items-center gap-1 py-2"
								data-history-signal-id={getSpaceConversationHistorySignalId(
									item
								)}
								data-message-row-id={item.id}
								data-message-source-at={spaceMessageReadSourceAt(item)}
								data-signal-id={item.id}
								ref={(element) =>
									input.registerMessageElement(item.id, element)
								}
								tabIndex={-1}
							>
								<SpaceMessageBody item={item} />
								{thread ? (
									<Button
										onClick={() => input.onOpenThread?.(thread.threadId)}
										size="sm"
										variant="ghost"
									>
										View thread
									</Button>
								) : null}
							</div>
						</MessageScrollerItem>
					);
				}
				const anchoredOutcomeNotices =
					input.anchoredOutcomeNoticesBySourceSignalId.get(item.id) ??
					EMPTY_ANCHORED_OUTCOME_NOTICES;
				const wakePresentationItem = resolveActiveWakeSourceItem({
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
				const wakeStopTargets = item.activeWakeProgress
					? [
							resolveWakeStopTargetForProgressItem({
								item: item.activeWakeProgress,
								sourceItem: wakePresentationItem,
								viewerProfileId: input.selfProfileId,
								stopRequestStatusBySelectorKey:
									input.wakeStopRequestStatusBySelectorKey,
							}),
						]
					: resolveSpaceMessageWakeStopTargets({
							item: wakePresentationItem,
							viewerProfileId: input.selfProfileId,
							stopRequestStatusBySelectorKey:
								input.wakeStopRequestStatusBySelectorKey,
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
				const isActiveWakeSource = hasActiveWakeReplyForSource({
					item,
					timelineItems: input.timelineItems,
				});
				const bubblePresentationClass =
					resolveSpaceMessageBubblePresentationClass({
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
					hideForActiveWakeSource: isActiveWakeSource,
					wakeOutcomeIndex: input.wakeOutcomeIndex,
					wakeSourceItem: wakePresentationItem,
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
					<MessageScrollerItem
						className={
							item.activeWakeProgress
								? "[content-visibility:visible]"
								: undefined
						}
						key={resolveSpaceConversationItemKey(item)}
						messageId={item.id}
					>
						<Message
							align={messageAlign}
							className={resolveSpaceMessageRunLayoutClassName({
								isFirstInGroup: index === 0,
								isGroupedRow,
								isLastInGroup: isLastGroupedRow,
							})}
							data-space-self-message={String(input.run.isSelf)}
							data-thread-message={input.threadId}
						>
							<MessageContent
								className={cn(
									"w-full min-w-0 gap-0",
									SPACE_MESSAGE_SURFACE_WIDTH_CLASS
								)}
								directMessage={input.isDirectMessage}
							>
								{index === 0 ? (
									<MessageHeader className="px-0">
										<ConversationSpeakerHeader
											avatarModelId={
												input.membersSnapshot?.agents.find(
													(agent) =>
														agent.profileId === input.run.speaker.profileId
												)?.avatarModelId ??
												input.modelCatalog?.agentControllers["center-agent"]
													?.hostedRuntimePolicy
													?.personalRemoteAgentDefaultModelId
											}
											avatarOnly={input.isDirectMessage}
											avatarStyle={
												input.membersSnapshot?.agents.find(
													(agent) =>
														agent.profileId === input.run.speaker.profileId
												)?.avatarStyle
											}
											centerAgentProfileId={input.centerAgentProfileId}
											detailsDialog={detailsDialog}
											isCenterAgentDirectMessage={
												input.isCenterAgentDirectMessage
											}
											run={input.run}
											selfAvatarImageUrl={input.selfAvatarImageUrl}
											selfProfileId={input.selfProfileId}
										/>
										<SpaceMessageTime
											createdAtMs={item.createdAtMs}
											isDirectMessage={input.isDirectMessage}
											placement="header"
										/>
									</MessageHeader>
								) : null}
								<MessageReactionsProvider
									input={resolveMessageReactionInput(
										item,
										input.selfProfileId,
										!canUseMessageActions
									)}
								>
									<BubbleGroup className="w-full gap-0">
										<FluidContextMenuScope
											disabled={
												item.transientActivityPurpose !== null ||
												Boolean(item.activeWakeProgress)
											}
											target={
												<div
													className={cn(
														"group/message-row relative flex w-full min-w-0 max-w-full flex-col gap-0",
														SPACE_MESSAGE_ROW_HOVER_COLOR_CLASS
													)}
													data-message-row-id={item.id}
													data-message-source-at={spaceMessageReadSourceAt(
														item
													)}
												>
													<Bubble
														align={messageAlign}
														className={cn(
															messageBubbleVisibilityClassName,
															hasSpaceMessageAttachments(item) && "w-full"
														)}
													>
														<ConversationBubbleContent
															agentInteractionItems={agentInteractionItems}
															anchoredOutcomeNotices={anchoredOutcomeNotices}
															answerProgressStatus={answerProgressStatus}
															bubblePresentationClass={bubblePresentationClass}
															canUseMessageActions={canUseMessageActions}
															computerSetupContext={
																computerSetupPresentation.context
															}
															detailsDialog={detailsDialog}
															isHighlighted={isHighlighted}
															item={item}
															messageAlign={messageAlign}
															parent={input}
															selfMessageContentLayoutClassName={
																selfMessageContentLayoutClassName
															}
														/>
													</Bubble>
													{input.messageFootersBySignalId?.get(item.id) ?? null}
													{rowProgressStatus}
													{renderConversationMessageFooter({
														anchoredOutcomeNotices,
														canUseMessageActions,
														hasWakeProblem,
														isDirectMessage: input.isDirectMessage,
														isCreatingThread: input.isCreatingThread,
														item,
														messageAlign,
														messageDetailsItem,
														onCreateThread: input.onCreateThread,
														onOpenMessageDetails: input.onOpenMessageDetails,
														onOpenThread: input.onOpenThread,
														onAddMessageToTasks: input.onAddMessageToTasks,
														onReplyToMessage: input.onReplyToMessage,
														orgSlug: input.orgSlug,
														profileEntriesById: input.profileEntriesById,
														profilePresentationsById:
															input.profilePresentationsById,
														selfProfileId: input.selfProfileId,
														taskCreationSourceSignalId:
															input.taskCreationSourceSignalId,
														threadsByRootSignalId: input.threadsByRootSignalId,
														threadId: input.threadId,
													})}
												</div>
											}
										/>
									</BubbleGroup>
								</MessageReactionsProvider>
							</MessageContent>
						</Message>
					</MessageScrollerItem>
				);
			})}
		</>
	);
});

function buildConversationSpeakerProfileDetailsEntry(
	run: SpaceConversationBubbleRun
): ProfileDetailsSpaceMemberInput | null {
	if (run.speaker.profileKind === "system") {
		return null;
	}
	return {
		addedByDisplayName: null,
		addedByProfileId: null,
		agentControllerConversationId: null,
		agentControllerRef: run.speaker.agentControllerRef,
		availabilityPhase: null,
		availabilityReasonCode: null,
		availabilitySummary: null,
		availabilityTooltip: null,
		lastSeenLabel: null,
		mentionLabel: null,
		ownerDisplay: run.speaker.ownerDisplay,
		ownerUserId: null,
		profileId: run.speaker.profileId,
		profileKind: run.speaker.profileKind,
		profileName: run.speaker.profileName,
		runtimeDeviceDisplayName: run.speaker.runtimeDeviceDisplayName,
		workingDirectory: null,
	};
}

function ConversationBubbleContent(input: {
	agentInteractionItems: ReturnType<
		typeof resolveSpaceMessageAgentInteractionItems
	>;
	anchoredOutcomeNotices: readonly SpaceTimelineItem[];
	answerProgressStatus: ReactNode;
	bubblePresentationClass?: string;
	canUseMessageActions: boolean;
	computerSetupContext?: CenterAgentComputerSetupContext;
	detailsDialog: ReturnType<typeof useSpaceProfileDetailsPopover>;
	isHighlighted: boolean;
	item: SpaceTimelineItem;
	messageAlign: "start" | "end";
	parent: SpaceMessageRunInput;
	selfMessageContentLayoutClassName?: string;
}) {
	const parent = input.parent;
	return (
		<SpaceMessageSurface
			attachments={
				<SpaceMessageAttachments
					align={input.messageAlign}
					item={input.item}
					onOpenSpaceFile={parent.onOpenSpaceFile}
					openMeldProfileId={parent.selfProfileId}
					organizationSlug={parent.orgSlug}
					spaceId={input.item.spaceId}
				/>
			}
			bubbleClassName={cn(
				"transition-colors data-[highlighted=true]:border-unread/60 motion-reduce:transition-none",
				input.selfMessageContentLayoutClassName,
				input.bubblePresentationClass
			)}
			className="group/message relative"
			data-highlighted={input.isHighlighted ? "true" : undefined}
			data-history-signal-id={getSpaceConversationHistorySignalId(input.item)}
			data-signal-id={input.item.id}
			edited={Boolean(input.item.editedAt) && !input.item.recalledAt}
			ref={(element) => {
				parent.registerMessageElement(input.item.id, element);
			}}
			references={
				<SpaceMessageTaskReference
					signalId={input.item.recalledAt ? undefined : input.item.id}
				/>
			}
			tabIndex={-1}
		>
			{!parent.isDirectMessage && (
				<ReplyPreview
					align={input.messageAlign}
					item={input.item}
					loadedMainTimelineSignalIds={parent.loadedMainTimelineSignalIds}
					onJumpToMessage={parent.onJumpToMessage}
					profilePresentationsById={parent.profilePresentationsById}
					sourceItem={parent.timelineItems.find(
						(item) => item.id === input.item.replyToSignalId
					)}
					spaceReferencesById={parent.spaceReferencesById}
				/>
			)}
			<SpaceMessageContinuationNotice
				item={input.item}
				wakeProgressItems={parent.addressingWakeProgressItems}
			/>
			{input.item.actorProfileKind === "agent" ? (
				<SpaceMessageWork
					item={input.item}
					status={input.answerProgressStatus}
				/>
			) : null}
			<SpaceMessageBody
				computerSetupContext={input.computerSetupContext}
				computerSetupSourceSignalId={input.item.id}
				containerClassName={input.selfMessageContentLayoutClassName}
				includeAttachments={false}
				item={input.item}
				onOpenSpaceFile={parent.onOpenSpaceFile}
				openMeldProfileId={parent.selfProfileId}
				orgSlug={parent.orgSlug}
				profilePresentationsById={parent.profilePresentationsById}
				renderProfileTrigger={
					input.detailsDialog.profileDetailsPopoverTriggerById
				}
				spaceReferencesById={parent.spaceReferencesById}
			/>
			{input.item.actorProfileKind !== "agent"
				? input.answerProgressStatus
				: null}
			{parent.spaceId &&
			parent.centerAgentProfileId &&
			!input.item.recalledAt &&
			input.item.wakeTargetProfileIds.includes(parent.centerAgentProfileId) ? (
				<SpaceMessageDelegationSummary
					onOpenDetails={() => parent.onOpenMessageDetails(input.item)}
					openMeldProfileId={parent.selfProfileId}
					signalId={input.item.id}
					spaceId={parent.spaceId}
				/>
			) : null}
			<SpaceMessageInteractionSource
				source={input.item.centerAgentInteractionSource}
			/>
			{!parent.spaceId || parent.readOnly || input.item.recalledAt ? null : (
				<SpaceMessagePluginRequests
					sourceSignalId={input.item.id}
					spaceId={parent.spaceId}
					visibleSignalIds={parent.timelineItems
						.filter((item) => !item.recalledAt)
						.map((item) => item.id)
						.sort()}
				/>
			)}
			{input.agentInteractionItems.map((interactionItem) =>
				parent.actionableAgentInteractionPlacement === "pending-surface" &&
				interactionItem.pendingInteraction?.canRespond ? null : (
					<SpaceAgentInteractionCard
						item={interactionItem}
						key={resolveSpacePendingAgentActionIdentity(interactionItem)}
						onRespond={
							// Core offers an answer only to the Agent's owner, who may
							// be observing this Space without being a member.
							parent.readOnly && !interactionItem.pendingInteraction?.canRespond
								? undefined
								: parent.onAgentInteractionResponse
						}
					/>
				)
			)}
			<ReplyStalenessMarker align={input.messageAlign} item={input.item} />
			{renderAnchoredSpaceOutcomeRows({
				notices: input.anchoredOutcomeNotices,
				onOpenMessageDetails: parent.onOpenMessageDetails,
				onRecoverExecution: parent.onRecoverExecution,
				profileEntriesById: parent.profileEntriesById,
				readOnly: parent.readOnly,
				sourceItem: input.item,
				spaceReferencesById: parent.spaceReferencesById,
			})}
			<MessageBubbleReactions />
			<ThreadPreview
				membersSnapshot={parent.membersSnapshot}
				onOpenThread={parent.onOpenThread}
				onWakeStopRequest={parent.onWakeStopRequest}
				preview={
					parent.threadPreviewByThreadId.get(
						parent.threadsByRootSignalId.get(input.item.id)?.threadId ?? ""
					) ?? null
				}
				profileId={parent.selfProfileId}
				progressItems={
					parent.threadWakeProgressByRootSignalId.get(input.item.id) ?? []
				}
				readOnly={parent.readOnly}
				spaceReferencesById={parent.spaceReferencesById}
				stopRequestStatusBySelectorKey={
					parent.wakeStopRequestStatusBySelectorKey
				}
				streams={parent.threadStreamsByRootSignalId.get(input.item.id) ?? []}
				targetLabelsByProfileId={parent.wakeStopTargetLabelsByProfileId}
				thread={parent.threadsByRootSignalId.get(input.item.id) ?? null}
				threadHref={
					parent.readOnly && parent.spaceId
						? (signalId) =>
								`/spaces/${encodeURIComponent(parent.spaceId ?? "")}?${new URLSearchParams(
									{
										...(signalId ? { signalId } : {}),
										threadRootSignalId: input.item.id,
									}
								)}`
						: undefined
				}
				unreadCount={
					parent.unreadScopes
						? (parent.unreadScopes.find(
								(scope) => scope.threadRootSignalId === input.item.id
							)?.unreadCount ?? 0)
						: parent.unreadTargets.filter(
								(target) => target.threadRootSignalId === input.item.id
							).length
				}
			/>
		</SpaceMessageSurface>
	);
}

function ConversationSpeakerHeader(input: {
	avatarStyle?: import("@openmeld/schemas/types").SpaceMemberAgentSnapshot["avatarStyle"];
	avatarModelId?: string | null;
	avatarOnly: boolean;
	centerAgentProfileId: string | null;
	detailsDialog: ReturnType<typeof useSpaceProfileDetailsPopover>;
	isCenterAgentDirectMessage: boolean;
	run: SpaceConversationBubbleRun;
	selfAvatarImageUrl: string | null;
	selfProfileId: string;
}) {
	const centerAgentModelName = useCenterAgentCurrentModelName(
		input.run.speaker.profileId
	);
	const memberAgentDisplayName = useMemberAgentProfileDisplayName({
		agentControllerRef: input.run.speaker.agentControllerRef,
		ownerName: input.run.items[0]?.actorOwnerName ?? null,
		profileId: input.run.speaker.profileId,
		profileKind: input.run.speaker.profileKind,
		profileName: input.run.speaker.displayName,
	});
	// A MemberAgent name already carries the owner; it replaces the owner
	// attribution instead of repeating it.
	const agentAttribution = memberAgentDisplayName
		? null
		: formatSpaceAgentAttribution({
				centerAgentModelName,
				agentControllerRef: input.run.speaker.agentControllerRef,
				ownerName: input.run.items[0]?.actorOwnerName ?? null,
				profileKind: input.run.speaker.profileKind,
			});
	const isCenterAgentRun = resolveIsCenterAgentConversationRun({
		centerAgentProfileId: input.centerAgentProfileId,
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		run: input.run,
	});
	const content = (
		<>
			<SpaceMessageProfileAvatar
				agentControllerPending={input.run.speaker.agentControllerPending}
				agentControllerRef={input.run.speaker.agentControllerRef}
				avatarImageUrl={
					input.run.speaker.profileId === input.selfProfileId
						? input.selfAvatarImageUrl
						: input.run.speaker.avatarImageUrl
				}
				avatarModelId={input.avatarModelId}
				avatarStyle={input.avatarStyle}
				displayName={input.run.speaker.displayName}
				isCenterAgent={isCenterAgentRun}
				profileId={input.run.speaker.profileId}
				profileKind={input.run.speaker.profileKind}
				responsive
				working={input.run.items.some(isSpaceMessageAgentWorking)}
			/>
			{!input.avatarOnly && (
				<>
					<span className="min-w-0 break-words font-normal text-muted-foreground text-xs">
						{memberAgentDisplayName ?? input.run.speaker.displayName}
					</span>
					<RemoteAgentIndicator
						agentControllerRef={input.run.speaker.agentControllerRef}
					/>
					{agentAttribution ? (
						<>
							<span className="shrink-0 text-muted-foreground">·</span>
							<span className="min-w-0 text-muted-foreground">
								{agentAttribution}
							</span>
						</>
					) : null}
				</>
			)}
		</>
	);
	if (!input.detailsDialog.canOpenProfileDetails) {
		return (
			<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
				{content}
			</div>
		);
	}
	const trigger = (
		<button
			aria-label={`Check ${input.run.speaker.displayName} Profile`}
			className={cn(
				"inline-flex min-w-0 max-w-full cursor-pointer touch-manipulation flex-wrap items-start gap-x-1.5 gap-y-1 self-start rounded-md text-left font-normal text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 max-lg:min-w-6",
				input.avatarOnly && "max-lg:min-h-6"
			)}
			type="button"
		>
			{content}
		</button>
	);
	return input.detailsDialog.profileDetailsPopoverTrigger
		? input.detailsDialog.profileDetailsPopoverTrigger(trigger)
		: trigger;
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

function resolveSpaceMessageBubbleVisibilityClassName(input: {
	item: SpaceTimelineItem;
	showProgressInAnswerArea: boolean;
}): string | undefined {
	return input.item.systemNoticeType === "wake_stopped" ||
		input.item.agentStreamState?.status === "stopped" ||
		input.showProgressInAnswerArea ||
		input.item.text.trim().length > 0 ||
		input.item.agentStreamState?.thinking ||
		input.item.attachments.length > 0 ||
		(input.item.files?.length ?? 0) > 0
		? undefined
		: "hidden";
}

function resolveSpaceMessageWakeThinkingEntries(input: {
	item: SpaceTimelineItem;
	wakePresentationItem: SpaceTimelineItem;
	wakeProgressState: ReturnType<typeof resolveSpaceMessageWakeProgressState>;
	wakeStopTargets: ReturnType<typeof resolveSpaceMessageWakeStopTargets>;
}) {
	if (input.item.activeWakeProgress !== undefined) {
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
	hideForActiveWakeSource: boolean;
	wakeOutcomeIndex: SpaceWakeOutcomeIndex;
	wakeSourceItem: SpaceTimelineItem;
	item: SpaceTimelineItem;
	messageDetailsItem: SpaceTimelineItem | null;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
}): ReactNode {
	if (input.hideForActiveWakeSource) {
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
			wakeOutcomeIndex={input.wakeOutcomeIndex}
			wakeSourceItem={input.wakeSourceItem}
		/>
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
		input.run.speaker.agentControllerRef === "hosted:center-agent" ||
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

export function resolveCenterAgentComputerSetupContext(input: {
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
				input.onOpenThread?.(input.thread.threadId);
				return;
			}
			input.onCreateThread({ rootSignalId: input.item.id }).catch((error) => {
				console.error("Failed to open a thread from the message.", error);
			});
		},
	};
}

type SpaceMessageFooterInput = {
	anchoredOutcomeNotices: readonly SpaceTimelineItem[];
	canUseMessageActions: boolean;
	hasWakeProblem: boolean;
	isDirectMessage: boolean;
	isCreatingThread: boolean;
	item: SpaceTimelineItem;
	messageAlign: "end" | "start";
	messageDetailsItem: SpaceTimelineItem | null;
	onCreateThread?: (input: { rootSignalId: string }) => Promise<void>;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onOpenThread?: (threadId: string) => void;
	onAddMessageToTasks?: (
		item: SpaceTimelineItem,
		threadId: string | null
	) => void;
	onReplyToMessage?: (item: SpaceTimelineItem) => void;
	orgSlug?: string;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	selfProfileId: string;
	taskCreationSourceSignalId?: string | null;
	threadId?: string;
	threadsByRootSignalId: ReadonlyMap<string, SpaceThread>;
};

function renderConversationMessageFooter(input: SpaceMessageFooterInput) {
	if (
		input.item.transientActivityPurpose !== null ||
		input.item.activeWakeProgress
	) {
		return null;
	}
	const failureSummary = resolveSpaceMessageFooterFailureSummary({
		notices: input.anchoredOutcomeNotices,
		resolveTargetLabel: (targetProfileId) =>
			input.profileEntriesById.get(targetProfileId)?.profileName ?? null,
	});
	const canUseCollaborationActions =
		input.canUseMessageActions && input.item.signalType === "signal.text";
	const awaitingDelivery =
		input.item.deliveryState === "pending" &&
		input.item.signalType === "signal.text";
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
			deviceWaitOutcome={{
				notices: input.anchoredOutcomeNotices,
				sourceItem: input.item,
			}}
			failureSummary={failureSummary}
			isDirectMessage={input.isDirectMessage}
			item={input.item}
			onCopy={
				input.item.text.trim() && !isSpaceMessageCopyPending(input.item)
					? () =>
							copySpaceTimelineItemWithFeedback({
								item: input.item,
								openMeldProfileId: input.selfProfileId,
								organizationSlug: input.orgSlug,
							})
					: undefined
			}
			reply={
				input.onReplyToMessage &&
				(canUseCollaborationActions || awaitingDelivery)
					? {
							disabled: awaitingDelivery,
							label: awaitingDelivery ? "Reply after sending" : "Reply",
							onSelect: () => {
								if (canUseCollaborationActions) {
									input.onReplyToMessage?.(input.item);
								}
							},
						}
					: undefined
			}
			signalId={canUseCollaborationActions ? input.item.id : undefined}
			task={resolveSpaceMessageTaskAction(input, canUseCollaborationActions)}
			thread={
				canUseCollaborationActions &&
				input.onCreateThread &&
				input.onOpenThread &&
				!input.threadId
					? resolveConversationMessageFooterThreadAction({
							isCreatingThread: input.isCreatingThread,
							item: input.item,
							onCreateThread: input.onCreateThread,
							onOpenThread: input.onOpenThread,
							thread: input.threadsByRootSignalId.get(input.item.id) ?? null,
						})
					: undefined
			}
		/>
	);
}

export function resolveSpaceMessageTaskAction(
	input: SpaceMessageFooterInput,
	canUseCollaborationActions: boolean
) {
	if (!(canUseCollaborationActions && input.onAddMessageToTasks)) {
		return undefined;
	}
	const threadId =
		input.threadId ??
		input.threadsByRootSignalId.get(input.item.id)?.threadId ??
		null;
	return {
		disabled: Boolean(input.taskCreationSourceSignalId),
		label:
			input.taskCreationSourceSignalId === input.item.id
				? "Creating Task…"
				: "Create task",
		onSelect: () => input.onAddMessageToTasks?.(input.item, threadId),
	};
}

export function resolveReplyPreviewText(
	text: string,
	sourceItem: SpaceTimelineItem | undefined,
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>
) {
	const profiles = buildSpaceMessageProfileMentionProfiles({
		profilePresentationsById,
		mentionTargetProfileIds: sourceItem?.mentionTargetProfileIds ?? [],
		wakeTargetProfileIds: sourceItem?.wakeTargetProfileIds ?? [],
		referenceTargetProfileIds: sourceItem?.referenceTargetProfileIds ?? [],
	});
	return splitSpaceMessageProfileMentionText(text, profiles)
		.map((segment) =>
			segment.kind === "text"
				? segment.value
				: `@${segment.profile.profileName}`
		)
		.join("");
}

function ReplyPreview(input: {
	align: "start" | "end";
	item: SpaceTimelineItem;
	loadedMainTimelineSignalIds: ReadonlySet<string>;
	onJumpToMessage: (signalId: string) => void;
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	sourceItem?: SpaceTimelineItem;
	spaceReferencesById?: SpaceMessageReferencesById;
}) {
	if (!input.item.replyPreviewText) {
		return null;
	}
	const previewText = resolveReplyPreviewText(
		input.item.replyPreviewText,
		input.sourceItem,
		input.profilePresentationsById
	);

	const replyToSignalId = input.item.replyToSignalId;
	const canJump =
		replyToSignalId !== null &&
		input.loadedMainTimelineSignalIds.has(replyToSignalId);
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;
	const hasSpaceReference = hasResolvedSpaceMessageReference({
		referencesById: spaceReferencesById,
		text: previewText,
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
			<p className="w-full truncate text-muted-foreground/80 text-xs">
				<SpaceMessageReferenceText
					referencesById={spaceReferencesById}
					text={previewText}
				/>
			</p>
		</>
	);

	if (!(canJump && replyToSignalId)) {
		return (
			<div
				className={cn(
					"flex min-w-0 max-w-full flex-col gap-1 border-border text-sm",
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
					"flex min-w-0 max-w-full flex-col gap-1 border-border text-sm",
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
				<p className="w-full truncate text-muted-foreground/80 text-xs">
					<SpaceMessageReferenceText
						referencesById={spaceReferencesById}
						text={previewText}
					/>
				</p>
			</div>
		);
	}

	return (
		<button
			aria-label="Jump to original message"
			className={cn(
				"flex min-w-0 max-w-full flex-col gap-1 border-border text-sm hover:border-foreground/50 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

export function resolveReplyItemsForMessage(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): readonly SpaceTimelineItem[] {
	return input.timelineItems.filter(
		(candidate) => candidate.replyToSignalId === input.item.id
	);
}

export function isModifiedNavigationClick(event: {
	altKey: boolean;
	button: number;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
}) {
	return (
		event.button !== 0 ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey
	);
}

function ThreadPreview(input: {
	streams: readonly SpaceConversationVisibleStreamProjection[];
	targetLabelsByProfileId: ReadonlyMap<string, string>;
	profileId: string;
	membersSnapshot: SpaceMembersSnapshot | null;
	unreadCount: number;
	onOpenThread?: (threadId: string, signalId?: string) => void;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	preview: SpaceThreadPreview | null;
	progressItems: readonly SpaceEphemeralActivityItem[];
	readOnly: boolean;
	spaceReferencesById?: SpaceMessageReferencesById;
	stopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	threadHref?: (signalId?: string) => string;
	thread: SpaceThread | null;
}) {
	const queryClient = useQueryClient();
	const pointerStart = useRef<{ x: number; y: number } | null>(null);
	const thread = input.thread;
	if (!thread) {
		return null;
	}

	const previewItems = buildSpaceTimelineItems({
		envelopes: input.preview?.signals ?? [],
		membersSnapshot: input.membersSnapshot,
	}).slice(-2);
	const activeProgressItems = input.progressItems.filter(
		(progress) =>
			isActiveWakeProgressItem(progress) &&
			!previewItems.some(
				(item) =>
					item.wakeDispatchId === progress.dispatchId &&
					item.actorProfileId === progress.targetProfileId
			)
	);
	const progressStatuses = activeProgressItems.flatMap((progress) => {
		const status = resolveWakeProgressStatus(progress);
		return status
			? [
					{
						key:
							progress.dispatchId ??
							`${progress.sourceSignalId}:${progress.targetProfileId}`,
						status,
					},
				]
			: [];
	});
	// A live stream can arrive first. It shares the Working presentation, but
	// never grants Stop or replaces a matching Wake snapshot (including terminal).
	progressStatuses.push(
		...input.streams.flatMap((stream) => {
			if (
				input.progressItems.some(
					(progress) =>
						progress.targetProfileId === stream.profileId &&
						(progress.dispatchId
							? progress.dispatchId === stream.dispatchId
							: progress.sourceSignalId === stream.triggerMessageId)
				) ||
				previewItems.some(
					(item) =>
						item.wakeDispatchId === stream.dispatchId &&
						item.actorProfileId === stream.profileId
				)
			) {
				return [];
			}
			return [
				{
					key: stream.dispatchId,
					status: presentWorkingStatus(
						input.targetLabelsByProfileId.get(stream.profileId) ?? "Agent"
					),
				},
			];
		})
	);
	const wakeStopTargets = activeProgressItems.map((item) =>
		resolveWakeStopTargetForProgressItem({
			item,
			stopRequestStatusBySelectorKey: input.stopRequestStatusBySelectorKey,
		})
	);
	const replyCount = input.preview?.replyCount ?? 0;
	if (input.preview && replyCount === 0 && progressStatuses.length === 0) {
		return null;
	}
	const replyCountText = formatThreadReplyCount(replyCount);
	const unreadLabel = `${String(input.unreadCount)} unread`;
	const countLabel = input.unreadCount > 0 ? unreadLabel : replyCountText;
	const showCount = input.unreadCount > 0 || replyCount > 0;
	const ThreadTarget = input.threadHref ? "a" : "button";
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;
	const prefetch = () => {
		return queryClient.prefetchQuery(
			spaceThreadSignalsQueryOptions({
				spaceId: thread.spaceId,
				threadId: thread.threadId,
				openMeldProfileId: input.profileId,
				enabled: true,
			})
		);
	};

	return (
		<div className="flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden border-border border-t pt-2">
			{previewItems.map((item) => (
				// biome-ignore lint/a11y/useSemanticElements: A native button cannot contain the reply's independent message links.
				<div
					aria-label={`Open reply from ${item.actorName}: ${readThreadReplyPreviewLine(item.text)}`}
					className="flex w-full min-w-0 max-w-full cursor-pointer items-start gap-2 overflow-hidden pe-2 hover:underline focus-visible:outline focus-visible:outline-ring"
					key={item.id}
					onClick={(event) => {
						if (
							event.target instanceof Element &&
							event.target.closest(
								'a,button,input,textarea,select,pre,code,[contenteditable="true"]'
							)
						) {
							return;
						}
						if (window.getSelection()?.toString()) {
							return;
						}
						if (
							pointerStart.current &&
							Math.hypot(
								event.clientX - pointerStart.current.x,
								event.clientY - pointerStart.current.y
							) > 5
						) {
							return;
						}
						input.onOpenThread?.(thread.threadId, item.id);
					}}
					onFocus={prefetch}
					onKeyDown={(event) => {
						if (event.target !== event.currentTarget) {
							return;
						}
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							input.onOpenThread?.(thread.threadId, item.id);
						}
					}}
					onPointerDown={(event) => {
						pointerStart.current = { x: event.clientX, y: event.clientY };
					}}
					onPointerEnter={prefetch}
					role="button"
					tabIndex={0}
				>
					{!item.recalledAt && (
						<span className="max-w-[40%] shrink-0 truncate font-bold text-foreground/88 text-xs leading-5">
							{item.actorName}
						</span>
					)}
					<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs leading-5">
						<SpaceMessageReferenceText
							referencesById={spaceReferencesById}
							text={readThreadReplyPreviewLine(item.text)}
						/>
					</span>
					{input.threadHref ? (
						<a
							aria-label={`Open reply from ${item.actorName}`}
							className="shrink-0 text-muted-foreground/75 text-xs leading-5"
							href={input.threadHref(item.id)}
							onClick={(event) => {
								if (isModifiedNavigationClick(event)) {
									return;
								}
								event.preventDefault();
								input.onOpenThread?.(thread.threadId, item.id);
							}}
						>
							<time
								dateTime={new Date(item.createdAtMs).toISOString()}
								title={new Date(item.createdAtMs).toLocaleString("en-US")}
							>
								{formatDirectMessageTime(item.createdAtMs)}
							</time>
						</a>
					) : (
						<button
							aria-label={`Open reply from ${item.actorName}`}
							className="shrink-0 text-muted-foreground/75 text-xs leading-5 hover:underline focus-visible:outline focus-visible:outline-ring"
							onClick={() => input.onOpenThread?.(thread.threadId, item.id)}
							onFocus={prefetch}
							type="button"
						>
							<time
								dateTime={new Date(item.createdAtMs).toISOString()}
								title={new Date(item.createdAtMs).toLocaleString("en-US")}
							>
								{formatDirectMessageTime(item.createdAtMs)}
							</time>
						</button>
					)}
				</div>
			))}
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<ThreadTarget
					aria-label={showCount ? `Open thread (${countLabel})` : "Open thread"}
					className={cn(
						"inline-flex w-fit items-center gap-1.5 text-xs leading-5 hover:text-foreground hover:underline",
						input.unreadCount > 0
							? "font-medium text-unread"
							: "text-muted-foreground"
					)}
					href={input.threadHref?.()}
					onClick={(event) => {
						event.preventDefault();
						input.onOpenThread?.(thread.threadId);
					}}
					onFocus={prefetch}
					onPointerEnter={prefetch}
					title="Only threads you start or reply to count as unread. Read the thread to clear its unread replies and reactions."
					type={ThreadTarget === "button" ? "button" : undefined}
				>
					<ChatCircleIcon aria-hidden="true" className="size-3.5" />
					<span>Open thread</span>
					{showCount ? (
						<span
							className={
								input.unreadCount > 0 ? undefined : "text-muted-foreground/75"
							}
						>
							{countLabel}
						</span>
					) : null}
				</ThreadTarget>
				{progressStatuses.map(({ key, status }) => (
					<output
						aria-label={status.label}
						className="inline-flex min-w-0 items-center gap-1 text-muted-foreground text-xs leading-5"
						key={key}
					>
						<SpaceAgentOrb state={WAKE_STATUS_ORB_STATE[status.kind]} />
						<span>{status.label}</span>
					</output>
				))}
				{!input.readOnly &&
				input.onWakeStopRequest &&
				shouldRenderSpaceWakeStopControl(wakeStopTargets) ? (
					<SpaceWakeStopControl
						onStopWake={input.onWakeStopRequest}
						targets={wakeStopTargets}
					/>
				) : null}
			</div>
		</div>
	);
}

export function readMessageDetailsProgressEntries(
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

export function buildThreadSignalIds(
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

function renderAnchoredSpaceOutcomeRows(input: {
	notices: readonly SpaceTimelineItem[];
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	readOnly: boolean;
	sourceItem: SpaceTimelineItem;
	spaceReferencesById?: SpaceMessageReferencesById;
}) {
	if (input.notices.length === 0) {
		return null;
	}

	const outcomeNotices = visibleAnchoredOutcomeNotices(input);
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
				return (
					<div
						data-message-read-sources={JSON.stringify(
							group.notices.map((notice) => ({
								signalId: notice.id,
								occurredAtMs: notice.createdAtMs,
							}))
						)}
						key={group.key}
					>
						<SpaceOutcomeRow
							onOpenDetails={
								input.readOnly
									? null
									: () => input.onOpenMessageDetails(input.sourceItem)
							}
							onRecoverExecution={
								input.readOnly ? undefined : input.onRecoverExecution
							}
							recoveryRequest={recoveryRequest}
							spaceReferencesById={input.spaceReferencesById}
							text={resolveGroupedOutcomeRowText({
								notices: group.notices,
								readOnly: input.readOnly,
								resolveTargetLabel: (targetProfileId) =>
									input.profileEntriesById.get(targetProfileId)?.profileName ??
									null,
								tone: group.tone,
							})}
							tone={group.tone}
						/>
					</div>
				);
			})}
		</>
	);
}

const EMPTY_ANCHORED_OUTCOME_NOTICES: readonly SpaceTimelineItem[] = [];
