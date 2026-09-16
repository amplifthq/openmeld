import { listProfilesResponseSchema } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import { readResponseBody } from "#/lib/http-response";
import {
	isSessionExpiredError,
	readSessionExpiredErrorFromResponse,
	SessionExpiredError,
} from "#/lib/session-expired";

export async function readStartProfilesResponse(
	response: Response
): Promise<readonly AuthProfileView[]> {
	if (!response.ok) {
		const sessionExpiredError =
			await readSessionExpiredErrorFromResponse(response);
		if (sessionExpiredError) {
			throw sessionExpiredError;
		}
		// The existing Web Auth proxy carries unauthenticated responses as 400
		// to avoid the development proxy's 401 overlay. Identity is in its body.
		if (response.status === 400) {
			const body = await readResponseBody(response);
			if (
				body.ok &&
				(isSessionExpiredError(body.value) ||
					(body.value !== null &&
						typeof body.value === "object" &&
						"code" in body.value &&
						body.value.code === "AUTH_UNAUTHENTICATED"))
			) {
				throw new SessionExpiredError({
					cause: body.value,
					requestId: response.headers.get("x-request-id"),
				});
			}
		}
		throw new Error(
			"OpenMeld could not load your profiles right now. Try again."
		);
	}
	const parsed = listProfilesResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error(`Invalid start profiles response: ${parsed.error.message}`);
	}
	return parsed.data.profiles;
}
