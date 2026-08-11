import type {
	GetOrganizationSkillResponse,
	ListOrganizationSkillsResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	getCurrentOrganizationSkill,
	listCurrentOrganizationSkills,
	type OrganizationSkillFailure,
} from "#/lib/organizations/organization-skills";
import { baseQueryOptions } from "#/query/query-config";

export const organizationSkillQueryKeys = {
	all: ["organization-skills"] as const,
	list: (organizationId: string) =>
		[...organizationSkillQueryKeys.all, organizationId, "list"] as const,
	detail: (organizationId: string, skillId: string) =>
		[
			...organizationSkillQueryKeys.all,
			organizationId,
			"detail",
			skillId,
		] as const,
};

export function organizationSkillsQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<ListOrganizationSkillsResponse, OrganizationSkillFailure>(
		{
			enabled: input.enabled ?? true,
			gcTime: baseQueryOptions.gcTime,
			queryFn: async ({ signal }) =>
				await listCurrentOrganizationSkills({
					organizationId: input.organizationId,
					signal,
				}),
			queryKey: organizationSkillQueryKeys.list(input.organizationId),
			refetchOnWindowFocus: false,
			retry: baseQueryOptions.retry,
			staleTime: 10_000,
		}
	);
}

export function organizationSkillQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
	skillId: string;
}) {
	return queryOptions<GetOrganizationSkillResponse, OrganizationSkillFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentOrganizationSkill({
				organizationId: input.organizationId,
				signal,
				skillId: input.skillId,
			}),
		queryKey: organizationSkillQueryKeys.detail(
			input.organizationId,
			input.skillId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
