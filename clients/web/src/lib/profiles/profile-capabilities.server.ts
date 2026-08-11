import { profileCapabilitiesResponseSchema } from "@openmeld/schemas";
import type { ProfileCapabilitiesResponse } from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { readSessionExpiredErrorFromResponse } from "#/lib/session-expired";

export async function readProfileCapabilities(input: {
	authBaseUrl: string;
	fetchImpl?: typeof fetch;
	requestHeaders: Headers;
}): Promise<ProfileCapabilitiesResponse> {
	const headers = new Headers({ accept: "application/json" });
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	const response = await (input.fetchImpl ?? fetch)(
		new URL("/v1/profiles/capabilities", input.authBaseUrl),
		{
			headers,
			method: "GET",
		}
	);
	if (!response.ok) {
		const sessionExpiredError =
			await readSessionExpiredErrorFromResponse(response);
		if (sessionExpiredError) {
			throw sessionExpiredError;
		}
		throw new Error(
			"OpenMeld could not check profile creation availability right now."
		);
	}

	const parsed = profileCapabilitiesResponseSchema.safeParse(
		await response.json()
	);
	if (!parsed.success) {
		throw new Error(
			`Invalid profile capabilities response: ${parsed.error.message}`
		);
	}
	return parsed.data;
}

export async function fetchProfileCapabilitiesFromRequest(input: {
	authBaseUrl: string;
	fetchImpl?: typeof fetch;
}): Promise<ProfileCapabilitiesResponse> {
	return await readProfileCapabilities({
		authBaseUrl: input.authBaseUrl,
		fetchImpl: input.fetchImpl,
		requestHeaders: getRequestHeaders(),
	});
}
