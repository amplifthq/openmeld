import {
	type SpaceInvitationRequest,
	spaceInvitationResponseSchema,
} from "@openmeld/schemas";
import { requestAuthEndpoint } from "#/lib/auth-transport";

export class SpaceInvitationRequestError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

export async function requestSpaceInvitations(request: SpaceInvitationRequest) {
	const response = await requestAuthEndpoint({
		path: "/space-invitations",
		fallbackMessage: "Could not load the invitation. Try again.",
		request: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
		},
	});
	if (response.error) {
		throw new SpaceInvitationRequestError(
			response.error.code ?? "space.invitation.request_failed",
			response.error.message ?? "Could not load the invitation."
		);
	}
	const result = spaceInvitationResponseSchema.parse(response.data);
	if (!result.ok) {
		throw new SpaceInvitationRequestError(result.code, result.message);
	}
	return result.invitations;
}
