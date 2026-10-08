import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type PropsWithChildren,
	use,
	useEffect,
	useMemo,
} from "react";
import {
	centerAgentDesignationQueryOptions,
	centerAgentModelQueryOptions,
} from "#/query/organizations/center-agent";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	type AgentAvatarInvalidationScope,
	subscribeAgentAvatarInvalidations,
} from "./agent-avatar-invalidation";

type AvatarProfile =
	OrganizationProfileDirectoryResponse["agentProfiles"][number];
const AgentAvatarProfilesContext = createContext<
	ReadonlyMap<string, AvatarProfile>
>(new Map());
const CenterAgentAvatarProfileContext = createContext<
	AvatarProfile | undefined
>(undefined);
const CenterAgentModelContext = createContext<
	{ profileId: string; modelName: string | null } | undefined
>(undefined);
const AgentAvatarInvalidationScopeContext = createContext<
	AgentAvatarInvalidationScope | undefined
>(undefined);

// One observer of the existing Profile read model for every avatar in the shell.
export function AgentAvatarProfilesProvider(
	input: PropsWithChildren<{ organizationId: string; ownerAccountId?: string }>
) {
	const queryClient = useQueryClient();
	const invalidationScope = useMemo(
		() =>
			input.ownerAccountId
				? {
						ownerAccountId: input.ownerAccountId,
						organizationId: input.organizationId,
					}
				: undefined,
		[input.ownerAccountId, input.organizationId]
	);
	useEffect(() => {
		if (!input.ownerAccountId) {
			return;
		}
		return subscribeAgentAvatarInvalidations({
			queryClient,
			ownerAccountId: input.ownerAccountId,
			organizationId: input.organizationId,
		});
	}, [queryClient, input.ownerAccountId, input.organizationId]);
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	).data;
	const profiles = useMemo(
		() =>
			new Map(
				directory?.agentProfiles.map((profile) => [profile.profileId, profile])
			),
		[directory?.agentProfiles]
	);
	const designation = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	).data?.designation;
	const modelQuery = useQuery({
		...centerAgentModelQueryOptions({
			enabled: Boolean(designation),
			organizationId: input.organizationId,
		}),
		refetchOnWindowFocus: true,
		refetchInterval: 30_000,
	});
	const model = useMemo(
		() =>
			designation
				? {
						profileId: designation.agentProfileId,
						modelName: modelQuery.isError
							? null
							: (modelQuery.data?.effectiveModel.displayName ?? null),
					}
				: undefined,
		[designation, modelQuery.isError, modelQuery.data]
	);
	return (
		<CenterAgentModelContext.Provider value={model}>
			<AgentAvatarInvalidationScopeContext.Provider value={invalidationScope}>
				<AgentAvatarProfilesContext.Provider value={profiles}>
					<CenterAgentAvatarProfileContext.Provider
						value={
							designation ? profiles.get(designation.agentProfileId) : undefined
						}
					>
						{input.children}
					</CenterAgentAvatarProfileContext.Provider>
				</AgentAvatarProfilesContext.Provider>
			</AgentAvatarInvalidationScopeContext.Provider>
		</CenterAgentModelContext.Provider>
	);
}

export function useCenterAgentAvatarProfile() {
	return use(CenterAgentAvatarProfileContext);
}

export function useAgentAvatarInvalidationScope() {
	return use(AgentAvatarInvalidationScopeContext);
}

export function useAgentAvatarProfile(profileId: string | undefined) {
	const profiles = use(AgentAvatarProfilesContext);
	return profileId ? profiles.get(profileId) : undefined;
}

export function useCenterAgentCurrentModelName(
	profileId: string | null | undefined
) {
	const model = use(CenterAgentModelContext);
	return model?.profileId === profileId ? model?.modelName : undefined;
}
