import type { QueryClient } from "@tanstack/react-query";
import { findActiveProfileById } from "#/lib/profiles/profiles";
import { applySpaceBootstrapSnapshotToCache } from "#/lib/spaces/member-cache";
import { centerAgentDirectMessageSpaceProjectionQueryOptions } from "#/query/organizations/center-agent";
import {
	organizationProfileDirectoryQueryOptions,
	organizationSpacesQueryOptions,
} from "#/query/organizations/organization-directory";
import {
	organizationScopeQueryKeys,
	organizationScopeQueryOptions,
} from "#/query/organizations/organization-scope";
import type { BrowserQueryPersistenceController } from "#/query/persistence/browser-query-persistence";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { spaceBootstrapQueryOptions } from "#/query/spaces/bootstrap";
import { spaceHistoryPrefetchQueryOptions } from "#/query/spaces/history-sync";
import { spaceQueryKeys } from "#/query/spaces/status";
import type {
	OrganizationScopeAuthorized,
	OrganizationScopeResolution,
} from "./organization-types";

type OrganizationRoutePrefetchInput = {
	organizationSlug: string;
	queryClient: QueryClient;
	queryPersistence: BrowserQueryPersistenceController;
	routeFamily: string;
};

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
	input: OrganizationRoutePrefetchInput & {
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
	if (!input.profileId) {
		return;
	}
	const selectedHumanProfile = findActiveProfileById(profiles, {
		profileId: input.profileId,
		profileKind: "human",
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
	await input.queryPersistence.activateSpaceConversation({
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

export async function prefetchKnownSpaceConversationData(input: {
	organizationId: string;
	organizationSlug: string;
	ownerAccountId: string;
	queryClient: QueryClient;
	queryPersistence: BrowserQueryPersistenceController;
	spaceId: string;
	openMeldProfileId: string;
}): Promise<void> {
	await input.queryPersistence.activateSpaceConversation({
		organizationId: input.organizationId,
		organizationSlug: input.organizationSlug,
		ownerAccountId: input.ownerAccountId,
		queryClient: input.queryClient,
		spaceId: input.spaceId,
		openMeldProfileId: input.openMeldProfileId,
	});
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
}

async function resolveAuthorizedPrefetchScope(
	input: OrganizationRoutePrefetchInput
): Promise<OrganizationScopeAuthorized | null> {
	const queryOptions = organizationScopeQueryOptions({
		organizationSlug: input.organizationSlug,
		routeFamily: input.routeFamily,
	});
	const cachedScope =
		input.queryClient.getQueryData<OrganizationScopeResolution>(
			organizationScopeQueryKeys.bySlug(input.organizationSlug)
		);
	const scope =
		cachedScope ?? (await input.queryClient.ensureQueryData(queryOptions));
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
