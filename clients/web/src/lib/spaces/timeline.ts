import {
	AGENT_REPLY_FINAL_PURPOSE,
	type NavigationAction,
} from "@openmeld/schemas";
import type {
	AgentStreamToolPart,
	CenterAgentInteractionSource,
	CenterAgentTaskReference,
	ConversationCompactionMarker,
	SignalEnvelope,
	SpaceAgentActivity,
	SpaceMemberAgentSnapshot,
	SpaceMemberHumanSnapshot,
	SpaceMembersSnapshot,
	SpaceMessageAttachment,
	SpaceMessageFileReference,
	SpaceStatus,
} from "@openmeld/schemas/types";
import {
	buildSignalIndex,
	buildSignalMessageReadProjection,
	buildSpaceMemberAgentOwnerWakeDiagnosticsPresencePresentation,
	createSpaceTargetCatalog,
	resolveSpaceProfileAccent,
} from "@openmeld/space";
import type { SpaceConversationVisibleStreamProjection } from "./conversation-stream";
import { isSpaceTransientActivityEnvelope } from "./dispatch-activity";

type VisibleTimelineSignalType =
	| "signal.text"
	| "signal.status"
	| "signal.system_notice";

export type SpaceLiveState = "connecting" | "connected" | "degraded" | "stale";

export type SpaceTimelineVisibleEnvelope = Extract<
	SignalEnvelope,
	{
		type: VisibleTimelineSignalType;
	}
>;

export type SpaceTimelineItem = {
	id: string;
	spaceId: string;
	signalType: VisibleTimelineSignalType;
	spaceStatus?: SpaceStatus;
	deliveryState: "failed" | "pending" | "sent";
	attachments: readonly SpaceTimelineAttachment[];
	files?: readonly SpaceTimelineFile[];
	createdAtMs: number;
	actorName: string;
	actorAvatarImageUrl: string | null;
	actorControllerDisplay: string | null;
	actorAgentControllerRef: string | null;
	actorAgentControllerPending?: boolean;
	actorOwnerDisplay: string | null;
	actorOwnerName: string | null;
	actorOwnerUserId: string | null;
	actorProfileId: string;
	actorProfileKind: "human" | "agent" | "system";
	actorProfileName: string;
	actorRuntimeDeviceDisplayName: string | null;
	agentControllerConversationId: string | null;
	agentWorkspace: string | null;
	clientMessageId: string | null;
	centerAgentInteractionSource?: CenterAgentInteractionSource;
	centerAgentTaskReferences?: readonly CenterAgentTaskReference[];
	conversationCompaction?: ConversationCompactionMarker;
	isAgentFinalReply?: boolean;
	newMessagesDuringComposition: number | null;
	navigationAction?: NavigationAction | null;
	optimisticAgentReplySourceItemId?: string;
	optimisticAgentReplyState?: "sending" | "working";
	replyPreviewText: string | null;
	replyToProfileName: string | null;
	replyToSignalId: string | null;
	systemNoticeDispatchId?: string | null;
	systemNoticeReason?: string | null;
	systemNoticeReasonCode?: string | null;
	systemNoticeResultRef?: string | null;
	systemNoticeStopCause?:
		| "user_stop"
		| "controlled_service_update"
		| "service_crash"
		| "network_disconnect"
		| "unknown"
		| null;
	systemNoticeFailureStage?: "execution" | "publication" | null;
	systemNoticeType: string | null;
	systemNoticeTargetProfileId?: string | null;
	transientActivityPurpose: string | null;
	text: string;
	wakeClientMessageId: string | null;
	referenceTargetProfileIds?: readonly string[];
	wakeSourceSignalId: string | null;
	wakeTargetProfileIds: readonly string[];
	agentStreamState?: {
		sequence: number;
		status: "streaming" | "failed" | "stopped" | "completed_but_publish_failed";
		streamId: string;
		reasonCode: string | null;
		toolParts?: readonly AgentStreamToolPart[];
		thinking?: string;
	};
	agentActivity?: SpaceAgentActivity;
};

export type SpaceTimelineAttachment = SpaceMessageAttachment & {
	localPreviewUrl: string | null;
};

export type SpaceTimelineFile = SpaceMessageFileReference & {
	localPreviewUrl: string | null;
};

export function resolveRecordedSpaceMessageDetailsItem(input: {
	item: SpaceTimelineItem;
	timelineItems: readonly SpaceTimelineItem[];
}): SpaceTimelineItem | null {
	const recordedItemId = input.item.agentStreamState
		? input.item.replyToSignalId
		: (input.item.optimisticAgentReplySourceItemId ?? input.item.id);
	if (!recordedItemId) {
		return null;
	}
	const recordedItem =
		recordedItemId === input.item.id
			? input.item
			: input.timelineItems.find(
					(candidate) => candidate.id === recordedItemId
				);
	if (
		recordedItem?.deliveryState !== "sent" ||
		recordedItem.agentStreamState !== undefined ||
		recordedItem.optimisticAgentReplyState !== undefined
	) {
		return null;
	}
	return recordedItem;
}

export type SpaceLandingMember = {
	profileId: string;
	profileName: string;
	profileKind: "human" | "agent";
	liveNow: boolean;
	detail: string;
};

const VISIBLE_TIMELINE_SIGNAL_TYPES = new Set<VisibleTimelineSignalType>([
	"signal.text",
	"signal.status",
	"signal.system_notice",
]);

const AGENT_STREAM_TIMELINE_ADAPTER_TEXT = "Agent is working";

export function mergeSpaceTimelineEnvelopes(input: {
	current: readonly SignalEnvelope[];
	incoming: readonly SignalEnvelope[];
}): readonly SignalEnvelope[] {
	const byId = new Map<string, SignalEnvelope>();

	for (const envelope of input.current) {
		byId.set(envelope.id, envelope);
	}
	for (const envelope of input.incoming) {
		byId.set(envelope.id, envelope);
	}

	return [...byId.values()].sort(compareSignalEnvelopeOrder);
}

export function listVisibleTimelineEnvelopes(
	envelopes: readonly SignalEnvelope[]
): readonly SpaceTimelineVisibleEnvelope[] {
	return envelopes.flatMap((envelope) =>
		isVisibleTimelineEnvelope(envelope) ? [envelope] : []
	);
}

export function buildSpaceTimelineItems(input: {
	envelopes: readonly SignalEnvelope[];
	membersSnapshot: SpaceMembersSnapshot | null;
	agentStreams?: readonly SpaceConversationVisibleStreamProjection[];
	agentStreamScope?:
		| { kind: "main" }
		| { kind: "thread"; rootSignalId: string };
	pendingAttachmentPreviewUrlsById?: ReadonlyMap<string, string>;
	pendingFilePreviewUrlsById?: ReadonlyMap<string, string>;
}): readonly SpaceTimelineItem[] {
	const signalIndex = buildSignalIndex(input.envelopes);
	const targetCatalog = input.membersSnapshot
		? createSpaceTargetCatalog(input.membersSnapshot)
		: null;
	const durableItems = listVisibleTimelineEnvelopes(input.envelopes).map(
		(signal) =>
			buildSpaceTimelineItem({
				membersSnapshot: input.membersSnapshot,
				pendingAttachmentPreviewUrlsById:
					input.pendingAttachmentPreviewUrlsById,
				pendingFilePreviewUrlsById: input.pendingFilePreviewUrlsById,
				signal,
				signalIndex,
				targetCatalog,
			})
	);
	const finalizedStreamIds = new Set(
		input.envelopes.flatMap((signal) => {
			const streamId = readFinalizedAgentStreamId(signal);
			return streamId ? [streamId] : [];
		})
	);
	const streamItems = (input.agentStreams ?? []).flatMap((stream) => {
		if (
			!isAgentStreamVisibleInScope({
				scope: input.agentStreamScope,
				signalIndex,
				stream,
			}) ||
			finalizedStreamIds.has(stream.streamId) ||
			hasDurableAgentTerminalNotice({
				dispatchId: stream.dispatchId,
				envelopes: input.envelopes,
			})
		) {
			return [];
		}
		const signal = buildAgentStreamProjectionEnvelope(stream);
		const timelineItem = buildSpaceTimelineItem({
			membersSnapshot: input.membersSnapshot,
			pendingAttachmentPreviewUrlsById: input.pendingAttachmentPreviewUrlsById,
			pendingFilePreviewUrlsById: input.pendingFilePreviewUrlsById,
			signal,
			signalIndex,
			targetCatalog,
		});
		return [
			{
				...timelineItem,
				agentStreamState: {
					reasonCode: stream.reasonCode,
					sequence: stream.sequence,
					status: stream.status,
					streamId: stream.streamId,
					toolParts: stream.toolParts ?? [],
					...(stream.status === "streaming" && stream.thinking
						? { thinking: stream.thinking }
						: {}),
				},
				isAgentFinalReply: true,
				text: stream.text,
			},
		];
	});

	return mergeSpaceTimelineItems({
		current: durableItems,
		incoming: streamItems,
	});
}

function isAgentStreamVisibleInScope(input: {
	scope:
		| { kind: "main" }
		| { kind: "thread"; rootSignalId: string }
		| undefined;
	signalIndex: ReadonlyMap<string, SignalEnvelope>;
	stream: SpaceConversationVisibleStreamProjection;
}): boolean {
	if (!input.scope) {
		return true;
	}
	if (!input.signalIndex.has(input.stream.triggerMessageId)) {
		return false;
	}
	return (
		input.scope.kind === "main" ||
		input.stream.triggerMessageId !== input.scope.rootSignalId
	);
}

export function mergeSpaceTimelineItems(input: {
	current: readonly SpaceTimelineItem[];
	incoming: readonly SpaceTimelineItem[];
}): readonly SpaceTimelineItem[] {
	const byId = new Map<string, SpaceTimelineItem>();
	for (const item of input.current) {
		byId.set(item.id, item);
	}
	for (const item of input.incoming) {
		byId.set(item.id, item);
	}
	return [...byId.values()].sort(compareSpaceTimelineItemOrder);
}

function buildSpaceTimelineItem(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	pendingAttachmentPreviewUrlsById?: ReadonlyMap<string, string>;
	pendingFilePreviewUrlsById?: ReadonlyMap<string, string>;
	signal: SpaceTimelineVisibleEnvelope;
	signalIndex: ReturnType<typeof buildSignalIndex>;
	targetCatalog: ReturnType<typeof createSpaceTargetCatalog> | null;
}): SpaceTimelineItem {
	const projection = buildSignalMessageReadProjection({
		signal: input.signal,
		membersSnapshot: input.membersSnapshot,
		signalIndex: input.signalIndex,
	});
	const actor = resolveActorPresentation({
		membersSnapshot: input.membersSnapshot,
		signal: input.signal,
		targetCatalog: input.targetCatalog,
	});
	const agentReplyDetails = readAgentFinalReplyDetails(input.signal);

	return {
		id: input.signal.id,
		spaceId: input.signal.spaceId,
		signalType: input.signal.type,
		...(input.signal.type === "signal.status"
			? { spaceStatus: input.signal.data.status }
			: {}),
		deliveryState: resolveLocalSignalDeliveryState(input.signal.id),
		attachments: readTimelineAttachments({
			pendingAttachmentPreviewUrlsById: input.pendingAttachmentPreviewUrlsById,
			signal: input.signal,
		}),
		files: readTimelineFiles({
			pendingFilePreviewUrlsById: input.pendingFilePreviewUrlsById,
			signal: input.signal,
		}),
		createdAtMs: input.signal.ts,
		actorControllerDisplay: actor.controllerDisplay,
		actorAgentControllerRef: actor.agentControllerRef,
		actorAgentControllerPending: actor.agentControllerPending,
		actorName: actor.displayName,
		actorAvatarImageUrl: actor.avatarImageUrl,
		actorOwnerDisplay: actor.ownerDisplay,
		actorOwnerName: actor.ownerName,
		actorOwnerUserId: actor.ownerUserId,
		actorProfileId: input.signal.profile.profileId,
		actorProfileKind: input.signal.profile.kind,
		actorProfileName: actor.profileName,
		actorRuntimeDeviceDisplayName: actor.runtimeDeviceDisplayName,
		agentControllerConversationId:
			agentReplyDetails.agentControllerConversationId,
		agentActivity: readAgentActivity(input.signal),
		agentWorkspace: agentReplyDetails.agentWorkspace,
		clientMessageId: readClientMessageId(input.signal),
		centerAgentInteractionSource:
			input.signal.type === "signal.text"
				? input.signal.data.meta?.centerAgentInteractionSource
				: undefined,
		centerAgentTaskReferences: readCenterAgentTaskReferences(input.signal),
		...readConversationCompaction(input.signal),
		isAgentFinalReply: isAgentFinalReplySignal(input.signal),
		newMessagesDuringComposition: readNewMessagesDuringComposition(
			input.signal
		),
		navigationAction: projection.navigationAction,
		replyPreviewText: projection.replyToContext?.previewText ?? null,
		replyToProfileName: projection.replyToContext?.actorDisplayName ?? null,
		replyToSignalId: projection.replyToSignalId,
		systemNoticeDispatchId: readSystemNoticeDispatchId(input.signal),
		systemNoticeReason: readSystemNoticeReason(input.signal),
		systemNoticeReasonCode: readSystemNoticeReasonCode(input.signal),
		systemNoticeResultRef: readSystemNoticeResultRef(input.signal),
		systemNoticeStopCause: readSystemNoticeStopCause(input.signal),
		systemNoticeFailureStage: readSystemNoticeFailureStage(input.signal),
		systemNoticeType: readSystemNoticeType(input.signal),
		systemNoticeTargetProfileId: readSystemNoticeTargetProfileId(input.signal),
		transientActivityPurpose: readTransientActivityPurpose(input.signal),
		text: projection.text,
		...readSourceMessageAddressingDetails(input.signal),
	};
}

function resolveLocalSignalDeliveryState(
	signalId: string
): SpaceTimelineItem["deliveryState"] {
	if (signalId.startsWith("pending:")) {
		return "pending";
	}
	if (signalId.startsWith("failed:")) {
		return "failed";
	}
	return "sent";
}

function readConversationCompaction(
	signal: SpaceTimelineVisibleEnvelope
): Pick<SpaceTimelineItem, "conversationCompaction"> {
	if (
		signal.type !== "signal.text" ||
		!signal.data.meta?.conversationCompaction
	) {
		return {};
	}
	return {
		conversationCompaction: signal.data.meta.conversationCompaction,
	};
}

function readClientMessageId(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.text") {
		return null;
	}
	return normalizeOptionalText(signal.data.meta?.clientMessageId);
}

function readCenterAgentTaskReferences(
	signal: SpaceTimelineVisibleEnvelope
): readonly CenterAgentTaskReference[] {
	if (signal.type !== "signal.text") {
		return [];
	}
	return signal.data.meta?.centerAgentTaskReferences ?? [];
}

function readAgentActivity(
	signal: SpaceTimelineVisibleEnvelope
): SpaceAgentActivity | undefined {
	if (signal.type !== "signal.text" || !isAgentFinalReplySignal(signal)) {
		return undefined;
	}
	return signal.data.meta?.agentWorkSummary ?? signal.data.meta?.agentActivity;
}

function readTimelineAttachments(input: {
	pendingAttachmentPreviewUrlsById?: ReadonlyMap<string, string>;
	signal: SpaceTimelineVisibleEnvelope;
}): readonly SpaceTimelineAttachment[] {
	if (input.signal.type !== "signal.text") {
		return [];
	}
	const isPending = input.signal.id.startsWith("pending:");
	return (input.signal.data.attachments ?? []).map((attachment) => ({
		...attachment,
		localPreviewUrl: isPending
			? (input.pendingAttachmentPreviewUrlsById?.get(attachment.id) ?? null)
			: null,
	}));
}

function readTimelineFiles(input: {
	pendingFilePreviewUrlsById?: ReadonlyMap<string, string>;
	signal: SpaceTimelineVisibleEnvelope;
}): readonly SpaceTimelineFile[] {
	if (input.signal.type !== "signal.text") {
		return [];
	}
	const isPending = input.signal.id.startsWith("pending:");
	return (input.signal.data.files ?? []).map((file) => ({
		...file,
		localPreviewUrl: isPending
			? (input.pendingFilePreviewUrlsById?.get(file.fileId) ?? null)
			: null,
	}));
}

function buildAgentStreamProjectionEnvelope(
	stream: SpaceConversationVisibleStreamProjection
): SpaceTimelineVisibleEnvelope {
	// Tool activity can arrive before the first text delta. This local adapter
	// still has to honor the non-empty Signal/Message Envelope contract while
	// the timeline item below keeps the real, possibly empty, visible text.
	const adapterText =
		stream.text.trim().length > 0
			? stream.text
			: AGENT_STREAM_TIMELINE_ADAPTER_TEXT;
	return {
		v: 1,
		id: stream.streamId,
		spaceId: stream.spaceId,
		ts: stream.createdAtMs,
		profile: {
			kind: "agent",
			profileId: stream.profileId,
		},
		type: "signal.text",
		data: {
			text: adapterText,
			messageEnvelope: {
				activationTargets: [],
				referenceTargets: [],
				replyToSignalId: stream.triggerMessageId,
				text: adapterText,
			},
			meta: {
				dispatchId: stream.dispatchId,
				purpose: "agent_stream_projection",
				targetProfileId: stream.profileId,
			},
		},
	} as SpaceTimelineVisibleEnvelope;
}

export function buildSpaceLandingMembers(input: {
	membersSnapshot: SpaceMembersSnapshot;
	limit: number;
}): {
	visibleMembers: readonly SpaceLandingMember[];
	overflowCount: number;
} {
	const orderedMembers = [
		...input.membersSnapshot.humans.filter((member) => member.liveNow),
		...input.membersSnapshot.agents.filter((member) => member.liveNow),
		...input.membersSnapshot.humans.filter((member) => !member.liveNow),
		...input.membersSnapshot.agents.filter((member) => !member.liveNow),
	].map((member) => toLandingMember(member));

	return {
		visibleMembers: orderedMembers.slice(0, input.limit),
		overflowCount: Math.max(0, orderedMembers.length - input.limit),
	};
}

export function getEarliestVisibleTimelineSignalId(
	envelopes: readonly SignalEnvelope[]
): string | null {
	return listVisibleTimelineEnvelopes(envelopes).at(0)?.id ?? null;
}

export function isSpaceTimelineCatchUpAnchorSignal(
	envelope: SignalEnvelope
): boolean {
	return isVisibleTimelineEnvelope(envelope);
}

// A request-level Wake outcome: the two `signal.system_notice` types that
// close a Wake with a durable, user-facing result (a failure or an explicit
// stop). `stay_silent` and `policy_blocked` are notices too, but they are not
// a request-level outcome the outcome row / anchoring model covers -- they
// keep the plain system-event marker treatment.
const OUTCOME_NOTICE_TYPES = new Set(["terminal_failure", "wake_stopped"]);

export function isSpaceOutcomeNoticeItem(item: SpaceTimelineItem): boolean {
	return (
		item.signalType === "signal.system_notice" &&
		item.systemNoticeType !== null &&
		OUTCOME_NOTICE_TYPES.has(item.systemNoticeType)
	);
}

export function isSpaceExecutionRecoveryNoticeItem(
	item: SpaceTimelineItem
): boolean {
	return (
		item.signalType === "signal.system_notice" &&
		(item.systemNoticeType === "execution_recovery_available" ||
			item.systemNoticeType === "execution_recovery_completed")
	);
}

function isVisibleTimelineEnvelope(
	envelope: SignalEnvelope
): envelope is SpaceTimelineVisibleEnvelope {
	if (isSpaceTransientActivityEnvelope(envelope)) {
		return false;
	}

	return VISIBLE_TIMELINE_SIGNAL_TYPES.has(
		envelope.type as VisibleTimelineSignalType
	);
}

function readTransientActivityPurpose(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.text" || signal.data.meta?.transient !== true) {
		return null;
	}

	const purpose = signal.data.meta.purpose;
	return typeof purpose === "string" && purpose.trim().length > 0
		? purpose.trim()
		: null;
}

function readNewMessagesDuringComposition(
	signal: SpaceTimelineVisibleEnvelope
): number | null {
	if (signal.type !== "signal.text") {
		return null;
	}
	return signal.data.meta?.staleness?.newMessagesDuringComposition ?? null;
}

function readSourceMessageAddressingDetails(
	signal: SpaceTimelineVisibleEnvelope
): {
	referenceTargetProfileIds: readonly string[];
	wakeClientMessageId: string | null;
	wakeSourceSignalId: string | null;
	wakeTargetProfileIds: readonly string[];
} {
	if (signal.type !== "signal.text") {
		return {
			referenceTargetProfileIds: [],
			wakeClientMessageId: null,
			wakeSourceSignalId: null,
			wakeTargetProfileIds: [],
		};
	}

	const wakeTargetProfileIds = normalizeUniqueNonEmptyStrings(
		signal.data.messageEnvelope?.activationTargets ?? []
	);
	const wakeTargetProfileIdSet = new Set(wakeTargetProfileIds);
	const referenceTargetProfileIds = normalizeUniqueNonEmptyStrings(
		signal.data.messageEnvelope?.referenceTargets ?? []
	).filter((profileId) => !wakeTargetProfileIdSet.has(profileId));
	const clientMessageId = normalizeOptionalText(
		signal.data.meta?.clientMessageId
	);
	if (wakeTargetProfileIds.length === 0) {
		return {
			referenceTargetProfileIds,
			wakeClientMessageId: null,
			wakeSourceSignalId: null,
			wakeTargetProfileIds: [],
		};
	}

	return {
		referenceTargetProfileIds,
		wakeClientMessageId: clientMessageId,
		wakeSourceSignalId: signal.id,
		wakeTargetProfileIds,
	};
}

function readSystemNoticeType(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return normalizeOptionalText(signal.data.noticeType);
}

function readSystemNoticeDispatchId(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return normalizeOptionalText(signal.data.dispatchId);
}

function readSystemNoticeReason(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return normalizeOptionalText(signal.data.reason);
}

function readSystemNoticeReasonCode(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return normalizeOptionalText(signal.data.reasonCode);
}

function readSystemNoticeResultRef(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return normalizeOptionalText(signal.data.resultRef);
}

function readSystemNoticeStopCause(
	signal: SpaceTimelineVisibleEnvelope
): SpaceTimelineItem["systemNoticeStopCause"] {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return signal.data.stopCause ?? null;
}

function readSystemNoticeFailureStage(
	signal: SpaceTimelineVisibleEnvelope
): "execution" | "publication" | null {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return signal.data.failureStage ?? null;
}

function readSystemNoticeTargetProfileId(
	signal: SpaceTimelineVisibleEnvelope
): string | null {
	if (signal.type !== "signal.system_notice") {
		return null;
	}
	return normalizeOptionalText(signal.data.actorProfileId);
}

function readAgentFinalReplyDetails(signal: SpaceTimelineVisibleEnvelope): {
	agentControllerConversationId: string | null;
	agentWorkspace: string | null;
} {
	if (!isAgentFinalReplySignal(signal)) {
		return {
			agentControllerConversationId: null,
			agentWorkspace: null,
		};
	}

	return {
		agentControllerConversationId:
			"agentControllerConversationId" in signal.profile
				? normalizeOptionalText(signal.profile.agentControllerConversationId)
				: null,
		agentWorkspace:
			"workingDirectory" in signal.profile
				? normalizeOptionalText(signal.profile.workingDirectory)
				: null,
	};
}

function isAgentFinalReplySignal(
	signal: SpaceTimelineVisibleEnvelope
): boolean {
	return (
		signal.type === "signal.text" &&
		signal.profile.kind === "agent" &&
		normalizeOptionalText(signal.data.meta?.purpose) ===
			AGENT_REPLY_FINAL_PURPOSE
	);
}

function readFinalizedAgentStreamId(signal: SignalEnvelope): string | null {
	if (
		signal.type !== "signal.text" ||
		signal.profile.kind !== "agent" ||
		normalizeOptionalText(signal.data.meta?.purpose) !==
			AGENT_REPLY_FINAL_PURPOSE
	) {
		return null;
	}
	const submissionId = normalizeOptionalText(signal.data.meta?.clientMessageId);
	return submissionId ? `stream:${submissionId}` : null;
}

function hasDurableAgentTerminalNotice(input: {
	dispatchId: string;
	envelopes: readonly SignalEnvelope[];
}): boolean {
	return input.envelopes.some(
		(signal) =>
			signal.type === "signal.system_notice" &&
			(signal.data.noticeType === "terminal_failure" ||
				signal.data.noticeType === "wake_stopped") &&
			normalizeOptionalText(signal.data.dispatchId) === input.dispatchId
	);
}

function normalizeUniqueNonEmptyStrings(values: readonly unknown[]): string[] {
	const normalized = new Set<string>();
	for (const value of values) {
		const item = normalizeOptionalText(value);
		if (item) {
			normalized.add(item);
		}
	}
	return [...normalized];
}

function normalizeOptionalText(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function compareSignalEnvelopeOrder(
	left: SignalEnvelope,
	right: SignalEnvelope
): number {
	if (left.ts !== right.ts) {
		return left.ts - right.ts;
	}
	return left.id.localeCompare(right.id);
}

function compareSpaceTimelineItemOrder(
	left: SpaceTimelineItem,
	right: SpaceTimelineItem
): number {
	if (left.createdAtMs !== right.createdAtMs) {
		return left.createdAtMs - right.createdAtMs;
	}
	return left.id.localeCompare(right.id);
}

function resolveActorName(
	signal: SignalEnvelope,
	membersSnapshot: SpaceMembersSnapshot | null
): string {
	const profileName = resolveUsableSignalProfileName(signal);
	if (profileName) {
		return profileName;
	}

	const memberName = findMemberName({
		membersSnapshot,
		profileId: signal.profile.profileId,
	});
	return memberName ?? signal.profile.profileId;
}

function resolveActorPresentation(input: {
	signal: SignalEnvelope;
	membersSnapshot: SpaceMembersSnapshot | null;
	targetCatalog: ReturnType<typeof createSpaceTargetCatalog> | null;
}): {
	avatarImageUrl: string | null;
	controllerDisplay: string | null;
	agentControllerRef: string | null;
	agentControllerPending: boolean;
	displayName: string;
	ownerDisplay: string | null;
	ownerName: string | null;
	ownerUserId: string | null;
	profileName: string;
	runtimeDeviceDisplayName: string | null;
} {
	const catalogEntry = input.targetCatalog?.byProfileId.get(
		input.signal.profile.profileId
	);
	const signalProfileName = resolveUsableSignalProfileName(input.signal);
	const signalOwnerName = input.signal.profile.ownerName?.trim() || null;
	const signalOwnerUserId = input.signal.profile.owner?.trim() || null;
	const signalAgentControllerRef =
		input.signal.profile.agentControllerRef?.trim() || null;
	const memberAgentControllerRef = findMemberAgentControllerRef({
		membersSnapshot: input.membersSnapshot,
		profileId: input.signal.profile.profileId,
	});
	const agentControllerRef =
		memberAgentControllerRef === undefined
			? signalAgentControllerRef
			: memberAgentControllerRef;
	const displayName =
		signalProfileName ??
		catalogEntry?.profileName ??
		resolveActorName(input.signal, input.membersSnapshot);
	const ownerName = signalOwnerName ?? catalogEntry?.ownerName ?? null;
	const ownerUserId = signalOwnerUserId ?? catalogEntry?.ownerUserId ?? null;
	const accent = resolveSpaceProfileAccent({
		agentControllerRef,
		ownerName,
		ownerUserId,
		profileId: input.signal.profile.profileId,
		profileKind: input.signal.profile.kind,
		profileName: signalProfileName ?? catalogEntry?.profileName ?? displayName,
	});
	const memberAvatarUrl = findMemberAvatarUrl({
		membersSnapshot: input.membersSnapshot,
		profileId: input.signal.profile.profileId,
	});

	return {
		// Prefer the live member snapshot avatar (reflects the latest user
		// image). `null` is an authoritative removed-avatar state; only a
		// missing member projection may fall back to the per-signal snapshot.
		avatarImageUrl:
			memberAvatarUrl === undefined
				? (input.signal.profile.avatarUrl?.trim() ?? null)
				: memberAvatarUrl,
		controllerDisplay:
			accent.controllerDisplayName ?? catalogEntry?.controllerDisplay ?? null,
		agentControllerRef,
		agentControllerPending:
			input.signal.profile.kind === "agent" &&
			agentControllerRef === null &&
			input.membersSnapshot === null,
		displayName,
		ownerDisplay:
			catalogEntry?.ownerDisplay ?? ownerName ?? ownerUserId ?? null,
		ownerName,
		ownerUserId,
		profileName: signalProfileName ?? catalogEntry?.profileName ?? displayName,
		runtimeDeviceDisplayName: catalogEntry?.runtimeDeviceDisplayName ?? null,
	};
}

function findMemberAgentControllerRef(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	profileId: string;
}): string | null | undefined {
	const agent = input.membersSnapshot?.agents.find(
		(member) => member.profileId === input.profileId
	);
	return agent ? agent.agentControllerRef?.trim() || null : undefined;
}

function resolveUsableSignalProfileName(signal: SignalEnvelope): string | null {
	const profileName = signal.profile.profileName?.trim() || null;
	return profileName === signal.profile.profileId ? null : profileName;
}

function findMemberName(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	profileId: string;
}): string | null {
	if (!input.membersSnapshot) {
		return null;
	}

	for (const member of [
		...input.membersSnapshot.humans,
		...input.membersSnapshot.agents,
	]) {
		if (member.profileId === input.profileId) {
			return member.profileName;
		}
	}
	return null;
}

function findMemberAvatarUrl(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	profileId: string;
}): string | null | undefined {
	if (!input.membersSnapshot) {
		return undefined;
	}

	for (const member of [
		...input.membersSnapshot.humans,
		...input.membersSnapshot.agents,
	]) {
		if (member.profileId === input.profileId) {
			return member.avatarUrl?.trim() || null;
		}
	}
	return undefined;
}

function toLandingMember(
	member: SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot
): SpaceLandingMember {
	let detail = "Member";

	if (member.profileKind === "agent") {
		detail =
			buildSpaceMemberAgentOwnerWakeDiagnosticsPresencePresentation(
				member
			).detailLabel;
	} else if (member.liveNow) {
		detail = "Live human";
	}

	return {
		profileId: member.profileId,
		profileName: member.profileName,
		profileKind: member.profileKind,
		liveNow: member.liveNow,
		detail,
	};
}
