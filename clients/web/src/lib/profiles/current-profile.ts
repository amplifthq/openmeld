import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";
import type { CurrentStartProfile } from "./current-profile.server";

async function resolveCurrentStartProfileServer(): Promise<CurrentStartProfile> {
	const { fetchCurrentStartProfileFromRequest } = await import(
		"./current-profile.server"
	);

	return await fetchCurrentStartProfileFromRequest({
		authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
	});
}

export const resolveCurrentStartProfile = createServerFn({
	method: "GET",
}).handler(resolveCurrentStartProfileServer);
