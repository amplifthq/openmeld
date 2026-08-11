import { resolveProfileResponseSchema } from "@openmeld/schemas";
import { getRequestHeaders } from "@tanstack/react-start/server";

export type CurrentStartProfile = {
	openMeldProfileId: string;
	profileKind: "human";
	profileName: string;
	ownerUserId: string;
};

export async function readCurrentStartProfile(input: {
	requestHeaders: Headers;
	authBaseUrl: string;
	openMeldProfileId?: string;
	fetchImpl?: typeof fetch;
}): Promise<CurrentStartProfile> {
	const headers = new Headers({
		accept: "application/json",
		"content-type": "application/json",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	const response = await (input.fetchImpl ?? fetch)(
		new URL("/v1/profiles/resolve", input.authBaseUrl),
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				profileKind: "human",
				...(input.openMeldProfileId
					? { openMeldProfileId: input.openMeldProfileId }
					: {}),
			}),
		}
	);
	if (!response.ok) {
		throw new Error(
			`Failed to resolve current start profile: ${response.status}`
		);
	}

	const payload = await response.json();
	const parsed = resolveProfileResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(
			`Invalid current start profile response: ${parsed.error.message}`
		);
	}
	if (parsed.data.profile.profileKind !== "human") {
		throw new Error(
			"Invalid current start profile response: expected human profile"
		);
	}

	return {
		openMeldProfileId: parsed.data.profile.openMeldProfileId,
		profileKind: parsed.data.profile.profileKind,
		profileName: parsed.data.profile.profileName,
		ownerUserId: parsed.data.profile.ownerUserId,
	};
}

export async function fetchCurrentStartProfileFromRequest(input: {
	authBaseUrl: string;
	fetchImpl?: typeof fetch;
}): Promise<CurrentStartProfile> {
	return await readCurrentStartProfile({
		requestHeaders: getRequestHeaders(),
		authBaseUrl: input.authBaseUrl,
		fetchImpl: input.fetchImpl,
	});
}
