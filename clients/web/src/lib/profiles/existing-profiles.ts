import type { AuthProfileView } from "@openmeld/schemas/types";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { readStartProfilesResponse } from "./profile-list-response";

async function listStartProfilesServer() {
	const { fetchStartProfilesFromRequest } = await import(
		"./existing-profiles.server"
	);

	return await fetchStartProfilesFromRequest({
		authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
	});
}

export const listStartProfiles = createIsomorphicFn()
	.client(async () =>
		readStartProfilesResponse(
			await createUnscopedWebOpenMeldApiFoundation().requestResponse({
				url: "/v1/profiles",
				method: "GET",
				operation: "profiles.list",
			})
		)
	)
	.server(listStartProfilesServer);

export type StartSelectableProfile = AuthProfileView;
