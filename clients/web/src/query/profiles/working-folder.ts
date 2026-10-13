import type { ProfileWorkspaceReadResult } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { readAgentProfileWorkspace } from "#/lib/profiles/update-profile-workspace";

export function agentProfileWorkingFolderQueryOptions(
	input: Parameters<typeof readAgentProfileWorkspace>[0] & {
		storageScope: string;
		enabled: boolean;
	}
) {
	return queryOptions({
		// Private Service data: scope to the account, organization and exact Binding.
		// This key is deliberately outside the browser persistence allowlist.
		queryKey: [
			"private-working-folder",
			input.storageScope,
			input.organizationId,
			input.profileId,
			input.target ?? null,
			input.expectedBindingTarget ?? null,
		],
		queryFn: () => readAgentProfileWorkspace(input),
		enabled: input.enabled,
		staleTime: 30_000,
		gcTime: 5 * 60_000,
		retry: false,
		refetchOnWindowFocus: false,
	});
}

export function describeSavedWorkingFolder(
	workspace: ProfileWorkspaceReadResult | undefined,
	fetching: boolean
): string {
	if (workspace?.status === "configured") {
		const source =
			workspace.workspaceMode === "custom"
				? "Custom folder"
				: "OpenMeld-managed folder";
		return `${source}: ${workspace.workspacePath}`;
	}
	if (workspace?.status === "missing") {
		return "Choose a working folder";
	}
	if (workspace?.status === "invalid") {
		return "Saved folder settings need attention";
	}
	return fetching
		? "Loading working folder…"
		: "Couldn’t read the working folder. Open settings to try again.";
}
