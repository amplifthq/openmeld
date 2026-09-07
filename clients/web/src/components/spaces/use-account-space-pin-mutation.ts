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
import {
	applyOptimisticAccountSpacePinUpdate,
	restoreAccountSpaceItemAfterPinFailure,
} from "./account-space-sections";

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
					applyOptimisticAccountSpacePinUpdate(
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
						restoreAccountSpaceItemAfterPinFailure(
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

	const setPinned = async (item: AccountSpaceItem, pinned: boolean) => {
		if (hasPendingAccountSpacePinMutation({ mutationKey, queryClient })) {
			return false;
		}
		if ((item.pinnedAt !== null) === pinned) {
			return true;
		}
		try {
			await pinMutation.mutateAsync({
				item,
				pinnedAt: pinned ? new Date().toISOString() : null,
				profileIds: pinned
					? [input.currentProfileId]
					: resolvePinnedProfileIds(item),
			});
			return true;
		} catch {
			// The mutation owns rollback and user-visible failure reporting.
			return false;
		}
	};
	return {
		arePinActionsPending: hasPendingMutation,
		setPinned,
		toggle: (item: AccountSpaceItem) => setPinned(item, item.pinnedAt === null),
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
