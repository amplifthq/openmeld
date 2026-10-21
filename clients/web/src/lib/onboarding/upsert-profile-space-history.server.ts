import { OPENMELD_HEADER_PROFILE_ID } from "@openmeld/gateway-contract";
import {
	upsertProfileSpaceHistoryBodySchema,
	upsertProfileSpaceHistoryResponseSchema,
} from "@openmeld/schemas";
import type {
	ProfileSpaceCreatorKind,
	ProfileSpaceHistoryRecord,
	UpsertProfileSpaceHistoryResponse,
} from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { copyOpenMeldClientAddressHeader } from "#/lib/openmeld-api/gateway-upstream";
import { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";

export async function upsertProfileSpaceHistoryFromRequest(input: {
	gatewayUrl: string;
	webAppUrl: string;
	profileId: string;
	spaceId: string;
	spaceName?: string | null;
	creatorProfileId?: string | null;
	creatorKind?: ProfileSpaceCreatorKind | null;
	spaceCreatedAt?: string | null;
	spaceUpdatedAt?: string | null;
	lastJoinedAt?: string;
	lastSeenTs?: number | null;
	pinnedAt?: string | null;
	fetchImpl?: typeof fetch;
}): Promise<ProfileSpaceHistoryRecord> {
	return (await upsertProfileSpaceHistoryResponseFromRequest(input)).item;
}

export async function upsertProfileSpaceHistoryResponseFromRequest(input: {
	gatewayUrl: string;
	webAppUrl: string;
	profileId: string;
	spaceId: string;
	spaceName?: string | null;
	creatorProfileId?: string | null;
	creatorKind?: ProfileSpaceCreatorKind | null;
	spaceCreatedAt?: string | null;
	spaceUpdatedAt?: string | null;
	lastJoinedAt?: string;
	lastSeenTs?: number | null;
	pinnedAt?: string | null;
	fetchImpl?: typeof fetch;
}): Promise<UpsertProfileSpaceHistoryResponse> {
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
		...(normalizeOptionalText(input.spaceName)
			? { spaceName: normalizeOptionalText(input.spaceName) }
			: {}),
		...(normalizeOptionalText(input.creatorProfileId)
			? { creatorProfileId: normalizeOptionalText(input.creatorProfileId) }
			: {}),
		...(input.creatorKind === undefined
			? {}
			: { creatorKind: input.creatorKind }),
		...(normalizeOptionalText(input.spaceCreatedAt)
			? { spaceCreatedAt: normalizeOptionalText(input.spaceCreatedAt) }
			: {}),
		...(normalizeOptionalText(input.spaceUpdatedAt)
			? { spaceUpdatedAt: normalizeOptionalText(input.spaceUpdatedAt) }
			: {}),
		...(normalizeOptionalText(input.lastJoinedAt)
			? { lastJoinedAt: normalizeOptionalText(input.lastJoinedAt) }
			: {}),
		...(input.lastSeenTs === undefined ? {} : { lastSeenTs: input.lastSeenTs }),
		...(input.pinnedAt === undefined ? {} : { pinnedAt: input.pinnedAt }),
		status: "active" as const,
	};
	const parsedBody = upsertProfileSpaceHistoryBodySchema.safeParse(body);
	if (!parsedBody.success) {
		throw new Error(
			parsedBody.error.issues[0]?.message ??
				"Invalid profile space history upsert body."
		);
	}

	const response = await proxyOpenMeldGatewayRequest({
		request: new Request(
			new URL(
				`/v1/profiles/${encodeURIComponent(profileId)}/spaces/${encodeURIComponent(spaceId)}`,
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
			`Failed to upsert profile space history: ${response.status}`
		);
	}

	const payload = await response.json();
	const parsedResponse =
		upsertProfileSpaceHistoryResponseSchema.safeParse(payload);
	if (!parsedResponse.success) {
		throw new Error(
			`Invalid profile space history upsert response: ${parsedResponse.error.message}`
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
