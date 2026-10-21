import {
	WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
	WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE,
} from "@openmeld/schemas";
import type {
	PostSpaceWakeStopBody,
	PostSpaceWakeStopResponse,
	WakeProgressItem,
	WakeStopEligibilityReadModel,
} from "@openmeld/schemas/types";
import {
	isActiveWakeProgressItem,
	isWakeClosingSystemNoticeType,
} from "@openmeld/space";
import type { SpaceTimelineItem } from "./timeline";

export type SpaceWakeStopSelector = PostSpaceWakeStopBody["target"];

export type SpaceWakeStopUiStatus =
	| "active"
	| "stopping"
	| "stopped"
	| "unavailable"
	| "unsupported"
	| "not_stoppable"
	| "retry_later";

export type SpaceWakeStopRequestStatus =
	| PostSpaceWakeStopResponse["status"]
	| "delivery_unknown";

export type SpaceWakeStopTargetResolution = {
	isWaitingToStart?: boolean;
	canStop: boolean;
	clientMessageId: string | null;
	selector: SpaceWakeStopSelector | null;
	selectorKey: string | null;
	sourceSignalId: string | null;
	status: SpaceWakeStopUiStatus;
	targetLabel: string | null;
	targetProfileId: string | null;
};

type ResolveSpaceMessageWakeStopTargetInput = {
	item: SpaceTimelineItem;
	viewerProfileId?: string;
	stopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	timelineItems?: readonly SpaceTimelineItem[];
	wakeOutcomeIndex?: SpaceWakeOutcomeIndex;
	wakeProgressItems: readonly WakeProgressItem[];
};

type SpaceWakeOutcomeRecord = {
	createdAtMs: number;
	itemId: string;
};

type SpaceWakeOutcomeMentionIndexNode = {
	children: Map<string, SpaceWakeOutcomeMentionIndexNode>;
	latestRecords: SpaceWakeOutcomeRecord[];
};

type SpaceWakeOutcomeLookup = {
	outcomeTargetsByDispatchId: ReadonlyMap<string, ReadonlySet<string>>;
	dispatchIdByOutcomeItemId: ReadonlyMap<string, string>;
	directOutcomeItemIdsBySourceSignalId: ReadonlyMap<
		string,
		ReadonlyMap<string, ReadonlySet<string>>
	>;
	finalNoticeMentionIndex: SpaceWakeOutcomeMentionIndexNode;
	latestFinalNoticeRecordsByTargetProfileId: ReadonlyMap<
		string,
		readonly SpaceWakeOutcomeRecord[]
	>;
};

export type SpaceWakeOutcomeIndex = {
	hasVisibleOutcomeForSourceTarget: (input: {
		dispatchId?: string | null;
		sourceItem: SpaceTimelineItem;
		targetProfileId: string;
	}) => boolean;
};

const WHITESPACE_CHARACTER_PATTERN = /\s/u;
const WHITESPACE_SEQUENCE_PATTERN = /\s+/gu;

export function buildSpaceWakeOutcomeIndex(
	timelineItems: readonly SpaceTimelineItem[]
): SpaceWakeOutcomeIndex {
	const directOutcomeItemIdsBySourceSignalId = new Map<
		string,
		Map<string, Set<string>>
	>();
	const dispatchIdByOutcomeItemId = new Map<string, string>();
	const outcomeTargetsByDispatchId = new Map<string, Set<string>>();
	const finalNoticeMentionIndex = createSpaceWakeOutcomeMentionIndexNode();
	const latestFinalNoticeRecordsByTargetProfileId = new Map<
		string,
		SpaceWakeOutcomeRecord[]
	>();

	for (const item of timelineItems) {
		if (
			item.activeWakeProgress ||
			item.agentStreamState?.status === "streaming"
		) {
			continue;
		}
		indexWakeOutcomeExecution(
			item,
			outcomeTargetsByDispatchId,
			dispatchIdByOutcomeItemId
		);
		if (
			item.replyToSignalId &&
			(item.isAgentFinalReply || item.wakeDispatchId) &&
			item.actorProfileKind === "agent" &&
			item.actorProfileId
		) {
			addDirectWakeOutcome({
				index: directOutcomeItemIdsBySourceSignalId,
				itemId: item.id,
				sourceSignalId: item.replyToSignalId,
				targetProfileId: item.actorProfileId,
			});
		}

		if (!isWakeClosingSystemNoticeType(item.systemNoticeType)) {
			continue;
		}

		const record = {
			createdAtMs: item.createdAtMs,
			itemId: item.id,
		};
		if (item.systemNoticeTargetProfileId) {
			if (item.replyToSignalId) {
				addDirectWakeOutcome({
					index: directOutcomeItemIdsBySourceSignalId,
					itemId: item.id,
					sourceSignalId: item.replyToSignalId,
					targetProfileId: item.systemNoticeTargetProfileId,
				});
			}
			addLatestWakeOutcomeRecord({
				index: latestFinalNoticeRecordsByTargetProfileId,
				key: item.systemNoticeTargetProfileId,
				record,
			});
		}
		indexFinalNoticeMentionCandidates({
			index: finalNoticeMentionIndex,
			noticeText: item.text,
			record,
		});
	}

	const wakeOutcomeLookup: SpaceWakeOutcomeLookup = {
		outcomeTargetsByDispatchId,
		dispatchIdByOutcomeItemId,
		directOutcomeItemIdsBySourceSignalId,
		finalNoticeMentionIndex,
		latestFinalNoticeRecordsByTargetProfileId,
	};
	return {
		hasVisibleOutcomeForSourceTarget: (input) =>
			hasVisibleWakeOutcomeForSourceTarget({
				...input,
				wakeOutcomeLookup,
			}),
	};
}

function indexWakeOutcomeExecution(
	item: SpaceTimelineItem,
	targetsByDispatch: Map<string, Set<string>>,
	dispatchByItem: Map<string, string>
) {
	const dispatchId = item.wakeDispatchId ?? item.systemNoticeDispatchId;
	const targetProfileId =
		item.systemNoticeTargetProfileId ?? item.actorProfileId;
	if (
		!(
			dispatchId &&
			targetProfileId &&
			(item.isAgentFinalReply ||
				item.wakeDispatchId ||
				isWakeClosingSystemNoticeType(item.systemNoticeType))
		)
	) {
		return;
	}
	const targets = targetsByDispatch.get(dispatchId) ?? new Set<string>();
	targets.add(targetProfileId);
	targetsByDispatch.set(dispatchId, targets);
	dispatchByItem.set(item.id, dispatchId);
}

export function resolveSpaceMessageWakeStopTarget(
	input: ResolveSpaceMessageWakeStopTargetInput
): SpaceWakeStopTargetResolution {
	return (
		resolveSpaceMessageWakeStopTargets(input)[0] ??
		createUnavailableWakeStopTarget("not_stoppable")
	);
}

export function resolveSpaceMessageWakeStopTargets(
	input: ResolveSpaceMessageWakeStopTargetInput
): readonly SpaceWakeStopTargetResolution[] {
	const targetProfileIds = resolveSpaceMessageWakeTargetProfileIds({
		sourceItem: input.item,
		wakeProgressItems: input.wakeProgressItems,
	});
	if (input.item.deliveryState === "failed" || targetProfileIds.length === 0) {
		return [];
	}
	if (input.item.deliveryState === "pending") {
		if (input.viewerProfileId !== input.item.actorProfileId) {
			return [];
		}
		const clientMessageId =
			input.item.wakeClientMessageId ?? input.item.clientMessageId;
		if (!clientMessageId) {
			return [];
		}
		return targetProfileIds.map((targetProfileId) => {
			const selector: SpaceWakeStopSelector = {
				by: "client_message",
				clientMessageId,
				targetProfileId,
			};
			const selectorKey = buildSpaceWakeStopSelectorKey(selector);
			const requestStatus =
				input.stopRequestStatusBySelectorKey?.get(selectorKey);
			const status = resolveRequestedStopUiStatus(requestStatus) ?? "active";
			return {
				canStop: status === "active" || status === "retry_later",
				clientMessageId,
				selector,
				selectorKey,
				sourceSignalId: null,
				status,
				targetLabel: null,
				targetProfileId,
			};
		});
	}
	const targetProfileIdSet = new Set(targetProfileIds);
	const wakeOutcomeIndex =
		input.wakeOutcomeIndex ??
		buildSpaceWakeOutcomeIndex(input.timelineItems ?? []);

	const matchingItems = input.wakeProgressItems.filter((item) =>
		matchesSpaceMessageWakeProgressItem({
			item,
			sourceItem: input.item,
			targetProfileIds: targetProfileIdSet,
		})
	);
	const activeTargets = resolveWakeStopTargetsForProgressItems({
		items: matchingItems,
		predicate: (item) =>
			isActiveWakeProgressItem(item) &&
			!wakeOutcomeIndex.hasVisibleOutcomeForSourceTarget({
				sourceItem: input.item,
				targetProfileId: item.targetProfileId,
				dispatchId: item.dispatchId,
			}),
		sourceItem: input.item,
		stopRequestStatusBySelectorKey: input.stopRequestStatusBySelectorKey,
		targetProfileIds,
		viewerProfileId: input.viewerProfileId,
	});
	if (activeTargets.length > 0) {
		return activeTargets;
	}

	const stoppedTargets = resolveWakeStopTargetsForProgressItems({
		items: matchingItems,
		predicate: (item) => item.phase === "stopped",
		sourceItem: input.item,
		statusOverride: "stopped",
		stopRequestStatusBySelectorKey: input.stopRequestStatusBySelectorKey,
		targetProfileIds,
	});
	if (stoppedTargets.length > 0) {
		return stoppedTargets;
	}

	const terminalTargets = resolveWakeStopTargetsForProgressItems({
		items: matchingItems,
		predicate: (item) => item.terminal,
		sourceItem: input.item,
		statusOverride: "not_stoppable",
		stopRequestStatusBySelectorKey: input.stopRequestStatusBySelectorKey,
		targetProfileIds,
	});
	if (terminalTargets.length > 0) {
		return terminalTargets;
	}

	// Retain an existing command receipt after a projection refresh. Historical
	// source messages alone must never invent a currently running execution.
	if (
		input.viewerProfileId &&
		input.item.actorProfileId === input.viewerProfileId &&
		matchingItems.length === 0
	) {
		const clientMessageId =
			input.item.wakeClientMessageId ?? input.item.clientMessageId;
		if (clientMessageId) {
			return targetProfileIds
				.filter(
					(targetProfileId) =>
						input.stopRequestStatusBySelectorKey?.has(
							`client_message:${clientMessageId}:${targetProfileId}`
						) &&
						!wakeOutcomeIndex.hasVisibleOutcomeForSourceTarget({
							sourceItem: input.item,
							targetProfileId,
						})
				)
				.map((targetProfileId) => {
					const selector: SpaceWakeStopSelector = {
						by: "client_message",
						clientMessageId,
						targetProfileId,
					};
					const selectorKey = buildSpaceWakeStopSelectorKey(selector);
					const status =
						resolveRequestedStopUiStatus(
							input.stopRequestStatusBySelectorKey?.get(selectorKey)
						) ?? "active";
					return {
						canStop: status === "active" || status === "retry_later",
						clientMessageId,
						selector,
						selectorKey,
						sourceSignalId: null,
						status,
						targetLabel: null,
						targetProfileId,
					};
				});
		}
	}
	return [];
}

export function resolveSpaceMessageWakeTargetProfileIds(input: {
	sourceItem: SpaceTimelineItem;
	wakeProgressItems: readonly WakeProgressItem[];
}): readonly string[] {
	const explicitTargetProfileIds = resolveOrderedWakeTargetProfileIds(
		input.sourceItem
	);
	if (explicitTargetProfileIds.length > 0) {
		return explicitTargetProfileIds;
	}

	const targetProfileIds: string[] = [];
	const seen = new Set<string>();
	for (const item of input.wakeProgressItems) {
		if (
			!matchesSpaceMessageWakeProgressSource({
				item,
				sourceItem: input.sourceItem,
			})
		) {
			continue;
		}
		const normalized = item.targetProfileId.trim();
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		targetProfileIds.push(normalized);
	}
	return targetProfileIds;
}

export function matchesSpaceMessageWakeProgressItem(input: {
	item: WakeProgressItem;
	sourceItem: SpaceTimelineItem;
	targetProfileIds: ReadonlySet<string>;
}): boolean {
	if (!input.targetProfileIds.has(input.item.targetProfileId)) {
		return false;
	}
	return matchesSpaceMessageWakeProgressSource({
		item: input.item,
		sourceItem: input.sourceItem,
	});
}

function matchesSpaceMessageWakeProgressSource(input: {
	item: WakeProgressItem;
	sourceItem: SpaceTimelineItem;
}): boolean {
	const sourceSignalId = resolveSpaceMessageWakeSourceSignalId(
		input.sourceItem
	);
	if (input.item.sourceSignalId === sourceSignalId) {
		return true;
	}
	if (input.sourceItem.wakeClientMessageId === null) {
		return false;
	}
	return input.item.clientMessageId === input.sourceItem.wakeClientMessageId;
}

export function resolveSpaceMessageWakeSourceSignalId(
	item: SpaceTimelineItem
): string {
	return item.wakeSourceSignalId ?? item.id;
}

function resolveOrderedWakeTargetProfileIds(
	item: SpaceTimelineItem
): readonly string[] {
	const targetProfileIds: string[] = [];
	const seen = new Set<string>();
	for (const targetProfileId of item.wakeTargetProfileIds) {
		const normalized = targetProfileId.trim();
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		targetProfileIds.push(normalized);
	}
	return targetProfileIds;
}

export function buildSpaceWakeStopSelectorKey(
	selector: SpaceWakeStopSelector
): string {
	if (selector.dispatchId) {
		return `dispatch:${selector.dispatchId}:${selector.targetProfileId}`;
	}
	if (selector.by === "source_signal") {
		return `source_signal:${selector.sourceSignalId}:${selector.targetProfileId}`;
	}
	return `client_message:${selector.clientMessageId}:${selector.targetProfileId}`;
}

function resolveWakeStopTargetsForProgressItems(input: {
	items: readonly WakeProgressItem[];
	predicate: (item: WakeProgressItem) => boolean;
	sourceItem: SpaceTimelineItem;
	statusOverride?: SpaceWakeStopUiStatus;
	stopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	targetProfileIds: readonly string[];
	viewerProfileId?: string;
}): readonly SpaceWakeStopTargetResolution[] {
	const targets: SpaceWakeStopTargetResolution[] = [];
	for (const targetProfileId of input.targetProfileIds) {
		const item = input.items.find(
			(candidate) =>
				candidate.targetProfileId === targetProfileId &&
				input.predicate(candidate)
		);
		if (!item) {
			continue;
		}
		const target = resolveWakeStopTargetForProgressItem({
			item,
			viewerProfileId: input.viewerProfileId,
			sourceItem: input.sourceItem,
			statusOverride: input.statusOverride,
			stopRequestStatusBySelectorKey: input.stopRequestStatusBySelectorKey,
		});
		if (target.selector) {
			targets.push(target);
		}
	}
	return targets;
}

export function resolveWakeStopTargetForProgressItem(input: {
	item: WakeProgressItem;
	viewerProfileId?: string;
	sourceItem?: SpaceTimelineItem;
	statusOverride?: SpaceWakeStopUiStatus;
	stopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
}): SpaceWakeStopTargetResolution {
	const selector = resolveWakeStopSelector({
		item: input.item,
		sourceItem: input.sourceItem,
	});
	if (!selector) {
		return createUnavailableWakeStopTarget("not_stoppable");
	}

	const selectorKey = buildSpaceWakeStopSelectorKey(selector);
	const requestStatus =
		input.stopRequestStatusBySelectorKey?.get(selectorKey) ?? null;
	const status =
		input.statusOverride ??
		resolveWakeStopUiStatus({
			item: input.item,
			requestStatus,
		});
	const requiresControlBackedEligibility =
		status === "active" || status === "retry_later";
	const wakeStopEligibility = Object.hasOwn(input.item, "wakeStopEligibility")
		? (input.item.wakeStopEligibility ?? null)
		: undefined;
	const hasControlBackedEligibility =
		isWakeStopEligible(wakeStopEligibility) ||
		(wakeStopEligibility == null &&
			input.sourceItem?.actorProfileId === input.viewerProfileId &&
			input.viewerProfileId !== undefined &&
			!input.item.terminal);
	const canStop =
		requiresControlBackedEligibility && hasControlBackedEligibility;
	const resolvedStatus = resolveControlBackedWakeStopUiStatus({
		hasControlBackedEligibility,
		requiresControlBackedEligibility,
		status,
		wakeStopEligibility,
	});

	return {
		canStop,
		isWaitingToStart: Boolean(
			(input.item.deviceWait &&
				(input.item.phase === "request_sent" ||
					input.item.phase === "queued")) ||
				(input.item.phase === "connecting" &&
					(input.item.waitReasonCode ===
						WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE ||
						input.item.waitReasonCode ===
							WAKE_PROGRESS_LOCAL_FOLDER_CONFLICT_REASON_CODE))
		),
		clientMessageId:
			input.item.clientMessageId ??
			input.sourceItem?.wakeClientMessageId ??
			null,
		selector,
		selectorKey,
		sourceSignalId:
			selector.by === "source_signal" ? selector.sourceSignalId : null,
		status: resolvedStatus,
		targetLabel: input.item.targetLabel,
		targetProfileId: input.item.targetProfileId,
	};
}

function hasVisibleWakeOutcomeForSourceTarget(input: {
	dispatchId?: string | null;
	sourceItem: SpaceTimelineItem;
	targetProfileId: string;
	wakeOutcomeLookup: SpaceWakeOutcomeLookup;
}): boolean {
	if (
		input.dispatchId &&
		input.wakeOutcomeLookup.outcomeTargetsByDispatchId
			.get(input.dispatchId)
			?.has(input.targetProfileId)
	) {
		return true;
	}
	const sourceSignalIds = [
		input.sourceItem.id,
		input.sourceItem.wakeSourceSignalId,
	].filter((value): value is string => Boolean(value?.trim()));
	for (const sourceSignalId of sourceSignalIds) {
		const directOutcomeItemIds =
			input.wakeOutcomeLookup.directOutcomeItemIdsBySourceSignalId
				.get(sourceSignalId)
				?.get(input.targetProfileId);
		if (
			directOutcomeItemIds &&
			[...directOutcomeItemIds].some(
				(itemId) =>
					itemId !== input.sourceItem.id &&
					(!(
						input.dispatchId &&
						input.wakeOutcomeLookup.dispatchIdByOutcomeItemId.has(itemId)
					) ||
						input.wakeOutcomeLookup.dispatchIdByOutcomeItemId.get(itemId) ===
							input.dispatchId)
			)
		) {
			return true;
		}
	}
	// A source-level mention or a later notice cannot close an identified
	// execution. In particular, an old execution's outcome cannot hide a retry.
	if (input.dispatchId) {
		return false;
	}

	if (
		hasLaterWakeOutcomeRecord({
			records:
				input.wakeOutcomeLookup.latestFinalNoticeRecordsByTargetProfileId.get(
					input.targetProfileId
				) ?? [],
			sourceItem: input.sourceItem,
		})
	) {
		return true;
	}

	if (resolveOrderedWakeTargetProfileIds(input.sourceItem).length !== 1) {
		return false;
	}
	const sourceMentionText = extractLeadingMentionText(input.sourceItem.text);
	if (!sourceMentionText) {
		return false;
	}
	for (const candidate of getLeadingMentionCandidates(sourceMentionText)) {
		const records = readWakeOutcomeMentionRecords({
			candidate,
			index: input.wakeOutcomeLookup.finalNoticeMentionIndex,
		});
		if (hasLaterWakeOutcomeRecord({ records, sourceItem: input.sourceItem })) {
			return true;
		}
	}
	return false;
}

export function resolveVisibleWakeOutcomeTargetProfileIds(input: {
	sourceItem: SpaceTimelineItem;
	targetProfileIds: Iterable<string>;
	timelineItems: readonly SpaceTimelineItem[];
	wakeOutcomeIndex?: SpaceWakeOutcomeIndex;
}): ReadonlySet<string> {
	const wakeOutcomeIndex =
		input.wakeOutcomeIndex ?? buildSpaceWakeOutcomeIndex(input.timelineItems);
	const targetProfileIds = new Set<string>();
	for (const targetProfileId of input.targetProfileIds) {
		if (
			wakeOutcomeIndex.hasVisibleOutcomeForSourceTarget({
				sourceItem: input.sourceItem,
				targetProfileId,
			})
		) {
			targetProfileIds.add(targetProfileId);
		}
	}
	return targetProfileIds;
}

function createSpaceWakeOutcomeMentionIndexNode(): SpaceWakeOutcomeMentionIndexNode {
	return {
		children: new Map(),
		latestRecords: [],
	};
}

function addDirectWakeOutcome(input: {
	index: Map<string, Map<string, Set<string>>>;
	itemId: string;
	sourceSignalId: string;
	targetProfileId: string;
}): void {
	let outcomeItemIdsByTargetProfileId = input.index.get(input.sourceSignalId);
	if (!outcomeItemIdsByTargetProfileId) {
		outcomeItemIdsByTargetProfileId = new Map();
		input.index.set(input.sourceSignalId, outcomeItemIdsByTargetProfileId);
	}
	let outcomeItemIds = outcomeItemIdsByTargetProfileId.get(
		input.targetProfileId
	);
	if (!outcomeItemIds) {
		outcomeItemIds = new Set();
		outcomeItemIdsByTargetProfileId.set(input.targetProfileId, outcomeItemIds);
	}
	outcomeItemIds.add(input.itemId);
}

function addLatestWakeOutcomeRecord(input: {
	index: Map<string, SpaceWakeOutcomeRecord[]>;
	key: string;
	record: SpaceWakeOutcomeRecord;
}): void {
	let records = input.index.get(input.key);
	if (!records) {
		records = [];
		input.index.set(input.key, records);
	}
	upsertLatestWakeOutcomeRecord(records, input.record);
}

function upsertLatestWakeOutcomeRecord(
	records: SpaceWakeOutcomeRecord[],
	record: SpaceWakeOutcomeRecord
): void {
	const existingRecordIndex = records.findIndex(
		(candidate) => candidate.itemId === record.itemId
	);
	if (existingRecordIndex >= 0) {
		records.splice(existingRecordIndex, 1);
	}
	records.push(record);
	records.sort((left, right) => right.createdAtMs - left.createdAtMs);
	if (records.length > 2) {
		records.length = 2;
	}
}

function indexFinalNoticeMentionCandidates(input: {
	index: SpaceWakeOutcomeMentionIndexNode;
	noticeText: string;
	record: SpaceWakeOutcomeRecord;
}): void {
	// Preserve the legacy "stopped for <leading mention>" inference without
	// scanning every final notice again for every source message.
	const normalizedNoticeText = normalizeWakeStopText(input.noticeText);
	let matchIndex = normalizedNoticeText.indexOf("for ");
	while (matchIndex >= 0) {
		let node = input.index;
		for (const character of normalizedNoticeText.slice(matchIndex + 4)) {
			let child = node.children.get(character);
			if (!child) {
				child = createSpaceWakeOutcomeMentionIndexNode();
				node.children.set(character, child);
			}
			node = child;
			upsertLatestWakeOutcomeRecord(node.latestRecords, input.record);
		}
		matchIndex = normalizedNoticeText.indexOf("for ", matchIndex + 1);
	}
}

function readWakeOutcomeMentionRecords(input: {
	candidate: string;
	index: SpaceWakeOutcomeMentionIndexNode;
}): readonly SpaceWakeOutcomeRecord[] {
	let node = input.index;
	for (const character of input.candidate) {
		const child = node.children.get(character);
		if (!child) {
			return [];
		}
		node = child;
	}
	return node.latestRecords;
}

function hasLaterWakeOutcomeRecord(input: {
	records: readonly SpaceWakeOutcomeRecord[];
	sourceItem: SpaceTimelineItem;
}): boolean {
	return input.records.some(
		(record) =>
			record.itemId !== input.sourceItem.id &&
			record.createdAtMs >= input.sourceItem.createdAtMs
	);
}

function extractLeadingMentionText(sourceText: string): string | null {
	const trimmedSourceText = sourceText.trim();
	if (!trimmedSourceText.startsWith("@")) {
		return null;
	}
	const mentionText = normalizeWakeStopText(trimmedSourceText.slice(1));
	return mentionText.length > 0 ? mentionText : null;
}

function getLeadingMentionCandidates(mentionText: string): string[] {
	const candidates: string[] = [];
	for (let index = mentionText.length; index >= 0; index -= 1) {
		const boundaryChar = mentionText[index] ?? " ";
		if (!WHITESPACE_CHARACTER_PATTERN.test(boundaryChar)) {
			continue;
		}
		const candidate = mentionText.slice(0, index).trim();
		if (candidate.length >= 3) {
			candidates.push(candidate);
		}
	}
	return candidates;
}

function normalizeWakeStopText(text: string): string {
	return text.replace(WHITESPACE_SEQUENCE_PATTERN, " ").trim();
}

function resolveWakeStopSelector(input: {
	item: WakeProgressItem;
	sourceItem?: SpaceTimelineItem;
}): SpaceWakeStopSelector | null {
	const clientMessageId =
		input.item.clientMessageId ??
		input.sourceItem?.wakeClientMessageId ??
		input.sourceItem?.clientMessageId;
	if (clientMessageId) {
		return {
			by: "client_message",
			clientMessageId,
			targetProfileId: input.item.targetProfileId,
			...(input.item.dispatchId ? { dispatchId: input.item.dispatchId } : {}),
		};
	}
	const sourceSignalId =
		input.item.sourceSignalId ??
		input.sourceItem?.wakeSourceSignalId ??
		(input.sourceItem?.deliveryState === "sent"
			? input.sourceItem.id
			: undefined) ??
		"";
	if (sourceSignalId.trim().length > 0) {
		return {
			by: "source_signal",
			sourceSignalId,
			targetProfileId: input.item.targetProfileId,
			...(input.item.dispatchId ? { dispatchId: input.item.dispatchId } : {}),
		};
	}

	return null;
}

export function resolveRequestedStopUiStatus(
	status: SpaceWakeStopRequestStatus | undefined | null
): SpaceWakeStopUiStatus | null {
	switch (status) {
		case "cancelled":
		case "already_cancelled":
			return "stopped";
		case "cancellation_requested":
			return "stopping";
		case "delivery_unknown":
		case "retry_later":
			return "retry_later";
		case "unsupported":
			return "unsupported";
		case "not_found":
		case "not_stoppable":
			return "not_stoppable";
		default:
			return null;
	}
}

function resolveWakeStopUiStatus(input: {
	item: WakeProgressItem;
	requestStatus: SpaceWakeStopRequestStatus | null;
}): SpaceWakeStopUiStatus {
	if (input.item.phase === "stopped") {
		return "stopped";
	}
	if (input.item.terminal) {
		return "not_stoppable";
	}
	const requestStatus = resolveRequestedStopUiStatus(input.requestStatus);
	if (requestStatus) {
		return requestStatus;
	}
	if (isActiveWakeProgressItem(input.item)) {
		return "active";
	}
	return "not_stoppable";
}

function isWakeStopEligible(
	eligibility: WakeStopEligibilityReadModel | null | undefined
): boolean {
	return eligibility?.status === "eligible";
}

function resolveControlBackedWakeStopUiStatus(input: {
	hasControlBackedEligibility: boolean;
	requiresControlBackedEligibility: boolean;
	status: SpaceWakeStopUiStatus;
	wakeStopEligibility: WakeStopEligibilityReadModel | null | undefined;
}): SpaceWakeStopUiStatus {
	if (!input.requiresControlBackedEligibility) {
		return input.status;
	}
	if (input.wakeStopEligibility == null && !input.hasControlBackedEligibility) {
		return "not_stoppable";
	}
	if (!input.hasControlBackedEligibility) {
		return "unsupported";
	}
	return input.status;
}

function createUnavailableWakeStopTarget(
	status: Extract<SpaceWakeStopUiStatus, "not_stoppable" | "unsupported">
): SpaceWakeStopTargetResolution {
	return {
		canStop: false,
		clientMessageId: null,
		selector: null,
		selectorKey: null,
		sourceSignalId: null,
		status,
		targetLabel: null,
		targetProfileId: null,
	};
}
