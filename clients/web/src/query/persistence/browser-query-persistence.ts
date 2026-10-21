import {
	accountSidebarResponseSchema,
	getCenterAgentDirectMessageSpaceProjectionResponseSchema,
	listSpaceThreadsResponseSchema,
	organizationSpaceDirectoryWithMemberCountsResponseSchema,
	signalEnvelopeSchema,
	spaceHistoryNavigationSchema,
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
} from "@tanstack/react-query-persist-client";
import { z } from "zod/v4";
import { observeSpaceOpen } from "#/lib/observability/space-open";
import { accountSidebarQueryKey } from "#/query/account/sidebar-preferences";
import { currentComputerToolbarDisplaySnapshotSchema } from "#/query/connect/current-computer-toolbar-display-snapshot";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	organizationPluginConnectionQueryKeys,
	organizationPluginConnectionStatusSummarySchema,
} from "#/query/organizations/plugin-connections";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";
import {
	spaceComposerTrayDisplayQueryKey,
	spaceComposerTrayDisplaySchema,
} from "#/query/spaces/composer-tray-display";
import { spaceConversationDisplaySnapshotSchema } from "#/query/spaces/display-snapshot";
import {
	spaceHeaderTitleDisplayQueryKey,
	spaceHeaderTitleDisplaySchema,
} from "#/query/spaces/header-title-display";
import {
	mergeSpaceHistorySnapshots,
	SPACE_SAVED_HISTORY_MAX_BYTES,
	SPACE_SAVED_THREAD_DISPLAY_MAX_BYTES,
} from "#/query/spaces/history";
import { spaceMemberDirectoryDisplaySchema } from "#/query/spaces/member-directory-display";
import {
	seedSidebarDisplaySnapshot,
	sidebarDisplaySnapshotQueryKey,
	sidebarDisplaySnapshotSchema,
} from "#/query/spaces/sidebar-display-snapshot";
import { clearSpaceFileMediaResources } from "#/query/spaces/space-file-media-resource";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	accountMemberSpacesDisplayQueryKey,
	accountMemberSpacesDisplaySchema,
	spaceViewerMembershipDisplayQueryKey,
	spaceViewerMembershipDisplaySchema,
} from "#/query/spaces/viewer-membership-display";
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
	restoreSpaceConversation: (input: {
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

type QueryCacheStore = Partial<Pick<DexieQueryCacheStore, "subscribe">> &
	Pick<
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
	flushPending?: () => Promise<void>;
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

	// Background flushes of segments the user navigated away from. A clear
	// must wait for them, or a late write could restore cleared account data.
	const pendingFlushes = new Set<Promise<void>>();
	const trackPendingFlush = (flush: Promise<void> | undefined) => {
		if (!flush) {
			return;
		}
		const tracked: Promise<void> = flush
			.catch((error: unknown) =>
				console.error("Could not save a browser read cache snapshot.", error)
			)
			.finally(() => {
				pendingFlushes.delete(tracked);
			});
		pendingFlushes.add(tracked);
	};
	const settlePendingFlushes = async () => {
		while (pendingFlushes.size > 0) {
			await Promise.all(pendingFlushes);
		}
	};

	const activateSegment = async (options: {
		/** Runs once the saved queries are in the cache, if still current. */
		onRestored?: () => void;
		readOnly?: boolean;
		reload?: boolean;
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
			!options.reload &&
			current?.ownerAccountId === options.ownerAccountId &&
			current.scopeAlias === options.scopeAlias &&
			current.scopeId === options.scopeId &&
			current.queryClient === options.queryClient
		) {
			return;
		}

		if (!options.readOnly) {
			// The flush captures the outgoing segment's snapshot synchronously,
			// while it is still current, so navigation need not wait for the
			// storage write. Only a reload of the same saved scope reads what
			// the flush writes; every clear settles pending flushes first.
			const flush = current?.flushPending?.();
			if (
				current &&
				current.scopeKind === options.scopeKind &&
				current.ownerAccountId === options.ownerAccountId &&
				current.scopeAlias === options.scopeAlias &&
				current.scopeId === options.scopeId
			) {
				await flush;
			} else {
				trackPendingFlush(flush);
			}
			current?.unsubscribe?.();
		}
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
			// Coalesce before dehydration. Keep a short storage interval so
			// overlapping writes do not spin on zero-delay retries.
			throttleTimeMs: Math.min(100, input.throttleTimeMs ?? 1000),
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
			diagnostics,
			isCurrent: () =>
				options.readOnly
					? knownPersistedQueries.get(resolveKnownQueryKey(segment)) ===
							segment &&
						activeOwnerAccountId === options.ownerAccountId &&
						organizationSegment?.organizationId === options.organizationId &&
						organizationSegment?.queryClient === options.queryClient
					: resolveActiveSegment(options.scopeKind) === segment,
			maxAgeMs,
			nowMs,
			persister: observedPersister.persister,
			queryClient: options.queryClient,
			saveDelayMs: input.throttleTimeMs ?? 1000,
			segment,
			subscribe: !options.readOnly,
			targetQueryKeys: options.targetQueryKeys,
		});
		if (!options.readOnly) {
			setActiveSegment(segment);
		}
		const { onRestored } = options;
		if (onRestored) {
			segment.activation.then(
				() => {
					if (resolveActiveSegment(options.scopeKind) === segment) {
						onRestored();
					}
				},
				() => undefined
			);
		}

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
			await settlePendingFlushes();
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
			await settlePendingFlushes();
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

	async function discardExternalSegment(segment: ActiveSegment) {
		segment.unsubscribe?.();
		await Promise.all(
			segment.targetQueryKeys.map((key) =>
				segment.queryClient.cancelQueries({ queryKey: key, exact: true })
			)
		);
		removeSegmentQueries(segment);
		if (segment === spaceSegment) {
			spaceSegment = null;
		}
		if (segment === organizationSegment) {
			organizationSegment = null;
		}
		if (segment === accountSegment) {
			accountSegment = null;
		}
	}

	async function refreshExternalSegment(
		segment: ActiveSegment,
		cleared: boolean
	) {
		const scope = {
			...segment,
			organizationId: segment.organizationId ?? undefined,
		};
		if (cleared) {
			const storage = input.store.createStorage(scope);
			const removed =
				(await storage.getItem(PERSISTED_QUERY_STORAGE_KEY)) === null;
			if (removed) {
				await discardExternalSegment(segment);
			}
			// Notifications are refresh signals, never access authority.
			await segment.queryClient.invalidateQueries({ queryKey: ["spaces"] });
			if (removed) {
				return;
			}
		}
		await activateSegment({ ...scope, reload: true });
	}

	input.store.subscribe?.((cleared) => {
		runExclusive(async () => {
			await Promise.all(
				[accountSegment, organizationSegment, spaceSegment]
					.filter((segment): segment is ActiveSegment => segment !== null)
					.map((segment) => refreshExternalSegment(segment, cleared))
			);
		}).catch((error: unknown) =>
			console.error("Failed to refresh saved browser views.", error)
		);
	});
	const openSpaceConversation = (
		{
			organizationId,
			organizationSlug,
			ownerAccountId,
			queryClient,
			spaceId,
			openMeldProfileId,
		}: Parameters<
			BrowserQueryPersistenceController["activateSpaceConversation"]
		>[0],
		readOnly: boolean
	) => {
		const hasDisplay = Boolean(
			queryClient.getQueryData(
				spaceQueryKeys.history(spaceId, openMeldProfileId)
			) &&
				queryClient.getQueryData(
					spaceQueryKeys.displaySnapshot(spaceId, openMeldProfileId)
				)
		);
		observeSpaceOpen(spaceId, { cache: hasDisplay ? "memory" : "cold" });
		// Route prefetch only needs a display snapshot. Re-reading and validating
		// the saved segment on every warm revisit delays the route and repeats the
		// same work again when the mounted Space activates its save subscription.
		// Activation still checks disk for newer cross-window data.
		if (
			readOnly &&
			hasDisplay &&
			queryClient.getQueryData(
				spaceQueryKeys.historyNavigation(spaceId, openMeldProfileId)
			)
		) {
			return Promise.resolve();
		}
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
				readOnly,
				scopeAlias: organizationSlug,
				scopeId: buildSpaceConversationQueryCacheScopeId(
					spaceId,
					openMeldProfileId
				),
				scopeKind: "space",
				targetQueryKeys: [
					spaceQueryKeys.history(spaceId, openMeldProfileId),
					spaceQueryKeys.displaySnapshot(spaceId, openMeldProfileId),
					spaceQueryKeys.memberDirectoryDisplay(spaceId, openMeldProfileId),
					spaceQueryKeys.historyNavigation(spaceId, openMeldProfileId),
					spaceViewerMembershipDisplayQueryKey(spaceId, openMeldProfileId),
					spaceHeaderTitleDisplayQueryKey(spaceId, openMeldProfileId),
					spaceComposerTrayDisplayQueryKey(spaceId, openMeldProfileId),
				],
			});
		});
		return waitWithinRestoreBudget({
			diagnostics,
			promise: operation,
			restoreBudgetMs: input.restoreBudgetMs,
			scopeKind: "space",
		});
	};
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
							startQueryKeys.currentComputerToolbarDisplaySnapshot(
								ownerAccountId
							),
						],
					}),
					activateSegment({
						organizationId,
						ownerAccountId,
						queryClient,
						scopeAlias: organizationSlug,
						scopeId: organizationId,
						scopeKind: "organization",
						// The sidebar paints its rows from the saved snapshot until its
						// reads return.
						onRestored: () =>
							seedSidebarDisplaySnapshot(queryClient, {
								organizationId,
								ownerAccountId,
							}),
						targetQueryKeys: [
							organizationQueryKeys.spaces(organizationId),
							accountSidebarQueryKey(ownerAccountId, organizationId),
							accountMemberSpacesDisplayQueryKey(
								ownerAccountId,
								organizationId
							),
							sidebarDisplaySnapshotQueryKey(ownerAccountId, organizationId),
							organizationPluginConnectionQueryKeys.statusSummary(
								organizationId
							),
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
		activateSpaceConversation: (space) => openSpaceConversation(space, false),
		restoreSpaceConversation: (space) => openSpaceConversation(space, true),
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
					spaceSegment !== null &&
					spaceSegment.ownerAccountId === ownerAccountId &&
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
					await settlePendingFlushes();
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
					await settlePendingFlushes();
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
					await settlePendingFlushes();
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
	if (segment.scopeKind === "account") {
		clearSpaceFileMediaResources(segment.queryClient);
	} else if (segment.scopeKind === "space") {
		const spaceId = segment.targetQueryKeys.find(
			(key) => key[0] === "spaces" && key[1] === "history"
		)?.[2];
		if (typeof spaceId === "string") {
			clearSpaceFileMediaResources(segment.queryClient, spaceId);
		}
	}
	for (const targetQueryKey of segment.targetQueryKeys) {
		segment.queryClient.removeQueries({
			exact: true,
			queryKey: targetQueryKey,
		});
	}
}

async function restoreAndSubscribe(input: {
	didRestoreUsableClient: () => boolean;
	diagnostics: QueryPersistenceDiagnostics;
	isCurrent: () => boolean;
	maxAgeMs: number;
	nowMs: () => number;
	persister: Persister;
	queryClient: QueryClient;
	saveDelayMs: number;
	segment: ActiveSegment;
	subscribe: boolean;
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
	const restored = dehydrate(restoreQueryClient, {
		shouldDehydrateMutation: () => false,
		shouldDehydrateQuery: (query: Query) =>
			isApprovedSuccessfulQuery(
				query,
				input.targetQueryKeys,
				input.segment.scopeKind
			),
	});
	// Another tab may have loaded additional pages without a newer server read.
	// Preserve those pages even when TanStack's timestamp-based hydrate skips it.
	for (const query of restored.queries) {
		if (query.queryKey[0] !== "spaces" || query.queryKey[1] !== "history") {
			continue;
		}
		const current = input.queryClient.getQueryState(query.queryKey);
		const currentHistory = spaceHistorySnapshotSchema.safeParse(current?.data);
		const savedHistory = spaceHistorySnapshotSchema.safeParse(query.state.data);
		if (!(currentHistory.success && savedHistory.success && current)) {
			continue;
		}
		const savedIsNewer = query.state.dataUpdatedAt > current.dataUpdatedAt;
		input.queryClient.setQueryData(
			query.queryKey,
			mergeSpaceHistorySnapshots({
				current: savedIsNewer ? currentHistory.data : savedHistory.data,
				incoming: savedIsNewer ? savedHistory.data : currentHistory.data,
			}),
			{ updatedAt: Math.max(current.dataUpdatedAt, query.state.dataUpdatedAt) }
		);
	}
	hydrate(input.queryClient, restored);
	if (input.segment.scopeKind === "space") {
		const history = restored.queries.find(
			(query) =>
				query.queryKey[0] === "spaces" && query.queryKey[1] === "history"
		);
		const display = restored.queries.find(
			(query) =>
				query.queryKey[0] === "spaces" &&
				query.queryKey[1] === "display-snapshot"
		);
		const spaceId = history?.queryKey[2];
		if (
			history &&
			typeof spaceId === "string" &&
			display &&
			dataUpdatedAtBeforeRestore.get(hashKey(history.queryKey)) === undefined
		) {
			observeSpaceOpen(spaceId, { cache: "restored" });
		}
	}
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
	if (!(input.isCurrent() && input.subscribe)) {
		return;
	}
	const dehydrateOptions = {
		...resolvePersistedDataSerializer(input.segment.scopeKind),
		shouldDehydrateMutation: () => false,
		shouldDehydrateQuery: (query: Query) =>
			isApprovedSuccessfulQuery(
				query,
				input.targetQueryKeys,
				input.segment.scopeKind
			),
	};
	const targetQueryHashes = new Set(input.targetQueryKeys.map(hashKey));
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const save = async () => {
		if (!input.isCurrent()) {
			return;
		}
		const startedAtMs = input.nowMs();
		const clientState = dehydrate(input.queryClient, dehydrateOptions);
		input.diagnostics.record({
			durationMs: elapsedMs(input.nowMs, startedAtMs),
			event: "save_preparation",
			scopeKind: input.segment.scopeKind,
		});
		if (clientState.queries.length === 0) {
			return;
		}
		await input.persister.persistClient({
			buster: BROWSER_QUERY_CACHE_BUSTER,
			clientState,
			timestamp: Date.now(),
		});
	};
	input.segment.flushPending = async () => {
		if (saveTimer === null) {
			return;
		}
		clearTimeout(saveTimer);
		saveTimer = null;
		await save();
	};
	const unsubscribe = input.queryClient.getQueryCache().subscribe((event) => {
		if (
			event.type !== "updated" ||
			event.action.type !== "success" ||
			!targetQueryHashes.has(event.query.queryHash)
		) {
			return;
		}
		if (input.saveDelayMs <= 0) {
			save().catch((error: unknown) =>
				console.error("Could not save a browser read cache snapshot.", error)
			);
			return;
		}
		if (saveTimer === null) {
			saveTimer = setTimeout(() => {
				saveTimer = null;
				save().catch((error: unknown) =>
					console.error("Could not save a browser read cache snapshot.", error)
				);
			}, input.saveDelayMs);
		}
	});
	input.segment.unsubscribe = () => {
		if (saveTimer !== null) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		unsubscribe();
	};
}

const spaceHistorySnapshotSchema = z.strictObject({
	personalHistoryDeletedAt: z.number().int().nonnegative().optional(),
	confirmedCursor: z.string().nullable().optional(),
	threadDisplay: listSpaceThreadsResponseSchema
		.refine(
			(snapshot) =>
				new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <=
				SPACE_SAVED_THREAD_DISPLAY_MAX_BYTES
		)
		.optional(),
	envelopes: z
		.array(signalEnvelopeSchema)
		.refine(
			(items) =>
				new TextEncoder().encode(JSON.stringify(items)).byteLength <=
				SPACE_SAVED_HISTORY_MAX_BYTES + items.length + 2
		),
	nextCursor: z.string().nullable(),
});

/** Called inside the IndexedDB write transaction, so two tabs retain both
 * sets of loaded pages. For duplicate signals the newer query snapshot wins. */
export function mergePersistedBrowserViews(
	existing: string,
	incoming: string
): string {
	try {
		const previous = JSON.parse(existing) as PersistedClient;
		const next = JSON.parse(incoming) as PersistedClient;
		if (
			previous.buster !== next.buster ||
			!Array.isArray(previous.clientState?.queries) ||
			!Array.isArray(next.clientState?.queries)
		) {
			return incoming;
		}
		const queries = new Map(
			previous.clientState.queries.map((query) => [query.queryHash, query])
		);
		for (const query of next.clientState.queries) {
			const old = queries.get(query.queryHash);
			const newer =
				old && old.state.dataUpdatedAt > query.state.dataUpdatedAt
					? old
					: query;
			const older = newer === old ? query : old;
			const oldHistory = spaceHistorySnapshotSchema.safeParse(
				older?.state.data
			);
			const newHistory = spaceHistorySnapshotSchema.safeParse(newer.state.data);
			queries.set(
				query.queryHash,
				query.queryKey[0] === "spaces" &&
					query.queryKey[1] === "history" &&
					oldHistory.success &&
					newHistory.success
					? {
							...newer,
							state: {
								...newer.state,
								data: mergeSpaceHistorySnapshots({
									current: oldHistory.data,
									incoming: newHistory.data,
								}),
							},
						}
					: newer
			);
		}
		return JSON.stringify({
			...next,
			clientState: { ...next.clientState, queries: [...queries.values()] },
		});
	} catch {
		return incoming;
	}
}

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
	const historyNavigation = spaceHistoryNavigationSchema.safeParse(data);
	if (historyNavigation.success) {
		return historyNavigation.data;
	}
	const directory = spaceMemberDirectoryDisplaySchema.safeParse(data);
	if (directory.success) {
		return directory.data;
	}
	const membership = spaceViewerMembershipDisplaySchema.safeParse(data);
	if (membership.success) {
		return membership.data;
	}
	const composerTray = spaceComposerTrayDisplaySchema.safeParse(data);
	if (composerTray.success) {
		return composerTray.data;
	}
	const headerTitle = spaceHeaderTitleDisplaySchema.safeParse(data);
	if (headerTitle.success) {
		return headerTitle.data;
	}
	const displaySnapshot =
		spaceConversationDisplaySnapshotSchema.safeParse(data);
	if (displaySnapshot.success) {
		return displaySnapshot.data;
	}
	return spaceHistorySnapshotSchema.parse(data);
}

function redactOrganizationPersistedDisplayData(data: unknown): unknown {
	const sidebarSnapshot = sidebarDisplaySnapshotSchema.safeParse(data);
	if (sidebarSnapshot.success) {
		return sidebarSnapshot.data;
	}
	const memberSpaces = accountMemberSpacesDisplaySchema.safeParse(data);
	if (memberSpaces.success) {
		return memberSpaces.data;
	}
	const sidebar = accountSidebarResponseSchema.safeParse(data);
	if (sidebar.success) {
		return sidebar.data;
	}
	const centerAgentProjection =
		getCenterAgentDirectMessageSpaceProjectionResponseSchema.safeParse(data);
	if (centerAgentProjection.success) {
		return centerAgentProjection.data;
	}
	const statusSummary =
		organizationPluginConnectionStatusSummarySchema.safeParse(data);
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

// Layout-only Space reads, checked by the second key segment.
const SPACE_DISPLAY_SCHEMAS: ReadonlyMap<
	string,
	{ safeParse: (data: unknown) => { success: boolean } }
> = new Map<string, { safeParse: (data: unknown) => { success: boolean } }>([
	["composer-tray-display", spaceComposerTrayDisplaySchema],
	["display-snapshot", spaceConversationDisplaySnapshotSchema],
	["header-title-display", spaceHeaderTitleDisplaySchema],
	["member-directory-display", spaceMemberDirectoryDisplaySchema],
	["viewer-membership-display", spaceViewerMembershipDisplaySchema],
]);

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
	if (!approved) {
		return false;
	}
	switch (scopeKind) {
		case "account":
			if (targetQueryKey[1] === "profiles") {
				return true;
			}
			if (targetQueryKey[1] === "current-computer-toolbar-display-snapshot") {
				return currentComputerToolbarDisplaySnapshotSchema.safeParse(
					query.state.data
				).success;
			}
			return false;
		case "organization":
			return true;
		case "space":
			if (targetQueryKey[3] === "history-navigation") {
				return spaceHistoryNavigationSchema.safeParse(query.state.data).success;
			}
			if (targetQueryKey[1] === "history") {
				return spaceHistorySnapshotSchema.safeParse(query.state.data).success;
			}
			return (
				SPACE_DISPLAY_SCHEMAS.get(String(targetQueryKey[1]))?.safeParse(
					query.state.data
				).success ?? false
			);
		default: {
			const unhandled: never = scopeKind;
			return unhandled;
		}
	}
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
	let restoredSizeBytes: number | undefined;
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
				const client = JSON.parse(payload) as PersistedClient;
				// Measure the payload we already read instead of serializing the
				// entire restored cache again solely for diagnostics.
				restoredSizeBytes = new TextEncoder().encode(payload).byteLength;
				return client;
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
			restoredSizeBytes = undefined;
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
					sizeBytes: restoredSizeBytes,
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

function elapsedMs(nowMs: () => number, startedAtMs: number): number {
	return Math.max(0, nowMs() - startedAtMs);
}

function defaultNowMs(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}
