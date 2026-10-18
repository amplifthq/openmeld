import type {
	CenterAgentUpdateProfileBody,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import {
	useMutationState,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
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
	centerAgentAvatarAppearance,
	centerAgentAvatarMutationKey,
} from "./agent-avatar";
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
	const designation = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	).data?.designation;
	// Pending saves are a view over confirmed identity, never writes to its cache.
	// Filtering the selected key here also handles an Organization switch while pending.
	const pending = useMutationState({
		filters: { mutationKey: ["center-agent-avatar-update"], status: "pending" },
		select: (mutation) => ({
			key: mutation.options.mutationKey,
			id: mutation.mutationId,
			update: mutation.state.variables as CenterAgentUpdateProfileBody,
		}),
	});
	const profiles = useMemo(() => {
		const entries = new Map(
			directory?.agentProfiles.map((profile) => [profile.profileId, profile])
		);
		if (!designation) {
			return entries;
		}
		const key = centerAgentAvatarMutationKey(
			input.organizationId,
			designation.agentProfileId
		);
		for (const intent of [...pending].sort((a, b) => a.id - b.id)) {
			if (intent.key?.[1] !== key[1] || intent.key?.[2] !== key[2]) {
				continue;
			}
			const profile = entries.get(designation.agentProfileId);
			if (profile && (intent.update.avatar || intent.update.avatarStyle)) {
				entries.set(profile.profileId, {
					...profile,
					...centerAgentAvatarAppearance(intent.update),
				});
			}
		}
		return entries;
	}, [directory?.agentProfiles, designation, input.organizationId, pending]);
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
