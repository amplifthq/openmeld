"use client";

import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { setCurrentOrganizationCenterAgentMemoryPolicy } from "#/lib/organizations/center-agent-memory";
import { centerAgentMemoryPolicyQueryOptions } from "#/query/organizations/center-agent";

export function OrganizationMemoryPolicySection(input: {
	isPersonalWorkspace: boolean;
	organizationId: string;
	roleState: {
		canManage: boolean;
		errorMessage: string | null;
		isPending: boolean;
	};
}) {
	const memoryPolicyQuery = useQuery(
		centerAgentMemoryPolicyQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const memoryPolicyMutation = useMutation({
		mutationFn: async (organizationMemoryOptIn: boolean) =>
			await setCurrentOrganizationCenterAgentMemoryPolicy({
				organizationId: input.organizationId,
				organizationMemoryOptIn,
			}),
		onSuccess: async () => {
			await memoryPolicyQuery.refetch();
		},
	});
	const checked = memoryPolicyQuery.data?.organizationMemoryOptIn ?? false;
	const isDisabled =
		!input.roleState.canManage ||
		input.roleState.isPending ||
		Boolean(input.roleState.errorMessage) ||
		memoryPolicyQuery.isPending ||
		memoryPolicyQuery.isError ||
		memoryPolicyMutation.isPending;

	return (
		<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
			<div className="border-border/70 border-b px-5 py-4">
				<h2 className="font-medium text-foreground text-sm">
					{input.isPersonalWorkspace
						? "Workspace memory"
						: "Organization memory"}
				</h2>
			</div>
			<div className="flex items-start justify-between gap-4 px-5 py-4">
				<div className="min-w-0">
					<p className="font-medium text-foreground text-sm">
						{input.isPersonalWorkspace
							? "Remember context across this workspace"
							: "Use shared memory for this organization"}
					</p>
					<p className="mt-1 text-muted-foreground text-xs leading-5">
						{input.isPersonalWorkspace
							? "When this is on, completed Center Agent conversations in Spaces and connected channels become workspace memory for future replies. Private chats use your Center Agent memory instead and are never added here automatically. OpenMeld stores workspace memory in Zep, a third-party memory service. You can turn this off at any time."
							: "When this is on, conversations with the Center Agent in shared Spaces and Slack are summarized into organization memory, stored in Zep, a third-party memory service, and used in future Center Agent replies. Private Center Agent DMs are never saved to organization memory automatically. Owners and admins can turn this off at any time; when it is off, OpenMeld stops writing and retrieving organization memory."}
					</p>
					<p className="mt-2 text-muted-foreground text-xs">
						{resolveOrganizationMemorySummary({
							checked,
							isPending: memoryPolicyQuery.isPending,
							isPersonalWorkspace: input.isPersonalWorkspace,
							isSaving: memoryPolicyMutation.isPending,
						})}
					</p>
					{input.roleState.isPending ? (
						<p className="mt-2 text-muted-foreground text-xs">
							Checking who can manage organization memory.
						</p>
					) : null}
					{input.roleState.errorMessage ? (
						<p className="mt-2 text-destructive text-xs" role="alert">
							Could not load your organization role.{" "}
							{input.roleState.errorMessage}
						</p>
					) : null}
					{input.roleState.isPending ||
					input.roleState.errorMessage ||
					input.roleState.canManage ? null : (
						<p className="mt-2 text-muted-foreground text-xs">
							Only organization owners and admins can change this setting.
						</p>
					)}
					{memoryPolicyQuery.isError ? (
						<p className="mt-2 text-destructive text-xs">
							{memoryPolicyQuery.error.message}
						</p>
					) : null}
					{memoryPolicyMutation.isError ? (
						<p className="mt-2 text-destructive text-xs">
							{memoryPolicyMutation.error.message}
						</p>
					) : null}
				</div>
				<Switch
					aria-label={
						input.isPersonalWorkspace
							? "Use Workspace memory"
							: "Use shared Center Agent organization memory"
					}
					checked={checked}
					disabled={isDisabled}
					onCheckedChange={(nextChecked) => {
						memoryPolicyMutation.mutate(nextChecked);
					}}
				/>
			</div>
		</section>
	);
}

function resolveOrganizationMemorySummary(input: {
	checked: boolean;
	isPending: boolean;
	isPersonalWorkspace: boolean;
	isSaving: boolean;
}): string {
	const scope = input.isPersonalWorkspace ? "Workspace" : "Organization";
	if (input.isPending) {
		return `Loading ${scope.toLowerCase()} memory settings.`;
	}
	if (input.isSaving) {
		return `Saving ${scope.toLowerCase()} memory settings.`;
	}
	return `${scope} memory is ${input.checked ? "on" : "off"}.`;
}
