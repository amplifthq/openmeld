import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";

export const getProfileCapabilities = createServerFn({ method: "GET" }).handler(
	async () => {
		const { fetchProfileCapabilitiesFromRequest } = await import(
			"./profile-capabilities.server"
		);
		return await fetchProfileCapabilitiesFromRequest({
			authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
		});
	}
);
