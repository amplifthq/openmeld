import {
	type OrganizationJoinRequestInput,
	organizationJoinRequestResponseSchema,
} from "@openmeld/schemas";
import { requestAuthEndpoint } from "#/lib/auth-transport";

export async function requestOrganizationJoinRequests(
	request: OrganizationJoinRequestInput | { token: string }
) {
	return (await requestOrganizationJoinRequestResult(request)).requests;
}

export async function requestOrganizationJoinRequestResult(
	request: OrganizationJoinRequestInput | { token: string }
) {
	const response = await requestAuthEndpoint({
		path:
			"token" in request
				? "/organization/join-link/request?responseVersion=2"
				: "/organization/join-requests?responseVersion=2",
		fallbackMessage: "Could not load the invitation request. Try again.",
		request: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
		},
	});
	if (response.error) {
		throw new Error(
			response.error.message ?? "Could not load the invitation request."
		);
	}
	const result = organizationJoinRequestResponseSchema.parse(response.data);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result;
}
