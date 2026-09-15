import type { AuthProfileView } from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { readStartProfilesResponse } from "./profile-list-response";

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
	return await readStartProfilesResponse(response);
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
