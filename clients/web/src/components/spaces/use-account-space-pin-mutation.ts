"use client";

import {
	useMutation,
	useMutationState,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
	type AccountSpaceItem,
	type AccountSpaceSections,
	setAccountSpaceItemPinned,
} from "#/lib/spaces/account-spaces";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { sortAccountSpaceItems } from "./account-space-sections";

const EMPTY_ACCOUNT_SPACE_SECTIONS: AccountSpaceSections = {
	pinnedItems: [],
	recentlyDeletedItems: [],
	spaceItems: [],
};

type SpacePinMutationInput = {
	item: AccountSpaceItem;
	pinnedAt: string | null;
	profileIds: readonly string[];
};

export function useAccountSpacePinMutation(input: {
	currentProfileId: string;
}) {
	const queryClient = useQueryClient();
	const mutationKey = accountSpacePinMutationKey(input.currentProfileId);
	const accountSpacesQueryKey = accountSpaceQueryKeys.items(
		input.currentProfileId,
		"account"
	);
	const pendingMutations = useMutationState<SpacePinMutationInput | null>({
		filters: { exact: true, mutationKey, status: "pending" },
		select: (mutation) =>
			(mutation.state.variables as SpacePinMutationInput | undefined) ?? null,
	});
	const hasPendingMutation = pendingMutations.length > 0;
	const pinMutation = useMutation({
		mutationKey,
		mutationFn: async (variables: SpacePinMutationInput) =>
			await setAccountSpaceItemPinned({
				pinnedAt: variables.pinnedAt,
				profileIds: variables.profileIds,
				spaceId: variables.item.spaceId,
			}),
		onMutate: async (variables) => {
			await queryClient.cancelQueries({ queryKey: accountSpacesQueryKey });
			const current = queryClient.getQueryData<AccountSpaceSections>(
				accountSpacesQueryKey
			);
			const previousItem = findAccountSpaceItem(
				current,
				variables.item.spaceId
			);
			queryClient.setQueryData<AccountSpaceSections>(
				accountSpacesQueryKey,
				(current) =>
					applyOptimisticPinnedUpdate(
						current ?? EMPTY_ACCOUNT_SPACE_SECTIONS,
						variables
					)
			);

			return { previousItem };
		},
		onError: (error, variables, context) => {
			if (context) {
				queryClient.setQueryData<AccountSpaceSections>(
					accountSpacesQueryKey,
					(current) =>
						restoreAccountSpaceItem(
							current ?? EMPTY_ACCOUNT_SPACE_SECTIONS,
							context.previousItem,
							variables.item.spaceId
						)
				);
			}
			console.error("Failed to update pinned space.", error);
			toast.error("Could not update pinned spaces.");
		},
		onSuccess: async (result) => {
			if (spaceIndexOverlayApplied(result)) {
				await queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				});
				return;
			}

			console.warn("Pinned space update is waiting for Space Index.", {
				spaceId: result[0]?.item.spaceId,
				statuses: result.map((item) => item.spaceIndexOverlay.status),
			});
			toast.warning("Pinned spaces are still syncing.");
		},
	});

	return {
		arePinActionsPending: hasPendingMutation,
		toggle: (item: AccountSpaceItem) => {
			if (
				hasPendingAccountSpacePinMutation({
					mutationKey,
					queryClient,
				})
			) {
				return;
			}
			const isPinned = item.pinnedAt !== null;
			pinMutation.mutate({
				item,
				pinnedAt: isPinned ? null : new Date().toISOString(),
				profileIds: isPinned
					? resolvePinnedProfileIds(item)
					: [input.currentProfileId],
			});
		},
	};
}

function accountSpacePinMutationKey(profileId: string) {
	return ["spaces", "account-spaces", profileId, "pin"] as const;
}

function hasPendingAccountSpacePinMutation(input: {
	mutationKey: ReturnType<typeof accountSpacePinMutationKey>;
	queryClient: ReturnType<typeof useQueryClient>;
}): boolean {
	return (
		input.queryClient.getMutationCache().findAll({
			exact: true,
			mutationKey: input.mutationKey,
			status: "pending",
		}).length > 0
	);
}

function resolvePinnedProfileIds(item: AccountSpaceItem): readonly string[] {
	return item.pinnedProfileIds.length > 0
		? item.pinnedProfileIds
		: [item.openProfileId];
}

function applyOptimisticPinnedUpdate(
	current: AccountSpaceSections,
	variables: SpacePinMutationInput
): AccountSpaceSections {
	const nextItem: AccountSpaceItem = {
		...variables.item,
		pinnedAt: variables.pinnedAt,
		pinnedProfileIds: variables.pinnedAt ? variables.profileIds : [],
	};
	const nextItems = [...current.pinnedItems, ...current.spaceItems].filter(
		(item) =>
			normalizeSpaceKey(item.spaceId) !== normalizeSpaceKey(nextItem.spaceId)
	);
	nextItems.push(nextItem);

	return {
		pinnedItems: sortAccountSpaceItems(
			nextItems.filter((item) => item.pinnedAt !== null)
		),
		recentlyDeletedItems: current.recentlyDeletedItems,
		spaceItems: sortAccountSpaceItems(
			nextItems.filter((item) => item.pinnedAt === null)
		),
	};
}

function findAccountSpaceItem(
	sections: AccountSpaceSections | undefined,
	spaceId: string
): AccountSpaceItem | null {
	const spaceKey = normalizeSpaceKey(spaceId);
	return (
		sections?.pinnedItems.find(
			(item) => normalizeSpaceKey(item.spaceId) === spaceKey
		) ??
		sections?.spaceItems.find(
			(item) => normalizeSpaceKey(item.spaceId) === spaceKey
		) ??
		null
	);
}

function restoreAccountSpaceItem(
	current: AccountSpaceSections,
	previousItem: AccountSpaceItem | null,
	spaceId: string
): AccountSpaceSections {
	const spaceKey = normalizeSpaceKey(spaceId);
	const nextItems = [...current.pinnedItems, ...current.spaceItems].filter(
		(item) => normalizeSpaceKey(item.spaceId) !== spaceKey
	);
	if (previousItem) {
		nextItems.push(previousItem);
	}

	return {
		pinnedItems: sortAccountSpaceItems(
			nextItems.filter((item) => item.pinnedAt !== null)
		),
		recentlyDeletedItems: current.recentlyDeletedItems,
		spaceItems: sortAccountSpaceItems(
			nextItems.filter((item) => item.pinnedAt === null)
		),
	};
}

function spaceIndexOverlayApplied(
	result: Awaited<ReturnType<typeof setAccountSpaceItemPinned>>
): boolean {
	return (
		result.length > 0 &&
		result.every((item) => item.spaceIndexOverlay.status === "applied")
	);
}

function normalizeSpaceKey(value: string): string {
	return value.trim().toLowerCase();
}
