import {
	getCenterAgentDirectMessageSpaceProjectionResponseSchema,
	organizationSpaceDirectoryWithMemberCountsResponseSchema,
	signalEnvelopeSchema,
} from "@openmeld/schemas";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
	dehydrate,
	hashKey,
	hydrate,
	type Query,
	QueryClient,
} from "@tanstack/react-query";
import {
	type PersistedClient,
	type Persister,
	persistQueryClientRestore,
	persistQueryClientSave,
} from "@tanstack/react-query-persist-client";
import { z } from "zod/v4";
import {
	organizationAppConnectionQueryKeys,
	organizationAppConnectionStatusSummarySchema,
} from "#/query/organizations/app-connections";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";
import { spaceConversationDisplaySnapshotSchema } from "#/query/spaces/display-snapshot";
import { SPACE_INITIAL_HISTORY_MAX_MESSAGES } from "#/query/spaces/history";
import { spaceQueryKeys } from "#/query/spaces/status";
import type {
	DexieQueryCacheStore,
	QueryCacheScope,
	QueryCacheScopeKind,
} from "./dexie-query-cache-store";
import {
	defaultQueryPersistenceDiagnostics,
	hashDiagnosticScope,
	type QueryPersistenceDiagnostic,
	type QueryPersistenceDiagnostics,
	resolvePersistenceErrorName,
} from "./query-persistence-diagnostics";

export type {
	QueryPersistenceDiagnostic,
	QueryPersistenceDiagnostics,
} from "./query-persistence-diagnostics";

export const BROWSER_QUERY_CACHE_MAX_AGE_MS =
	PERSISTED_DISPLAY_QUERY_GC_TIME_MS;
export const BROWSER_QUERY_CACHE_BUSTER = "browser-read-cache-v1";
const PERSISTED_QUERY_STORAGE_KEY = "tanstack-query-cache";

export function buildSpaceConversationQueryCacheScopeId(
	spaceId: string,
	openMeldProfileId: string
): string {
	const normalizedSpaceId = spaceId.trim();
	const normalizedProfileId = openMeldProfileId.trim();
	if (!(normalizedSpaceId && normalizedProfileId)) {
		throw new Error(
			"Space conversation cache identity requires a Space and Human Profile id."
		);
	}
	return JSON.stringify([normalizedSpaceId, normalizedProfileId]);
}

export type BrowserQueryPersistenceController = {
	activateAuthorizedScope: (input: {
		organizationId: string;
		organizationSlug: string;
		ownerAccountId: string;
		queryClient: QueryClient;
	}) => Promise<void>;
	activateSpaceConversation: (input: {
		organizationId: string;
		organizationSlug: string;
		ownerAccountId: string;
		queryClient: QueryClient;
		spaceId: string;
		openMeldProfileId: string;
	}) => Promise<void>;
	clearSpaceConversation: (input: {
		organizationId: string;
		organizationSlug: string;
		ownerAccountId: string;
		queryClient: QueryClient;
		spaceId: string;
		openMeldProfileId: string;
	}) => Promise<void>;
	clearActiveAccount: () => Promise<void>;
	clearOrganization: (
		ownerAccountId: string,
		organizationId: string
	) => Promise<void>;
	clearOrganizationBySlug: (
		ownerAccountId: string,
		organizationSlug: string
	) => Promise<void>;
	deactivate: () => void;
};

type QueryCacheStore = Pick<
	DexieQueryCacheStore,
	| "clearAccount"
	| "clearAll"
	| "clearOrganization"
	| "clearOrganizationBySlug"
	| "createStorage"
>;

type CreateBrowserQueryPersistenceControllerInput = {
	diagnostics?: QueryPersistenceDiagnostics;
	maxAgeMs?: number;
	nowMs?: () => number;
	restoreBudgetMs: number;
	store: QueryCacheStore;
	throttleTimeMs?: number;
};

type ActiveSegment = {
	activation: Promise<void>;
	organizationId: string | null;
	ownerAccountId: string;
	queryClient: QueryClient;
	scopeAlias: string;
	scopeId: string;
	scopeKind: QueryCacheScopeKind;
	targetQueryKeys: readonly (readonly unknown[])[];
	unsubscribe?: () => void;
};

type KnownPersistedQuery = Pick<
	ActiveSegment,
	| "organizationId"
	| "ownerAccountId"
	| "queryClient"
	| "scopeAlias"
	| "scopeId"
	| "scopeKind"
	| "targetQueryKeys"
>;

type AuthorizedScopeActivation = {
	organizationId: string;
	organizationSlug: string;
	ownerAccountId: string;
	promise: Promise<void>;
	queryClient: QueryClient;
};

export function createBrowserQueryPersistenceController(
	input: CreateBrowserQueryPersistenceControllerInput
): BrowserQueryPersistenceController {
	if (
		!Number.isSafeInteger(input.restoreBudgetMs) ||
		input.restoreBudgetMs < 0
	) {
		throw new Error(
			"Browser query restore budget must be a non-negative safe integer."
		);
	}

	const diagnostics = input.diagnostics ?? defaultQueryPersistenceDiagnostics;
	const maxAgeMs = input.maxAgeMs ?? BROWSER_QUERY_CACHE_MAX_AGE_MS;
	const nowMs = input.nowMs ?? defaultNowMs;
	let accountSegment: ActiveSegment | null = null;
	let organizationSegment: ActiveSegment | null = null;
	let spaceSegment: ActiveSegment | null = null;
	let activeOwnerAccountId: string | null = null;
	let unknownOwnerCleanupRequired = false;
	const knownPersistedQueries = new Map<string, KnownPersistedQuery>();
	let authorizedScopeActivation: AuthorizedScopeActivation | null = null;
	let operationQueue = Promise.resolve();

	const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
		const result = operationQueue.then(operation, operation);
		operationQueue = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	};

	const activateSegment = async (options: {
		organizationId?: string;
		ownerAccountId: string;
		queryClient: QueryClient;
		scopeAlias: string;
		scopeId: string;
		scopeKind: QueryCacheScopeKind;
		targetQueryKeys: readonly (readonly unknown[])[];
	}): Promise<void> => {
		const current = resolveActiveSegment(options.scopeKind);
		if (
			current?.ownerAccountId === options.ownerAccountId &&
			current.scopeAlias === options.scopeAlias &&
			current.scopeId === options.scopeId &&
			current.queryClient === options.queryClient
		) {
			return;
		}

		current?.unsubscribe?.();
		const scope: QueryCacheScope = {
			...(options.organizationId === undefined
				? {}
				: { organizationId: options.organizationId }),
			ownerAccountId: options.ownerAccountId,
			scopeAlias: options.scopeAlias,
			scopeId: options.scopeId,
			scopeKind: options.scopeKind,
		};
		const observedPersister = createObservedPersister({
			diagnostics,
			maxAgeMs,
			nowMs,
			scope,
			storage: input.store.createStorage(scope),
			throttleTimeMs: input.throttleTimeMs,
		});
		const segment = {
			activation: Promise.resolve(),
			organizationId: options.organizationId ?? null,
			ownerAccountId: options.ownerAccountId,
			queryClient: options.queryClient,
			scopeAlias: options.scopeAlias,
			scopeId: options.scopeId,
			scopeKind: options.scopeKind,
			targetQueryKeys: options.targetQueryKeys,
		} satisfies ActiveSegment;
		knownPersistedQueries.set(resolveKnownQueryKey(segment), segment);
		segment.activation = restoreAndSubscribe({
			didRestoreUsableClient: observedPersister.didRestoreUsableClient,
			isCurrent: () => resolveActiveSegment(options.scopeKind) === segment,
			maxAgeMs,
			persister: observedPersister.persister,
			queryClient: options.queryClient,
			segment,
			targetQueryKeys: options.targetQueryKeys,
		});
		setActiveSegment(segment);

		await waitWithinRestoreBudget({
			diagnostics,
			promise: segment.activation,
			restoreBudgetMs: input.restoreBudgetMs,
			scopeKind: options.scopeKind,
		});
	};

	function resolveActiveSegment(
		scopeKind: QueryCacheScopeKind
	): ActiveSegment | null {
		switch (scopeKind) {
			case "account":
				return accountSegment;
			case "organization":
				return organizationSegment;
			case "space":
				return spaceSegment;
			default: {
				const unhandled: never = scopeKind;
				throw new Error(`Unsupported query cache scope: ${unhandled}`);
			}
		}
	}

	function setActiveSegment(segment: ActiveSegment): void {
		switch (segment.scopeKind) {
			case "account":
				accountSegment = segment;
				return;
			case "organization":
				organizationSegment = segment;
				return;
			case "space":
				spaceSegment = segment;
				return;
			default: {
				const unhandled: never = segment.scopeKind;
				throw new Error(`Unsupported query cache scope: ${unhandled}`);
			}
		}
	}

	function deactivateSegments(removeQueries: boolean) {
		const previousSegments = [
			accountSegment,
			organizationSegment,
			spaceSegment,
		].filter((segment): segment is ActiveSegment => segment !== null);
		accountSegment?.unsubscribe?.();
		organizationSegment?.unsubscribe?.();
		spaceSegment?.unsubscribe?.();
		accountSegment = null;
		organizationSegment = null;
		spaceSegment = null;
		if (removeQueries) {
			for (const previousSegment of previousSegments) {
				removeSegmentQueries(previousSegment);
			}
		}
	}

	function removeKnownQueries(input: {
		organizationId?: string;
		ownerAccountId: string;
		scopeAlias?: string;
		scopeId?: string;
		scopeKind?: QueryCacheScopeKind;
	}) {
		for (const [key, knownQuery] of knownPersistedQueries) {
			if (
				knownQuery.ownerAccountId !== input.ownerAccountId ||
				(input.organizationId !== undefined &&
					knownQuery.organizationId !== input.organizationId) ||
				(input.scopeAlias !== undefined &&
					knownQuery.scopeAlias !== input.scopeAlias) ||
				(input.scopeId !== undefined && knownQuery.scopeId !== input.scopeId) ||
				(input.scopeKind !== undefined &&
					knownQuery.scopeKind !== input.scopeKind)
			) {
				continue;
			}
			removeSegmentQueries(knownQuery);
			knownPersistedQueries.delete(key);
		}
	}

	function removeAllKnownQueries() {
		for (const knownQuery of knownPersistedQueries.values()) {
			removeSegmentQueries(knownQuery);
		}
		knownPersistedQueries.clear();
	}

	async function clearUnknownOwnerRecords(): Promise<void> {
		unknownOwnerCleanupRequired = true;
		deactivateSegments(true);
		removeAllKnownQueries();
		try {
			await input.store.clearAll();
			unknownOwnerCleanupRequired = false;
			diagnostics.record({
				event: "clear_succeeded",
				scopeKind: "all",
			});
		} catch (error) {
			diagnostics.record({
				errorName: resolvePersistenceErrorName(error),
				event: "clear_failed",
				scopeKind: "all",
			});
			throw error;
		}
	}

	async function clearAccountRecords(ownerAccountId: string): Promise<boolean> {
		deactivateSegments(false);
		removeKnownQueries({ ownerAccountId });
		try {
			await input.store.clearAccount(ownerAccountId);
			diagnostics.record({
				event: "clear_succeeded",
				scopeHash: hashDiagnosticScope(ownerAccountId),
				scopeKind: "account",
			});
			return true;
		} catch (error) {
			diagnostics.record({
				errorName: resolvePersistenceErrorName(error),
				event: "clear_failed",
				scopeHash: hashDiagnosticScope(ownerAccountId),
				scopeKind: "account",
			});
			return false;
		}
	}

	return {
		activateAuthorizedScope: ({
			organizationId,
			organizationSlug,
			ownerAccountId,
			queryClient,
		}) => {
			if (
				authorizedScopeActivation?.organizationId === organizationId &&
				authorizedScopeActivation.organizationSlug === organizationSlug &&
				authorizedScopeActivation.ownerAccountId === ownerAccountId &&
				authorizedScopeActivation.queryClient === queryClient
			) {
				return authorizedScopeActivation.promise;
			}
			const operation = runExclusive(async () => {
				if (unknownOwnerCleanupRequired) {
					try {
						await clearUnknownOwnerRecords();
					} catch {
						// Keep persistence disabled until a later activation can complete
						// the unknown previous-account cleanup.
						return false;
					}
				}
				if (
					activeOwnerAccountId !== null &&
					activeOwnerAccountId !== ownerAccountId
				) {
					const previousOwnerAccountId = activeOwnerAccountId;
					if (!(await clearAccountRecords(previousOwnerAccountId))) {
						// Keep the previous owner marker so the next activation retries the
						// cleanup. Browser persistence stays inactive meanwhile; the route's
						// normal network reads continue.
						return false;
					}
				}
				activeOwnerAccountId = ownerAccountId;
				if (
					spaceSegment !== null &&
					(spaceSegment.ownerAccountId !== ownerAccountId ||
						spaceSegment.organizationId !== organizationId ||
						spaceSegment.queryClient !== queryClient)
				) {
					spaceSegment.unsubscribe?.();
					removeSegmentQueries(spaceSegment);
					spaceSegment = null;
				}
				await Promise.all([
					activateSegment({
						ownerAccountId,
						queryClient,
						scopeAlias: ownerAccountId,
						scopeId: ownerAccountId,
						scopeKind: "account",
						targetQueryKeys: [
							startQueryKeys.profilesForStorageScope(ownerAccountId),
						],
					}),
					activateSegment({
						organizationId,
						ownerAccountId,
						queryClient,
						scopeAlias: organizationSlug,
						scopeId: organizationId,
						scopeKind: "organization",
						targetQueryKeys: [
							organizationQueryKeys.spaces(organizationId),
							organizationAppConnectionQueryKeys.statusSummary(organizationId),
							centerAgentQueryKeys.directMessageSpaceProjection(organizationId),
						],
					}),
				]);
				return true;
			});
			const activation = {
				organizationId,
				organizationSlug,
				ownerAccountId,
				promise: Promise.resolve(),
				queryClient,
			} satisfies AuthorizedScopeActivation;
			const completion = operation.then((activated) => {
				if (!activated && authorizedScopeActivation === activation) {
					authorizedScopeActivation = null;
				}
			});
			activation.promise = waitWithinRestoreBudget({
				diagnostics,
				promise: completion,
				restoreBudgetMs: input.restoreBudgetMs,
				scopeKind: "all",
			});
			authorizedScopeActivation = activation;
			return activation.promise;
		},
		activateSpaceConversation: ({
			organizationId,
			organizationSlug,
			ownerAccountId,
			queryClient,
			spaceId,
			openMeldProfileId,
		}) => {
			const operation = runExclusive(async () => {
				if (
					activeOwnerAccountId !== ownerAccountId ||
					organizationSegment?.ownerAccountId !== ownerAccountId ||
					organizationSegment.organizationId !== organizationId ||
					organizationSegment.scopeAlias !== organizationSlug ||
					organizationSegment.queryClient !== queryClient
				) {
					return;
				}
				await activateSegment({
					organizationId,
					ownerAccountId,
					queryClient,
					scopeAlias: organizationSlug,
					scopeId: buildSpaceConversationQueryCacheScopeId(
						spaceId,
						openMeldProfileId
					),
					scopeKind: "space",
					targetQueryKeys: [
						spaceQueryKeys.history(spaceId, openMeldProfileId),
						spaceQueryKeys.displaySnapshot(spaceId, openMeldProfileId),
					],
				});
			});
			return waitWithinRestoreBudget({
				diagnostics,
				promise: operation,
				restoreBudgetMs: input.restoreBudgetMs,
				scopeKind: "space",
			});
		},
		clearSpaceConversation: async ({
			organizationId,
			organizationSlug,
			ownerAccountId,
			queryClient,
			spaceId,
			openMeldProfileId,
		}) => {
			const scopeId = buildSpaceConversationQueryCacheScopeId(
				spaceId,
				openMeldProfileId
			);
			await runExclusive(async () => {
				if (
					spaceSegment?.ownerAccountId === ownerAccountId &&
					spaceSegment.organizationId === organizationId &&
					spaceSegment.scopeId === scopeId &&
					spaceSegment.queryClient === queryClient
				) {
					spaceSegment.unsubscribe?.();
					spaceSegment = null;
				}
				removeKnownQueries({
					ownerAccountId,
					scopeId,
					scopeKind: "space",
				});
				const scope = {
					organizationId,
					ownerAccountId,
					scopeAlias: organizationSlug,
					scopeId,
					scopeKind: "space",
				} satisfies QueryCacheScope;
				try {
					await input.store
						.createStorage(scope)
						.removeItem(PERSISTED_QUERY_STORAGE_KEY);
					diagnostics.record({
						event: "clear_succeeded",
						scopeHash: hashDiagnosticScope(ownerAccountId, scopeId),
						scopeKind: "space",
					});
				} catch (error) {
					diagnostics.record({
						errorName: resolvePersistenceErrorName(error),
						event: "clear_failed",
						scopeHash: hashDiagnosticScope(ownerAccountId, scopeId),
						scopeKind: "space",
					});
					throw error;
				}
			});
		},
		clearActiveAccount: async () => {
			authorizedScopeActivation = null;
			await runExclusive(async () => {
				if (activeOwnerAccountId === null) {
					await clearUnknownOwnerRecords();
					return;
				}
				const ownerAccountId = activeOwnerAccountId;
				const cleared = await clearAccountRecords(ownerAccountId);
				if (cleared) {
					activeOwnerAccountId = null;
					return;
				}
				throw new Error("Could not clear the active saved account read cache.");
			});
		},
		clearOrganization: async (ownerAccountId, organizationId) => {
			if (
				authorizedScopeActivation?.ownerAccountId === ownerAccountId &&
				authorizedScopeActivation.organizationId === organizationId
			) {
				authorizedScopeActivation = null;
			}
			await runExclusive(async () => {
				if (
					spaceSegment?.ownerAccountId === ownerAccountId &&
					spaceSegment.organizationId === organizationId
				) {
					spaceSegment.unsubscribe?.();
					spaceSegment = null;
				}
				if (
					organizationSegment?.ownerAccountId === ownerAccountId &&
					organizationSegment.scopeId === organizationId
				) {
					organizationSegment.unsubscribe?.();
					organizationSegment = null;
				}
				removeKnownQueries({
					organizationId,
					ownerAccountId,
				});
				try {
					await input.store.clearOrganization(ownerAccountId, organizationId);
					diagnostics.record({
						event: "clear_succeeded",
						scopeHash: hashDiagnosticScope(ownerAccountId, organizationId),
						scopeKind: "organization",
					});
				} catch (error) {
					diagnostics.record({
						errorName: resolvePersistenceErrorName(error),
						event: "clear_failed",
						scopeHash: hashDiagnosticScope(ownerAccountId, organizationId),
						scopeKind: "organization",
					});
					throw error;
				}
			});
		},
		clearOrganizationBySlug: async (ownerAccountId, organizationSlug) => {
			if (
				authorizedScopeActivation?.ownerAccountId === ownerAccountId &&
				authorizedScopeActivation.organizationSlug === organizationSlug
			) {
				authorizedScopeActivation = null;
			}
			await runExclusive(async () => {
				if (
					spaceSegment?.ownerAccountId === ownerAccountId &&
					spaceSegment.scopeAlias === organizationSlug
				) {
					spaceSegment.unsubscribe?.();
					spaceSegment = null;
				}
				if (
					organizationSegment?.ownerAccountId === ownerAccountId &&
					organizationSegment.scopeAlias === organizationSlug
				) {
					organizationSegment.unsubscribe?.();
					organizationSegment = null;
				}
				removeKnownQueries({
					ownerAccountId,
					scopeAlias: organizationSlug,
				});
				try {
					await input.store.clearOrganizationBySlug(
						ownerAccountId,
						organizationSlug
					);
					diagnostics.record({
						event: "clear_succeeded",
						scopeHash: hashDiagnosticScope(ownerAccountId, organizationSlug),
						scopeKind: "organization",
					});
				} catch (error) {
					diagnostics.record({
						errorName: resolvePersistenceErrorName(error),
						event: "clear_failed",
						scopeHash: hashDiagnosticScope(ownerAccountId, organizationSlug),
						scopeKind: "organization",
					});
					throw error;
				}
			});
		},
		deactivate: () => {
			deactivateSegments(false);
			activeOwnerAccountId = null;
			authorizedScopeActivation = null;
			knownPersistedQueries.clear();
		},
	};
}

function resolveKnownQueryKey(segment: KnownPersistedQuery): string {
	return JSON.stringify([
		segment.ownerAccountId,
		segment.scopeKind,
		segment.scopeId,
	]);
}

function removeSegmentQueries(segment: KnownPersistedQuery): void {
	for (const targetQueryKey of segment.targetQueryKeys) {
		segment.queryClient.removeQueries({
			exact: true,
			queryKey: targetQueryKey,
		});
	}
}

async function restoreAndSubscribe(input: {
	didRestoreUsableClient: () => boolean;
	isCurrent: () => boolean;
	maxAgeMs: number;
	persister: Persister;
	queryClient: QueryClient;
	segment: ActiveSegment;
	targetQueryKeys: readonly (readonly unknown[])[];
}): Promise<void> {
	const dataUpdatedAtBeforeRestore = new Map(
		input.targetQueryKeys.map((targetQueryKey) => [
			hashKey(targetQueryKey),
			input.queryClient.getQueryState(targetQueryKey)?.dataUpdatedAt,
		])
	);
	const restoreQueryClient = new QueryClient({
		defaultOptions: {
			queries: { gcTime: Number.POSITIVE_INFINITY },
		},
	});
	try {
		await persistQueryClientRestore({
			buster: BROWSER_QUERY_CACHE_BUSTER,
			maxAge: input.maxAgeMs,
			persister: input.persister,
			queryClient: restoreQueryClient,
		});
	} catch {
		// The observed persister records the failure. Browser persistence is an
		// acceleration layer, so a restore failure must not block the route read
		// or prevent a later successful network result from repairing the cache.
	}
	if (!input.isCurrent()) {
		return;
	}
	hydrate(
		input.queryClient,
		dehydrate(restoreQueryClient, {
			shouldDehydrateMutation: () => false,
			shouldDehydrateQuery: (query: Query) =>
				isApprovedSuccessfulQuery(
					query,
					input.targetQueryKeys,
					input.segment.scopeKind
				),
		})
	);
	if (input.didRestoreUsableClient()) {
		await Promise.all(
			input.targetQueryKeys.map(async (targetQueryKey) => {
				const restoredState = input.queryClient.getQueryState(targetQueryKey);
				const previousUpdatedAt = dataUpdatedAtBeforeRestore.get(
					hashKey(targetQueryKey)
				);
				if (
					restoredState !== undefined &&
					(previousUpdatedAt === undefined ||
						restoredState.dataUpdatedAt > previousUpdatedAt)
				) {
					await input.queryClient.invalidateQueries({
						exact: true,
						queryKey: targetQueryKey,
						refetchType: "none",
					});
				}
			})
		);
	}
	if (!input.isCurrent()) {
		return;
	}
	const saveOptions = {
		buster: BROWSER_QUERY_CACHE_BUSTER,
		dehydrateOptions: {
			...resolvePersistedDataSerializer(input.segment.scopeKind),
			shouldDehydrateMutation: () => false,
			shouldDehydrateQuery: (query: Query) =>
				isApprovedSuccessfulQuery(
					query,
					input.targetQueryKeys,
					input.segment.scopeKind
				),
		},
		persister: input.persister,
		queryClient: input.queryClient,
	};
	input.segment.unsubscribe = input.queryClient
		.getQueryCache()
		.subscribe((event) => {
			if (
				event.type !== "updated" ||
				event.action.type !== "success" ||
				!isApprovedSuccessfulQuery(
					event.query,
					input.targetQueryKeys,
					input.segment.scopeKind
				)
			) {
				return;
			}
			persistQueryClientSave(saveOptions);
		});
}

const spaceHistorySnapshotSchema = z.strictObject({
	envelopes: z
		.array(signalEnvelopeSchema)
		.max(SPACE_INITIAL_HISTORY_MAX_MESSAGES),
	nextCursor: z.string().nullable(),
});

function resolvePersistedDataSerializer(scopeKind: QueryCacheScopeKind): {
	serializeData?: (data: unknown) => unknown;
} {
	switch (scopeKind) {
		case "account":
			return {};
		case "organization":
			return { serializeData: redactOrganizationPersistedDisplayData };
		case "space":
			return { serializeData: serializeSpacePersistedDisplayData };
		default: {
			const unhandled: never = scopeKind;
			throw new Error(`Unsupported query cache scope: ${unhandled}`);
		}
	}
}

function serializeSpacePersistedDisplayData(data: unknown): unknown {
	const displaySnapshot =
		spaceConversationDisplaySnapshotSchema.safeParse(data);
	if (displaySnapshot.success) {
		return displaySnapshot.data;
	}
	return spaceHistorySnapshotSchema.parse(data);
}

function redactOrganizationPersistedDisplayData(data: unknown): unknown {
	const centerAgentProjection =
		getCenterAgentDirectMessageSpaceProjectionResponseSchema.safeParse(data);
	if (centerAgentProjection.success) {
		return centerAgentProjection.data;
	}
	const statusSummary =
		organizationAppConnectionStatusSummarySchema.safeParse(data);
	if (statusSummary.success) {
		return statusSummary.data;
	}
	return redactOrganizationDirectoryActivity(data);
}

function redactOrganizationDirectoryActivity(data: unknown): unknown {
	const directory =
		organizationSpaceDirectoryWithMemberCountsResponseSchema.parse(data);
	return {
		...directory,
		spaces: directory.spaces.map((space) => ({
			...space,
			// `joined` is retained only as a stale grouping hint. It never enables
			// mutations, and the more sensitive activity timestamp is not stored.
			lastJoinedAt: null,
		})),
	};
}

function isApprovedSuccessfulQuery(
	query: Query,
	targetQueryKeys: readonly (readonly unknown[])[],
	scopeKind: QueryCacheScopeKind
): boolean {
	const targetQueryKey = targetQueryKeys.find(
		(candidate) => query.queryHash === hashKey(candidate)
	);
	const approved =
		query.state.status === "success" && targetQueryKey !== undefined;
	if (!(approved && scopeKind === "space")) {
		return approved;
	}
	if (targetQueryKey[1] === "history") {
		return spaceHistorySnapshotSchema.safeParse(query.state.data).success;
	}
	if (targetQueryKey[1] === "display-snapshot") {
		return spaceConversationDisplaySnapshotSchema.safeParse(query.state.data)
			.success;
	}
	return false;
}

function createObservedPersister(input: {
	diagnostics: QueryPersistenceDiagnostics;
	maxAgeMs: number;
	nowMs: () => number;
	scope: QueryCacheScope;
	storage: ReturnType<QueryCacheStore["createStorage"]>;
	throttleTimeMs?: number;
}): { didRestoreUsableClient: () => boolean; persister: Persister } {
	let restoredUsableClient = false;
	const observedStorage = {
		getItem: input.storage.getItem,
		removeItem: input.storage.removeItem,
		setItem: async (key: string, payload: string) => {
			const startedAtMs = input.nowMs();
			try {
				await input.storage.setItem(key, payload);
				input.diagnostics.record({
					durationMs: elapsedMs(input.nowMs, startedAtMs),
					event: "save_succeeded",
					scopeKind: input.scope.scopeKind,
					sizeBytes: new TextEncoder().encode(payload).byteLength,
				});
			} catch (error) {
				const errorName = resolvePersistenceErrorName(error);
				if (errorName === "QuotaExceededError") {
					input.diagnostics.record({
						durationMs: elapsedMs(input.nowMs, startedAtMs),
						errorName,
						event: "quota_failed",
						scopeKind: input.scope.scopeKind,
					});
				}
				input.diagnostics.record({
					durationMs: elapsedMs(input.nowMs, startedAtMs),
					errorName,
					event: "save_failed",
					scopeKind: input.scope.scopeKind,
				});
				throw error;
			}
		},
	};
	const basePersister = createAsyncStoragePersister({
		deserialize: (payload) => {
			try {
				return JSON.parse(payload) as PersistedClient;
			} catch (error) {
				input.diagnostics.record({
					errorName: resolvePersistenceErrorName(error),
					event: "corruption_failed",
					scopeKind: input.scope.scopeKind,
				});
				throw error;
			}
		},
		key: PERSISTED_QUERY_STORAGE_KEY,
		retry: () => undefined,
		serialize: (client) => {
			try {
				return JSON.stringify(client);
			} catch (error) {
				input.diagnostics.record({
					errorName: resolvePersistenceErrorName(error),
					event: "serialization_failed",
					scopeKind: input.scope.scopeKind,
				});
				throw error;
			}
		},
		storage: observedStorage,
		throttleTime: input.throttleTimeMs,
	});

	const persister: Persister = {
		persistClient: basePersister.persistClient,
		removeClient: async () => await basePersister.removeClient(),
		restoreClient: async () => {
			restoredUsableClient = false;
			const startedAtMs = input.nowMs();
			try {
				const client = await basePersister.restoreClient();
				if (!client) {
					input.diagnostics.record({
						durationMs: elapsedMs(input.nowMs, startedAtMs),
						event: "restore_miss",
						scopeKind: input.scope.scopeKind,
					});
					return undefined;
				}
				const expired = Date.now() - client.timestamp > input.maxAgeMs;
				const busted = client.buster !== BROWSER_QUERY_CACHE_BUSTER;
				restoredUsableClient = !(expired || busted);
				let restoreEvent: QueryPersistenceDiagnostic["event"] = "restore_hit";
				if (expired) {
					restoreEvent = "restore_expired";
				} else if (busted) {
					restoreEvent = "restore_buster_mismatch";
				}
				input.diagnostics.record({
					durationMs: elapsedMs(input.nowMs, startedAtMs),
					event: restoreEvent,
					scopeKind: input.scope.scopeKind,
					sizeBytes: estimatePersistedClientSize(client),
				});
				return client;
			} catch (error) {
				input.diagnostics.record({
					durationMs: elapsedMs(input.nowMs, startedAtMs),
					errorName: resolvePersistenceErrorName(error),
					event: "restore_failed",
					scopeKind: input.scope.scopeKind,
				});
				throw error;
			}
		},
	};
	return {
		didRestoreUsableClient: () => restoredUsableClient,
		persister,
	};
}

async function waitWithinRestoreBudget(input: {
	diagnostics: QueryPersistenceDiagnostics;
	promise: Promise<void>;
	restoreBudgetMs: number;
	scopeKind: QueryPersistenceDiagnostic["scopeKind"];
}): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<void>((resolve) => {
		timeout = setTimeout(() => {
			input.diagnostics.record({
				durationMs: input.restoreBudgetMs,
				event: "restore_timed_out",
				scopeKind: input.scopeKind,
			});
			resolve();
		}, input.restoreBudgetMs);
	});
	await Promise.race([input.promise, timeoutPromise]);
	if (timeout !== undefined) {
		clearTimeout(timeout);
	}
}

function estimatePersistedClientSize(client: PersistedClient): number {
	return new TextEncoder().encode(JSON.stringify(client)).byteLength;
}

function elapsedMs(nowMs: () => number, startedAtMs: number): number {
	return Math.max(0, nowMs() - startedAtMs);
}

function defaultNowMs(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}
