import type { AuthProfileView } from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { deleteStartAgentProfile } from "#/lib/profiles/delete-agent-profile";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import type { AgentDeleteFailure } from "./agent-list-selection";
import {
	invalidateAgentProfileListCaches,
	optimisticallyRemoveAgentProfileFromListCaches,
	removeAgentProfileFromListCaches,
	restoreFailedAgentProfilesInListCaches,
} from "./agent-profile-delete-cache";
import { isAgentProfileAlreadyRemovedError } from "./agents-page-formatters";

export async function deleteAgentProfiles(input: {
	profiles: readonly AuthProfileView[];
	currentUserId: string;
	organizationId: string;
	queryClient: QueryClient;
	storageScope: string;
}): Promise<AgentDeleteFailure[]> {
	const outcomes: (AgentDeleteFailure | null)[] = Array.from(
		{ length: input.profiles.length },
		() => null
	);
	const eligible: { index: number; profileId: string }[] = [];
	input.profiles.forEach((profile, index) => {
		const profileId = profile.openMeldProfileId;
		if (
			profile.ownerUserId !== input.currentUserId ||
			profile.profileKind !== "agent" ||
			profile.managedRole
		) {
			outcomes[index] = {
				profileId,
				message: "You can only delete your own ordinary Agents.",
			};
			return;
		}
		eligible.push({ index, profileId });
	});
	let snapshot: Awaited<
		ReturnType<typeof optimisticallyRemoveAgentProfileFromListCaches>
	> | null = null;
	const first = eligible[0];
	if (first) {
		snapshot = await optimisticallyRemoveAgentProfileFromListCaches({
			...input,
			agentProfileId: first.profileId,
		});
		for (const { profileId } of eligible.slice(1)) {
			removeAgentProfileFromListCaches({ ...input, agentProfileId: profileId });
		}
	}
	// Bound concurrent requests while keeping each Agent's result independent.
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(3, eligible.length) }, async () => {
			while (next < eligible.length) {
				const entry = eligible[next++];
				if (!entry) {
					break;
				}
				try {
					await deleteStartAgentProfile({ data: entry.profileId });
				} catch (error) {
					if (!isAgentProfileAlreadyRemovedError(error)) {
						outcomes[entry.index] = {
							profileId: entry.profileId,
							message:
								error instanceof Error
									? error.message
									: "Couldn’t confirm deletion. Try again.",
						};
					}
				}
			}
		})
	);
	const failures = outcomes.filter(
		(outcome): outcome is AgentDeleteFailure => outcome !== null
	);
	if (snapshot && failures.length > 0) {
		restoreFailedAgentProfilesInListCaches({
			failedProfileIds: new Set(failures.map((failure) => failure.profileId)),
			queryClient: input.queryClient,
			snapshot,
		});
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
