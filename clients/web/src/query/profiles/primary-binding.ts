import type { StructuredApiClientFailure } from "@openmeld/api-client";
import type { GetAgentProfilePrimaryBindingResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { readAgentProfilePrimaryBinding } from "#/lib/profiles/agent-profile-primary-binding";
import { baseQueryOptions } from "#/query/query-config";

function normalizeQueryScope(storageScope: string | null | undefined): string {
	const normalizedScope = (storageScope ?? "").trim();
	return normalizedScope.length > 0 ? normalizedScope : "anonymous";
}

export const agentProfilePrimaryBindingQueryKeys = {
	profile: (storageScope: string, agentProfileId: string) =>
		[
			"profiles",
			"primary-binding",
			normalizeQueryScope(storageScope),
			agentProfileId,
		] as const,
} as const;

export function agentProfilePrimaryBindingQueryOptions(input: {
	agentProfileId: string;
	enabled: boolean;
	storageScope: string;
}) {
	return queryOptions<
		GetAgentProfilePrimaryBindingResponse,
		StructuredApiClientFailure
	>({
		queryKey: agentProfilePrimaryBindingQueryKeys.profile(
			input.storageScope,
			input.agentProfileId
		),
		queryFn: async () =>
			await readAgentProfilePrimaryBinding({
				agentProfileId: input.agentProfileId,
			}),
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: baseQueryOptions.staleTime,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}
