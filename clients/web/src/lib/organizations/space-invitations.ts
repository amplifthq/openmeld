import {
	type SpaceInvitationRequest,
	spaceInvitationResponseSchema,
} from "@openmeld/schemas";
import {
	OrganizationRequestError,
	requestAuthBusiness,
} from "#/lib/auth-business";

export class SpaceInvitationRequestError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

export async function requestSpaceInvitations(request: SpaceInvitationRequest) {
	const result = await requestAuthBusiness({
		path: "/v1/space-invitations",
		method: "POST",
		body: request,
		schema: spaceInvitationResponseSchema,
	}).catch((error) => {
		if (error instanceof OrganizationRequestError) {
			throw new SpaceInvitationRequestError(
				error.code ?? "space.invitation.request_failed",
				error.message
			);
		}
		throw error;
	});
	if (!result.ok) {
		throw new SpaceInvitationRequestError(result.code, result.message);
	}
	return result.invitations;
}
