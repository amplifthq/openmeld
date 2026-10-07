import {
	type QueryClient,
	useMutation,
	useMutationState,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
import { applySpaceMembersResponseToCache } from "#/lib/spaces/member-cache";
import { spaceBootstrapQueryOptions } from "./bootstrap";
import { spaceMembersQueryOptions } from "./members";

export type SpaceMemberAddition = {
	spaceId: string;
	directoryProfileIds: string[];
	expectedCenterAgentProfileId?: string;
	members: readonly { profileId: string; profileName: string }[];
};

export async function addSpaceDirectoryMembers(input: {
	organizationId: string;
	profileId: string;
	queryClient: QueryClient;
	addition: SpaceMemberAddition;
}) {
	const { members: _members, ...request } = input.addition;
	const result = await createOrganizationScopedWebSpaceApi({
		organizationId: input.organizationId,
		openMeldProfileId: input.profileId,
	}).addOrganizationDirectoryProfilesToSpace(request);
	input.queryClient.prefetchQuery(
		spaceMembersQueryOptions({
			spaceId: request.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
	// Join the snapshot already being fetched in parallel. Patch after it settles
	// so a snapshot started before admission cannot erase the confirmed members.
	await input.queryClient.ensureQueryData(
		spaceBootstrapQueryOptions({
			spaceId: request.spaceId,
			openMeldProfileId: input.profileId,
			enabled: true,
		})
	);
	applySpaceMembersResponseToCache({
		queryClient: input.queryClient,
		response: result,
		spaceId: request.spaceId,
		viewerProfileId: input.profileId,
	});
	return result;
}

export function useSpaceMemberAddition<T>(input: {
	organizationId: string;
	profileId: string;
	add: (addition: SpaceMemberAddition) => Promise<T>;
	showToast?: boolean;
}) {
	const mutation = useMutation({
		mutationKey: [
			"space-member-addition",
			input.organizationId,
			input.profileId,
		],
		mutationFn: input.add,
		retry: false,
		onMutate: (addition) => {
			if (input.showToast) {
				toast.loading(
					`Adding ${addition.members.map((member) => member.profileName).join(", ")}…`,
					{ id: `member-addition:${addition.spaceId}` }
				);
			}
		},
		onSuccess: (_result, addition) => {
			if (input.showToast) {
				toast.dismiss(`member-addition:${addition.spaceId}`);
			}
		},
		onError: (error, addition) => {
			if (input.showToast) {
				toast.error("Couldn't add members.", {
					id: `member-addition:${addition.spaceId}`,
					description: error.message,
					action: {
						label: "Try again",
						onClick: () => mutation.mutate(addition),
					},
				});
			}
		},
	});
	return mutation;
}

export function useSpaceMemberAdditions(input: {
	organizationId: string;
	profileId: string;
	spaceId: string;
}) {
	const additions = useMutationState({
		filters: { mutationKey: ["space-member-addition"] },
		select: (mutation) => ({
			organizationId: mutation.options.mutationKey?.[1],
			profileId: mutation.options.mutationKey?.[2],
			status: mutation.state.status,
			error: mutation.state.error,
			input: mutation.state.variables as SpaceMemberAddition | undefined,
		}),
	});
	return additions.filter(
		(addition) =>
			addition.organizationId === input.organizationId &&
			addition.profileId === input.profileId &&
			addition.input?.spaceId === input.spaceId
	);
}
