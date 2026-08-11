import { createFileRoute } from "@tanstack/react-router";
import { proxyAuthOwnedRequest } from "#/lib/auth-proxy.server";
import { ACCOUNT_LAST_SELECTED_ORGANIZATION_PATH } from "#/lib/organizations/account-organization-preference";

function proxyLastSelectedOrganizationRequest(
	request: Request
): Promise<Response> {
	return proxyAuthOwnedRequest({
		request,
		upstreamPath: ACCOUNT_LAST_SELECTED_ORGANIZATION_PATH,
	});
}

export const Route = createFileRoute("/v1/account/last-selected-organization")({
	server: {
		handlers: {
			PATCH: ({ request }) => proxyLastSelectedOrganizationRequest(request),
		},
	},
});
