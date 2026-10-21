import type { QueryClient } from "@tanstack/react-query";
import { findActiveProfileById } from "#/lib/profiles/profiles";
import { resolveAppSpacesProfile } from "#/lib/spaces/app-spaces-profile";
import { readLastUsedHumanProfileId } from "#/lib/spaces/last-used-profile";
import { applySpaceBootstrapSnapshotToCache } from "#/lib/spaces/member-cache";
import {
	resolveSpaceThreadTarget,
	type SpaceMessageTarget,
} from "#/lib/spaces/thread-navigation";
import { readSpaceThreadPanelSelection } from "#/lib/spaces/thread-panel-storage";
import { accountSidebarQueryOptions } from "#/query/account/sidebar-preferences";
import { accountOrganizationContextQueryOptions } from "#/query/organizations/account-organization-context";
import { centerAgentDirectMessageSpaceProjectionQueryOptions } from "#/query/organizations/center-agent";
import {
	type InboxFeedFilters,
	organizationInboxFeedQueryOptions,
} from "#/query/organizations/inbox-feed";
import {
	organizationProfileDirectoryQueryOptions,
	organizationSpacesQueryOptions,
} from "#/query/organizations/organization-directory";
import {
	organizationPluginConnectionCatalogQueryOptions,
	organizationPluginProviderCatalogQueryOptions,
} from "#/query/organizations/plugin-connections";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { spaceBootstrapQueryOptions } from "#/query/spaces/bootstrap";
import { spaceEntryResolutionQueryOptions } from "#/query/spaces/entry-resolution";
import type { SpaceHistorySnapshot } from "#/query/spaces/history";
import { spaceHistoryPrefetchQueryOptions } from "#/query/spaces/history-sync";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	spaceThreadSignalsQueryOptions,
	spaceThreadsQueryOptions,
} from "#/query/spaces/threads";
import { resolveOrganizationScopeForContext } from "./organization-scope";
import type { OrganizationScopeAuthorized } from "./organization-types";

type OrganizationRoutePrefetchInput = {
	organizationSlug: string;
	queryClient: QueryClient;
	queryPersistence: BrowserQueryPersistenceController;
	routeFamily: string;
};

export async function prefetchPluginsRouteData(
	input: OrganizationRoutePrefetchInput
): Promise<void> {
	const scope = await resolveAuthorizedPrefetchScope(input);
	if (!scope) {
		return;
	}
	const organizationId = scope.currentOrganization.id;
	await Promise.all([
		input.queryClient.prefetchQuery(
			organizationPluginProviderCatalogQueryOptions({ organizationId })
		),
		input.queryClient.prefetchQuery(
			organizationPluginConnectionCatalogQueryOptions({
				organizationId,
				queryClient: input.queryClient,
			})
		),
	]);
}

export async function prefetchInboxRouteData(
	input: OrganizationRoutePrefetchInput & { filters: InboxFeedFilters }
): Promise<void> {
	const scope = await resolveAuthorizedPrefetchScope(input);
	if (!scope) {
		return;
	}
	await input.queryClient.prefetchInfiniteQuery(
		organizationInboxFeedQueryOptions({
			...input.filters,
			organizationId: scope.currentOrganization.id,
			accountId: scope.currentUserId,
		})
	);
}

export async function prefetchPeopleRouteData(
	input: OrganizationRoutePrefetchInput
): Promise<void> {
	const scope = await resolveAuthorizedPrefetchScope(input);
	if (!scope) {
		return;
	}
	await Promise.all([
		input.queryClient.prefetchQuery(
			organizationProfileDirectoryQueryOptions({
				enabled: true,
				organizationId: scope.currentOrganization.id,
			})
		),
		input.queryClient.prefetchQuery(
			accountSidebarQueryOptions(
				scope.currentUserId,
				scope.currentOrganization.id
			)
		),
	]);
}

export async function prefetchAgentsRouteIdentityData(
	input: OrganizationRoutePrefetchInput
): Promise<void> {
	const scope = await resolveAuthorizedPrefetchScope(input);
	if (!scope) {
		return;
	}

	const queries = [
		input.queryClient.prefetchQuery(
			buildStartProfilesQueryOptions({
				enabled: true,
				storageScope: scope.storageScope,
			})
		),
		input.queryClient.prefetchQuery(
			accountSidebarQueryOptions(
				scope.currentUserId,
				scope.currentOrganization.id
			)
		),
	];
	if (scope.currentOrganization.isPersonal !== true) {
		queries.push(
			input.queryClient.prefetchQuery(
				organizationProfileDirectoryQueryOptions({
					enabled: true,
					organizationId: scope.currentOrganization.id,
				})
			)
		);
	}
	await Promise.all(queries);
}

export async function prefetchSpacesRouteData(
	input: OrganizationRoutePrefetchInput
): Promise<void> {
	const scope = await resolveAuthorizedPrefetchScope(input);
	if (!scope) {
		return;
	}

	await Promise.all([
		input.queryClient.prefetchQuery(
			buildStartProfilesQueryOptions({
				enabled: true,
				storageScope: scope.storageScope,
			})
		),
		input.queryClient.prefetchQuery(
			organizationSpacesQueryOptions({
				enabled: true,
				organizationId: scope.currentOrganization.id,
			})
		),
	]);
}

export async function prefetchSpaceConversationRouteData(
	input: OrganizationRoutePrefetchInput &
		SpaceMessageTarget & {
			profileId?: string;
			spaceId: string;
		}
): Promise<void> {
	const scope = await resolveAuthorizedPrefetchScope(input);
	if (!scope) {
		return;
	}
	const profiles = await input.queryClient.ensureQueryData(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope: scope.storageScope,
		})
	);
	const selectedHumanProfile = input.profileId
		? findActiveProfileById(profiles, {
				profileId: input.profileId,
				profileKind: "human",
			})
		: resolveAppSpacesProfile({
				profiles,
				selectedHumanProfileId: readLastUsedHumanProfileId(scope.storageScope),
			});
	if (!selectedHumanProfile) {
		return;
	}

	await prefetchKnownSpaceConversationData({
		organizationId: scope.currentOrganization.id,
		organizationSlug: scope.currentOrganization.slug,
		ownerAccountId: scope.storageScope,
		queryClient: input.queryClient,
		queryPersistence: input.queryPersistence,
		spaceId: input.spaceId,
		openMeldProfileId: selectedHumanProfile.openMeldProfileId,
		focusSignalId: input.focusSignalId,
		focusThreadRootSignalId: input.focusThreadRootSignalId,
	});
}

export async function restoreSpaceConversationRouteData(
	input: OrganizationRoutePrefetchInput & {
		profileId?: string;
		spaceId: string;
	}
): Promise<void> {
	if (!input.profileId) {
		return;
	}
	const scope = await resolveAuthorizedPrefetchScope(input);
	if (!scope) {
		return;
	}
	await input.queryPersistence.restoreSpaceConversation({
		organizationId: scope.currentOrganization.id,
		organizationSlug: scope.currentOrganization.slug,
		ownerAccountId: scope.storageScope,
		queryClient: input.queryClient,
		spaceId: input.spaceId,
		openMeldProfileId: input.profileId,
	});
}

export async function prefetchCenterAgentConversationData(input: {
	organizationId: string;
	organizationSlug: string;
	ownerAccountId: string;
	queryClient: QueryClient;
	queryPersistence: BrowserQueryPersistenceController;
}): Promise<void> {
	const projectionResponse = await input.queryClient.ensureQueryData({
		...centerAgentDirectMessageSpaceProjectionQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		}),
		revalidateIfStale: true,
	});
	if (projectionResponse.organizationId !== input.organizationId) {
		throw new Error(
			`Center Agent prefetch organization mismatch: expected ${input.organizationId}, received ${projectionResponse.organizationId}.`
		);
	}
	const projection = projectionResponse.projection;
	if (!projection) {
		// Intent prefetch is read-only. Opening or creating the DM remains an
		// explicit route/launcher activation owned by the Center Agent loader.
		return;
	}
	if (projection.organizationId !== input.organizationId) {
		throw new Error(
			`Center Agent prefetch projection mismatch: expected ${input.organizationId}, received ${projection.organizationId}.`
		);
	}

	await prefetchKnownSpaceConversationData({
		organizationId: input.organizationId,
		organizationSlug: input.organizationSlug,
		ownerAccountId: input.ownerAccountId,
		queryClient: input.queryClient,
		queryPersistence: input.queryPersistence,
		spaceId: projection.spaceId,
		openMeldProfileId: projection.memberProfileId,
	});
}

export async function prefetchKnownSpaceConversationData(
	input: SpaceMessageTarget & {
		organizationId: string;
		organizationSlug: string;
		ownerAccountId: string;
		queryClient: QueryClient;
		queryPersistence: BrowserQueryPersistenceController;
		spaceId: string;
		openMeldProfileId: string;
	}
): Promise<void> {
	// Warm the exact access query consumed by the gate, including linked targets.
	// A bootstrap is display data and cannot stand in for this server decision.
	// It does not depend on saved display data, so its request overlaps the
	// local restore instead of waiting behind it; the request count is unchanged.
	const entryPrefetch = input.queryClient.prefetchQuery(
		spaceEntryResolutionQueryOptions({
			enabled: true,
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
			signalId: input.focusSignalId,
			threadRootSignalId: input.focusThreadRootSignalId,
		})
	);
	// The restored history decides below between a contiguous update and a
	// bootstrap, so that choice still waits for the restore.
	await input.queryPersistence.restoreSpaceConversation({
		organizationId: input.organizationId,
		organizationSlug: input.organizationSlug,
		ownerAccountId: input.ownerAccountId,
		queryClient: input.queryClient,
		spaceId: input.spaceId,
		openMeldProfileId: input.openMeldProfileId,
	});
	prefetchTargetThread(input).catch((error: unknown) =>
		console.error("Could not prefetch the linked Thread.", error)
	);
	// Advance a saved tail only through contiguous updates, never by replacing
	// it with a recent bootstrap window that could skip intervening messages.
	if (
		input.queryClient.getQueryData(
			spaceQueryKeys.history(input.spaceId, input.openMeldProfileId)
		) &&
		input.queryClient.getQueryData(
			spaceQueryKeys.displaySnapshot(input.spaceId, input.openMeldProfileId)
		)
	) {
		await input.queryClient.prefetchQuery(
			spaceHistoryPrefetchQueryOptions(input.queryClient, input)
		);
		await entryPrefetch;
		return;
	}
	const bootstrap = await input.queryClient.fetchQuery(
		spaceBootstrapQueryOptions({
			enabled: true,
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
		})
	);
	applySpaceBootstrapSnapshotToCache({
		bootstrap,
		bootstrapUpdatedAt: input.queryClient.getQueryState(
			spaceQueryKeys.bootstrap(input.spaceId, input.openMeldProfileId)
		)?.dataUpdatedAt,
		queryClient: input.queryClient,
		spaceId: input.spaceId,
		viewerProfileId: input.openMeldProfileId,
	});
	await entryPrefetch;
}

async function prefetchTargetThread(
	input: SpaceMessageTarget & {
		queryClient: QueryClient;
		spaceId: string;
		openMeldProfileId: string;
	}
) {
	const explicitTarget = input.focusSignalId || input.focusThreadRootSignalId;
	let threadId: string | null | undefined;
	if (explicitTarget) {
		const options = spaceThreadsQueryOptions({ ...input, enabled: true });
		const cached =
			input.queryClient.getQueryData(options.queryKey) ??
			input.queryClient.getQueryData<SpaceHistorySnapshot>(
				spaceQueryKeys.history(input.spaceId, input.openMeldProfileId)
			)?.threadDisplay ??
			undefined;
		const target = resolveSpaceThreadTarget(cached, input);
		threadId = target?.threadId;
		if (!threadId) {
			const catalog = await input.queryClient.fetchQuery({
				...options,
				staleTime: 0,
			});
			threadId = resolveSpaceThreadTarget(catalog, input)?.threadId;
		}
	} else {
		threadId = readSpaceThreadPanelSelection({ spaceId: input.spaceId });
	}
	if (!threadId) {
		return;
	}
	// Warm the selected destination without blocking main conversation paint.
	await input.queryClient.prefetchQuery(
		spaceThreadSignalsQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
			threadId,
			enabled: true,
		})
	);
}

async function resolveAuthorizedPrefetchScope(
	input: OrganizationRoutePrefetchInput
): Promise<OrganizationScopeAuthorized | null> {
	const context = await input.queryClient.ensureQueryData(
		accountOrganizationContextQueryOptions(input.routeFamily)
	);
	if (!context) {
		return null;
	}
	const scope = resolveOrganizationScopeForContext({
		context,
		orgSlug: input.organizationSlug,
	});
	if (scope.access !== "authorized") {
		return null;
	}
	await input.queryPersistence.activateAuthorizedScope({
		organizationId: scope.currentOrganization.id,
		organizationSlug: scope.currentOrganization.slug,
		ownerAccountId: scope.storageScope,
		queryClient: input.queryClient,
	});
	return scope;
}
