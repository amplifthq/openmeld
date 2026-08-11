import type { OrganizationInformationProtectionPolicyResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	type OrganizationInformationProtectionFailure,
	readCurrentOrganizationInformationProtection,
} from "#/lib/organizations/organization-information-protection";
import { baseQueryOptions } from "#/query/query-config";

export const organizationInformationProtectionQueryKeys = {
	all: ["organization-information-protection"] as const,
	policy: (organizationId: string) =>
		[
			...organizationInformationProtectionQueryKeys.all,
			organizationId,
			"policy",
		] as const,
};

export function organizationInformationProtectionQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		OrganizationInformationProtectionPolicyResponse,
		OrganizationInformationProtectionFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await readCurrentOrganizationInformationProtection({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationInformationProtectionQueryKeys.policy(
			input.organizationId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
