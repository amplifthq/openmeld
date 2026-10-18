import { queryOptions } from "@tanstack/react-query";
import { readAgentProfileFolders } from "#/lib/profiles/agent-profile-folders";

export function agentProfileFoldersQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	profileId: string;
	storageScope: string;
}) {
	return queryOptions({
		// Owner-private: keep it out of the browser persistence allowlist.
		queryKey: [
			"private-agent-folders",
			input.storageScope,
			input.organizationId,
			input.profileId,
		],
		queryFn: () =>
			readAgentProfileFolders({
				organizationId: input.organizationId,
				profileId: input.profileId,
			}),
		enabled: input.enabled,
		staleTime: 30_000,
		gcTime: 5 * 60_000,
		retry: false,
		refetchOnWindowFocus: false,
	});
}
