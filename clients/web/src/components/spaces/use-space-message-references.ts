import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { organizationSpacesQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	collectSpaceMessageReferenceIds,
	type SpaceMessageReference,
	type SpaceMessageReferencesById,
} from "./space-message-reference";

const SPACE_REFERENCE_DIRECTORY_REFRESH_COOLDOWN_MS = 10_000;

export function useSpaceMessageReferences(input: {
	accountProfileId: string | null;
	currentSpace: SpaceMessageReference | null;
	messageTexts: readonly string[];
	organizationId: string | null;
	organizationSlug: string | null;
}): SpaceMessageReferencesById {
	const lastDirectoryRefreshAtRef = useRef<number | null>(null);
	const previousOrganizationIdRef = useRef(input.organizationId);
	const currentSpaceId = input.currentSpace?.spaceId ?? null;
	const currentSpaceName = input.currentSpace?.name ?? null;
	const referencedSpaceIds = useMemo(
		() => collectSpaceMessageReferenceIds(input.messageTexts),
		[input.messageTexts]
	);
	const referencedSpaceIdSet = useMemo(
		() => new Set(referencedSpaceIds),
		[referencedSpaceIds]
	);
	const directoryQuery = useQuery(
		organizationSpacesQueryOptions({
			enabled:
				input.organizationId !== null &&
				referencedSpaceIds.some((spaceId) => spaceId !== currentSpaceId),
			organizationId: input.organizationId ?? "",
		})
	);
	const accountSpacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled:
				input.accountProfileId !== null &&
				referencedSpaceIds.some((spaceId) => spaceId !== currentSpaceId),
			profileId: input.accountProfileId ?? "",
			scope: "account",
		})
	);
	const directorySpaceIds = useMemo(
		() =>
			new Set(
				directoryQuery.isSuccess
					? directoryQuery.data.spaces.map((space) => space.spaceId)
					: []
			),
		[directoryQuery.data, directoryQuery.isSuccess]
	);
	const accountSpaceIds = useMemo(
		() =>
			new Set(
				input.accountProfileId !== null && accountSpacesQuery.isSuccess
					? [
							...accountSpacesQuery.data.pinnedItems,
							...accountSpacesQuery.data.spaceItems,
						].map((space) => space.spaceId)
					: []
			),
		[
			accountSpacesQuery.data,
			accountSpacesQuery.isSuccess,
			input.accountProfileId,
		]
	);

	useEffect(() => {
		if (previousOrganizationIdRef.current === input.organizationId) {
			return;
		}
		previousOrganizationIdRef.current = input.organizationId;
		lastDirectoryRefreshAtRef.current = null;
	}, [input.organizationId]);

	useEffect(() => {
		if (
			input.organizationId === null ||
			!directoryQuery.isSuccess ||
			directoryQuery.isFetching ||
			accountSpacesQuery.isFetching
		) {
			return;
		}

		const hasMissingSpaceReference = referencedSpaceIds.some(
			(spaceId) =>
				spaceId !== currentSpaceId &&
				!directorySpaceIds.has(spaceId) &&
				!accountSpaceIds.has(spaceId)
		);
		if (!hasMissingSpaceReference) {
			return;
		}

		const now = Date.now();
		const lastRefreshAt = lastDirectoryRefreshAtRef.current;
		if (
			lastRefreshAt !== null &&
			now - lastRefreshAt < SPACE_REFERENCE_DIRECTORY_REFRESH_COOLDOWN_MS
		) {
			return;
		}
		lastDirectoryRefreshAtRef.current = now;

		directoryQuery.refetch({ throwOnError: true }).catch((error: unknown) => {
			console.warn("Failed to refresh Space references.", error);
		});
	}, [
		accountSpaceIds,
		accountSpacesQuery.isFetching,
		directoryQuery.isFetching,
		directoryQuery.isSuccess,
		directoryQuery.refetch,
		directorySpaceIds,
		currentSpaceId,
		input.organizationId,
		referencedSpaceIds,
	]);

	return useMemo(() => {
		return buildSpaceMessageReferences({
			accountProfileId: input.accountProfileId,
			accountPinnedSpaces:
				input.accountProfileId !== null && accountSpacesQuery.isSuccess
					? accountSpacesQuery.data.pinnedItems
					: [],
			accountSpaces:
				input.accountProfileId !== null && accountSpacesQuery.isSuccess
					? accountSpacesQuery.data.spaceItems
					: [],
			currentSpaceId,
			currentSpaceName,
			directorySpaces:
				input.organizationId !== null && directoryQuery.isSuccess
					? directoryQuery.data.spaces
					: [],
			organizationSlug: input.organizationSlug,
			referencedSpaceIdSet,
		});
	}, [
		accountSpacesQuery.data,
		accountSpacesQuery.isSuccess,
		directoryQuery.data,
		directoryQuery.isSuccess,
		currentSpaceId,
		currentSpaceName,
		input.accountProfileId,
		input.organizationId,
		input.organizationSlug,
		referencedSpaceIdSet,
	]);
}

function buildSpaceMessageReferences(input: {
	accountProfileId: string | null;
	accountPinnedSpaces: readonly { spaceId: string; spaceName: string }[];
	accountSpaces: readonly { spaceId: string; spaceName: string }[];
	currentSpaceId: string | null;
	currentSpaceName: string | null;
	directorySpaces: readonly { name: string | null; spaceId: string }[];
	organizationSlug: string | null;
	referencedSpaceIdSet: ReadonlySet<string>;
}): SpaceMessageReferencesById {
	const references = new Map<string, SpaceMessageReference>();
	addAuthenticatedFallbackReferences(references, input);
	addCurrentSpaceReference(references, input);
	addDirectorySpaceReferences(references, input);
	addAccountSpaceReferences(references, input.accountPinnedSpaces, input);
	addAccountSpaceReferences(references, input.accountSpaces, input);
	return references;
}

function addAuthenticatedFallbackReferences(
	references: Map<string, SpaceMessageReference>,
	input: {
		accountProfileId: string | null;
		organizationSlug: string | null;
		referencedSpaceIdSet: ReadonlySet<string>;
	}
): void {
	if (!(input.accountProfileId && input.organizationSlug)) {
		return;
	}

	for (const spaceId of input.referencedSpaceIdSet) {
		references.set(spaceId, {
			...buildAuthenticatedSpaceReferenceHref(input, spaceId),
			name: null,
			spaceId,
		});
	}
}

function addCurrentSpaceReference(
	references: Map<string, SpaceMessageReference>,
	input: {
		accountProfileId: string | null;
		currentSpaceId: string | null;
		currentSpaceName: string | null;
		organizationSlug: string | null;
		referencedSpaceIdSet: ReadonlySet<string>;
	}
): void {
	if (
		!(
			input.currentSpaceId &&
			input.referencedSpaceIdSet.has(input.currentSpaceId)
		)
	) {
		return;
	}

	references.set(input.currentSpaceId, {
		...buildAuthenticatedSpaceReferenceHref(input, input.currentSpaceId),
		name: input.currentSpaceName,
		spaceId: input.currentSpaceId,
	});
}

function addDirectorySpaceReferences(
	references: Map<string, SpaceMessageReference>,
	input: {
		accountProfileId: string | null;
		directorySpaces: readonly { name: string | null; spaceId: string }[];
		organizationSlug: string | null;
		referencedSpaceIdSet: ReadonlySet<string>;
	}
): void {
	for (const space of input.directorySpaces) {
		if (input.referencedSpaceIdSet.has(space.spaceId)) {
			references.set(space.spaceId, {
				...space,
				...buildAuthenticatedSpaceReferenceHref(input, space.spaceId),
			});
		}
	}
}

function addAccountSpaceReferences(
	references: Map<string, SpaceMessageReference>,
	spaces: readonly { spaceId: string; spaceName: string }[],
	input: {
		accountProfileId: string | null;
		organizationSlug: string | null;
		referencedSpaceIdSet: ReadonlySet<string>;
	}
): void {
	for (const space of spaces) {
		if (input.referencedSpaceIdSet.has(space.spaceId)) {
			references.set(space.spaceId, {
				...buildAuthenticatedSpaceReferenceHref(input, space.spaceId),
				name: space.spaceName,
				spaceId: space.spaceId,
			});
		}
	}
}

function buildAuthenticatedSpaceReferenceHref(
	input: { accountProfileId: string | null; organizationSlug: string | null },
	spaceId: string
): { href?: string } {
	if (!(input.accountProfileId && input.organizationSlug)) {
		return {};
	}
	return {
		href: buildOrganizationSpacePath({
			orgSlug: input.organizationSlug,
			search: { profileId: input.accountProfileId },
			spaceId,
		}),
	};
}
