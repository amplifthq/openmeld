import { createOrganizationApi } from "@openmeld/api-client";
import type { OrganizationLogoMimeType } from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function updateCurrentOrganizationLogo(input: {
	bytes: ArrayBuffer | Blob | Uint8Array;
	mimeType: OrganizationLogoMimeType;
	organizationId: string;
}) {
	const { organizationId, ...request } = input;
	return await createOrganizationApi(
		createWebOpenMeldApiFoundation({ organizationId })
	).updateCurrentLogo(request);
}

export async function removeCurrentOrganizationLogo(input: {
	organizationId: string;
}) {
	return await createOrganizationApi(
		createWebOpenMeldApiFoundation({ organizationId: input.organizationId })
	).removeCurrentLogo();
}
