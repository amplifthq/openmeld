import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type {
	CreateSpaceDiagnosticReportResponse,
	GetSpaceStatusResponse,
	ListSpaceThreadSignalsResponse,
	ListSpaceThreadsResponse,
	SignalEnvelope,
	SpaceDiagnosticReportProblemType,
	SpaceMembersSnapshot,
	SpaceThreadContext,
	SpaceThreadPreview,
	SpaceThreadSignalPlacement,
	WakeProgressItem,
	WakeProgressPhase,
} from "@openmeld/schemas/types";
import {
	clearWakeProgressItemsForSignal,
	createWakeProgressItem,
	filterVisibleWakeProgressItems,
	isAgentDirectConversationSpace,
	isSpaceComposerSubmissionError,
	isWakeProgressSourceSignalRecoverable,
	mergeWakeProgressItems,
} from "@openmeld/space";
import type { useQueryClient } from "@tanstack/react-query";
import { isSessionExpiredError } from "#/lib/session-expired";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { SPACE_WAKE_PROGRESS_TIMEOUT_MS } from "#/lib/spaces/request-timeouts";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { spaceQueryKeys } from "#/query/spaces/status";
import { SPACE_MEMBERS_LOAD_ERROR_MESSAGE } from "./space-members-error-copy";

const LAST_WAKE_DIAGNOSTIC_STORAGE_KEY = "openmeld.space.last-wake-diagnostic";
const LAST_DIAGNOSTIC_REPORT_STORAGE_KEY =
	"openmeld.space.last-diagnostic-report";

export const resolveQueryError = <TError>(input: {
	error: TError | null | undefined;
	isError: boolean;
}): TError | null => {
	if (!input.isError) {
		return null;
	}
	return input.error ?? null;
};

export const resolveSpaceMembersLoadErrorMessage = (
	membersError: unknown
): string | null => {
	return membersError ? SPACE_MEMBERS_LOAD_ERROR_MESSAGE : null;
};

export function resolveBlockedWakeProfileIdFromSubmissionError(
	error: unknown
): string | null {
	if (
		isSpaceComposerSubmissionError(error) &&
		error.code === "addressing.wake_blocked"
	) {
		return error.targetProfileId;
	}

	return null;
}

export function buildLocalWakeProgressItems(input: {
	activationTargets: readonly string[];
	clientMessageId: string;
	membersSnapshot: SpaceMembersSnapshot | null;
	phase: Extract<WakeProgressPhase, "request_sent" | "sending">;
	sourceSignal?: SignalEnvelope;
	updatedAtMs: number;
}): WakeProgressItem[] {
	const sourceSignalId =
		input.sourceSignal?.type === "signal.text" ? input.sourceSignal.id : null;
	return input.activationTargets.map((targetProfileId) =>
		createWakeProgressItem({
			clientMessageId: input.clientMessageId,
			dispatchId: null,
			phase: input.phase,
			sourceSignalId,
			targetLabel: resolveWakeProgressTargetLabel({
				membersSnapshot: input.membersSnapshot,
				targetProfileId,
			}),
			targetProfileId,
			updatedAtMs: input.updatedAtMs,
		})
	);
}

export function resolveComposerWakeProgressTargetProfileIds(input: {
	explicitActivationTargets: readonly string[];
	membersSnapshot: SpaceMembersSnapshot | null;
	senderProfileId: string;
	status: GetSpaceStatusResponse | null;
}): string[] {
	const explicitTargets = uniqueNonEmptyStrings(
		input.explicitActivationTargets
	);
	if (explicitTargets.length > 0) {
		return explicitTargets;
	}
	if (!input.status) {
		return [];
	}
	if (
		!isAgentDirectConversationSpace({
			activeMemberCount: input.status.members.totalCount,
			agentMemberCount: input.status.members.agentCount,
			humanMemberCount: input.status.members.humanCount,
			purpose: input.status.spacePurpose,
		})
	) {
		return [];
	}
	const activeHuman = input.membersSnapshot?.humans.find(
		(member) =>
			member.status === "active" && member.profileId === input.senderProfileId
	);
	if (!activeHuman) {
		return [];
	}
	const activeAgents =
		input.membersSnapshot?.agents.filter(
			(member) => member.status === "active"
		) ?? [];
	return activeAgents.length === 1 ? [activeAgents[0].profileId] : [];
}

export function createClientMessageId(): string {
	if (!globalThis.crypto?.randomUUID) {
		throw new Error("Browser crypto.randomUUID is required to send messages.");
	}
	return globalThis.crypto.randomUUID();
}

export function recordWakeDiagnosticIfNeeded(input: {
	clientMessageId: string;
	sourceSignalId: string;
	spaceId: string;
	targetProfileIds: readonly string[];
	threadId?: string;
}): void {
	if (input.targetProfileIds.length === 0 || typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			LAST_WAKE_DIAGNOSTIC_STORAGE_KEY,
			JSON.stringify({
				clientMessageId: input.clientMessageId,
				sourceSignalId: input.sourceSignalId,
				spaceId: input.spaceId,
				targetProfileIds: input.targetProfileIds,
				...(input.threadId ? { threadId: input.threadId } : {}),
				recordedAt: new Date().toISOString(),
			})
		);
	} catch (error) {
		console.warn("[openmeld.web.space.wake_diagnostic_record_failed]", {
			error: error instanceof Error ? error.message : String(error),
			sourceSignalId: input.sourceSignalId,
			spaceId: input.spaceId,
		});
	}
}

export function recordDiagnosticReportPointer(
	report: CreateSpaceDiagnosticReportResponse
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			LAST_DIAGNOSTIC_REPORT_STORAGE_KEY,
			JSON.stringify({
				createdAtMs: report.createdAtMs,
				diagnosticReportId: report.diagnosticReportId,
				reportedSignalId: report.reportedSignalId,
				replyToSignalId: report.replyToSignalId,
				spaceId: report.spaceId,
				threadId: report.threadId,
				wakePointers: report.wakePointers,
				wakePointerDerivation: report.wakePointerDerivation,
			})
		);
	} catch (error) {
		console.warn("[openmeld.web.space.diagnostic_report_record_failed]", {
			diagnosticReportId: report.diagnosticReportId,
			error: error instanceof Error ? error.message : String(error),
			spaceId: report.spaceId,
		});
	}
}

export function resolveDiagnosticReportProblemType(
	item: SpaceTimelineItem
): SpaceDiagnosticReportProblemType {
	return item.actorProfileKind === "agent"
		? "reply_problem"
		: "message_problem";
}

export function addSetValue<T>(
	current: ReadonlySet<T>,
	value: T
): ReadonlySet<T> {
	if (current.has(value)) {
		return current;
	}
	const next = new Set(current);
	next.add(value);
	return next;
}

export function removeSetValue<T>(
	current: ReadonlySet<T>,
	value: T
): ReadonlySet<T> {
	if (!current.has(value)) {
		return current;
	}
	const next = new Set(current);
	next.delete(value);
	return next;
}

export function hasActiveSpaceMember(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	profileId: string;
}): boolean {
	const normalizedProfileId = input.profileId.trim();
	if (!input.membersSnapshot || normalizedProfileId.length === 0) {
		return false;
	}

	return [
		...input.membersSnapshot.humans,
		...input.membersSnapshot.agents,
	].some(
		(member) =>
			member.profileId === normalizedProfileId && member.status === "active"
	);
}

export function readSpaceStatusName(
	status: GetSpaceStatusResponse | undefined
): string | null {
	return status?.name ?? null;
}

export function normalizeOptionalText(
	value: string | null | undefined
): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
	const normalizedValues: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const normalized = normalizeOptionalText(value);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		normalizedValues.push(normalized);
	}
	return normalizedValues;
}

export function resolveWakeProgressTargetLabel(input: {
	membersSnapshot: SpaceMembersSnapshot | null;
	targetProfileId: string;
}): string {
	const agent = input.membersSnapshot?.agents.find(
		(member) => member.profileId === input.targetProfileId
	);
	const mentionAlias = agent?.mentionAlias?.trim();
	const profileName = agent?.profileName.trim();
	return `@${mentionAlias || profileName || input.targetProfileId}`;
}

export function mergeWakeProgressItemState(input: {
	currentItems: readonly WakeProgressItem[];
	incomingItems: readonly WakeProgressItem[];
	signals: readonly SignalEnvelope[];
}): WakeProgressItem[] {
	const currentItems = filterWakeProgressItemsForVisibleOutcomes({
		items: input.currentItems,
		signals: input.signals,
	});
	const nextItems = mergeWakeProgressItems({
		currentItems,
		incomingItems: filterWakeProgressItemsForVisibleOutcomes({
			items: input.incomingItems,
			signals: input.signals,
		}),
	});
	return areWakeProgressItemsEqual(input.currentItems, nextItems)
		? (input.currentItems as WakeProgressItem[])
		: nextItems;
}

export function reconcilePolledWakeProgressItems(input: {
	currentItems: readonly WakeProgressItem[];
	fulfilledClientMessageIds: readonly string[];
	incomingItems: readonly WakeProgressItem[];
	signals: readonly SignalEnvelope[];
}): WakeProgressItem[] {
	const fulfilledClientMessageIds = new Set(input.fulfilledClientMessageIds);
	const retainedItems = input.currentItems.filter(
		(item) =>
			!(
				item.clientMessageId &&
				fulfilledClientMessageIds.has(item.clientMessageId)
			)
	);
	return mergeWakeProgressItemState({
		currentItems: retainedItems,
		incomingItems: input.incomingItems,
		signals: input.signals,
	});
}

export function reconcileActiveWakeProgressSnapshot(input: {
	currentItems: readonly WakeProgressItem[];
	incomingItems: readonly WakeProgressItem[];
	signals: readonly SignalEnvelope[];
	snapshotItemsAtRequestStart: readonly WakeProgressItem[];
}): WakeProgressItem[] {
	const retainedItems = input.currentItems.filter((currentItem) => {
		const requestStartItem = input.snapshotItemsAtRequestStart.find(
			(candidate) =>
				doWakeProgressItemsMatch({ left: currentItem, right: candidate })
		);
		if (!requestStartItem) {
			return true;
		}
		if (!areWakeProgressItemsEqual([currentItem], [requestStartItem])) {
			return true;
		}
		return input.incomingItems.some((candidate) =>
			doWakeProgressItemsMatch({ left: currentItem, right: candidate })
		);
	});
	return mergeWakeProgressItemState({
		currentItems: retainedItems,
		incomingItems: input.incomingItems,
		signals: input.signals,
	});
}

export function mergeActiveWakeProgressPresentation(input: {
	detailedItems: readonly WakeProgressItem[];
	signals: readonly SignalEnvelope[];
	summaryItems: readonly WakeProgressItem[];
}): WakeProgressItem[] {
	const mergedItems = mergeWakeProgressItemState({
		currentItems: filterVisibleWakeProgressItems({
			items: input.summaryItems,
		}),
		// Detailed polling is merged second so equal-revision runtime location
		// enrichment wins while ordinary lifecycle ordering remains unchanged.
		incomingItems: input.detailedItems,
		signals: input.signals,
	});
	return mergedItems.map((item) => {
		if (item.wakeStopEligibility !== undefined) {
			return item;
		}
		const detailedItem = input.detailedItems.find(
			(candidate) =>
				candidate.wakeStopEligibility !== undefined &&
				doWakeProgressItemsMatch({ left: item, right: candidate })
		);
		return detailedItem
			? {
					...item,
					wakeStopEligibility: detailedItem.wakeStopEligibility,
				}
			: item;
	});
}

function doWakeProgressItemsMatch(input: {
	left: WakeProgressItem;
	right: WakeProgressItem;
}): boolean {
	if (input.left.dispatchId && input.right.dispatchId) {
		return input.left.dispatchId === input.right.dispatchId;
	}
	if (input.left.targetProfileId !== input.right.targetProfileId) {
		return false;
	}
	if (
		input.left.clientMessageId &&
		input.right.clientMessageId &&
		input.left.clientMessageId === input.right.clientMessageId
	) {
		return true;
	}
	if (
		input.left.sourceSignalId &&
		input.right.sourceSignalId &&
		input.left.sourceSignalId === input.right.sourceSignalId
	) {
		return true;
	}
	const leftHasExecutionIdentity = Boolean(
		input.left.dispatchId ||
			input.left.clientMessageId ||
			input.left.sourceSignalId
	);
	const rightHasExecutionIdentity = Boolean(
		input.right.dispatchId ||
			input.right.clientMessageId ||
			input.right.sourceSignalId
	);
	return !(leftHasExecutionIdentity || rightHasExecutionIdentity);
}

export function filterWakeProgressItemsForVisibleOutcomes(input: {
	items: readonly WakeProgressItem[];
	signals: readonly SignalEnvelope[];
}): WakeProgressItem[] {
	if (input.items.length === 0 || input.signals.length === 0) {
		return [...input.items];
	}

	return input.signals.reduce(
		(items, signal) => clearWakeProgressItemsForSignal({ items, signal }),
		[...input.items]
	);
}

export function removeWakeProgressItemsForClientMessageId(input: {
	clientMessageId: string;
	items: readonly WakeProgressItem[];
}): WakeProgressItem[] {
	return input.items.filter(
		(item) => item.clientMessageId !== input.clientMessageId
	);
}

export function listPendingWakeProgressClientMessageIds(
	items: readonly WakeProgressItem[],
	nowMs = Date.now()
): string[] {
	const ids = new Set<string>();
	for (const item of filterVisibleWakeProgressItems({ items, nowMs })) {
		if (item.terminal || item.phase === "sending" || !item.clientMessageId) {
			continue;
		}
		ids.add(item.clientMessageId);
	}
	return [...ids];
}

export function listRecoverableWakeProgressClientMessageIds(input: {
	alreadyRequestedClientMessageIds: ReadonlySet<string>;
	signals: readonly SignalEnvelope[];
}): string[] {
	const ids = new Set<string>();
	for (const signal of input.signals) {
		const clientMessageId = readWakeSourceClientMessageId(signal);
		if (!clientMessageId) {
			continue;
		}
		if (
			!isWakeProgressSourceSignalRecoverable({
				sourceUpdatedAtMs: signal.ts,
			})
		) {
			continue;
		}
		if (input.alreadyRequestedClientMessageIds.has(clientMessageId)) {
			continue;
		}
		ids.add(clientMessageId);
	}
	return [...ids];
}

export function readWakeSourceClientMessageId(
	signal: SignalEnvelope
): string | null {
	if (signal.type !== "signal.text") {
		return null;
	}

	const activationTargets =
		signal.data.messageEnvelope?.activationTargets ?? [];
	if (!activationTargets.some((target) => target.trim().length > 0)) {
		return null;
	}

	const clientMessageId = signal.data.meta?.clientMessageId?.trim();
	return clientMessageId && clientMessageId.length > 0 ? clientMessageId : null;
}

export function resolveWakeProgressPollDelayMs(input: {
	attemptCounts: readonly number[];
}): number {
	const nextAttemptCount = Math.min(...input.attemptCounts);
	if (nextAttemptCount <= 0) {
		return 15_000;
	}
	return 30_000;
}

export async function pollWakeProgress(input: {
	openMeldProfileId: string;
	clientMessageIds: readonly string[];
	onItems: (
		items: readonly WakeProgressItem[],
		fulfilledClientMessageIds: readonly string[]
	) => void;
	onSettled: () => void;
	spaceId: string;
}): Promise<void> {
	try {
		const api = createUnscopedWebSpaceApi({
			openMeldProfileId: input.openMeldProfileId,
		});
		const results = await Promise.allSettled(
			input.clientMessageIds.map((clientMessageId) =>
				api.getWakeProgress({
					clientMessageId,
					includeTiming: true,
					includeWaitReason: true,
					includeWakeStopEligibility: true,
					spaceId: input.spaceId,
					timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
				})
			)
		);
		const items: WakeProgressItem[] = [];
		const fulfilledClientMessageIds: string[] = [];
		for (const [index, result] of results.entries()) {
			if (result.status === "fulfilled") {
				items.push(...result.value.items);
				const clientMessageId = input.clientMessageIds[index];
				if (clientMessageId) {
					fulfilledClientMessageIds.push(clientMessageId);
				}
				continue;
			}
			console.warn("[openmeld.web.space.wake_progress_poll_failed]", {
				error:
					result.reason instanceof Error
						? result.reason.message
						: String(result.reason),
				spaceId: input.spaceId,
			});
		}
		input.onItems(items, fulfilledClientMessageIds);
	} finally {
		input.onSettled();
	}
}

export function areWakeProgressItemsEqual(
	left: readonly WakeProgressItem[],
	right: readonly WakeProgressItem[]
): boolean {
	return (
		left.length === right.length &&
		left.every((item, index) => {
			const other = right[index];
			return (
				other !== undefined &&
				item.clientMessageId === other.clientMessageId &&
				item.dispatchId === other.dispatchId &&
				item.failureReasonCode === other.failureReasonCode &&
				item.message === other.message &&
				item.previewText === other.previewText &&
				item.phase === other.phase &&
				item.runtimeCoordinatorExecutionId ===
					other.runtimeCoordinatorExecutionId &&
				areWakeProgressSourceContextsEqual(
					item.sourceContext ?? null,
					other.sourceContext ?? null
				) &&
				item.sourceSignalId === other.sourceSignalId &&
				item.startedAtMs === other.startedAtMs &&
				item.targetLabel === other.targetLabel &&
				item.targetProfileId === other.targetProfileId &&
				item.terminal === other.terminal &&
				item.updatedAtMs === other.updatedAtMs &&
				item.waitReasonCode === other.waitReasonCode &&
				areAgentInteractionPendingSummariesEqual(
					item.pendingInteraction ?? null,
					other.pendingInteraction ?? null
				) &&
				areWakeStopEligibilitiesEqual(
					item.wakeStopEligibility ?? null,
					other.wakeStopEligibility ?? null
				)
			);
		})
	);
}

function areWakeProgressSourceContextsEqual(
	left: NonNullable<WakeProgressItem["sourceContext"]> | null,
	right: NonNullable<WakeProgressItem["sourceContext"]> | null
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return (
		left.messagePreview === right.messagePreview &&
		left.profileId === right.profileId &&
		left.profileKind === right.profileKind &&
		left.profileName === right.profileName &&
		left.threadId === right.threadId
	);
}

function areAgentInteractionPendingSummariesEqual(
	left: NonNullable<WakeProgressItem["pendingInteraction"]> | null,
	right: NonNullable<WakeProgressItem["pendingInteraction"]> | null
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return (
		left.interactionId === right.interactionId &&
		left.kind === right.kind &&
		left.requestedAtMs === right.requestedAtMs &&
		left.expiresAtMs === right.expiresAtMs &&
		left.canRespond === right.canRespond &&
		JSON.stringify(left.request) === JSON.stringify(right.request)
	);
}

function areWakeStopEligibilitiesEqual(
	left: NonNullable<WakeProgressItem["wakeStopEligibility"]> | null,
	right: NonNullable<WakeProgressItem["wakeStopEligibility"]> | null
): boolean {
	if (left === null || right === null) {
		return left === right;
	}
	return (
		left.controlMode === right.controlMode &&
		left.reasonCode === right.reasonCode &&
		left.reliability === right.reliability &&
		left.status === right.status
	);
}

export function mergeLiveThreadSignalIntoCache(input: {
	openMeldProfileId: string;
	placement: SpaceThreadSignalPlacement;
	queryClient: ReturnType<typeof useQueryClient>;
	signal: SignalEnvelope;
	spaceId: string;
	threadContext: SpaceThreadContext;
}) {
	if (input.placement.threadId !== input.threadContext.threadId) {
		return;
	}

	const threadSignalsKey = spaceQueryKeys.threadSignals(
		input.spaceId,
		input.threadContext.threadId,
		input.openMeldProfileId
	);
	input.queryClient.setQueryData<ListSpaceThreadSignalsResponse>(
		threadSignalsKey,
		(current) => mergeThreadSignalsCache(current, input)
	);

	const threadsKey = spaceQueryKeys.threads(
		input.spaceId,
		input.openMeldProfileId
	);
	input.queryClient.setQueryData<ListSpaceThreadsResponse>(
		threadsKey,
		(current) => mergeThreadPreviewCache(current, input)
	);
}

export function mergeThreadSignalsCache(
	current: ListSpaceThreadSignalsResponse | undefined,
	input: {
		placement: SpaceThreadSignalPlacement;
		signal: SignalEnvelope;
	}
): ListSpaceThreadSignalsResponse {
	const currentSignals = current?.signals ?? [];
	const currentPlacements = current?.placements ?? [];
	const signals = currentSignals.some((signal) => signal.id === input.signal.id)
		? currentSignals
		: [...currentSignals, input.signal].sort(compareSignalOrder);
	const placements = currentPlacements.some(
		(placement) => placement.signalId === input.placement.signalId
	)
		? currentPlacements
		: [...currentPlacements, input.placement].sort(comparePlacementOrder);
	return { signals, placements };
}

export function mergeThreadPreviewCache(
	current: ListSpaceThreadsResponse | undefined,
	input: {
		placement: SpaceThreadSignalPlacement;
		signal: SignalEnvelope;
		threadContext: SpaceThreadContext;
	}
): ListSpaceThreadsResponse | undefined {
	if (!current) {
		return current;
	}

	const updatedAt = new Date(input.signal.ts).toISOString();
	return {
		...current,
		threads: current.threads.map((thread) =>
			thread.threadId === input.threadContext.threadId
				? { ...thread, updatedAt }
				: thread
		),
		previews: upsertThreadPreview(current.previews ?? [], input),
	};
}

export function upsertThreadPreview(
	previews: readonly SpaceThreadPreview[],
	input: {
		placement: SpaceThreadSignalPlacement;
		signal: SignalEnvelope;
		threadContext: SpaceThreadContext;
	}
): SpaceThreadPreview[] {
	const existingPreview = previews.find(
		(preview) => preview.threadId === input.threadContext.threadId
	);
	if (!existingPreview) {
		return [
			...previews,
			{
				threadId: input.threadContext.threadId,
				replyCount: 1,
				signals: [input.signal],
				placements: [input.placement],
			},
		];
	}

	const signalAlreadyKnown = existingPreview.signals.some(
		(signal) => signal.id === input.signal.id
	);
	const nextSignals =
		signalAlreadyKnown || existingPreview.signals.length >= 2
			? existingPreview.signals
			: [...existingPreview.signals, input.signal].sort(compareSignalOrder);
	const nextPlacements = existingPreview.placements.some(
		(placement) => placement.signalId === input.placement.signalId
	)
		? existingPreview.placements
		: [...existingPreview.placements, input.placement].sort(
				comparePlacementOrder
			);
	const nextPreview: SpaceThreadPreview = {
		...existingPreview,
		replyCount: signalAlreadyKnown
			? existingPreview.replyCount
			: existingPreview.replyCount + 1,
		signals: nextSignals,
		placements: nextPlacements,
	};
	return previews.map((preview) =>
		preview.threadId === input.threadContext.threadId ? nextPreview : preview
	);
}

export function compareSignalOrder(
	left: SignalEnvelope,
	right: SignalEnvelope
): number {
	if (left.ts !== right.ts) {
		return left.ts - right.ts;
	}
	return left.id.localeCompare(right.id);
}

export function comparePlacementOrder(
	left: SpaceThreadSignalPlacement,
	right: SpaceThreadSignalPlacement
): number {
	if (left.createdAt !== right.createdAt) {
		return left.createdAt.localeCompare(right.createdAt);
	}
	return left.signalId.localeCompare(right.signalId);
}

export function resolveLeaveSpaceErrorMessage(
	failure: StructuredApiClientFailure
): string {
	if (failure.code === "space.leave_space.creator_forbidden") {
		return "The space creator cannot leave this space. Delete the space instead when only you remain.";
	}

	return failure.message;
}

export function resolveDeleteSpaceErrorMessage(
	failure: StructuredApiClientFailure
): string {
	if (failure.code === "space.forbidden") {
		return "Only the space creator can delete this space.";
	}
	if (failure.code === "space.human_confirmation_required") {
		return "Agent-created spaces must be deleted by their owner.";
	}

	return failure.message;
}

export async function refreshLanding(input: {
	statusRefetch: () => Promise<unknown>;
	membersRefetch: () => Promise<unknown>;
	historyRefetch: () => Promise<unknown>;
}) {
	await Promise.all([
		input.statusRefetch(),
		input.membersRefetch(),
		input.historyRefetch(),
	]);
}

export async function refreshStatusAndMembers(input: {
	statusRefetch: () => Promise<unknown>;
	membersRefetch: () => Promise<unknown>;
}) {
	await Promise.all([input.statusRefetch(), input.membersRefetch()]);
}

export function createStatusAndMembersRefreshDedupe() {
	let inFlightRefresh: Promise<void> | null = null;

	return async (input: {
		statusRefetch: () => Promise<unknown>;
		membersRefetch: () => Promise<unknown>;
	}) => {
		if (inFlightRefresh) {
			await inFlightRefresh;
			return;
		}

		const refresh = refreshStatusAndMembers(input).finally(() => {
			if (inFlightRefresh === refresh) {
				inFlightRefresh = null;
			}
		});
		inFlightRefresh = refresh;
		await refresh;
	};
}

export function findSessionExpiredError(
	errors: readonly unknown[]
): unknown | null {
	return errors.find((error) => isSessionExpiredError(error)) ?? null;
}
