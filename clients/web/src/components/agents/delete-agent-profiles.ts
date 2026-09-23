import type { AuthProfileView } from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { deleteStartAgentProfile } from "#/lib/profiles/delete-agent-profile";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import type { AgentDeleteFailure } from "./agent-list-selection";
import {
	invalidateAgentProfileListCaches,
	removeAgentProfileFromListCaches,
} from "./agent-profile-delete-cache";
import { isAgentProfileAlreadyRemovedError } from "./agents-page-formatters";

export async function deleteAgentProfiles(input: {
	profiles: readonly AuthProfileView[];
	currentUserId: string;
	organizationId: string;
	queryClient: QueryClient;
	storageScope: string;
}): Promise<AgentDeleteFailure[]> {
	const failures: AgentDeleteFailure[] = [];
	// Keep per-profile outcomes. A later failure must never restore an earlier deletion.
	for (const profile of input.profiles) {
		const profileId = profile.openMeldProfileId;
		if (
			profile.ownerUserId !== input.currentUserId ||
			profile.profileKind !== "agent" ||
			profile.managedRole
		) {
			failures.push({
				profileId,
				message: "You can only delete your own ordinary Agents.",
			});
			continue;
		}
		try {
			await deleteStartAgentProfile({ data: profileId });
		} catch (error) {
			if (!isAgentProfileAlreadyRemovedError(error)) {
				failures.push({
					profileId,
					message:
						error instanceof Error
							? error.message
							: "Couldn’t delete this Agent. Try again.",
				});
				continue;
			}
		}
		removeAgentProfileFromListCaches({ ...input, agentProfileId: profileId });
	}
	// A refresh failure does not undo a committed deletion.
	const refresh = await Promise.allSettled([
		invalidateAgentProfileListCaches(input),
		input.queryClient.invalidateQueries({
			queryKey: organizationQueryKeys.agentRuntimeOverview(
				input.organizationId
			),
		}),
	]);
	for (const result of refresh) {
		if (result.status === "rejected") {
			console.warn(
				"Could not refresh Agent lists after deletion.",
				result.reason
			);
		}
	}
	return failures;
}
