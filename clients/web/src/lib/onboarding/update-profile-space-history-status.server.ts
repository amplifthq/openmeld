import { OPENMELD_HEADER_PROFILE_ID } from "@openmeld/gateway-contract";
import {
	patchProfileSpaceHistoryStatusBodySchema,
	patchProfileSpaceHistoryStatusResponseSchema,
} from "@openmeld/schemas";
import type {
	PatchProfileSpaceHistoryStatusResponse,
	ProfileSpaceHistoryStatus,
} from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { copyOpenMeldClientAddressHeader } from "#/lib/openmeld-api/gateway-upstream";
import { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";

export async function updateProfileSpaceHistoryStatusFromRequest(input: {
	gatewayUrl: string;
	webAppUrl: string;
	profileId: string;
	spaceId: string;
	status: ProfileSpaceHistoryStatus;
	reason?: string;
	fetchImpl?: typeof fetch;
}): Promise<PatchProfileSpaceHistoryStatusResponse> {
	const profileId = normalizeRequiredText(input.profileId, "profileId");
	const spaceId = normalizeRequiredText(input.spaceId, "spaceId");
	const gatewayHost = new URL(input.gatewayUrl).host.toLowerCase();
	const requestHeaders = getRequestHeaders();
	const headers = new Headers({
		accept: "application/json",
		"content-type": "application/json",
		[OPENMELD_HEADER_PROFILE_ID]: profileId,
	});
	const cookie = requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}
	copyOpenMeldClientAddressHeader({ from: requestHeaders, to: headers });

	const body = {
		gatewayHost,
		status: input.status,
		...(normalizeOptionalText(input.reason)
			? { reason: normalizeOptionalText(input.reason) }
			: {}),
	};
	const parsedBody = patchProfileSpaceHistoryStatusBodySchema.safeParse(body);
	if (!parsedBody.success) {
		throw new Error(
			parsedBody.error.issues[0]?.message ??
				"Invalid profile space history status body."
		);
	}

	const response = await proxyOpenMeldGatewayRequest({
		request: new Request(
			new URL(
				`/v1/profiles/${encodeURIComponent(profileId)}/spaces/${encodeURIComponent(spaceId)}/status`,
				input.webAppUrl
			),
			{
				method: "PATCH",
				headers,
				body: JSON.stringify(parsedBody.data),
			}
		),
		gatewayUrl: input.gatewayUrl,
		webAppUrl: input.webAppUrl,
		fetchImpl: input.fetchImpl,
	});
	if (!response.ok) {
		throw new Error(
			`Failed to update profile space history status: ${response.status}`
		);
	}

	const payload = await response.json();
	const parsedResponse =
		patchProfileSpaceHistoryStatusResponseSchema.safeParse(payload);
	if (!parsedResponse.success) {
		throw new Error(
			`Invalid profile space history status response: ${parsedResponse.error.message}`
		);
	}

	return parsedResponse.data;
}

function normalizeRequiredText(value: string, label: string): string {
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`${label} is required.`);
	}
	return normalized;
}

function normalizeOptionalText(
	value: string | null | undefined
): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}
