import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type { OrganizationInformationProtectionPolicyResponse } from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type OrganizationInformationProtectionFailure =
	StructuredApiClientFailure;

export async function readCurrentOrganizationInformationProtection(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<OrganizationInformationProtectionPolicyResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).readCurrentInformationProtection({ signal: input.signal });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setCurrentOrganizationInformationProtection(input: {
	organizationId: string;
	protectedInformation: string | null;
}): Promise<OrganizationInformationProtectionPolicyResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).setCurrentInformationProtection({
			protectedInformation: input.protectedInformation,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
