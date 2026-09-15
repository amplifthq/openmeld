import { normalizeOrganizationList } from "@openmeld/schemas";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { OrganizationSummary } from "./organization-types";

type FetchAuthOrganizationsInput = {
	betterAuthUrl: string;
	fetchImpl?: typeof fetch;
	requestHeaders?: Headers;
};

export async function fetchAuthOrganizations({
	betterAuthUrl,
	fetchImpl = fetch,
	requestHeaders = getRequestHeaders(),
}: FetchAuthOrganizationsInput): Promise<OrganizationSummary[]> {
	const headers = new Headers({ accept: "application/json" });
	const cookie = requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	const endpoint = new URL("/api/auth/organization/list", betterAuthUrl);
	const response = await fetchImpl(endpoint, {
		headers,
		method: "GET",
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch organizations: ${response.status}`);
	}

	const payload = await response.json();
	return normalizeOrganizationList(payload);
}
