"use client";

import type { AgentProfileCreationApprovalPolicy } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setAgentProfileCreationApprovalPreference } from "#/lib/profiles/agent-profile-creation-requests";
import {
	agentProfileCreationApprovalPreferenceQueryOptions,
	agentProfileCreationRequestQueryKeys,
} from "#/query/profiles/agent-profile-creation-requests";

const POLICY_OPTIONS = [
	{ label: "Ask me each time", value: "ask_every_time" },
	{ label: "Allow without asking", value: "automatically_allow" },
	{ label: "Don’t allow", value: "never_allow" },
] as const satisfies readonly {
	label: string;
	value: AgentProfileCreationApprovalPolicy;
}[];

export function AgentProfileCreationApprovalSettings(input: {
	organizationId: string;
	organizationName?: string;
}) {
	const queryClient = useQueryClient();
	const preferenceQuery = useQuery(
		agentProfileCreationApprovalPreferenceQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const mutation = useMutation({
		mutationFn: async (next: {
			existingSessionPolicy: AgentProfileCreationApprovalPolicy;
			newSessionPolicy: AgentProfileCreationApprovalPolicy;
		}) =>
			await setAgentProfileCreationApprovalPreference({
				...next,
				organizationId: input.organizationId,
			}),
		onError: (error) => toast.error(error.message),
		onSuccess: (preference) => {
			queryClient.setQueryData(
				agentProfileCreationRequestQueryKeys.preference(input.organizationId),
				preference
			);
			toast.success("Agent creation permissions saved.");
		},
	});

	const preference = preferenceQuery.data;
	const readUnavailable =
		preferenceQuery.isError || preferenceQuery.fetchStatus === "paused";
	const isDisabled = !preference || readUnavailable || mutation.isPending;

	return (
		<SettingsSection
			description={`Choose whether teammates and their agents can create Agents for you in ${input.organizationName ?? "this organization"}. These settings apply only to you in this organization.`}
			id="agent-profile-creation-approvals"
			title="Agent creation permissions"
		>
			<div className="divide-y divide-border overflow-hidden rounded-md border border-border/70">
				<ApprovalPolicyRow
					description="Create an Agent with a new conversation, without inheriting an existing conversation’s history."
					disabled={isDisabled}
					label="Start new conversations"
					loading={!readUnavailable && preferenceQuery.isPending}
					onChange={(newSessionPolicy) => {
						if (preference) {
							mutation.mutate({
								existingSessionPolicy: preference.existingSessionPolicy,
								newSessionPolicy,
							});
						}
					}}
					value={preference?.newSessionPolicy}
				/>
				<ApprovalPolicyRow
					description="Create an Agent that continues an existing conversation or uses a copy of its history."
					disabled={isDisabled}
					label="Continue or copy existing conversations"
					loading={!readUnavailable && preferenceQuery.isPending}
					onChange={(existingSessionPolicy) => {
						if (preference) {
							mutation.mutate({
								existingSessionPolicy,
								newSessionPolicy: preference.newSessionPolicy,
							});
						}
					}}
					value={preference?.existingSessionPolicy}
				/>
			</div>
			<p className="text-muted-foreground text-xs">
				These permissions don’t approve every action an Agent takes or share all
				conversations on your computer. They don’t change Agents already
				created.
			</p>
			{readUnavailable ? (
				<div className="flex items-center justify-between gap-3">
					<p className="text-destructive text-xs" role="alert">
						{preferenceQuery.error?.message ??
							"Your approval preferences are unavailable while offline."}
					</p>
					<Button
						onClick={() => preferenceQuery.refetch()}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</div>
			) : null}
		</SettingsSection>
	);
}

function ApprovalPolicyRow(input: {
	description: string;
	disabled: boolean;
	loading: boolean;
	label: string;
	onChange: (policy: AgentProfileCreationApprovalPolicy) => void;
	value?: AgentProfileCreationApprovalPolicy;
}) {
	const selected = POLICY_OPTIONS.find(
		(option) => option.value === input.value
	);
	const missingControl = input.loading ? (
		<SkeletonRegion
			className="w-full shrink-0 sm:w-48"
			label={`Loading ${input.label} approval policy`}
		>
			<Skeleton className="h-9 w-full" />
		</SkeletonRegion>
	) : (
		<span className="text-muted-foreground text-xs">Unavailable</span>
	);
	return (
		<div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<p className="font-medium text-foreground text-sm">{input.label}</p>
				<p className="mt-1 text-muted-foreground text-xs leading-5">
					{input.description}
				</p>
			</div>
			{input.value === undefined ? (
				missingControl
			) : (
				<Select
					disabled={input.disabled}
					onValueChange={(value) =>
						input.onChange(value as AgentProfileCreationApprovalPolicy)
					}
					value={input.value}
				>
					<SelectTrigger
						aria-label={`${input.label} approval policy`}
						className="w-full sm:w-48"
						displayValue={selected?.label ?? "Ask me each time"}
					/>
					<SelectContent>
						{POLICY_OPTIONS.map((option, index) => (
							<SelectItem index={index} key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			)}
		</div>
	);
}
