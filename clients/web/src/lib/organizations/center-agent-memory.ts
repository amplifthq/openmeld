import { createOrganizationApi } from "@openmeld/api-client";
import type {
	CenterAgentOrganizationMemoryPolicyResponse,
	CenterAgentWipeMemberMemoryResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readCurrentOrganizationCenterAgentMemoryPolicy(input: {
	organizationId: string;
}): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
	return await createOrganizationApi(
		createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		})
	).readCurrentOrganizationCenterAgentMemoryPolicy();
}

export async function setCurrentOrganizationCenterAgentMemoryPolicy(input: {
	organizationId: string;
	organizationMemoryOptIn: boolean;
}): Promise<CenterAgentOrganizationMemoryPolicyResponse> {
	return await createOrganizationApi(
		createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		})
	).setCurrentOrganizationCenterAgentMemoryPolicy({
		organizationMemoryOptIn: input.organizationMemoryOptIn,
	});
}

export async function wipeCurrentMemberCenterAgentMemory(input: {
	organizationId: string;
}): Promise<CenterAgentWipeMemberMemoryResponse> {
	return await createOrganizationApi(
		createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		})
	).wipeCurrentMemberCenterAgentMemory();
}
