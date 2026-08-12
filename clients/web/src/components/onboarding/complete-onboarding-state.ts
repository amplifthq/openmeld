"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { findAppDefinition } from "#/components/organizations/app-catalog";
import { resolveCurrentLocalRuntime } from "#/lib/connect/current-local-runtime";
import { listOrganizationInvitations } from "#/lib/organizations/auth-organizations";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { localRuntimesQueryOptions } from "#/query/connect/local-runtimes";
import { organizationAppConnectionCatalogQueryOptions } from "#/query/organizations/app-connections";
import {
	centerAgentDesignationQueryOptions,
	centerAgentMemoryPolicyQueryOptions,
} from "#/query/organizations/center-agent";
import { messageChannelListQueryOptions } from "#/query/organizations/message-channels";
import {
	organizationMemberRoleQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";

export type CompleteOnboardingState = {
	appNames: string[];
	channelNames: string[];
	computerName: string | null;
	invitationCount: number;
	isPersonal: boolean;
	localAgentNames: string[];
	memoryEnabled: boolean | null;
	organizationId: string;
	organizationName: string;
};

export function useCompleteOnboardingState(input: {
	enabled: boolean;
}): CompleteOnboardingState {
	const { currentOrganization, currentUserId, storageScope } =
		useAppOrganization();
	const queryClient = useQueryClient();
	const isPersonal = currentOrganization.isPersonal === true;
	const loadTeamState = shouldLoadTeamOnboardingState({
		enabled: input.enabled,
		isPersonal,
	});
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: loadTeamState,
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	const designationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: loadTeamState,
			organizationId: currentOrganization.id,
		})
	);
	const channelsQuery = useQuery({
		...messageChannelListQueryOptions({
			organizationId: currentOrganization.id,
		}),
		enabled: loadTeamState,
	});
	const appsQuery = useQuery({
		...organizationAppConnectionCatalogQueryOptions({
			organizationId: currentOrganization.id,
			queryClient,
		}),
		enabled: input.enabled,
	});
	const memoryPolicyQuery = useQuery(
		centerAgentMemoryPolicyQueryOptions({
			enabled: input.enabled,
			organizationId: currentOrganization.id,
		})
	);
	const localRuntimesQuery = useQuery(
		localRuntimesQueryOptions({
			enabled: input.enabled,
			storageScope,
		})
	);
	const canReadInvitations =
		loadTeamState &&
		canManageOrganizationArea(roleQuery.data, {
			invitation: ["create"],
		});
	const invitationsQuery = useQuery({
		enabled: canReadInvitations,
		queryFn: async () =>
			await listOrganizationInvitations({
				organizationId: currentOrganization.id,
			}),
		queryKey: organizationQueryKeys.invitations(currentOrganization.id),
		refetchOnWindowFocus: false,
		retry: 1,
		staleTime: 10_000,
	});
	const channelNames = loadTeamState
		? resolveConnectedChannelNames({
				larkConnections: channelsQuery.data?.connections ?? [],
				slackConnected:
					designationQuery.data?.slackConnection?.connected === true,
			})
		: [];
	const appNames = [
		...new Set(
			(appsQuery.data?.connections ?? [])
				.filter((connection) => connection.status === "active")
				.map(
					(connection) =>
						findAppDefinition(connection.service)?.name ?? connection.service
				)
		),
	];
	const currentComputer = resolveCurrentLocalRuntime(localRuntimesQuery.data);
	const localAgentNames = [
		...new Set(
			(currentComputer?.executionTargets ?? []).flatMap((target) =>
				target.localAgentCatalog.entries
					.filter(
						(entry) =>
							entry.detected &&
							entry.enabled &&
							entry.lifecycleStatus === "active"
					)
					.map((entry) => entry.displayName)
			)
		),
	];

	return {
		appNames,
		channelNames,
		computerName: currentComputer?.deviceDisplayName ?? null,
		invitationCount: (invitationsQuery.data ?? []).filter(
			(invitation) => invitation.status === "pending"
		).length,
		isPersonal,
		localAgentNames,
		memoryEnabled: memoryPolicyQuery.data?.organizationMemoryOptIn ?? null,
		organizationId: currentOrganization.id,
		organizationName: currentOrganization.name,
	};
}

export function shouldLoadTeamOnboardingState(input: {
	enabled: boolean;
	isPersonal: boolean;
}): boolean {
	return input.enabled && !input.isPersonal;
}

function resolveConnectedChannelNames(input: {
	larkConnections: readonly { provider: string; status: string }[];
	slackConnected: boolean;
}): string[] {
	const names = new Set<string>();
	if (input.slackConnected) {
		names.add("Slack");
	}
	for (const connection of input.larkConnections) {
		if (connection.status !== "connected") {
			continue;
		}
		if (connection.provider === "lark") {
			names.add("Lark");
		} else if (connection.provider === "feishu") {
			names.add("Feishu");
		}
	}
	return [...names];
}
