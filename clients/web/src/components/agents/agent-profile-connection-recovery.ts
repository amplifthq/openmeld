import type {
	AuthProfileView,
	DaemonServiceLane,
	GetAgentProfilePrimaryBindingResponse,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { readAgentProfilePrimaryBinding } from "#/lib/profiles/agent-profile-primary-binding";
import {
	ensureWebAgentProfileRuntimeBinding,
	formatWebAgentProfileRuntimeBindingFailure,
} from "#/lib/profiles/agent-profile-runtime-binding";
import { refreshWebAgentReadinessFacts } from "#/query/agents/execution-readiness";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { agentProfilePrimaryBindingQueryKeys } from "#/query/profiles/primary-binding";
import type { AgentProfileRepairAction } from "./agents-page-agent-profile-helpers";

export async function saveAgentProfileConnection(input: {
	action: AgentProfileRepairAction;
	actorProfileId: string | null;
	deviceId: string | null;
	organizationId: string;
	profile: AuthProfileView;
	runtimeLane: DaemonServiceLane | null;
}): Promise<void> {
	const bindingResult = await ensureWebAgentProfileRuntimeBinding({
		actorProfileId: input.actorProfileId,
		agentProfileId: input.profile.openMeldProfileId,
		agentControllerRef: input.action.agentControllerRef,
		deviceId: input.deviceId,
		organizationId: input.organizationId,
		runtimeLane: input.runtimeLane,
		writeMode: input.action.intent === "reconnect" ? "reconnect" : "ensure",
	});
	if (bindingResult.status !== "accepted") {
		throw new Error(formatWebAgentProfileRuntimeBindingFailure(bindingResult));
	}
}

export async function refreshSavedAgentProfileConnections(input: {
	onPrimaryBinding: (
		profileId: string,
		binding: NonNullable<GetAgentProfilePrimaryBindingResponse["binding"]>
	) => void;
	profileIds: readonly string[];
	organizationId: string;
	queryClient: QueryClient;
	refreshAll: () => Promise<unknown>;
	storageScope: string;
}): Promise<void> {
	const primaryBindingResults = await Promise.allSettled(
		input.profileIds.map(async (profileId) => ({
			profileId,
			response: await readAgentProfilePrimaryBinding({
				agentProfileId: profileId,
				organizationId: input.organizationId,
			}),
		}))
	);
	for (const result of primaryBindingResults) {
		if (result.status === "rejected") {
			continue;
		}
		const { profileId, response } = result.value;
		if (!response.binding) {
			continue;
		}
		input.queryClient.setQueryData<GetAgentProfilePrimaryBindingResponse>(
			agentProfilePrimaryBindingQueryKeys.profile(
				input.storageScope,
				profileId
			),
			{
				binding: response.binding,
				grantsClaimSuccess: false,
				status: "found",
			}
		);
		input.onPrimaryBinding(profileId, response.binding);
	}

	const refreshResults = await Promise.allSettled([
		input.queryClient.invalidateQueries({
			queryKey: organizationQueryKeys.all,
		}),
		refreshWebAgentReadinessFacts({
			agentProfileIds: input.profileIds,
			organizationId: input.organizationId,
			queryClient: input.queryClient,
			storageScope: input.storageScope,
		}),
		input.refreshAll(),
	]);
	const failureCount = [...primaryBindingResults, ...refreshResults].filter(
		(result) => result.status === "rejected"
	).length;
	if (failureCount > 0) {
		throw new Error(
			`Agent Profile connection refresh failed in ${failureCount} operation${failureCount === 1 ? "" : "s"}.`
		);
	}
}
