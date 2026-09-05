import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { organizationMemberWebActivityResponseSchema } from "@openmeld/schemas";
import type { OrganizationMemberWebActivityResponse } from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function recordCurrentOrganizationWebActivity(input: {
	organizationId: string;
	spaceId?: string;
}): Promise<OrganizationMemberWebActivityResponse> {
	try {
		return await createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			invalidMessage: "Invalid member activity response.",
			method: "POST",
			operation: "organization.member_activity.web.record",
			schema: organizationMemberWebActivityResponseSchema,
			url: input.spaceId
				? `/v1/spaces/${encodeURIComponent(input.spaceId)}/member-activity/web`
				: "/v1/organizations/current/member-activity/web",
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export type OrganizationMemberActivityFailure = StructuredApiClientFailure;
