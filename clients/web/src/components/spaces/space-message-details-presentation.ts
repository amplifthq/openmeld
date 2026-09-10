import { isAgentWorkActivityPresentable } from "@openmeld/schemas";
import type {
	GetSpaceMessageDetailsResponse,
	SpaceMessageDetailsToolActivity,
} from "@openmeld/schemas/types";
import {
	isSpaceOutcomeNoticeItem,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import type {
	SpaceMessageWakeIssueEntry,
	SpaceMessageWakeThinkingEntry,
} from "#/lib/spaces/wake-progress-presentation";
import type { SpaceWakeStopTargetResolution } from "#/lib/spaces/wake-stop-target";
import { resolveAgentWorkPresentation } from "./agent-work-presentation";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";

export type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";

const OPAQUE_AGENT_PROFILE_ID_PATTERN = /^agt_[a-z0-9-]+$/iu;

export type MessageDetailsStatus =
	| "failed"
	| "missing"
	| "pending"
	| "replied"
	| "running"
	| "stopped"
	| null;

export type MessageDetailsDiagnosticReportStatus = "idle" | "pending" | "sent";

export function resolveMessageDetailsDiagnosticReportStatus(input: {
	isPending: boolean;
	isSent: boolean;
}): MessageDetailsDiagnosticReportStatus {
	if (input.isPending) {
		return "pending";
	}
	return input.isSent ? "sent" : "idle";
}

export type MessageDetailsActivityActor = {
	agentControllerRef: string | null;
	avatarImageUrl: string | null;
	isCenterAgent: boolean;
	profileId: string;
	profileKind: "agent" | "human" | "system";
	profileName: string;
};

export type MessageDetailsActivityItem = {
	actor: MessageDetailsActivityActor;
	description: string | null;
	id: string;
	jumpSignalId: string | null;
	kind: "message" | "recovery" | "reply" | "target" | "work";
	occurredAtMs: number | null;
	status: Exclude<MessageDetailsStatus, null> | "completed" | "started" | null;
	targetProfileId: string | null;
	title: string;
};

export type SpaceMessageDetailsPresentation = {
	activityItems: readonly MessageDetailsActivityItem[];
	recoveryNoticeItems: readonly SpaceTimelineItem[];
	replyItems: readonly SpaceTimelineItem[];
	status: MessageDetailsStatus;
	wakeFailureNoticeItems: readonly SpaceTimelineItem[];
};

/**
 * The only Web presentation projection for Message details.
 *
 * Each Wake target owns one readable Activity row. Transient progress enriches
 * that row while work is active; a durable reply or outcome replaces the live
 * content instead of creating a second status row.
 */
export function buildSpaceMessageDetailsPresentation(input: {
	data: GetSpaceMessageDetailsResponse;
	item: SpaceTimelineItem;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	replyItems: readonly SpaceTimelineItem[];
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	wakeIssueEntries: readonly SpaceMessageWakeIssueEntry[];
	wakeProgressEntries?: readonly SpaceMessageWakeThinkingEntry[];
	wakeStopTarget?: SpaceWakeStopTargetResolution | null;
}): SpaceMessageDetailsPresentation {
	const wakeFailureNoticeItems = [
		...(isTerminalFailureNoticeItem(input.item) ? [input.item] : []),
		...input.replyItems.filter(
			(item) => item.id !== input.item.id && isTerminalFailureNoticeItem(item)
		),
	];
	const replyItems = input.replyItems.filter(isRecordedReplyItem);
	const recoveryNoticeItems = input.replyItems.filter(isRecoveryNoticeItem);

	return {
		activityItems: buildActivityItems({
			data: input.data,
			item: input.item,
			profilePresentationsById: input.profilePresentationsById,
			replyItems: input.replyItems,
			targetProfileDisplayNamesByProfileId:
				input.targetProfileDisplayNamesByProfileId,
			wakeIssueEntries: input.wakeIssueEntries,
			wakeProgressEntries: input.wakeProgressEntries ?? [],
			wakeStopTarget: input.wakeStopTarget ?? null,
		}),
		recoveryNoticeItems,
		replyItems,
		status: resolveMessageDetailsStatus({
			item: input.item,
			wakeContext: input.data.wakeContext,
		}),
		wakeFailureNoticeItems,
	};
}

function buildActivityItems(input: {
	data: GetSpaceMessageDetailsResponse;
	item: SpaceTimelineItem;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	replyItems: readonly SpaceTimelineItem[];
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	wakeIssueEntries: readonly SpaceMessageWakeIssueEntry[];
	wakeProgressEntries: readonly SpaceMessageWakeThinkingEntry[];
	wakeStopTarget: SpaceWakeStopTargetResolution | null;
}): MessageDetailsActivityItem[] {
	if (isRecordedOutcomeItem(input.item)) {
		return [
			buildOriginalActivityItem(input),
			...buildWorkActivityItems(
				input.data.workingDetails,
				actorFromItem(input.item)
			),
		];
	}
	if (
		isSelectedAgentReply(input.item) &&
		!isWakeSourceForSelectedMessage(input.data, input.item.id)
	) {
		return [
			buildOriginalActivityItem(input),
			...buildWorkActivityItems(
				input.data.workingDetails,
				actorFromItem(input.item)
			),
		];
	}
	const targetsByProfileId = buildTargetActivities(input);
	applyWakeProgressEntries({
		entries: input.wakeProgressEntries,
		profilePresentationsById: input.profilePresentationsById,
		targetProfileDisplayNamesByProfileId:
			input.targetProfileDisplayNamesByProfileId,
		targetsByProfileId,
	});
	const laterItems = applyRecordedActivityItems({
		items: input.replyItems,
		profilePresentationsById: input.profilePresentationsById,
		targetProfileDisplayNamesByProfileId:
			input.targetProfileDisplayNamesByProfileId,
		targetsByProfileId,
	});
	applyWakeIssueEntries({
		entries: input.wakeIssueEntries,
		profilePresentationsById: input.profilePresentationsById,
		targetProfileDisplayNamesByProfileId:
			input.targetProfileDisplayNamesByProfileId,
		targetsByProfileId,
	});
	applyWakeStopTarget({
		profilePresentationsById: input.profilePresentationsById,
		targetProfileDisplayNamesByProfileId:
			input.targetProfileDisplayNamesByProfileId,
		targetsByProfileId,
		wakeStopTarget: input.wakeStopTarget,
	});
	laterItems.push(...targetsByProfileId.values());
	laterItems.push(
		...buildWorkActivityItems(
			input.data.workingDetails,
			actorFromItem(input.item)
		)
	);
	laterItems.sort(compareActivityOrder);

	return [buildOriginalActivityItem(input), ...laterItems];
}

function applyWakeStopTarget(input: {
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	targetsByProfileId: Map<string, MessageDetailsActivityItem>;
	wakeStopTarget: SpaceWakeStopTargetResolution | null;
}): void {
	const stoppedTarget = input.wakeStopTarget;
	if (stoppedTarget?.status !== "stopped" || !stoppedTarget.targetProfileId) {
		return;
	}
	const target = getOrCreateTargetActivity({
		...input,
		targetLabel: stoppedTarget.targetLabel ?? undefined,
		targetProfileId: stoppedTarget.targetProfileId,
	});
	target.description = "Wake was stopped.";
	target.status = "stopped";
}

function buildTargetActivities(input: {
	data: GetSpaceMessageDetailsResponse;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
}): Map<string, MessageDetailsActivityItem> {
	const targetsByProfileId = new Map<string, MessageDetailsActivityItem>();
	if (input.data.wakeContext.state !== "recorded") {
		return targetsByProfileId;
	}
	for (const target of input.data.wakeContext.targets) {
		const actor = resolveTargetActor({
			profilePresentationsById: input.profilePresentationsById,
			target,
			targetProfileDisplayNamesByProfileId:
				input.targetProfileDisplayNamesByProfileId,
		});
		targetsByProfileId.set(target.targetProfileId, {
			actor,
			description: resolvePendingTargetDescription(target.status ?? null),
			id: `target:${target.targetProfileId}`,
			jumpSignalId: null,
			kind: "target",
			occurredAtMs: readLatestObservedAtMs(target.steps ?? []),
			status: target.status ?? null,
			targetProfileId: target.targetProfileId,
			title: actor.profileName,
		});
	}
	return targetsByProfileId;
}

function applyWakeProgressEntries(input: {
	entries: readonly SpaceMessageWakeThinkingEntry[];
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	targetsByProfileId: Map<string, MessageDetailsActivityItem>;
}): void {
	for (const entry of input.entries) {
		const target = getOrCreateTargetActivity({
			...input,
			targetProfileId: entry.targetProfileId,
		});
		if (isTerminalActivityStatus(target.status)) {
			continue;
		}
		target.description = entry.text.trim() || entry.step.label;
		if (
			entry.step.kind === "waiting_for_device" ||
			(entry.step.kind === "queued" && entry.step.status === "pending")
		) {
			target.description += `. ${entry.step.description}`;
		}
		target.occurredAtMs = entry.elapsedStartedAtMs;
		target.status = entry.step.status === "failed" ? "failed" : "running";
	}
}

function applyRecordedActivityItems(input: {
	items: readonly SpaceTimelineItem[];
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	targetsByProfileId: Map<string, MessageDetailsActivityItem>;
}): MessageDetailsActivityItem[] {
	const standaloneItems: MessageDetailsActivityItem[] = [];
	for (const item of input.items) {
		if (
			applyRecoveryNotice({
				...input,
				item,
				standaloneItems,
			})
		) {
			continue;
		}
		const targetProfileId = resolveOutcomeTargetProfileId(item);
		const target = targetProfileId
			? getOrCreateTargetActivity({
					...input,
					targetLabel:
						item.actorProfileKind === "agent" ? item.actorName : undefined,
					targetProfileId,
				})
			: undefined;
		if (target && isRecordedReplyItem(item)) {
			applyRecordedReply(target, item);
			continue;
		}
		if (target && isRecordedOutcomeItem(item)) {
			applyRecordedOutcome(target, item);
			continue;
		}
		const standalone = buildStandaloneRecordedActivityItem({ ...input, item });
		if (standalone) {
			standaloneItems.push(standalone);
		}
	}
	return standaloneItems;
}

function applyRecoveryNotice(input: {
	item: SpaceTimelineItem;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	standaloneItems: MessageDetailsActivityItem[];
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	targetsByProfileId: Map<string, MessageDetailsActivityItem>;
}): boolean {
	if (!isRecoveryNoticeItem(input.item)) {
		return false;
	}
	const targetProfileId = resolveOutcomeTargetProfileId(input.item);
	if (!targetProfileId) {
		input.standaloneItems.push(buildRecoveryActivityItem(input.item));
		return true;
	}
	const target = getOrCreateTargetActivity({
		...input,
		targetProfileId,
	});
	if (
		input.item.systemNoticeType === "execution_recovery_completed" ||
		target.status !== "failed"
	) {
		applyRecordedOutcome(target, input.item);
	}
	return true;
}

function buildStandaloneRecordedActivityItem(input: {
	item: SpaceTimelineItem;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
}): MessageDetailsActivityItem | null {
	if (isRecordedReplyItem(input.item)) {
		return buildOrdinaryReplyActivityItem(input.item);
	}
	if (isRecordedOutcomeItem(input.item)) {
		return buildStandaloneOutcomeActivityItem(input);
	}
	return null;
}

function applyWakeIssueEntries(input: {
	entries: readonly SpaceMessageWakeIssueEntry[];
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	targetsByProfileId: Map<string, MessageDetailsActivityItem>;
}): void {
	for (const issue of input.entries) {
		const target = getOrCreateTargetActivity({
			...input,
			targetLabel: issue.targetLabel,
			targetProfileId: issue.targetProfileId,
		});
		if (target.status === "replied" || target.status === "stopped") {
			continue;
		}
		target.description = issue.body.trim() || issue.message.trim() || null;
		target.status = "failed";
	}
}

function buildOriginalActivityItem(input: {
	data: GetSpaceMessageDetailsResponse;
	item: SpaceTimelineItem;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
}): MessageDetailsActivityItem {
	if (isRecordedOutcomeItem(input.item)) {
		return buildStandaloneOutcomeActivityItem({
			item: input.item,
			profilePresentationsById: input.profilePresentationsById,
			targetProfileDisplayNamesByProfileId:
				input.targetProfileDisplayNamesByProfileId,
		});
	}
	if (isSelectedAgentReply(input.item)) {
		return buildOrdinaryReplyActivityItem(input.item);
	}
	const actor = actorFromItem(input.item);
	return {
		actor,
		description: input.item.text.trim() || null,
		id: `message:${input.data.message.signalId}`,
		jumpSignalId: input.item.id,
		kind: "message",
		occurredAtMs: input.data.message.sentAtMs,
		status: null,
		targetProfileId: null,
		title: actor.profileName,
	};
}

function isWakeSourceForSelectedMessage(
	data: GetSpaceMessageDetailsResponse,
	messageId: string
): boolean {
	return (
		data.wakeContext.state === "recorded" &&
		data.wakeContext.sourceSignalId.value === messageId
	);
}

function getOrCreateTargetActivity(input: {
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetLabel?: string;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	targetProfileId: string;
	targetsByProfileId: Map<string, MessageDetailsActivityItem>;
}): MessageDetailsActivityItem {
	const existing = input.targetsByProfileId.get(input.targetProfileId);
	if (existing) {
		const targetLabel = input.targetLabel?.trim();
		if (existing.actor.profileName === "Agent" && targetLabel) {
			existing.actor = { ...existing.actor, profileName: targetLabel };
			existing.title = targetLabel;
		}
		return existing;
	}
	const actor = resolveProfileActor({
		fallbackName: input.targetLabel,
		profilePresentationsById: input.profilePresentationsById,
		targetProfileDisplayNamesByProfileId:
			input.targetProfileDisplayNamesByProfileId,
		targetProfileId: input.targetProfileId,
	});
	const created: MessageDetailsActivityItem = {
		actor,
		description: "Waiting for a reply.",
		id: `target:${input.targetProfileId}`,
		jumpSignalId: null,
		kind: "target",
		occurredAtMs: null,
		status: "pending",
		targetProfileId: input.targetProfileId,
		title: actor.profileName,
	};
	input.targetsByProfileId.set(input.targetProfileId, created);
	return created;
}

function applyRecordedReply(
	target: MessageDetailsActivityItem,
	reply: SpaceTimelineItem
): void {
	target.actor = actorFromItem(reply);
	target.description = reply.text.trim() || null;
	target.jumpSignalId = reply.id;
	target.occurredAtMs = reply.createdAtMs;
	target.status = "replied";
	target.title = target.actor.profileName;
}

function applyRecordedOutcome(
	target: MessageDetailsActivityItem,
	item: SpaceTimelineItem
): void {
	target.description = item.text.trim() || null;
	target.jumpSignalId = item.id;
	target.occurredAtMs = item.createdAtMs;
	target.status = resolveOutcomeActivityStatus(item);
}

function buildOrdinaryReplyActivityItem(
	reply: SpaceTimelineItem
): MessageDetailsActivityItem {
	const actor = actorFromItem(reply);
	return {
		actor,
		description: reply.text.trim() || null,
		id: `reply:${reply.id}`,
		jumpSignalId: reply.id,
		kind: "reply",
		occurredAtMs: reply.createdAtMs,
		status: "replied",
		targetProfileId: null,
		title: actor.profileName,
	};
}

function buildStandaloneOutcomeActivityItem(input: {
	item: SpaceTimelineItem;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
}): MessageDetailsActivityItem {
	const targetProfileId = resolveOutcomeTargetProfileId(input.item);
	const actor = targetProfileId
		? resolveProfileActor({
				fallbackName:
					input.item.actorProfileKind === "agent"
						? input.item.actorName
						: undefined,
				profilePresentationsById: input.profilePresentationsById,
				targetProfileDisplayNamesByProfileId:
					input.targetProfileDisplayNamesByProfileId,
				targetProfileId,
			})
		: actorFromItem(input.item);
	return {
		actor,
		description: input.item.text.trim() || null,
		id: `outcome:${input.item.id}`,
		jumpSignalId: input.item.id,
		kind: targetProfileId ? "target" : "message",
		occurredAtMs: input.item.createdAtMs,
		status: resolveOutcomeActivityStatus(input.item),
		targetProfileId,
		title: actor.profileName,
	};
}

function buildRecoveryActivityItem(
	item: SpaceTimelineItem
): MessageDetailsActivityItem {
	const actor = actorFromItem(item);
	return {
		actor,
		description: item.text.trim() || null,
		id: `recovery:${item.id}`,
		jumpSignalId: item.id,
		kind: "recovery",
		occurredAtMs: item.createdAtMs,
		status:
			item.systemNoticeType === "execution_recovery_completed"
				? "completed"
				: "pending",
		targetProfileId: item.systemNoticeTargetProfileId ?? null,
		title:
			item.systemNoticeType === "execution_recovery_completed"
				? "Reply recovered"
				: "Reply recovery available",
	};
}

function buildWorkActivityItems(
	workingDetails: GetSpaceMessageDetailsResponse["workingDetails"],
	actor: MessageDetailsActivityActor
): MessageDetailsActivityItem[] {
	if (workingDetails?.state !== "recorded") {
		return [];
	}
	return workingDetails.tools.flatMap((tool) => {
		if (!isPresentableWorkTool(tool)) {
			return [];
		}
		const workPresentation = resolveAgentWorkPresentation(
			tool.work,
			tool.state,
			false
		);
		return [
			{
				actor,
				description: "Agent work",
				id: `work:${tool.toolName}:${tool.startedAtMs}:${tool.updatedAtMs}`,
				jumpSignalId: null,
				kind: "work" as const,
				occurredAtMs: tool.updatedAtMs,
				status: resolveWorkActivityStatus(workPresentation.status),
				targetProfileId: null,
				title: workPresentation.text,
			},
		];
	});
}

function resolveTargetActor(input: {
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	target: GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number];
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
}): MessageDetailsActivityActor {
	const recordedProfileName = resolveReadableWakeTargetName(
		input.target.agentContext?.profileName.value,
		input.target.targetProfileId
	);
	const targetLabel = resolveReadableWakeTargetName(
		input.target.targetLabel,
		input.target.targetProfileId
	);
	return resolveProfileActor({
		fallbackName: recordedProfileName ?? targetLabel ?? undefined,
		profilePresentationsById: input.profilePresentationsById,
		targetProfileDisplayNamesByProfileId:
			input.targetProfileDisplayNamesByProfileId,
		targetProfileId: input.target.targetProfileId,
	});
}

function resolveProfileActor(input: {
	fallbackName?: string;
	profilePresentationsById?: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	targetProfileDisplayNamesByProfileId?: ReadonlyMap<string, string>;
	targetProfileId: string;
}): MessageDetailsActivityActor {
	const profile = input.profilePresentationsById?.get(input.targetProfileId);
	if (profile) {
		return { ...profile };
	}
	return {
		agentControllerRef: null,
		avatarImageUrl: null,
		isCenterAgent: false,
		profileId: input.targetProfileId,
		profileKind: "agent",
		profileName:
			input.targetProfileDisplayNamesByProfileId?.get(input.targetProfileId) ??
			input.fallbackName ??
			"Agent",
	};
}

function actorFromItem(item: SpaceTimelineItem): MessageDetailsActivityActor {
	return {
		agentControllerRef: item.actorAgentControllerRef,
		avatarImageUrl: item.actorAvatarImageUrl,
		isCenterAgent: false,
		profileId: item.actorProfileId,
		profileKind: item.actorProfileKind,
		profileName:
			item.actorName.trim() || item.actorProfileName.trim() || "Unknown",
	};
}

function resolvePendingTargetDescription(
	status: Exclude<MessageDetailsStatus, null> | null
): string | null {
	switch (status) {
		case "running":
			return "Agent is working.";
		case "pending":
			return "Waiting for a reply.";
		case "missing":
			return "Agent details are unavailable.";
		default:
			return null;
	}
}

function resolveOutcomeActivityStatus(
	item: SpaceTimelineItem
): Exclude<MessageDetailsActivityItem["status"], null> {
	if (item.signalType === "signal.system_notice") {
		switch (item.systemNoticeType) {
			case "wake_stopped":
				return "stopped";
			case "stay_silent":
			case "execution_recovery_completed":
				return "completed";
			case "execution_recovery_available":
				return "pending";
			default:
				return "failed";
		}
	}
	if (item.signalType === "signal.status") {
		switch (item.spaceStatus) {
			case "working":
				return "running";
			case "done":
				return "completed";
			case "blocked":
				return "failed";
			default:
				return "pending";
		}
	}
	return "replied";
}

function resolveOutcomeTargetProfileId(item: SpaceTimelineItem): string | null {
	if (item.systemNoticeTargetProfileId) {
		return item.systemNoticeTargetProfileId;
	}
	if (item.actorProfileKind === "agent") {
		return item.actorProfileId;
	}
	return null;
}

function isRecordedOutcomeItem(item: SpaceTimelineItem): boolean {
	return (
		item.signalType === "signal.system_notice" ||
		item.signalType === "signal.status"
	);
}

function isTerminalActivityStatus(
	status: MessageDetailsActivityItem["status"]
): boolean {
	return status === "replied" || status === "failed" || status === "stopped";
}

function compareActivityOrder(
	left: MessageDetailsActivityItem,
	right: MessageDetailsActivityItem
): number {
	if (left.occurredAtMs === null) {
		return right.occurredAtMs === null ? 0 : 1;
	}
	if (right.occurredAtMs === null) {
		return -1;
	}
	return left.occurredAtMs - right.occurredAtMs;
}

function resolveReadableWakeTargetName(
	candidate: string | null | undefined,
	targetProfileId: string
): string | null {
	const value = candidate?.trim();
	if (
		!value ||
		value === targetProfileId ||
		OPAQUE_AGENT_PROFILE_ID_PATTERN.test(value)
	) {
		return null;
	}
	return value;
}

function resolveWorkActivityStatus(
	status: "active" | "complete" | "failed"
): "completed" | "failed" | "started" {
	switch (status) {
		case "active":
			return "started";
		case "complete":
			return "completed";
		case "failed":
			return "failed";
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}

function readLatestObservedAtMs(
	steps: readonly NonNullable<
		GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number]["steps"]
	>[number][]
): number | null {
	let latest: number | null = null;
	for (const step of steps) {
		if (!step.observedAt) {
			continue;
		}
		const observedAtMs = Date.parse(step.observedAt);
		if (Number.isNaN(observedAtMs)) {
			continue;
		}
		latest = latest === null ? observedAtMs : Math.max(latest, observedAtMs);
	}
	return latest;
}

function isPresentableWorkTool(
	tool: SpaceMessageDetailsToolActivity
): tool is SpaceMessageDetailsToolActivity & {
	work: NonNullable<SpaceMessageDetailsToolActivity["work"]>;
} {
	if (!tool.work) {
		return false;
	}
	return isAgentWorkActivityPresentable(tool.work);
}

function resolveMessageDetailsStatus(input: {
	item: SpaceTimelineItem;
	wakeContext: GetSpaceMessageDetailsResponse["wakeContext"];
}): MessageDetailsStatus {
	if (isSpaceOutcomeNoticeItem(input.item)) {
		return input.item.systemNoticeType === "wake_stopped"
			? "stopped"
			: "failed";
	}
	if (
		input.wakeContext.state === "recorded" &&
		input.wakeContext.targets.length === 1
	) {
		return input.wakeContext.targets[0]?.status ?? null;
	}
	return null;
}

function isTerminalFailureNoticeItem(item: SpaceTimelineItem): boolean {
	return (
		item.signalType === "signal.system_notice" &&
		item.systemNoticeType === "terminal_failure"
	);
}

function isRecoveryNoticeItem(item: SpaceTimelineItem): boolean {
	return (
		item.signalType === "signal.system_notice" &&
		(item.systemNoticeType === "execution_recovery_available" ||
			item.systemNoticeType === "execution_recovery_completed")
	);
}

function isRecordedReplyItem(item: SpaceTimelineItem): boolean {
	return (
		item.signalType === "signal.text" &&
		item.deliveryState === "sent" &&
		item.agentStreamState === undefined &&
		item.activeWakeProgress === undefined &&
		item.transientActivityPurpose === null
	);
}

function isSelectedAgentReply(item: SpaceTimelineItem): boolean {
	return (
		item.actorProfileKind === "agent" &&
		item.replyToSignalId !== null &&
		isRecordedReplyItem(item)
	);
}
