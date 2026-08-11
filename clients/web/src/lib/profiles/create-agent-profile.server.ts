import {
	type AuthProfileView,
	createAgentProfileBodySchema,
	createAgentProfileResponseSchema,
} from "@openmeld/schemas";
import { getRequestHeaders } from "@tanstack/react-start/server";

export async function createStartAgentProfileFromAuth(input: {
	requestHeaders: Headers;
	authBaseUrl: string;
	body: {
		profileName: string;
		creatorProfileId?: string;
	};
	fetchImpl?: typeof fetch;
}): Promise<AuthProfileView> {
	const parsedBody = createAgentProfileBodySchema.safeParse(input.body);
	if (!parsedBody.success) {
		throw new Error(
			parsedBody.error.issues[0]?.message ??
				"Invalid create agent profile input."
		);
	}

	const headers = new Headers({
		accept: "application/json",
		"content-type": "application/json",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	const response = await (input.fetchImpl ?? fetch)(
		new URL("/v1/profiles/agents", input.authBaseUrl),
		{
			method: "POST",
			headers,
			body: JSON.stringify(parsedBody.data),
		}
	);
	if (!response.ok) {
		throw new Error(`Failed to create agent profile: ${response.status}`);
	}

	const payload = await response.json();
	const parsedResponse = createAgentProfileResponseSchema.safeParse(payload);
	if (!parsedResponse.success) {
		throw new Error(
			`Invalid create agent profile response: ${parsedResponse.error.message}`
		);
	}
	if (parsedResponse.data.profile.profileKind !== "agent") {
		throw new Error(
			"Invalid create agent profile response: expected agent profile"
		);
	}

	return parsedResponse.data.profile;
}

// No route-catalog nudge here on purpose: a freshly created profile has no
// binding yet, so a sync now can only register the pre-existing route set
// (a wasted full catalog sync per creation). Core notifies daemons itself
// once the primary binding is written (rpcEnsureAgentProfilePrimaryBinding).
export async function createStartAgentProfileFromRequest(input: {
	authBaseUrl: string;
	body: {
		profileName: string;
		creatorProfileId?: string;
	};
	fetchImpl?: typeof fetch;
	requestHeaders?: Headers;
}): Promise<AuthProfileView> {
	const requestHeaders = input.requestHeaders ?? getRequestHeaders();
	return await createStartAgentProfileFromAuth({
		requestHeaders,
		authBaseUrl: input.authBaseUrl,
		body: input.body,
		fetchImpl: input.fetchImpl,
	});
}
