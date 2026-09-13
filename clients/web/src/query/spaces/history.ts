import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	GetSpaceUpdatesResponse,
	SignalEnvelope,
	SpaceMessageReactions,
} from "@openmeld/schemas/types";
import {
	type QueryClient,
	queryOptions,
	replaceEqualDeep,
} from "@tanstack/react-query";
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

export function boundSavedSpaceHistory(
	envelopes: readonly SignalEnvelope[]
): readonly SignalEnvelope[] {
	let bytes = 0;
	let start = envelopes.length;
	const encoder = new TextEncoder();
	while (start > 0) {
		const size = encoder.encode(
			JSON.stringify(envelopes[start - 1])
		).byteLength;
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
	envelopes: readonly SignalEnvelope[];
	nextCursor: string | null;
};

export function mergeSpaceHistorySnapshots(input: {
	current: SpaceHistorySnapshot | undefined;
	incoming: SpaceHistorySnapshot;
}): SpaceHistorySnapshot {
	const mergedEnvelopes = mergeSpaceTimelineEnvelopes({
		current: input.current?.envelopes ?? [],
		incoming: input.incoming.envelopes,
	});
	const nextSnapshot = {
		...input.incoming,
		envelopes: boundSavedSpaceHistory(mergedEnvelopes),
	};
	return replaceEqualDeep(input.current, nextSnapshot);
}

export function writeSpaceHistoryEnvelopesToCache(input: {
	envelopes: readonly SignalEnvelope[];
	queryClient: QueryClient;
	spaceId: string;
	openMeldProfileId: string;
}): void {
	if (input.envelopes.length === 0) {
		return;
	}

	input.queryClient.setQueryData<SpaceHistorySnapshot>(
		spaceQueryKeys.history(input.spaceId, input.openMeldProfileId),
		(current) =>
			mergeSpaceHistorySnapshots({
				current,
				incoming: {
					envelopes: input.envelopes,
					nextCursor: current?.nextCursor ?? null,
				},
			})
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
	return await readAnchoredSpaceHistory({
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
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).listSignalEnvelopes({
			spaceId: input.spaceId,
			query: input.query,
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
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
