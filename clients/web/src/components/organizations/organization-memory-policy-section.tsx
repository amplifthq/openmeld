"use client";

import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { Switch } from "@openmeld/ui/components/switch";
import { BrainIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentConfigurationCard } from "#/components/profiles/agent-configuration-card";
import { setCurrentOrganizationCenterAgentMemoryPolicy } from "#/lib/organizations/center-agent-memory";
import { centerAgentMemoryPolicyQueryOptions } from "#/query/organizations/center-agent";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The policy query and mutation serve the existing page and the Center Agent card presentation.
export function OrganizationMemoryPolicySection(input: {
	isPersonalWorkspace: boolean;
	organizationId: string;
	presentation?: "card";
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
	const readUnavailable =
		memoryPolicyQuery.isError || memoryPolicyQuery.fetchStatus === "paused";
	const checked = readUnavailable
		? undefined
		: memoryPolicyQuery.data?.organizationMemoryOptIn;
	const isDisabled =
		!input.roleState.canManage ||
		input.roleState.isPending ||
		Boolean(input.roleState.errorMessage) ||
		memoryPolicyQuery.isPending ||
		readUnavailable ||
		memoryPolicyMutation.isPending;
	const missingControl = readUnavailable ? (
		<span className="shrink-0 text-muted-foreground text-xs">Unavailable</span>
	) : (
		<SkeletonRegion className="shrink-0" label="Loading memory setting">
			<Skeleton className="h-5 w-8 rounded-full" />
		</SkeletonRegion>
	);
	const control =
		checked === undefined ? (
			missingControl
		) : (
			<Switch
				aria-label={
					input.isPersonalWorkspace
						? "Use Workspace memory"
						: "Use shared Center Agent organization memory"
				}
				checked={checked}
				disabled={isDisabled}
				onCheckedChange={(nextChecked) =>
					memoryPolicyMutation.mutate(nextChecked)
				}
			/>
		);
	if (input.presentation === "card") {
		return (
			<OrganizationMemoryPolicyCard
				checked={checked}
				control={control}
				error={
					memoryPolicyMutation.error?.message ??
					memoryPolicyQuery.error?.message ??
					input.roleState.errorMessage
				}
				isLoading={memoryPolicyQuery.isPending && !readUnavailable}
				onRetry={
					readUnavailable
						? () => memoryPolicyQuery.refetch().catch(console.error)
						: undefined
				}
			/>
		);
	}

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
						Remember shared conversations
					</p>
					<p className="mt-1 text-muted-foreground text-xs leading-5">
						{input.isPersonalWorkspace
							? "Center Agent can use useful details from Spaces and connected channels in future replies. Private chats use your personal memory instead."
							: "Center Agent can use useful details from shared Spaces and connected channels in future replies. Private chats are not included."}
					</p>
					{memoryPolicyMutation.isPending ? (
						<p
							aria-live="polite"
							className="mt-2 text-muted-foreground text-xs"
						>
							Saving memory setting…
						</p>
					) : null}
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
							Only owners and admins can change organization memory.
						</p>
					)}
					{readUnavailable ? (
						<div className="mt-2 flex items-center gap-2" role="alert">
							<p className="text-destructive text-xs">
								{memoryPolicyQuery.error?.message ??
									"Reconnect to load this memory setting."}
							</p>
							<Button
								disabled={memoryPolicyQuery.isFetching}
								onClick={() => memoryPolicyQuery.refetch().catch(console.error)}
								size="sm"
								variant="outline"
							>
								Try again
							</Button>
						</div>
					) : null}
					{memoryPolicyMutation.isError ? (
						<p className="mt-2 text-destructive text-xs">
							{memoryPolicyMutation.error.message}
						</p>
					) : null}
				</div>
				{control}
			</div>
		</section>
	);
}

function OrganizationMemoryPolicyCard(input: {
	checked: boolean | undefined;
	control: ReactNode;
	error: string | null | undefined;
	isLoading: boolean;
	onRetry?: () => void;
}) {
	let summary = input.isLoading ? "Loading…" : "Unavailable";
	if (input.checked === true) {
		summary = "On";
	}
	if (input.checked === false) {
		summary = "Off";
	}
	return (
		<AgentConfigurationCard
			description="Uses details from shared Spaces and channels. Private chats stay out."
			icon={<BrainIcon aria-hidden="true" />}
			inlineContent={
				<>
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground text-xs">
							Remember shared conversations
						</span>
						{input.control}
					</div>
					{input.error ? (
						<p className="mt-2 text-destructive text-xs" role="alert">
							{input.error}
						</p>
					) : null}
					{input.onRetry ? (
						<Button
							className="mt-2"
							onClick={input.onRetry}
							size="sm"
							type="button"
							variant="outline"
						>
							Try again
						</Button>
					) : null}
				</>
			}
			itemId="center-agent-memory"
			label="Organization memory"
			readOnly
			summary={summary}
		/>
	);
}
