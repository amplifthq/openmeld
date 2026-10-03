import {
	createProfilesApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { AuthProfileView } from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { applySavedAgentAvatarProfile } from "#/query/profiles/agent-avatar";
import type { AgentAvatarInvalidationScope } from "#/query/profiles/agent-avatar-invalidation";

export async function updateAgentAvatar(
	input: {
		profileId: string;
		// Personal Remote avatars use this API; Center bot styles use the Center owner API.
		avatarStyle: "automatic" | "fluid";
	},
	queryClient: QueryClient,
	scope?: AgentAvatarInvalidationScope
): Promise<AuthProfileView> {
	try {
		const response = await createProfilesApi(
			createUnscopedWebOpenMeldApiFoundation()
		).updateAgentAvatar(input);
		await applySavedAgentAvatarProfile(queryClient, response.profile, scope);
		return response.profile;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
