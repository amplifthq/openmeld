import { listProfilesResponseSchema } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { readSessionExpiredErrorFromResponse } from "#/lib/session-expired";

export async function readStartProfiles(input: {
	requestHeaders: Headers;
	authBaseUrl: string;
	fetchImpl?: typeof fetch;
}): Promise<readonly AuthProfileView[]> {
	const headers = new Headers({
		accept: "application/json",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	const response = await (input.fetchImpl ?? fetch)(
		new URL("/v1/profiles", input.authBaseUrl),
		{
			method: "GET",
			headers,
		}
	);
	if (!response.ok) {
		const sessionExpiredError =
			await readSessionExpiredErrorFromResponse(response);
		if (sessionExpiredError) {
			throw sessionExpiredError;
		}

		throw new Error(
			"OpenMeld could not load your profiles right now. Try again."
		);
	}

	const payload = await response.json();
	const parsed = listProfilesResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(`Invalid start profiles response: ${parsed.error.message}`);
	}

	return parsed.data.profiles;
}

export async function fetchStartProfilesFromRequest(input: {
	authBaseUrl: string;
	fetchImpl?: typeof fetch;
}): Promise<readonly AuthProfileView[]> {
	return await readStartProfiles({
		requestHeaders: getRequestHeaders(),
		authBaseUrl: input.authBaseUrl,
		fetchImpl: input.fetchImpl,
	});
}
