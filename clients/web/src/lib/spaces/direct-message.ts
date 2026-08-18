import {
	createDirectMessageApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { OpenDirectMessageSpaceResponse } from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type DirectMessageOpenFailure = StructuredApiClientFailure;

export async function openCurrentDirectMessageSpace(input: {
	organizationId: string;
	targetProfileId: string;
}): Promise<OpenDirectMessageSpaceResponse> {
	try {
		return await createDirectMessageApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).openSpace({
			targetProfileId: input.targetProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveDirectMessageOpenErrorMessage(error: unknown): string {
	const failure = toStructuredApiClientFailure(error);
	const code = failure.upstreamCode ?? failure.code;

	switch (code) {
		case "direct_message.self_not_allowed":
			return "Choose another profile to start a Direct Message.";
		case "direct_message.target_not_found":
			return "OpenMeld could not find that profile in this organization.";
		default:
			break;
	}

	if (failure.status === 401) {
		return "Sign in again before starting a Direct Message.";
	}

	if (failure.status === 403) {
		return "You do not have access to start a Direct Message in this organization.";
	}

	return "OpenMeld could not open the Direct Message.";
}
