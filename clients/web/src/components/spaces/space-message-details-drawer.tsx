import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { resolvePublicAgentFailureRecovery } from "@openmeld/schemas";
import type {
	GetSpaceMessageDetailsResponse,
	SpaceMessageDetailsStringFact,
} from "@openmeld/schemas/types";
import { buildPublicSpaceEntryUrl } from "@openmeld/space";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import {
	Tooltip,
	TooltipContent,
	TooltipHint,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	resolveStatusToneBadgeClassName,
	type StatusTone,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowSquareOutIcon,
	CopyIcon,
	ShareNetworkIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { AgentProfileUsage } from "#/components/profiles/agent-profile-usage";
import { copyTextToClipboard } from "#/lib/clipboard";
import type { FolderContinueSource } from "#/lib/spaces/continue-in-default-folder";
import {
	isSpaceOutcomeNoticeItem,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import {
	isQuotaWakeFailure,
	resolveHistoricalWakeFailureBody,
	type WakeFailureTargetContext,
} from "#/lib/spaces/wake-failure-display";
import type {
	SpaceMessageWakeIssueEntry,
	SpaceMessageWakeThinkingEntry,
} from "#/lib/spaces/wake-progress-presentation";
import type { SpaceWakeStopTargetResolution } from "#/lib/spaces/wake-stop-target";
import { spaceMessageDetailsQueryOptions } from "#/query/spaces/message-details";
import { FolderContinueProvider } from "./continue-in-default-folder-action";
import { OpenMeldSystemIcon } from "./openmeld-system-icon";
import {
	type SpaceAgentProfileBindingRecoveryPlan,
	SpaceAgentRecoveryActionControl,
} from "./space-agent-recovery-action";
import {
	resolveAnchoredSpaceExecutionRecoveryState,
	SpaceExecutionRecoveryButton,
	type SpaceExecutionRecoveryHandler,
	type SpaceExecutionRecoveryRequest,
} from "./space-execution-recovery-actions";
import { SpaceMessageDelegations } from "./space-message-delegations";
import {
	buildSpaceMessageDetailsPresentation,
	type MessageDetailsActivityItem,
	type MessageDetailsDiagnosticReportStatus,
	type MessageDetailsStatus,
	type SpaceCollaborationProfilePresentation,
} from "./space-message-details-presentation";
import {
	EMPTY_SPACE_MESSAGE_REFERENCES,
	type SpaceMessageReferencesById,
	SpaceMessageReferenceText,
} from "./space-message-reference";
import { SpaceMessageTaskContext } from "./space-message-task-context";
import { SpaceProfileIcon } from "./space-profile-icon";
import { SpaceWakeFailureActionControl } from "./space-wake-failure-action";
import {
	SpaceWakeStopControl,
	type SpaceWakeStopRequestHandler,
	shouldRenderSpaceWakeStopControl,
} from "./space-wake-stop-control";

const MESSAGE_DETAILS_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "medium",
});
const MESSAGE_ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
});
const REDACTED_FACT_PLACEHOLDER = "Hidden";
const ACTIVITY_MESSAGE_PREVIEW_CHARACTER_LIMIT = 280;
const ACTIVITY_REPLY_PREVIEW_CHARACTER_LIMIT = 640;
const LINE_BREAK_PATTERN = /\r?\n/u;

type TechnicalDetailField = {
	label: string;
	value: string;
	dedupeByValue?: boolean;
};

type NoticeRecoveryPresentation = {
	action: SpaceMessageWakeIssueEntry["action"];
	body: string | null;
};

type MessageDetailsQueryState =
	| { status: "loading" }
	| { status: "error" }
	| {
			data: GetSpaceMessageDetailsResponse;
			status: "ready";
	  };

import { SpaceWorkHandoffAction } from "./space-work-handoff";

export function SpaceMessageDetailsDrawer(input: {
	threadId?: string;
	canStartNewTask?: boolean;
	agentRecoveryPlansByProfileId?: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	openMeldProfileId?: string;
	canJumpToMessage: (signalId: string) => boolean;
	diagnosticReportStatus: MessageDetailsDiagnosticReportStatus;
	errorLogMessage: string;
	isPersonalContext?: boolean;
	item: SpaceTimelineItem;
	isAgentRecoveryPending?: (profileId: string) => boolean;
	onJumpToMessage: (signalId: string) => void;
	onOpenChange: (open: boolean) => void;
	onViewInGraph?: (signalId: string) => void;
	onAgentRecoveryAction?: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	open: boolean;
	orgSlug?: string;
	prepareSetupHref?: string;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	replyItems?: readonly SpaceTimelineItem[];
	spaceId: string;
	spacePassword?: string;
	spaceReferencesById?: SpaceMessageReferencesById;
	threadRootSignalId?: string;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	wakeFailureTargetContextsByProfileId?: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	wakeIssueEntries?: readonly SpaceMessageWakeIssueEntry[];
	wakeProgressEntries?: readonly SpaceMessageWakeThinkingEntry[];
	wakeStopTarget?: SpaceWakeStopTargetResolution | null;
}) {
	const [origin] = useState<string | null>(() =>
		typeof window === "undefined" ? null : window.location.origin
	);
	const messageLink = buildPublicSpaceEntryUrl({
		origin,
		target: {
			signalId: input.item.id,
			spaceId: input.spaceId,
			...(input.threadRootSignalId
				? { threadRootSignalId: input.threadRootSignalId }
				: {}),
		},
	});
	const query = useQuery(
		spaceMessageDetailsQueryOptions({
			openMeldProfileId: input.openMeldProfileId,
			enabled: input.open,
			signalId: input.item.id,
			spaceId: input.spaceId,
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
		})
	);
	const recoverExecution = input.onRecoverExecution;
	let detailsState: MessageDetailsQueryState;
	if (query.isPending && !query.data) {
		detailsState = { status: "loading" };
	} else if (query.isError || !query.data) {
		detailsState = { status: "error" };
	} else {
		detailsState = { data: query.data, status: "ready" };
	}

	return (
		<Drawer.Root
			autoFocus
			direction="right"
			onOpenChange={input.onOpenChange}
			open={input.open}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-40 bg-background/55 backdrop-blur-[2px] motion-reduce:transition-none" />
				<Drawer.Content
					className="fixed top-0 right-0 bottom-0 z-50 flex border-border border-l bg-background shadow-2xl outline-none motion-reduce:transition-none"
					data-testid="message-details-drawer"
					style={
						{
							"--initial-transform": "calc(100% + 1px)",
							width: "min(42rem, 100vw)",
						} as CSSProperties
					}
				>
					<div className="flex min-h-0 w-full flex-col">
						<header className="flex shrink-0 items-center justify-between gap-4 border-border border-b px-5 py-4">
							<div className="min-w-0">
								<Drawer.Title className="font-medium text-base">
									Message details
								</Drawer.Title>
								<Drawer.Description className="sr-only">
									Activity, outcomes, and support details for this message.
								</Drawer.Description>
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								{input.onViewInGraph ? (
									<Button
										onClick={() => {
											input.onOpenChange(false);
											input.onViewInGraph?.(input.item.id);
										}}
										size="sm"
										type="button"
										variant="outline"
									>
										<ShareNetworkIcon aria-hidden="true" />
										View in Graph
									</Button>
								) : null}
								<Drawer.Close asChild>
									<Button
										aria-label="Close message details"
										className="-mr-1 shrink-0"
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<XIcon aria-hidden="true" />
									</Button>
								</Drawer.Close>
							</div>
						</header>
						<ScrollArea
							className="min-h-0 flex-1"
							contentClassName="select-text px-5 py-5"
							data-testid="message-details-scroll-area"
							data-vaul-no-drag
							orientation="vertical"
						>
							{input.canStartNewTask &&
							input.openMeldProfileId &&
							input.item.signalType === "signal.text" &&
							input.item.deliveryState === "sent" &&
							!input.item.recalledAt ? (
								<SpaceWorkHandoffAction
									key={`${input.spaceId}:${input.openMeldProfileId}:${input.item.id}:${input.threadId ?? "main"}`}
									profileId={input.openMeldProfileId}
									sourceSignalId={input.item.id}
									spaceId={input.spaceId}
									spacePassword={input.spacePassword}
									threadId={input.threadId}
								/>
							) : null}
							<MessageDetailsBody
								agentRecoveryPlansByProfileId={
									input.agentRecoveryPlansByProfileId
								}
								canJumpToMessage={input.canJumpToMessage}
								canStartNewTask={input.canStartNewTask === true}
								detailsState={detailsState}
								diagnosticReportStatus={input.diagnosticReportStatus}
								errorLogMessage={input.errorLogMessage}
								isAgentRecoveryPending={input.isAgentRecoveryPending}
								isPersonalContext={input.isPersonalContext}
								item={input.item}
								messageLink={messageLink}
								onAgentRecoveryAction={input.onAgentRecoveryAction}
								onJumpToMessage={(signalId) => {
									input.onOpenChange(false);
									input.onJumpToMessage(signalId);
								}}
								onRecoverExecution={
									recoverExecution
										? async (recoveryInput) => {
												const resolution =
													await recoverExecution(recoveryInput);
												if (recoveryInput.action && resolution) {
													input.onOpenChange(false);
												}
												return resolution;
											}
										: undefined
								}
								onReportMessage={input.onReportMessage}
								onWakeStopRequest={input.onWakeStopRequest}
								orgSlug={input.orgSlug}
								prepareSetupHref={input.prepareSetupHref}
								profileId={input.openMeldProfileId}
								profilePresentationsById={input.profilePresentationsById}
								replyItems={input.replyItems ?? []}
								spaceId={input.spaceId}
								spacePassword={input.spacePassword}
								spaceReferencesById={input.spaceReferencesById}
								targetProfileDisplayNamesByProfileId={
									input.targetProfileDisplayNamesByProfileId
								}
								threadId={input.threadId}
								wakeFailureTargetContextsByProfileId={
									input.wakeFailureTargetContextsByProfileId
								}
								wakeIssueEntries={input.wakeIssueEntries ?? []}
								wakeProgressEntries={input.wakeProgressEntries ?? []}
								wakeStopTarget={input.wakeStopTarget ?? null}
							/>
						</ScrollArea>
					</div>
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

function MessageDetailsBody(input: {
	canStartNewTask: boolean;
	profileId?: string;
	spaceId: string;
	spacePassword?: string;
	/** The thread the drawer opened in; a continuation stays there. */
	threadId?: string;
	agentRecoveryPlansByProfileId?: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	canJumpToMessage: (signalId: string) => boolean;
	detailsState: MessageDetailsQueryState;
	diagnosticReportStatus: MessageDetailsDiagnosticReportStatus;
	errorLogMessage: string;
	isPersonalContext?: boolean;
	item: SpaceTimelineItem;
	messageLink: string;
	isAgentRecoveryPending?: (profileId: string) => boolean;
	onJumpToMessage: (signalId: string) => void;
	onAgentRecoveryAction?: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	orgSlug?: string;
	prepareSetupHref?: string;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	replyItems: readonly SpaceTimelineItem[];
	spaceReferencesById?: SpaceMessageReferencesById;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	wakeFailureTargetContextsByProfileId?: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	wakeIssueEntries: readonly SpaceMessageWakeIssueEntry[];
	wakeProgressEntries: readonly SpaceMessageWakeThinkingEntry[];
	wakeStopTarget: SpaceWakeStopTargetResolution | null;
}) {
	const technicalDetailsId = useId();

	if (input.detailsState.status === "loading") {
		return (
			<div className="flex flex-col gap-5">
				<MessageLinkSection messageLink={input.messageLink} />
				<SkeletonRows label="Loading message details" />
			</div>
		);
	}

	if (input.detailsState.status === "error") {
		return (
			<div className="flex flex-col gap-5">
				<MessageLinkSection messageLink={input.messageLink} />
				<p className="text-destructive text-sm">
					Couldn't load the rest of the message details.
				</p>
			</div>
		);
	}

	const data = input.detailsState.data;
	const presentation = buildSpaceMessageDetailsPresentation({
		data,
		item: input.item,
		profilePresentationsById: input.profilePresentationsById,
		replyItems: input.replyItems,
		targetProfileDisplayNamesByProfileId:
			input.targetProfileDisplayNamesByProfileId,
		wakeIssueEntries: input.wakeIssueEntries,
		wakeProgressEntries: input.wakeProgressEntries,
		wakeStopTarget: input.wakeStopTarget,
	});
	const actionNotices = [
		...presentation.wakeFailureNoticeItems,
		...presentation.recoveryNoticeItems,
	];
	const spaceReferencesById =
		input.spaceReferencesById ?? EMPTY_SPACE_MESSAGE_REFERENCES;
	let primaryOutcomeNotice: SpaceTimelineItem | null = null;
	if (isSpaceOutcomeNoticeItem(input.item)) {
		primaryOutcomeNotice = input.item;
	} else if (presentation.wakeFailureNoticeItems.length === 1) {
		primaryOutcomeNotice = presentation.wakeFailureNoticeItems[0] ?? null;
	}
	const technicalDetailFields = buildTechnicalDetailFields({
		data,
		item: primaryOutcomeNotice ?? input.item,
	});
	return (
		<FolderContinueProvider
			value={{
				profileId: input.profileId,
				source: buildFolderContinueSource({
					item: input.item,
					replyContext: data.replyContext,
					threadId: input.threadId ?? null,
				}),
				spaceId: input.spaceId,
				spacePassword: input.spacePassword,
			}}
		>
			<div className="flex flex-col gap-5">
				<OriginalErrorsSection wakeContext={data.wakeContext} />
				{data.delegations ? (
					<SpaceMessageDelegations
						canJumpToMessage={input.canJumpToMessage}
						data={data.delegations}
						onJumpToMessage={input.onJumpToMessage}
						onWakeStopRequest={input.onWakeStopRequest}
						openMeldProfileId={input.profileId}
						profileNames={input.targetProfileDisplayNamesByProfileId}
						signalId={input.item.id}
						spaceId={input.spaceId}
						spacePassword={input.spacePassword}
					/>
				) : null}
				{data.wakeContext.targets.some((target) => target.taskContext) ? (
					<SpaceMessageTaskContext
						canStartNewTask={input.canStartNewTask}
						data={data}
						profileId={input.profileId}
						spaceId={input.spaceId}
						spacePassword={input.spacePassword}
					/>
				) : null}
				<ActivitySection
					actionNotices={actionNotices}
					agentRecoveryPlansByProfileId={input.agentRecoveryPlansByProfileId}
					canJumpToMessage={input.canJumpToMessage}
					entries={input.wakeIssueEntries}
					isAgentRecoveryPending={input.isAgentRecoveryPending}
					isPersonalContext={input.isPersonalContext}
					items={presentation.activityItems}
					notices={presentation.wakeFailureNoticeItems}
					onAgentRecoveryAction={input.onAgentRecoveryAction}
					onJumpToMessage={input.onJumpToMessage}
					onRecoverExecution={input.onRecoverExecution}
					onWakeStopRequest={input.onWakeStopRequest}
					orgSlug={input.orgSlug}
					prepareSetupHref={input.prepareSetupHref}
					replyContext={data.replyContext}
					sourceItem={input.item}
					spaceReferencesById={spaceReferencesById}
					targetProfileDisplayNamesByProfileId={
						input.targetProfileDisplayNamesByProfileId
					}
					wakeFailureTargetContextsByProfileId={
						input.wakeFailureTargetContextsByProfileId
					}
					wakeStopTarget={input.wakeStopTarget}
				/>
				<MessageLinkSection messageLink={input.messageLink} />
				<SourceNotLoadedSection
					canJumpToMessage={input.canJumpToMessage}
					item={input.item}
				/>
				<TechnicalDetailsSection
					detailsId={technicalDetailsId}
					fields={technicalDetailFields}
				/>
				<DiagnosticReportSection
					errorLogMessage={input.errorLogMessage}
					isPending={input.diagnosticReportStatus === "pending"}
					isSent={input.diagnosticReportStatus === "sent"}
					item={input.item}
					onReportMessage={input.onReportMessage}
				/>
			</div>
		</FolderContinueProvider>
	);
}

function MessageLinkSection(input: { messageLink: string }) {
	return (
		<DetailsSection title="Message link">
			<p className="text-muted-foreground text-sm leading-6">
				Anyone with access to this Space can open this message.
			</p>
			<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 bg-muted/45 p-3">
				<span className="min-w-0 select-text break-all font-mono text-xs leading-5 [overflow-wrap:anywhere]">
					{input.messageLink}
				</span>
				<Button
					onClick={() => copyDetailText(input.messageLink, "Link copied.")}
					size="sm"
					type="button"
					variant="outline"
				>
					<CopyIcon aria-hidden="true" />
					Copy link
				</Button>
			</div>
		</DetailsSection>
	);
}

type ActivitySectionProps = {
	actionNotices: readonly SpaceTimelineItem[];
	agentRecoveryPlansByProfileId?: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	canJumpToMessage: (signalId: string) => boolean;
	entries: readonly SpaceMessageWakeIssueEntry[];
	isAgentRecoveryPending?: (profileId: string) => boolean;
	isPersonalContext?: boolean;
	items: readonly MessageDetailsActivityItem[];
	notices: readonly SpaceTimelineItem[];
	onAgentRecoveryAction?: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onJumpToMessage: (signalId: string) => void;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
	orgSlug?: string;
	prepareSetupHref?: string;
	replyContext: GetSpaceMessageDetailsResponse["replyContext"];
	sourceItem: SpaceTimelineItem;
	spaceReferencesById: SpaceMessageReferencesById;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	wakeFailureTargetContextsByProfileId?: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
	wakeStopTarget: SpaceWakeStopTargetResolution | null;
};

function ActivitySection(input: ActivitySectionProps) {
	return (
		<DetailsSection title="Activity">
			<ol aria-label="Message activity" className="flex flex-col gap-5">
				{input.items.map((item, index) => (
					<ActivityItemRow
						activity={input}
						isFirst={index === 0}
						isLast={index === input.items.length - 1}
						item={item}
						key={item.id}
					/>
				))}
			</ol>
		</DetailsSection>
	);
}

function ActivityItemRow(input: {
	activity: ActivitySectionProps;
	isFirst: boolean;
	isLast: boolean;
	item: MessageDetailsActivityItem;
}) {
	const { activity, item } = input;
	const statusPresentation = resolveActivityStatusPresentation(item);
	const issueEntry = item.targetProfileId
		? activity.entries.find(
				(entry) => entry.targetProfileId === item.targetProfileId
			)
		: undefined;
	const outcomeNotice = resolveActivityOutcomeNotice({
		item,
		notices: activity.notices,
	});
	const noticeRecovery = outcomeNotice
		? resolveNoticeRecoveryPresentation({
				agentRecoveryPlansByProfileId: activity.agentRecoveryPlansByProfileId,
				isPersonalContext: activity.isPersonalContext,
				notice: outcomeNotice,
				targetLabel: item.kind === "target" ? item.title : undefined,
				targetProfileDisplayNamesByProfileId:
					activity.targetProfileDisplayNamesByProfileId,
				wakeFailureTargetContextsByProfileId:
					activity.wakeFailureTargetContextsByProfileId,
			})
		: null;
	const executionRecoveryState = outcomeNotice
		? resolveAnchoredSpaceExecutionRecoveryState({
				notices: activity.actionNotices,
				outcomeNotice,
			})
		: null;
	const recoveryRequest =
		executionRecoveryState?.status === "inspect"
			? executionRecoveryState.request
			: null;
	const wakeFailureAction = resolveActivityWakeFailureAction({
		executionRecoveryState,
		issueEntry,
		noticeRecovery,
		outcomeNotice,
	});
	const canJump =
		item.jumpSignalId !== null && activity.canJumpToMessage(item.jumpSignalId);
	const canStopThisTarget =
		item.targetProfileId !== null &&
		activity.wakeStopTarget?.targetProfileId === item.targetProfileId &&
		activity.wakeStopTarget.status !== "stopped" &&
		activity.onWakeStopRequest &&
		shouldRenderSpaceWakeStopControl(activity.wakeStopTarget, "details");
	return (
		<li
			className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3"
			data-activity-kind={item.kind}
		>
			<div className="relative flex justify-center">
				<ActivityActorIcon item={item} />
				{input.isLast ? null : (
					<span
						aria-hidden="true"
						className="absolute top-7 -bottom-5 w-px bg-border/70"
					/>
				)}
			</div>
			<section aria-label={`${item.title} activity`} className="min-w-0">
				<div className="flex min-w-0 items-center justify-between gap-3">
					<div className="flex min-w-0 items-baseline gap-2">
						<p className="min-w-0 truncate font-medium text-sm">{item.title}</p>
						<ActivityTime occurredAtMs={item.occurredAtMs} />
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						{statusPresentation ? (
							<Badge
								className={resolveStatusToneBadgeClassName(
									statusPresentation.tone
								)}
								variant="outline"
							>
								{statusPresentation.label}
							</Badge>
						) : null}
						{canJump && item.jumpSignalId ? (
							<ActivityJumpButton
								onJump={() => activity.onJumpToMessage(item.jumpSignalId ?? "")}
							/>
						) : null}
					</div>
				</div>
				{(noticeRecovery?.body ?? item.description) ? (
					<ExpandableActivityDescription
						description={noticeRecovery?.body ?? item.description ?? ""}
						isFailure={item.status === "failed"}
						item={item}
						preserveFullDescription={noticeRecovery !== null}
						referencesById={activity.spaceReferencesById}
					/>
				) : null}
				{input.isFirst ? (
					<ActivityReplyContext
						canJumpToMessage={activity.canJumpToMessage}
						onJumpToMessage={activity.onJumpToMessage}
						replyContext={activity.replyContext}
						spaceReferencesById={activity.spaceReferencesById}
					/>
				) : null}
				<WakeQuotaReset
					profileId={item.targetProfileId}
					reasonCode={outcomeNotice?.systemNoticeReasonCode}
				/>
				<WakeFailureActions
					action={wakeFailureAction}
					isAgentRecoveryPending={activity.isAgentRecoveryPending}
					onAgentRecoveryAction={activity.onAgentRecoveryAction}
					onRecoverExecution={activity.onRecoverExecution}
					orgSlug={activity.orgSlug}
					prepareSetupHref={activity.prepareSetupHref}
					recoveryRequest={recoveryRequest}
					targetProfileId={item.targetProfileId ?? undefined}
				/>
				{canStopThisTarget && activity.onWakeStopRequest ? (
					<div className="mt-3">
						<SpaceWakeStopControl
							onStopWake={activity.onWakeStopRequest}
							target={activity.wakeStopTarget}
							variant="details"
						/>
					</div>
				) : null}
			</section>
		</li>
	);
}

function resolveActivityWakeFailureAction(input: {
	executionRecoveryState: ReturnType<
		typeof resolveAnchoredSpaceExecutionRecoveryState
	> | null;
	issueEntry: SpaceMessageWakeIssueEntry | undefined;
	noticeRecovery: NoticeRecoveryPresentation | null;
	outcomeNotice: SpaceTimelineItem | null;
}): SpaceMessageWakeIssueEntry["action"] {
	if (!input.outcomeNotice) {
		return input.issueEntry?.action ?? null;
	}
	if (
		input.executionRecoveryState?.status === "closed" ||
		input.executionRecoveryState?.status === "invalid"
	) {
		return null;
	}
	return input.noticeRecovery?.action ?? null;
}

function ExpandableActivityDescription(input: {
	description: string;
	isFailure: boolean;
	item: MessageDetailsActivityItem;
	preserveFullDescription: boolean;
	referencesById: SpaceMessageReferencesById;
}) {
	const [isExpanded, setIsExpanded] = useState(false);
	const preview = resolveActivityDescriptionPreview(input);
	const isCollapsed = preview !== null && !isExpanded;

	return (
		<div className="mt-1.5">
			{input.preserveFullDescription ? (
				<p className="mb-1 text-muted-foreground text-xs">Recorded outcome</p>
			) : null}
			<p
				className={cn(
					"whitespace-pre-wrap break-words text-sm leading-6",
					input.isFailure ? "text-destructive" : "text-foreground/85",
					isCollapsed ? preview.className : null
				)}
			>
				<SpaceMessageReferenceText
					referencesById={input.referencesById}
					text={input.description}
				/>
			</p>
			{preview ? (
				<Button
					aria-expanded={isExpanded}
					className="mt-1 h-auto px-0 py-1 text-muted-foreground"
					onClick={() => setIsExpanded((expanded) => !expanded)}
					size="sm"
					type="button"
					variant="link"
				>
					{isExpanded
						? `Collapse ${preview.label}`
						: `Show full ${preview.label}`}
				</Button>
			) : null}
		</div>
	);
}

function resolveActivityDescriptionPreview(input: {
	description: string;
	item: MessageDetailsActivityItem;
	preserveFullDescription: boolean;
}): { className: string; label: "message" | "reply" } | null {
	if (input.preserveFullDescription) {
		return null;
	}

	if (input.item.kind === "message") {
		return shouldCollapseActivityDescription(
			input.description,
			ACTIVITY_MESSAGE_PREVIEW_CHARACTER_LIMIT,
			3
		)
			? { className: "line-clamp-3", label: "message" }
			: null;
	}
	if (input.item.kind === "reply" || input.item.status === "replied") {
		return shouldCollapseActivityDescription(
			input.description,
			ACTIVITY_REPLY_PREVIEW_CHARACTER_LIMIT,
			6
		)
			? { className: "line-clamp-6", label: "reply" }
			: null;
	}
	return null;
}

function shouldCollapseActivityDescription(
	description: string,
	characterLimit: number,
	lineLimit: number
): boolean {
	return (
		description.length > characterLimit ||
		description.split(LINE_BREAK_PATTERN).length > lineLimit
	);
}

function ActivityTime(input: { occurredAtMs: number | null }) {
	if (input.occurredAtMs === null) {
		return null;
	}
	return (
		<TooltipHint
			content={MESSAGE_DETAILS_TIME_FORMATTER.format(input.occurredAtMs)}
		>
			<time
				className="shrink-0 text-muted-foreground text-xs"
				dateTime={new Date(input.occurredAtMs).toISOString()}
			>
				{MESSAGE_ACTIVITY_TIME_FORMATTER.format(input.occurredAtMs)}
			</time>
		</TooltipHint>
	);
}

function ActivityActorIcon(input: { item: MessageDetailsActivityItem }) {
	if (input.item.actor.profileKind === "system") {
		return (
			<span className="relative z-10 flex size-6 items-center justify-center rounded-md bg-background text-foreground ring-1 ring-border">
				<OpenMeldSystemIcon />
			</span>
		);
	}
	return (
		<SpaceProfileIcon
			agentControllerRef={input.item.actor.agentControllerRef}
			avatarImageUrl={input.item.actor.avatarImageUrl}
			className="relative z-10 bg-background"
			isCenterAgent={input.item.actor.isCenterAgent}
			profileId={input.item.actor.profileId}
			profileKind={input.item.actor.profileKind}
			profileName={input.item.actor.profileName}
			size="sm"
		/>
	);
}

function ActivityJumpButton(input: { onJump: () => void }) {
	const label = "Go to message";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label={label}
						className="size-7"
						onClick={input.onJump}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<ArrowSquareOutIcon aria-hidden="true" />
					</Button>
				}
			/>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

function ActivityReplyContext(input: {
	canJumpToMessage: (signalId: string) => boolean;
	onJumpToMessage: (signalId: string) => void;
	replyContext: GetSpaceMessageDetailsResponse["replyContext"];
	spaceReferencesById: SpaceMessageReferencesById;
}) {
	if (input.replyContext.state === "not_applicable") {
		return null;
	}
	const replyToSignalId = input.replyContext.replyingToSignalId.value;
	return (
		<div className="mt-3 rounded-lg bg-muted/55 px-3 py-2.5 text-sm">
			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground">
					In reply to{" "}
					<span className="text-foreground">
						{formatFactValue(input.replyContext.replyingToAuthor)}
					</span>
				</p>
				{replyToSignalId && input.canJumpToMessage(replyToSignalId) ? (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="Go to message"
									className="size-7"
									onClick={() => input.onJumpToMessage(replyToSignalId)}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<ArrowSquareOutIcon aria-hidden="true" />
								</Button>
							}
						/>
						<TooltipContent side="bottom">Go to message</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{input.replyContext.previewText.state === "recorded" ? (
				<p className="mt-1 line-clamp-2 text-foreground/75">
					<SpaceMessageReferenceText
						referencesById={input.spaceReferencesById}
						text={input.replyContext.previewText.value ?? ""}
					/>
				</p>
			) : null}
		</div>
	);
}

function resolveActivityOutcomeNotice(input: {
	item: MessageDetailsActivityItem;
	notices: readonly SpaceTimelineItem[];
}): SpaceTimelineItem | null {
	const bySignal = input.item.jumpSignalId
		? input.notices.find((notice) => notice.id === input.item.jumpSignalId)
		: undefined;
	if (bySignal) {
		return bySignal;
	}
	if (
		!input.item.targetProfileId ||
		(input.item.status !== "failed" && input.item.status !== "stopped")
	) {
		return null;
	}
	return (
		input.notices.find(
			(notice) =>
				notice.systemNoticeTargetProfileId === input.item.targetProfileId
		) ?? null
	);
}

function resolveActivityStatusPresentation(
	item: MessageDetailsActivityItem
): { label: string; tone: StatusTone } | null {
	const status = item.status;
	if (!status) {
		return null;
	}
	if (status === "completed") {
		return {
			label: item.kind === "recovery" ? "Recovered" : "Done",
			tone: "ready",
		};
	}
	if (status === "started") {
		return {
			label: "Working",
			tone: "checking",
		};
	}
	const wakeStatus = resolveWakeStatusPresentation(status);
	return {
		label: wakeStatus.label,
		tone: wakeStatus.tone,
	};
}

// Status always owns the label. Its tone is only the fallback for a pure status
// with no outcome notice; when a notice exists, its semantic cause owns tone.
function resolveWakeStatusPresentation(
	status: NonNullable<MessageDetailsStatus>
): { label: string; tone: StatusTone } {
	switch (status) {
		case "replied":
			return { label: "Replied", tone: "ready" };
		case "failed":
			return { label: "Failed", tone: "danger" };
		case "stopped":
			return { label: "Stopped", tone: "muted" };
		case "running":
			return { label: "Working", tone: "checking" };
		case "pending":
			return { label: "Waiting", tone: "muted" };
		case "missing":
			return { label: "Unknown target", tone: "warning" };
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}

function resolveNoticeRecoveryPresentation(input: {
	agentRecoveryPlansByProfileId?: ReadonlyMap<
		string,
		AgentProfileReplyRecoveryPlan
	>;
	isPersonalContext?: boolean;
	notice: SpaceTimelineItem;
	targetLabel?: string;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	wakeFailureTargetContextsByProfileId?: ReadonlyMap<
		string,
		WakeFailureTargetContext
	>;
}): NoticeRecoveryPresentation | null {
	const targetProfileId = input.notice.systemNoticeTargetProfileId;
	const currentPlan =
		input.notice.systemNoticeType === "terminal_failure" && targetProfileId
			? (input.agentRecoveryPlansByProfileId?.get(targetProfileId) ?? null)
			: null;
	const reasonCode = input.notice.systemNoticeReasonCode?.trim();
	const targetLabel = targetProfileId
		? (input.targetProfileDisplayNamesByProfileId?.get(targetProfileId) ??
			input.targetLabel ??
			"This agent")
		: (input.targetLabel ?? "This agent");
	// The published notice owns the historical explanation. Current recovery
	// eligibility may supply an action, but must not replace the recorded cause.
	const body =
		input.notice.text.trim() ||
		resolveHistoricalWakeFailureBody({
			failureReasonCode: reasonCode,
			targetLabel,
		});
	const currentAction =
		currentPlan && currentPlan.kind !== "none"
			? ({ kind: "agent_recovery", plan: currentPlan } as const)
			: resolveSessionFolderAction({ reasonCode, targetLabel });
	return { action: currentAction, body };
}

/**
 * A Session keeps its folder (smoke R5-01). When its folder is no longer the
 * Agent's, the failure offers to continue the chat in a new Session in the
 * current default folder. The action itself renders only for the owner.
 */
function resolveSessionFolderAction(input: {
	reasonCode: string | undefined;
	targetLabel: string;
}): SpaceMessageWakeIssueEntry["action"] {
	const recovery = resolvePublicAgentFailureRecovery({
		errorCode: input.reasonCode,
		targetLabel: input.targetLabel,
	});
	return recovery?.recoveryTarget === "session_folder"
		? {
				display: {
					actionTarget: recovery.recoveryTarget,
					body: recovery.body,
					primaryActionId: recovery.primaryActionId,
					primaryActionLabel: recovery.primaryActionLabel,
				},
				kind: "wake_failure",
			}
		: null;
}

function WakeQuotaReset(input: {
	profileId: string | null;
	reasonCode: string | null | undefined;
}) {
	if (!(input.profileId && isQuotaWakeFailure(input.reasonCode))) {
		return null;
	}
	return (
		<div className="my-2 text-muted-foreground text-xs">
			Current provider report:{" "}
			<AgentProfileUsage profileId={input.profileId} variant="reset" />
		</div>
	);
}

function WakeFailureActions(input: {
	action: SpaceMessageWakeIssueEntry["action"];
	isAgentRecoveryPending?: (profileId: string) => boolean;
	onAgentRecoveryAction?: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onRecoverExecution?: SpaceExecutionRecoveryHandler;
	orgSlug?: string;
	prepareSetupHref?: string;
	recoveryRequest: SpaceExecutionRecoveryRequest | null;
	targetProfileId?: string;
}) {
	if (!((input.recoveryRequest && input.onRecoverExecution) || input.action)) {
		return null;
	}

	let confirmedCurrentAction: ReactNode = null;
	if (input.action) {
		confirmedCurrentAction = (
			<WakeIssueAction
				action={input.action}
				isAgentRecoveryPending={input.isAgentRecoveryPending}
				onAgentRecoveryAction={input.onAgentRecoveryAction}
				orgSlug={input.orgSlug}
				prepareSetupHref={input.prepareSetupHref}
				targetProfileId={input.targetProfileId}
			/>
		);
	}

	let primaryAction = confirmedCurrentAction;
	if (input.recoveryRequest) {
		if (!input.onRecoverExecution) {
			return null;
		}
		primaryAction = (
			<SpaceExecutionRecoveryButton
				onRecoverExecution={input.onRecoverExecution}
				request={input.recoveryRequest}
				unavailableFallback={confirmedCurrentAction}
			/>
		);
	}
	if (primaryAction === null) {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center gap-2">{primaryAction}</div>
	);
}

function WakeIssueAction(input: {
	action: SpaceMessageWakeIssueEntry["action"];
	isAgentRecoveryPending?: (profileId: string) => boolean;
	onAgentRecoveryAction?: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	orgSlug?: string;
	prepareSetupHref?: string;
	targetProfileId?: string;
}) {
	if (!input.action) {
		return null;
	}

	if (!input.orgSlug) {
		return null;
	}

	if (input.action.kind === "wake_failure") {
		return (
			<SpaceWakeFailureActionControl
				display={input.action.display}
				orgSlug={input.orgSlug}
				prepareSetupHref={input.prepareSetupHref}
				targetProfileId={input.targetProfileId}
			/>
		);
	}

	return (
		<SpaceAgentRecoveryActionControl
			allowComputerAction
			isPending={
				input.isAgentRecoveryPending?.(input.action.plan.profileId) ?? false
			}
			onAction={input.onAgentRecoveryAction}
			orgSlug={input.orgSlug}
			plan={input.action.plan}
			prepareSetupHref={input.prepareSetupHref}
		/>
	);
}

// The only remaining piece of the old "Wake outcome" section with real user
// value: when this dialog opened an unanchored notice whose source message
// isn't loaded in this view, say so instead of silently omitting it.
function SourceNotLoadedSection(input: {
	canJumpToMessage: (signalId: string) => boolean;
	item: SpaceTimelineItem;
}) {
	if (!isSpaceOutcomeNoticeItem(input.item)) {
		return null;
	}
	const replyToSignalId = input.item.replyToSignalId;
	if (replyToSignalId === null || input.canJumpToMessage(replyToSignalId)) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-xs">
			Original message is not loaded in this view.
		</p>
	);
}

// Every raw ID this panel knows about, gathered from Message/AgentContext/
// WakeContext/Diagnostics into one list. Known trace-selector aliases can
// dedupe by value, while role-qualified Agent identity facts remain separate.
function buildTechnicalDetailFields(input: {
	data: GetSpaceMessageDetailsResponse;
	item: SpaceTimelineItem;
}): TechnicalDetailField[] {
	const hasWakeTargets =
		input.data.wakeContext.state === "recorded" &&
		input.data.wakeContext.targets.length > 0;
	const authorLabelPrefix = hasWakeTargets ? "Message author" : "";
	const outcomeFacts = isSpaceOutcomeNoticeItem(input.item)
		? {
				dispatchId: input.item.systemNoticeDispatchId ?? null,
				failureStage: input.item.systemNoticeFailureStage ?? null,
				reasonCode: input.item.systemNoticeReasonCode ?? null,
				resultRef: input.item.systemNoticeResultRef ?? null,
				stopCause: input.item.systemNoticeStopCause ?? null,
			}
		: null;

	const candidates: (TechnicalDetailField | null)[] = [
		{
			dedupeByValue: true,
			label: "Message ID",
			value: input.data.message.signalId,
		},
		{
			label: "Type",
			value: formatMessageSignalType(input.data.message.signalType),
		},
		...buildAgentContextTechnicalDetailFields(
			input.data.agentContext,
			authorLabelPrefix
		),
		...buildWakeTargetTechnicalDetailFields(input.data.wakeContext),
		toTechnicalDetailField(
			input.data.wakeContext.sourceSignalId,
			"Wake source message",
			true
		),
		toTechnicalDetailField(
			input.data.wakeContext.clientMessageId,
			"Client message ID",
			true
		),
		outcomeFacts?.reasonCode
			? { label: "Reason code", value: outcomeFacts.reasonCode }
			: null,
		outcomeFacts?.failureStage
			? {
					label: "Failure stage",
					value: formatSystemNoticeFailureStage(outcomeFacts.failureStage),
				}
			: null,
		outcomeFacts?.stopCause
			? {
					label: "Service stop cause",
					value: outcomeFacts.stopCause.replaceAll("_", " "),
				}
			: null,
		outcomeFacts?.resultRef
			? {
					dedupeByValue: true,
					label: "Retained result reference",
					value: outcomeFacts.resultRef,
				}
			: null,
		outcomeFacts?.dispatchId
			? {
					dedupeByValue: true,
					label: "Dispatch ID",
					value: outcomeFacts.dispatchId,
				}
			: null,
		...input.data.diagnostics.traceSelectors.map((selector) => ({
			dedupeByValue: true,
			label: selector.label,
			value: selector.value,
		})),
	];

	return dedupeTechnicalDetailFields(candidates);
}

function OriginalErrorsSection(input: {
	wakeContext: GetSpaceMessageDetailsResponse["wakeContext"];
}) {
	if (input.wakeContext.state !== "recorded") {
		return null;
	}
	const targets = input.wakeContext.targets.filter(
		(target) => target.originalError
	);
	if (targets.length === 0) {
		return null;
	}
	return (
		<DetailsSection
			title={targets.length === 1 ? "Original error" : "Original errors"}
		>
			<div className="flex min-w-0 flex-col gap-4">
				{targets.map((target) => (
					<div className="min-w-0" key={target.targetProfileId}>
						<p className="mb-2 font-medium text-sm">
							{target.agentContext?.profileName.value ??
								target.targetLabel ??
								"Agent"}
						</p>
						<ScrollArea className="max-h-72 rounded-md bg-muted/50">
							<pre className="whitespace-pre-wrap break-words p-3 font-mono text-foreground text-xs leading-5">
								{target.originalError}
							</pre>
						</ScrollArea>
					</div>
				))}
			</div>
		</DetailsSection>
	);
}

function buildWakeTargetTechnicalDetailFields(
	wakeContext: GetSpaceMessageDetailsResponse["wakeContext"]
): (TechnicalDetailField | null)[] {
	if (wakeContext.state !== "recorded") {
		return [];
	}

	return wakeContext.targets.flatMap((target) => {
		const targetName =
			target.agentContext?.profileName.value ??
			target.targetLabel ??
			target.targetProfileId;
		const labelPrefix =
			wakeContext.targets.length === 1
				? "Wake target"
				: `Wake target (${targetName})`;
		return [
			...(target.agentContext
				? buildAgentContextTechnicalDetailFields(
						target.agentContext,
						labelPrefix
					)
				: []),
			{ label: `${labelPrefix} profile ID`, value: target.targetProfileId },
			target.taskContext?.assignment.readStatus === "found" &&
			target.taskContext.assignment.contextId
				? {
						label: `${labelPrefix} Context ID`,
						value: target.taskContext.assignment.contextId,
					}
				: null,
			target.reasonCode
				? { label: `${labelPrefix} reason code`, value: target.reasonCode }
				: null,
		];
	});
}

function buildAgentContextTechnicalDetailFields(
	agentContext: GetSpaceMessageDetailsResponse["agentContext"],
	labelPrefix: string
): (TechnicalDetailField | null)[] {
	const label = (fieldLabel: string) =>
		labelPrefix ? `${labelPrefix} ${fieldLabel}` : fieldLabel;
	return [
		toTechnicalDetailField(agentContext.profileName, label("Agent profile")),
		toTechnicalDetailField(
			agentContext.agentControllerRef,
			label("Agent Controller")
		),
		toTechnicalDetailField(
			agentContext.agentControllerConversationId,
			label("Agent Controller Conversation ID")
		),
		toTechnicalDetailField(agentContext.workspacePath, label("Workspace")),
		toTechnicalDetailField(
			agentContext.openMeldServiceRuntimeId,
			label("OpenMeld Service runtime ID")
		),
		toTechnicalDetailField(agentContext.bindingId, label("Binding ID")),
		toTechnicalDetailField(
			agentContext.workspaceFingerprint,
			label("Workspace fingerprint")
		),
	];
}

// "redacted" still renders (as the "Hidden" placeholder below) -- it means
// OpenMeld deliberately withheld a value that does exist, which is a
// different fact from "not_recorded"/"not_applicable" (nothing to show).
function toTechnicalDetailField(
	fact: SpaceMessageDetailsStringFact,
	label: string,
	dedupeByValue = false
): TechnicalDetailField | null {
	if (fact.state === "redacted") {
		return { dedupeByValue, label, value: REDACTED_FACT_PLACEHOLDER };
	}
	if (fact.state !== "recorded" || !fact.value) {
		return null;
	}
	return { dedupeByValue, label, value: fact.value };
}

// Only known selector aliases dedupe by value. Agent identity facts keep their
// role-qualified labels even when the author and Wake target use the same
// controller, Binding, or workspace. The "Hidden" placeholder is also exempt:
// several distinct redacted fields can legitimately render the same word.
function dedupeTechnicalDetailFields(
	candidates: readonly (TechnicalDetailField | null)[]
): TechnicalDetailField[] {
	const seenKeys = new Set<string>();
	const deduped: TechnicalDetailField[] = [];
	for (const candidate of candidates) {
		if (!candidate) {
			continue;
		}
		if (candidate.value === REDACTED_FACT_PLACEHOLDER) {
			deduped.push(candidate);
			continue;
		}
		const key = candidate.dedupeByValue
			? `value:${candidate.value}`
			: `field:${candidate.label}:${candidate.value}`;
		if (seenKeys.has(key)) {
			continue;
		}
		seenKeys.add(key);
		deduped.push(candidate);
	}
	return deduped;
}

function formatSystemNoticeFailureStage(
	stage: "execution" | "publication"
): string {
	return stage === "execution" ? "Execution" : "Publication";
}

// Collapsed by default: every field here is a raw ID or fingerprint useful
// for debugging or filing a support ticket, not for reading day to day.
function TechnicalDetailsSection(input: {
	detailsId: string;
	fields: readonly TechnicalDetailField[];
}) {
	if (input.fields.length === 0) {
		return null;
	}
	const allDetails = input.fields
		.map((field) => `${field.label}: ${field.value}`)
		.join("\n");
	return (
		<section className="border-border/70 border-t pt-4">
			<details className="group" id={input.detailsId}>
				<summary className="cursor-pointer select-none font-medium text-base">
					Technical details
				</summary>
				<div className="mt-2 flex justify-end">
					<Button
						onClick={() =>
							copyDetailText(allDetails, "Technical details copied.")
						}
						size="sm"
						type="button"
						variant="ghost"
					>
						<CopyIcon aria-hidden="true" />
						Copy technical details
					</Button>
				</div>
				<div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
					{input.fields.map((field) => (
						<DetailLine
							key={`${field.label}:${field.value}`}
							label={field.label}
							value={field.value}
						/>
					))}
				</div>
			</details>
		</section>
	);
}

function DiagnosticReportSection(input: {
	errorLogMessage: string;
	isPending: boolean;
	isSent: boolean;
	item: SpaceTimelineItem;
	onReportMessage: (item: SpaceTimelineItem) => Promise<void>;
}) {
	const reportMessage = () => {
		input.onReportMessage(input.item).catch((error) => {
			console.error(input.errorLogMessage, error);
		});
	};

	return (
		<DetailsSection title="Report issue">
			<div className="flex flex-col items-start gap-3 text-sm">
				<p className="text-muted-foreground leading-6">
					Send a report to help investigate this problem. Message text is not
					included.
				</p>
				<Button
					disabled={input.isPending || input.isSent}
					onClick={reportMessage}
					size="sm"
					type="button"
					variant="outline"
				>
					{resolveDiagnosticReportButtonText({
						isPending: input.isPending,
						isSent: input.isSent,
					})}
				</Button>
			</div>
		</DetailsSection>
	);
}

function DetailsSection(input: { children: ReactNode; title: string }) {
	return (
		<section className="flex flex-col gap-3 border-border/70 border-t pt-4 first:border-t-0 first:pt-0">
			<h3 className="font-medium text-base">{input.title}</h3>
			{input.children}
		</section>
	);
}

function DetailLine(input: {
	label: string;
	value: string;
	valueClassName?: string;
}) {
	return (
		<div className="min-w-0">
			<div className="flex items-center justify-between gap-2">
				<div className="text-muted-foreground text-xs">{input.label}</div>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label={`Copy ${input.label}`}
								className="size-6 shrink-0"
								onClick={() =>
									copyDetailText(input.value, `${input.label} copied.`)
								}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<CopyIcon aria-hidden="true" />
							</Button>
						}
					/>
					<TooltipContent side="bottom">Copy {input.label}</TooltipContent>
				</Tooltip>
			</div>
			<div
				className={cn(
					"break-words text-foreground text-sm leading-6",
					input.valueClassName
				)}
			>
				{input.value}
			</div>
		</div>
	);
}

async function copyDetailText(
	value: string,
	successMessage: string
): Promise<void> {
	let copied = false;
	try {
		copied = await copyTextToClipboard(value);
	} catch {
		copied = false;
	}
	if (copied) {
		toast.success(successMessage);
		return;
	}
	toast.error(
		"OpenMeld could not copy this automatically. Select the text and copy it manually."
	);
}

function formatFactValue(fact: SpaceMessageDetailsStringFact): string {
	switch (fact.state) {
		case "recorded":
			return fact.value ?? "Recorded";
		case "not_recorded":
			return "Not recorded";
		case "redacted":
			return "Hidden";
		case "not_applicable":
			return "Not applicable";
		default: {
			const _exhaustive: never = fact.state;
			return _exhaustive;
		}
	}
}

function formatMessageSignalType(signalType: string): string {
	switch (signalType) {
		case "signal.text":
			return "Message";
		case "signal.status":
			return "Status";
		case "signal.system_notice":
			return "System notice";
		default:
			return "Message";
	}
}

function resolveDiagnosticReportButtonText(input: {
	isPending: boolean;
	isSent: boolean;
}): string {
	if (input.isSent) {
		return "Issue reported";
	}
	return input.isPending ? "Sending report..." : "Send report";
}

/** Only the requester's own sent message can be continued from here. */
function buildFolderContinueSource(input: {
	item: SpaceTimelineItem;
	replyContext: GetSpaceMessageDetailsResponse["replyContext"];
	threadId: string | null;
}): FolderContinueSource | null {
	const item = input.item;
	if (
		item.signalType === "signal.text" &&
		item.actorProfileKind === "human" &&
		item.deliveryState === "sent" &&
		!item.recalledAt &&
		item.text.trim()
	) {
		return {
			sourceSignalId: item.id,
			text: item.text,
			threadId: input.threadId,
		};
	}
	// The failure notice itself is open, for example when its request is not
	// in loaded history: continue the request it answers.
	if (
		item.signalType === "signal.system_notice" &&
		item.systemNoticeType === "terminal_failure" &&
		item.replyToSignalId
	) {
		const preview = input.replyContext.previewText;
		return {
			sourceSignalId: item.replyToSignalId,
			text: preview.state === "recorded" ? (preview.value ?? "") : "",
			threadId: input.threadId,
		};
	}
	return null;
}
