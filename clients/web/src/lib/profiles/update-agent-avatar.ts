import {
	createProfilesApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function updateAgentAvatar(input: {
	profileId: string;
	avatarStyle: "automatic" | "fluid";
}): Promise<AuthProfileView> {
	try {
		const response = await createProfilesApi(
			createUnscopedWebOpenMeldApiFoundation()
		).updateAgentAvatar(input);
		return response.profile;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
