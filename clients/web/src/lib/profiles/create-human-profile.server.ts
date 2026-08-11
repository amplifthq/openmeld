import {
	type AuthProfileView,
	createHumanProfileBodySchema,
	createHumanProfileResponseSchema,
	profileErrorResponseSchema,
} from "@openmeld/schemas";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { readResponseBody } from "#/lib/http-response";
import { readSessionExpiredErrorFromResponse } from "#/lib/session-expired";

export async function createStartHumanProfileFromAuth(input: {
	requestHeaders: Headers;
	authBaseUrl: string;
	body: {
		profileName: string;
		creatorProfileId?: string;
	};
	fetchImpl?: typeof fetch;
}): Promise<AuthProfileView> {
	const parsedBody = createHumanProfileBodySchema.safeParse(input.body);
	if (!parsedBody.success) {
		throw new Error(
			parsedBody.error.issues[0]?.message ??
				"Invalid create human profile input."
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
		new URL("/v1/profiles/humans", input.authBaseUrl),
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

		throw await createHumanProfileResponseError(response);
	}

	const payload = await response.json();
	const parsedResponse = createHumanProfileResponseSchema.safeParse(payload);
	if (!parsedResponse.success) {
		throw new Error(
			`Invalid create human profile response: ${parsedResponse.error.message}`
		);
	}
	if (parsedResponse.data.profile.profileKind !== "human") {
		throw new Error(
			"Invalid create human profile response: expected human profile"
		);
	}

	return parsedResponse.data.profile;
}

async function createHumanProfileResponseError(
	response: Response
): Promise<Error> {
	const body = await readResponseBody(response);
	const payload = body.ok ? body.value : null;
	const parsedError = profileErrorResponseSchema.safeParse(payload);
	const error = new Error(
		parsedError.success
			? parsedError.data.message
			: `Failed to create human profile: ${response.status}`
	) as Error & { status: number; upstreamCode?: string };
	error.status = response.status;
	if (parsedError.success) {
		error.upstreamCode = parsedError.data.code;
	}
	return error;
}

export async function createStartHumanProfileFromRequest(input: {
	authBaseUrl: string;
	body: {
		profileName: string;
		creatorProfileId?: string;
	};
	fetchImpl?: typeof fetch;
}): Promise<AuthProfileView> {
	return await createStartHumanProfileFromAuth({
		requestHeaders: getRequestHeaders(),
		authBaseUrl: input.authBaseUrl,
		body: input.body,
		fetchImpl: input.fetchImpl,
	});
}
