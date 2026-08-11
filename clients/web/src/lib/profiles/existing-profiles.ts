import type { AuthProfileView } from "@openmeld/schemas/types";
import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";

async function listStartProfilesServer() {
	const { fetchStartProfilesFromRequest } = await import(
		"./existing-profiles.server"
	);

	return await fetchStartProfilesFromRequest({
		authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
	});
}

export const listStartProfiles = createServerFn({
	method: "GET",
}).handler(listStartProfilesServer);

export type StartSelectableProfile = AuthProfileView;
