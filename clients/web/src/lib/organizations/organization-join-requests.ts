import {
	type OrganizationJoinRequestInput,
	organizationJoinRequestResponseSchema,
} from "@openmeld/schemas";
import { requestAuthBusiness } from "#/lib/auth-business";

export async function requestOrganizationJoinRequests(
	request: OrganizationJoinRequestInput | { token: string }
) {
	return (await requestOrganizationJoinRequestResult(request)).requests;
}

export async function requestOrganizationJoinRequestResult(
	request: OrganizationJoinRequestInput | { token: string }
) {
	const result = await requestAuthBusiness({
		path:
			"token" in request
				? "/v1/organization-join-link/request?responseVersion=2"
				: "/v1/organization-join-requests?responseVersion=3",
		method: "POST",
		body: request,
		schema: organizationJoinRequestResponseSchema,
	});
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result;
}
