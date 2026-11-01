"use client";

import type { CenterAgentOrganizationMemoryPolicyResponse } from "@openmeld/schemas/types";
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
	const availability = memoryPolicyQuery.data?.availability;
	const availabilityMessage = checked
		? memoryAvailabilityMessage(availability)
		: null;
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
				availability={availability}
				availabilityMessage={availabilityMessage}
				checked={checked}
				control={control}
				error={
					memoryPolicyMutation.error?.message ??
					memoryPolicyQuery.error?.message ??
					input.roleState.errorMessage
				}
				isLoading={memoryPolicyQuery.isPending && !readUnavailable}
				onRetry={
					readUnavailable || (checked && availability !== "available")
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
						{input.isPersonalWorkspace
							? "Use Workspace memory"
							: "Use organization memory"}
					</p>
					{availabilityMessage ? (
						<output className="mt-2 block text-muted-foreground text-xs">
							{availabilityMessage}
						</output>
					) : null}
					<p className="mt-1 text-muted-foreground text-xs leading-5">
						{input.isPersonalWorkspace
							? "Messages sent to Center Agent in a Space can be remembered within that Space. Saving knowledge for the whole Workspace still requires your request. Private chats use personal memory."
							: "Messages sent to Center Agent in a Space can be remembered within that Space. Saving knowledge for the whole organization still requires an explicit request. Private chats use personal memory."}
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
					{readUnavailable || (checked && availability !== "available") ? (
						<div className="mt-2 flex items-center gap-2" role="alert">
							<p className="text-destructive text-xs">
								{readUnavailable
									? (memoryPolicyQuery.error?.message ??
										"Reconnect to load this memory setting.")
									: "Check memory availability again."}
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
	availability: CenterAgentOrganizationMemoryPolicyResponse["availability"];
	availabilityMessage: string | null;
	control: ReactNode;
	error: string | null | undefined;
	isLoading: boolean;
	onRetry?: () => void;
}) {
	let summary = input.isLoading ? "Loading…" : "Unavailable";
	if (input.checked === true) {
		summary =
			input.availability === "unavailable"
				? "Enabled · unavailable"
				: "Enabled";
	}
	if (input.checked === false) {
		summary = "Off";
	}
	return (
		<AgentConfigurationCard
			description="Remembers messages sent to Center Agent within each Space. Organization-wide saves still require an explicit request."
			icon={<BrainIcon aria-hidden="true" />}
			inlineContent={
				<>
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground text-xs">
							Use organization memory
						</span>
						{input.control}
					</div>
					{input.availabilityMessage ? (
						<output className="mt-2 block text-muted-foreground text-xs">
							{input.availabilityMessage}
						</output>
					) : null}
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

function memoryAvailabilityMessage(
	availability: CenterAgentOrganizationMemoryPolicyResponse["availability"]
): string {
	if (availability === "available") {
		return "The latest recall check succeeded. New saves may still be processing.";
	}
	if (availability === "unavailable") {
		return "Memory could not be read. Your setting is still enabled. Try again to check availability.";
	}
	return "Service availability has not been verified. Save a team fact, then check it in a new conversation.";
}
