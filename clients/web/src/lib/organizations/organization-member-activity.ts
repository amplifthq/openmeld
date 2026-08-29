import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { organizationMemberWebActivityResponseSchema } from "@openmeld/schemas";
import type { OrganizationMemberWebActivityResponse } from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function recordCurrentOrganizationWebActivity(input: {
	organizationId: string;
}): Promise<OrganizationMemberWebActivityResponse> {
	try {
		return await createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			invalidMessage: "Invalid member activity response.",
			method: "POST",
			operation: "organization.member_activity.web.record",
			schema: organizationMemberWebActivityResponseSchema,
			url: "/v1/organizations/current/member-activity/web",
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export type OrganizationMemberActivityFailure = StructuredApiClientFailure;
