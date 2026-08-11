import {
	selectLastSelectedOrganizationBodySchema,
	selectLastSelectedOrganizationResponseSchema,
} from "@openmeld/schemas";
import type { SelectLastSelectedOrganizationResponse } from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export const ACCOUNT_LAST_SELECTED_ORGANIZATION_PATH =
	"/v1/account/last-selected-organization" as const;

export async function selectLastSelectedOrganization(
	organizationId: string
): Promise<SelectLastSelectedOrganizationResponse> {
	const body = selectLastSelectedOrganizationBodySchema.parse({
		organizationId,
	});
	return await createWebOpenMeldApiFoundation().requestJson({
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		invalidMessage: "Invalid Organization selection response.",
		method: "PATCH",
		operation: "account.organizationPreference.select",
		schema: selectLastSelectedOrganizationResponseSchema,
		url: ACCOUNT_LAST_SELECTED_ORGANIZATION_PATH,
	});
}
