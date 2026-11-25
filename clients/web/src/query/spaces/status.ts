import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import { shouldRetrySpaceQuery } from "./retry";

// Space snapshots render from cache immediately and revalidate in the
// background. Freshness inside the window is owned by the live event path
// (WS signal frames, space.members.changed / agent.readiness.invalidated
// invalidations, and the periodic reconcile), which refetches imperatively
// and never consults staleTime.
export const SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS = 30_000;

const allSpaceQueryKey = ["spaces"] as const;
const allSpaceBootstrapQueryKey = [...allSpaceQueryKey, "bootstrap"] as const;
const allSpaceMembersQueryKey = [...allSpaceQueryKey, "members"] as const;

export const spaceQueryKeys = {
	all: allSpaceQueryKey,
	allBootstraps: allSpaceBootstrapQueryKey,
	allMembers: allSpaceMembersQueryKey,
	bootstrap: (spaceId: string, openMeldProfileId?: string | null) =>
		[...allSpaceBootstrapQueryKey, spaceId, openMeldProfileId ?? null] as const,
	status: (spaceId: string, openMeldProfileId?: string | null) =>
		["spaces", "status", spaceId, openMeldProfileId ?? null] as const,
	meta: (spaceId: string, openMeldProfileId?: string | null) =>
		["spaces", "meta", spaceId, openMeldProfileId ?? null] as const,
	memberDirectoryDisplay: (
		spaceId: string,
		openMeldProfileId?: string | null
	) =>
		[
			"spaces",
			"member-directory-display",
			spaceId,
			openMeldProfileId ?? null,
		] as const,
	displaySnapshot: (spaceId: string, openMeldProfileId?: string | null) =>
		["spaces", "display-snapshot", spaceId, openMeldProfileId ?? null] as const,
	members: (spaceId: string, openMeldProfileId?: string | null) =>
		[...allSpaceMembersQueryKey, spaceId, openMeldProfileId ?? null] as const,
	history: (spaceId: string, openMeldProfileId?: string | null) =>
		["spaces", "history", spaceId, openMeldProfileId ?? null] as const,
	historyNavigation: (spaceId: string, openMeldProfileId: string) =>
		["spaces", spaceId, openMeldProfileId, "history-navigation"] as const,
	historyWindow: (spaceId: string, openMeldProfileId: string) =>
		["spaces", "history-window", spaceId, openMeldProfileId] as const,
	historyDateWindow: (
		spaceId: string,
		startAtMs: number,
		openMeldProfileId?: string | null
	) =>
		[
			"spaces",
			"history-date-window",
			spaceId,
			openMeldProfileId ?? null,
			startAtMs,
		] as const,
	activeWakeProgressSummary: (
		spaceId: string,
		openMeldProfileId?: string | null
	) =>
		[
			"spaces",
			"active-wake-progress-summary",
			spaceId,
			openMeldProfileId ?? null,
		] as const,
	wakeProgressPresentation: (
		spaceId: string,
		openMeldProfileId?: string | null
	) =>
		[
			"spaces",
			"wake-progress-presentation",
			spaceId,
			openMeldProfileId ?? null,
		] as const,
	wakeTraceWaterfall: (
		spaceId: string,
		selectorKind: "client_message" | "source_signal" | null,
		selectorId: string | null,
		targetProfileId?: string | null,
		openMeldProfileId?: string | null
	) =>
		[
			"spaces",
			"wake-trace-waterfall",
			spaceId,
			selectorKind,
			selectorId,
			targetProfileId ?? null,
			openMeldProfileId ?? null,
		] as const,
	messageDetails: (
		spaceId: string,
		signalId: string,
		openMeldProfileId?: string | null
	) =>
		[
			"spaces",
			"message-details",
			spaceId,
			signalId,
			openMeldProfileId ?? null,
		] as const,
	threadSignals: (
		spaceId: string,
		threadId: string,
		openMeldProfileId?: string | null
	) =>
		[
			"spaces",
			"thread-signals",
			spaceId,
			threadId,
			openMeldProfileId ?? null,
		] as const,
	threads: (spaceId: string, openMeldProfileId?: string | null) =>
		["spaces", "threads", spaceId, openMeldProfileId ?? null] as const,
} as const;

export async function readSpaceStatus(input: {
	spaceId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	signal?: AbortSignal;
}): Promise<GetSpaceStatusResponse> {
	try {
		return await createUnscopedWebSpaceApi({
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		}).getStatus({
			spaceId: input.spaceId,
			timeoutMs: 15_000,
			...(input.spacePassword === undefined
				? {}
				: { spacePassword: input.spacePassword }),
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function spaceStatusQueryOptions(input: {
	spaceId: string;
	openMeldProfileId?: string;
	enabled: boolean;
}) {
	return queryOptions<GetSpaceStatusResponse, StructuredApiClientFailure>({
		queryKey: spaceQueryKeys.status(input.spaceId, input.openMeldProfileId),
		queryFn: async ({ signal }) =>
			await readSpaceStatus({
				spaceId: input.spaceId,
				...(input.openMeldProfileId === undefined
					? {}
					: { openMeldProfileId: input.openMeldProfileId }),
				signal,
			}),
		enabled: input.enabled,
		// Composer admission awaits this read. Offline must settle as a failure,
		// rather than leaving an optimistic message waiting on a paused query.
		networkMode: "always",
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		retry: shouldRetrySpaceQuery,
		staleTime: SPACE_INITIAL_SNAPSHOT_STALE_TIME_MS,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}
