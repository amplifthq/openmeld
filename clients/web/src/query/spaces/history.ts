import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	GetSpaceUpdatesResponse,
	ListSpaceThreadsResponse,
	SignalEnvelope,
	SpaceMessageReactions,
} from "@openmeld/schemas/types";
import {
	type QueryClient,
	queryOptions,
	replaceEqualDeep,
} from "@tanstack/react-query";
import { recordReactUpdate } from "#/lib/observability/react-update-trace";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { mergeSpaceTimelineEnvelopes } from "#/lib/spaces/timeline";
import {
	PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";
import { shouldRetrySpaceQuery } from "./retry";
import { SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS, spaceQueryKeys } from "./status";

export const SPACE_INITIAL_HISTORY_MAX_MESSAGES = 30;
// Retain loaded pages by their actual cost, independently of the server's
// initial page size. Eviction affects saved history, not the mounted reader.
export const SPACE_SAVED_HISTORY_MAX_BYTES = 2 * 1024 * 1024;

// Cached query data is immutable and merges keep unchanged envelopes by
// reference, so each envelope's serialized size is measured once instead of
// re-serializing up to 2 MB of retained history on every cache write.
const savedEnvelopeBytes = new WeakMap<SignalEnvelope, number>();
const envelopeSizeEncoder = new TextEncoder();

export function measureSavedSpaceEnvelopeBytes(
	envelope: SignalEnvelope
): number {
	let size = savedEnvelopeBytes.get(envelope);
	if (size === undefined) {
		size = envelopeSizeEncoder.encode(JSON.stringify(envelope)).byteLength;
		savedEnvelopeBytes.set(envelope, size);
	}
	return size;
}

export function boundSavedSpaceHistory(
	envelopes: readonly SignalEnvelope[]
): readonly SignalEnvelope[] {
	let bytes = 0;
	let start = envelopes.length;
	while (start > 0) {
		const envelope = envelopes[start - 1];
		if (envelope === undefined) {
			break;
		}
		const size = measureSavedSpaceEnvelopeBytes(envelope);
		if (bytes + size > SPACE_SAVED_HISTORY_MAX_BYTES) {
			break;
		}
		bytes += size;
		start -= 1;
	}
	return start === 0 ? envelopes : envelopes.slice(start);
}
export const SPACE_UPDATES_LIMIT = 50;
export const SPACE_EARLIER_HISTORY_PAGE_MAX_MESSAGES = 20;
export const SPACE_DATE_HISTORY_PAGE_MAX_MESSAGES = 30;
export const SPACE_HISTORY_SIGNAL_KINDS = [
	"text",
	"status",
	"system_notice",
] as const;

export type SpaceHistorySnapshot = {
	personalHistoryDeletedAt?: number;
	envelopes: readonly SignalEnvelope[];
	nextCursor: string | null;
	/** Last contiguous server read, independent of retained or live display rows. */
	confirmedCursor?: string | null;
	/** Bounded display context only; never seeds the authoritative Thread query. */
	threadDisplay?: ListSpaceThreadsResponse;
};

export const SPACE_SAVED_THREAD_DISPLAY_MAX_BYTES = 256 * 1024;

export function boundSpaceThreadDisplay(
	envelopes: readonly SignalEnvelope[],
	snapshot: ListSpaceThreadsResponse
): ListSpaceThreadsResponse {
	const roots = new Set(envelopes.map((signal) => signal.id));
	const previews = new Map(
		snapshot.previews.map((preview) => [preview.threadId, preview])
	);
	const result: ListSpaceThreadsResponse = { threads: [], previews: [] };
	const encoder = new TextEncoder();
	let bytes = 32;
	for (const thread of snapshot.threads.toReversed()) {
		if (!roots.has(thread.rootSignalId)) {
			continue;
		}
		const source = previews.get(thread.threadId);
		const signals = source?.signals.slice(0, 2) ?? [];
		const preview = {
			threadId: thread.threadId,
			replyCount: source?.replyCount ?? 0,
			signals:
				encoder.encode(JSON.stringify(signals)).byteLength <= 16 * 1024
					? signals
					: [],
			placements: [],
		};
		const size =
			encoder.encode(JSON.stringify(thread) + JSON.stringify(preview))
				.byteLength + 2;
		if (bytes + size > SPACE_SAVED_THREAD_DISPLAY_MAX_BYTES) {
			break;
		}
		bytes += size;
		result.threads.push(thread);
		result.previews.push(preview);
	}
	result.threads.reverse();
	result.previews.reverse();
	return result;
}

export function mergeSpaceHistorySnapshots(input: {
	current: SpaceHistorySnapshot | undefined;
	incoming: SpaceHistorySnapshot;
}): SpaceHistorySnapshot {
	const currentEpoch = input.current?.personalHistoryDeletedAt ?? 0;
	const incomingEpoch = input.incoming.personalHistoryDeletedAt ?? 0;
	if (incomingEpoch < currentEpoch && input.current) {
		return input.current;
	}
	const current = incomingEpoch > currentEpoch ? undefined : input.current;
	const mergedEnvelopes = mergeSpaceTimelineEnvelopes({
		current: current?.envelopes ?? [],
		incoming: input.incoming.envelopes,
	});
	const envelopes = boundSavedSpaceHistory(mergedEnvelopes);
	const threadDisplay = input.incoming.threadDisplay ?? current?.threadDisplay;
	const confirmedCursor =
		input.incoming.confirmedCursor !== undefined
			? input.incoming.confirmedCursor
			: current?.confirmedCursor;
	const nextSnapshot = {
		...input.incoming,
		...(confirmedCursor !== undefined ? { confirmedCursor } : {}),
		...(threadDisplay
			? {
					threadDisplay: boundSpaceThreadDisplay(envelopes, threadDisplay),
				}
			: {}),
		envelopes,
	};
	return replaceEqualDeep(input.current, nextSnapshot);
}

export function writeSpaceHistoryEnvelopesToCache(input: {
	envelopes: readonly SignalEnvelope[];
	confirmedCursor?: string | null;
	queryClient: QueryClient;
	spaceId: string;
	openMeldProfileId: string;
}): void {
	if (input.envelopes.length === 0 && input.confirmedCursor === undefined) {
		return;
	}

	input.queryClient.setQueryData<SpaceHistorySnapshot>(
		spaceQueryKeys.history(input.spaceId, input.openMeldProfileId),
		(current) => {
			const merged = mergeSpaceHistorySnapshots({
				current,
				incoming: {
					...(current?.personalHistoryDeletedAt === undefined
						? {}
						: { personalHistoryDeletedAt: current.personalHistoryDeletedAt }),
					envelopes: input.envelopes,
					nextCursor: current?.nextCursor ?? null,
					...(input.confirmedCursor !== undefined
						? { confirmedCursor: input.confirmedCursor }
						: {}),
				},
			});
			if (merged !== current) {
				recordReactUpdate("space_history_cache_write");
			}
			return merged;
		}
	);
}

export function writeSpaceHistoryReactionsToCache(input: {
	queryClient: QueryClient;
	spaceId: string;
	openMeldProfileId: string;
	signalId: string;
	reactions: SpaceMessageReactions;
}): void {
	const key = spaceQueryKeys.history(input.spaceId, input.openMeldProfileId);
	const current = input.queryClient.getQueryData<SpaceHistorySnapshot>(key);
	// Never recreate content after access revocation, or persist a Thread
	// reply that was not already part of this main conversation snapshot.
	if (!current) {
		return;
	}
	let changed = false;
	const envelopes = current.envelopes.map((message) => {
		if (
			message.id !== input.signalId ||
			message.type !== "signal.text" ||
			(message.reactions?.version ?? -1) >= input.reactions.version
		) {
			return message;
		}
		changed = true;
		return { ...message, reactions: input.reactions };
	});
	if (changed) {
		input.queryClient.setQueryData(key, {
			...current,
			envelopes: boundSavedSpaceHistory(envelopes),
		});
	}
}

export async function readSpaceHistory(input: {
	spaceId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	signal?: AbortSignal;
}): Promise<SpaceHistorySnapshot> {
	const snapshot = await readAnchoredSpaceHistory({
		spaceId: input.spaceId,
		...(input.openMeldProfileId === undefined
			? {}
			: { openMeldProfileId: input.openMeldProfileId }),
		query: {
			recent: true,
			limit: SPACE_INITIAL_HISTORY_MAX_MESSAGES,
			kinds: SPACE_HISTORY_SIGNAL_KINDS,
		},
		...(input.spacePassword === undefined
			? {}
			: { spacePassword: input.spacePassword }),
		...(input.signal === undefined ? {} : { signal: input.signal }),
	});
	return {
		...snapshot,
		confirmedCursor: snapshot.envelopes.at(-1)?.id ?? null,
	};
}

export async function readEarlierSpaceHistory(input: {
	spaceId: string;
	aroundSignalId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	signal?: AbortSignal;
}): Promise<SpaceHistorySnapshot> {
	return await readAnchoredSpaceHistory({
		spaceId: input.spaceId,
		...(input.openMeldProfileId === undefined
			? {}
			: { openMeldProfileId: input.openMeldProfileId }),
		query: {
			aroundSignalId: input.aroundSignalId,
			beforeCount: SPACE_EARLIER_HISTORY_PAGE_MAX_MESSAGES,
			afterCount: 0,
			kinds: SPACE_HISTORY_SIGNAL_KINDS,
		},
		...(input.spacePassword === undefined
			? {}
			: { spacePassword: input.spacePassword }),
		...(input.signal === undefined ? {} : { signal: input.signal }),
	});
}

export async function readSpaceHistoryFromDate(input: {
	startAtMs: number;
	spaceId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	signal?: AbortSignal;
}): Promise<SpaceHistorySnapshot> {
	return await readAnchoredSpaceHistory({
		spaceId: input.spaceId,
		...(input.openMeldProfileId === undefined
			? {}
			: { openMeldProfileId: input.openMeldProfileId }),
		query: {
			afterTs: Math.max(0, input.startAtMs - 1),
			limit: SPACE_DATE_HISTORY_PAGE_MAX_MESSAGES,
			kinds: SPACE_HISTORY_SIGNAL_KINDS,
		},
		...(input.spacePassword === undefined
			? {}
			: { spacePassword: input.spacePassword }),
		...(input.signal === undefined ? {} : { signal: input.signal }),
	});
}

async function readAnchoredSpaceHistory(input: {
	spaceId: string;
	openMeldProfileId?: string;
	query: {
		afterTs?: number;
		cursor?: string;
		recent?: boolean;
		limit?: number;
		aroundSignalId?: string;
		beforeCount?: number;
		afterCount?: number;
		kinds: readonly (typeof SPACE_HISTORY_SIGNAL_KINDS)[number][];
	};
	spacePassword?: string;
	signal?: AbortSignal;
}): Promise<SpaceHistorySnapshot> {
	try {
		const result = await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).listSignalEnvelopes({
			spaceId: input.spaceId,
			query: { ...input.query, includePersonalHistoryBoundary: true },
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
		return {
			...result,
			personalHistoryDeletedAt: result.personalHistoryDeletedAt ?? 0,
		};
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceHistoryDateWindowQueryOptions(input: {
	startAtMs: number;
	spaceId: string;
	openMeldProfileId?: string;
}) {
	return queryOptions<SpaceHistorySnapshot, StructuredApiClientFailure>({
		queryKey: spaceQueryKeys.historyDateWindow(
			input.spaceId,
			input.startAtMs,
			input.openMeldProfileId
		),
		queryFn: async ({ signal }) =>
			await readSpaceHistoryFromDate({
				startAtMs: input.startAtMs,
				spaceId: input.spaceId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				signal,
			}),
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		retry: shouldRetrySpaceQuery,
		staleTime: ROUTE_REVISIT_GC_TIME_MS,
	});
}

export async function readSpaceUpdates(input: {
	spaceId: string;
	afterSignalId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	signal?: AbortSignal;
}): Promise<GetSpaceUpdatesResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).getUpdates({
			spaceId: input.spaceId,
			afterSignalId: input.afterSignalId,
			limit: SPACE_UPDATES_LIMIT,
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceHistoryQueryOptions(input: {
	spaceId: string;
	openMeldProfileId?: string;
	enabled: boolean;
}) {
	return queryOptions<SpaceHistorySnapshot, StructuredApiClientFailure>({
		queryKey: spaceQueryKeys.history(input.spaceId, input.openMeldProfileId),
		queryFn: async ({ signal }) =>
			await readSpaceHistory({
				spaceId: input.spaceId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				signal,
			}),
		enabled: input.enabled,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		retry: shouldRetrySpaceQuery,
		staleTime: SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
		structuralSharing: (current, incoming) =>
			mergeSpaceHistorySnapshots({
				current: current as SpaceHistorySnapshot | undefined,
				incoming: incoming as SpaceHistorySnapshot,
			}),
	});
}
