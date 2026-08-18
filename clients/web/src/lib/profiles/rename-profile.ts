import {
	createProfilesApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function renameOpenMeldProfile(input: {
	actorProfileId?: string | null;
	profileId: string;
	profileName: string;
}): Promise<AuthProfileView> {
	try {
		const response = await createProfilesApi(
			createUnscopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
			})
		).rename({
			profileId: input.profileId,
			profileName: input.profileName,
		});
		return response.profile;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
