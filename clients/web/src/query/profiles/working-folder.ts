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

const PATH_SEPARATOR_PATTERN = /[\\/]+/;

/**
 * The working folder as one short line: the folder's name, with the full
 * path for a tooltip.
 */
export function describeSavedWorkingFolder(
	workspace: ProfileWorkspaceReadResult | undefined,
	fetching: boolean
): { summary: string; path?: string } {
	if (workspace?.status === "configured") {
		if (workspace.workspaceMode !== "custom") {
			return { summary: "OpenMeld folder", path: workspace.workspacePath };
		}
		const name = workspace.workspacePath
			.split(PATH_SEPARATOR_PATTERN)
			.filter(Boolean)
			.at(-1);
		return {
			summary: name ?? workspace.workspacePath,
			path: workspace.workspacePath,
		};
	}
	if (workspace?.status === "missing") {
		return { summary: "Choose a working folder" };
	}
	if (workspace?.status === "invalid") {
		return { summary: "Needs attention" };
	}
	return { summary: fetching ? "Loading…" : "Couldn’t read the folder" };
}
