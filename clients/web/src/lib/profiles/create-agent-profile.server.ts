import { OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID } from "@openmeld/gateway-contract";
import {
	type AuthProfileView,
	createAgentProfileBodySchema,
	createAgentProfileResponseSchema,
	profileErrorResponseSchema,
} from "@openmeld/schemas";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { readResponseBody } from "#/lib/http-response";
import { readSessionExpiredErrorFromResponse } from "#/lib/session-expired";

export async function createStartAgentProfileFromAuth(input: {
	requestHeaders: Headers;
	authBaseUrl: string;
	organizationId: string;
	body: {
		profileName: string;
		creatorProfileId?: string;
		idempotencyKey?: string;
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
		[OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID]: input.organizationId,
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
		const sessionExpiredError =
			await readSessionExpiredErrorFromResponse(response);
		if (sessionExpiredError) {
			throw sessionExpiredError;
		}

		throw await createAgentProfileResponseError(response);
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

async function createAgentProfileResponseError(
	response: Response
): Promise<Error> {
	const body = await readResponseBody(response);
	const payload = body.ok ? body.value : null;
	const parsedError = profileErrorResponseSchema.safeParse(payload);
	const error = new Error(
		parsedError.success
			? parsedError.data.message
			: `Failed to create agent profile: ${response.status}`
	) as Error & { status: number; upstreamCode?: string };
	error.status = response.status;
	if (parsedError.success) {
		error.upstreamCode = parsedError.data.code;
	}
	return error;
}

// No route-catalog nudge here on purpose: a freshly created profile has no
// binding yet, so a sync now can only register the pre-existing route set
// (a wasted full catalog sync per creation). Core notifies daemons itself
// once the primary binding is written (rpcEnsureAgentProfilePrimaryBinding).
export async function createStartAgentProfileFromRequest(input: {
	authBaseUrl: string;
	organizationId: string;
	body: {
		profileName: string;
		creatorProfileId?: string;
		idempotencyKey?: string;
	};
	fetchImpl?: typeof fetch;
	requestHeaders?: Headers;
}): Promise<AuthProfileView> {
	const requestHeaders = input.requestHeaders ?? getRequestHeaders();
	return await createStartAgentProfileFromAuth({
		requestHeaders,
		authBaseUrl: input.authBaseUrl,
		body: input.body,
		organizationId: input.organizationId,
		fetchImpl: input.fetchImpl,
	});
}
