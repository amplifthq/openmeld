import type {
	AuthProfileView,
	CreateSpaceResponse,
	SpaceAccessMode,
	SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";
import {
	useMutation,
	useMutationState,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { createSpaceInOrganization } from "#/lib/spaces/create-space-in-organization";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "./account-spaces";
import { spaceBootstrapQueryOptions } from "./bootstrap";
import {
	addSpaceDirectoryMembers,
	type SpaceMemberAddition,
	useSpaceMemberAddition,
} from "./member-additions";
import { spaceMembersQueryOptions } from "./members";

export type SpaceCreationInput = {
	accessMode: SpaceAccessMode;
	name: string;
	password?: string;
	visibility: SpaceOrganizationVisibility;
	members?: SpaceMemberAddition["members"];
	expectedCenterAgentProfileId?: string;
};

export type SpaceCreationRequest = SpaceCreationInput & { creationId: string };

export function spaceCreationPath(
	orgSlug: string,
	profileId: string,
	creationId: string
) {
	return buildOrganizationSpacePath({
		orgSlug,
		spaceId: creationId,
		search: { profileId },
	});
}

export const spaceCreationKey = (organizationId: string, profileId: string) =>
	["space-creation", organizationId, profileId] as const;

export const spaceCreationReceiptKey = (
	organizationId: string,
	profileId: string,
	spaceId: string
) => ["space-creation-receipt", organizationId, profileId, spaceId] as const;

export function useCreateSpace(input: {
	organizationId: string;
	orgSlug: string;
	actingProfile: AuthProfileView | null;
}) {
	const client = useQueryClient();
	const navigate = useNavigate();
	const router = useRouter();
	const profileId = input.actingProfile?.openMeldProfileId ?? "";
	const mutationKey = spaceCreationKey(input.organizationId, profileId);
	const creations = useSpaceCreations(input.organizationId, profileId);
	const pending = creations.find((creation) => creation.status === "pending");
	const latest = creations.at(-1);
	const memberAddition = useSpaceMemberAddition({
		organizationId: input.organizationId,
		profileId,
		add: (addition) =>
			addSpaceDirectoryMembers({
				organizationId: input.organizationId,
				profileId,
				queryClient: client,
				addition,
			}),
	});
	const mutation = useMutation({
		mutationKey,
		retry: false,
		mutationFn: (space: SpaceCreationRequest) => {
			if (!input.actingProfile) {
				throw new Error("No usable profile to create a Space.");
			}
			return createSpaceInOrganization({
				actingProfile: input.actingProfile,
				organizationId: input.organizationId,
				space,
			});
		},
		onSuccess: (response, request) => {
			// Start the access-checked snapshot immediately, in parallel with member admission.
			client.prefetchQuery(
				spaceBootstrapQueryOptions({
					spaceId: response.spaceId,
					openMeldProfileId: profileId,
					enabled: true,
				})
			);
			if (request.members?.length) {
				memberAddition.mutate({
					spaceId: response.spaceId,
					members: request.members,
					directoryProfileIds: request.members.map(
						(member) => member.profileId
					),
					expectedCenterAgentProfileId: request.expectedCenterAgentProfileId,
				});
			} else {
				client.prefetchQuery(
					spaceMembersQueryOptions({
						spaceId: response.spaceId,
						openMeldProfileId: profileId,
						enabled: true,
					})
				);
			}
			client.setQueryData(
				spaceCreationReceiptKey(
					input.organizationId,
					profileId,
					response.spaceId
				),
				{
					organizationId: input.organizationId,
					profileId,
					id: 0,
					status: "success",
					input: request,
					response,
					error: null,
				}
			);
			// Refresh in the background. A confirmed write does not wait on list reads.
			Promise.all([
				client.invalidateQueries({
					queryKey: [...accountSpaceQueryKeys.all, profileId],
				}),
				client.invalidateQueries({
					queryKey: organizationQueryKeys.spaces(input.organizationId),
				}),
			]).catch((error) =>
				console.warn(
					"OpenMeld created a Space but could not refresh Space lists.",
					{ error, spaceId: response.spaceId }
				)
			);
			if (
				router.state.location.pathname !==
				buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					spaceId: request.creationId,
				})
			) {
				return;
			}
			navigate({
				replace: true,
				to: buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					spaceId: response.spaceId,
					search: { profileId },
				}),
			}).catch((error) => {
				// A navigation failure must never turn a confirmed write into a failed create.
				console.warn("OpenMeld created a Space but could not open it.", {
					error,
					spaceId: response.spaceId,
				});
			});
		},
		onError: (_error, request) => {
			if (
				router.state.location.pathname !==
				buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					spaceId: request.creationId,
				})
			) {
				toast.error("Couldn't confirm that the Space was created.", {
					description: "Check Spaces before trying again.",
				});
			}
		},
	});
	return {
		isPending: Boolean(pending),
		error: latest?.status === "error" ? latest.error : null,
		initialDraft:
			latest?.status === "error" || latest?.status === "pending"
				? latest.input
				: undefined,
		mutate: (space: SpaceCreationInput) => {
			if (client.isMutating({ mutationKey, exact: true }) === 0) {
				const creationId = `creating-${crypto.randomUUID()}`;
				mutation.mutate({ ...space, creationId });
				navigate({
					to: spaceCreationPath(input.orgSlug, profileId, creationId),
				}).catch((error) => {
					console.warn("Could not open the new Space conversation.", { error });
				});
			}
		},
	};
}

// Presentation only. These receipts never stand in for membership or Space data.
export function useSpaceCreations(organizationId: string, profileId: string) {
	// Keep the subscription stable and apply the current scope on every render.
	// useMutationState refreshes its selection on cache events, not filter changes.
	const creations = useMutationState({
		filters: {
			mutationKey: ["space-creation"],
		},
		select: (mutation) => ({
			organizationId: mutation.options.mutationKey?.[1],
			profileId: mutation.options.mutationKey?.[2],
			id: mutation.mutationId,
			status: mutation.state.status,
			input: mutation.state.variables as SpaceCreationRequest | undefined,
			response: mutation.state.data as CreateSpaceResponse | undefined,
			error: mutation.state.error,
		}),
	});
	return creations.filter(
		(creation) =>
			creation.organizationId === organizationId &&
			creation.profileId === profileId
	);
}
