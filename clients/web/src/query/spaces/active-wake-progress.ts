import type { StructuredApiClientFailure } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { SignalEnvelope } from "@openmeld/protocol";
import type {
	GetActiveSpaceWakeProgressResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	doWakeProgressItemsMatch,
	filterVisibleWakeProgressItems,
	readWakeProgressTerminalSignalEvidence,
} from "@openmeld/space";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { SPACE_WAKE_PROGRESS_TIMEOUT_MS } from "#/lib/spaces/request-timeouts";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import { spaceQueryKeys } from "./status";

type WakeProgressEvidence = NonNullable<
	ReturnType<typeof readWakeProgressTerminalSignalEvidence>
>;
type TerminalWakeProgressEvidence = Pick<
	WakeProgressItem,
	| "dispatchId"
	| "clientMessageId"
	| "sourceSignalId"
	| "targetProfileId"
	| "phase"
	| "updatedAtMs"
>;
type SpaceWakeProgressPresentation = {
	items: WakeProgressItem[];
	// Publication evidence and terminal progress are distinct: an unknown
	// publication must keep its warning until an actual publication is observed.
	publications: WakeProgressEvidence[];
	terminalItems: TerminalWakeProgressEvidence[];
	epoch: string;
	createdAtMs: number;
};
export type SpaceWakeProgressSummary = GetActiveSpaceWakeProgressResponse & {
	presentationEpoch: string;
};
type SpaceViewer = { spaceId: string; openMeldProfileId: string };

function createPresentation(): SpaceWakeProgressPresentation {
	return {
		items: [],
		publications: [],
		terminalItems: [],
		epoch: crypto.randomUUID(),
		createdAtMs: Date.now(),
	};
}

function ensurePresentation(
	queryClient: QueryClient,
	scope: SpaceViewer
): SpaceWakeProgressPresentation {
	const options = spaceWakeProgressPresentationQueryOptions(scope);
	const current = queryClient.getQueryData(options.queryKey);
	if (current) {
		return current;
	}
	const [scopeKey, kindKey] = options.queryKey;
	queryClient.setQueryDefaults([scopeKey, kindKey], {
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
	});
	const created = createPresentation();
	queryClient.setQueryData(options.queryKey, created);
	return created;
}

export function filterSpaceWakeProgressItems(input: {
	presentation: SpaceWakeProgressPresentation;
	items: readonly WakeProgressItem[];
}): WakeProgressItem[] {
	return filterVisibleWakeProgressItems({ items: input.items }).filter(
		(item) =>
			!hasSpaceWakeProgressOutcome({ presentation: input.presentation, item })
	);
}

export function hasSpaceWakeProgressOutcome(input: {
	presentation: SpaceWakeProgressPresentation;
	item: Pick<
		WakeProgressItem,
		| "dispatchId"
		| "targetProfileId"
		| "sourceSignalId"
		| "clientMessageId"
		| "terminal"
	>;
}): boolean {
	return (
		input.presentation.publications.some((outcome) =>
			doWakeProgressItemsMatch({ left: outcome, right: input.item })
		) ||
		input.presentation.terminalItems.some(
			(outcome) =>
				(!input.item.terminal || outcome.phase === "replied") &&
				doWakeProgressItemsMatch({ left: outcome, right: input.item })
		)
	);
}

export function readSpaceWakeProgressSummaryItems(input: {
	presentation: SpaceWakeProgressPresentation;
	summary: SpaceWakeProgressSummary | undefined;
	isFetchedAfterMount?: boolean;
}): WakeProgressItem[] {
	// Old summaries (including requests that outlive GC) cannot rejoin a new
	// cache lifetime after its accepted outcomes have been retired.
	return input.isFetchedAfterMount !== false &&
		input.summary?.presentationEpoch === input.presentation.epoch
		? filterSpaceWakeProgressItems({
				presentation: input.presentation,
				items: input.summary.items,
			})
		: [];
}

export function readCurrentSpaceWakeProgressSummaryItems(
	input: SpaceViewer & {
		queryClient: QueryClient;
		summary: SpaceWakeProgressSummary;
	}
): WakeProgressItem[] {
	return readSpaceWakeProgressSummaryItems({
		presentation: ensurePresentation(input.queryClient, input),
		summary: input.summary,
	});
}

export function recordSpaceWakeProgressEvidence(
	input: SpaceViewer & {
		queryClient: QueryClient;
		signals?: readonly SignalEnvelope[];
		items?: readonly WakeProgressItem[];
	}
): void {
	const current = ensurePresentation(input.queryClient, input);
	const publications = [...current.publications];
	for (const signal of input.signals ?? []) {
		const evidence = readWakeProgressTerminalSignalEvidence(signal);
		if (!evidence) {
			continue;
		}
		const index = publications.findIndex((existing) =>
			doWakeProgressItemsMatch({ left: existing, right: evidence })
		);
		if (index < 0) {
			publications.push(evidence);
		} else if (!publications[index]?.dispatchId && evidence.dispatchId) {
			publications[index] = evidence;
		}
	}
	const terminalItems = [...current.terminalItems];
	for (const item of input.items ?? []) {
		if (!item.terminal) {
			continue;
		}
		const {
			dispatchId,
			clientMessageId,
			sourceSignalId,
			targetProfileId,
			phase,
			updatedAtMs,
		} = item;
		const evidence = {
			dispatchId,
			clientMessageId,
			sourceSignalId,
			targetProfileId,
			phase,
			updatedAtMs,
		};
		const index = terminalItems.findIndex((existing) =>
			doWakeProgressItemsMatch({ left: existing, right: item })
		);
		const previous = terminalItems[index];
		if (index < 0) {
			terminalItems.push(evidence);
		} else if (
			previous &&
			previous.phase !== "replied" &&
			(item.phase === "replied" || item.updatedAtMs >= previous.updatedAtMs)
		) {
			terminalItems[index] = evidence;
		}
	}
	const next = { ...current, publications, terminalItems };
	next.items = filterSpaceWakeProgressItems({
		presentation: next,
		items: current.items,
	});
	input.queryClient.setQueryData(
		spaceWakeProgressPresentationQueryOptions(input).queryKey,
		next
	);
}

export function spaceActiveWakeProgressSummaryQueryOptions(input: {
	enabled: boolean;
	spaceId: string;
	openMeldProfileId: string;
	sourceProfileId?: string;
}) {
	return queryOptions<SpaceWakeProgressSummary, StructuredApiClientFailure>({
		queryKey: [
			...spaceQueryKeys.activeWakeProgressSummary(
				input.spaceId,
				input.openMeldProfileId
			),
			...(input.sourceProfileId ? [input.sourceProfileId] : []),
		],
		queryFn: async ({ client }) => {
			const presentationEpoch = ensurePresentation(client, input).epoch;
			try {
				const response = await createUnscopedWebSpaceApi({
					openMeldProfileId: input.openMeldProfileId,
				}).getActiveWakeProgress({
					...(input.sourceProfileId
						? { sourceProfileId: input.sourceProfileId }
						: {}),
					includePageInfo: true,
					includePreviewText: true,
					includeSourceContext: true,
					includeReplyPlacement: true,
					includeTiming: true,
					includeWaitReason: true,
					includeDeviceWait: true,
					includeWakeStopEligibility: true,
					spaceId: input.spaceId,
					timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
				});
				if (ensurePresentation(client, input).epoch === presentationEpoch) {
					recordSpaceWakeProgressEvidence({
						...input,
						queryClient: client,
						items: response.items,
					});
				}
				return { ...response, presentationEpoch };
			} catch (error) {
				throw toStructuredApiClientFailure(error);
			}
		},
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		retry: false,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnReconnect: "always",
		refetchOnWindowFocus: "always",
	});
}

export function spaceWakeProgressPresentationQueryOptions(input: {
	spaceId: string;
	openMeldProfileId: string;
}) {
	return queryOptions<SpaceWakeProgressPresentation>({
		queryKey: spaceQueryKeys.wakeProgressPresentation(
			input.spaceId,
			input.openMeldProfileId
		),
		queryFn: ({ client }) => ensurePresentation(client, input),
		enabled: false,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		initialData: createPresentation,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

type WakeProgressPresentationItemsUpdate =
	| WakeProgressItem[]
	| ((currentItems: WakeProgressItem[]) => WakeProgressItem[]);

export function setSpaceWakeProgressPresentationItems(input: {
	items: WakeProgressPresentationItemsUpdate;
	queryClient: QueryClient;
	spaceId: string;
	openMeldProfileId: string;
}): void {
	const current = ensurePresentation(input.queryClient, input);
	const items =
		typeof input.items === "function"
			? input.items(current.items)
			: input.items;
	recordSpaceWakeProgressEvidence({ ...input, items });
	const presentation = ensurePresentation(input.queryClient, input);
	input.queryClient.setQueryData(
		spaceWakeProgressPresentationQueryOptions(input).queryKey,
		{
			...presentation,
			items: filterSpaceWakeProgressItems({ presentation, items }),
		}
	);
}
