"use client";

import { ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Label } from "@openmeld/ui/components/label";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { Textarea } from "@openmeld/ui/components/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { InfoIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { setCurrentOrganizationInformationProtection } from "#/lib/organizations/organization-information-protection";
import {
	organizationInformationProtectionQueryKeys,
	organizationInformationProtectionQueryOptions,
} from "#/query/organizations/organization-information-protection";

export function OrganizationInformationProtectionSection(input: {
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const policyQuery = useQuery(
		organizationInformationProtectionQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const [draft, setDraft] = useState("");
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const normalizedDraft = draft.trim();
	const currentPolicy = policyQuery.data?.protectedInformation ?? "";
	const hasChanges = normalizedDraft !== currentPolicy;
	const policyMutation = useMutation({
		mutationFn: async () =>
			await setCurrentOrganizationInformationProtection({
				organizationId: input.organizationId,
				protectedInformation: normalizedDraft || null,
			}),
		onSuccess: (policy) => {
			queryClient.setQueryData(
				organizationInformationProtectionQueryKeys.policy(input.organizationId),
				policy
			);
			setDraft(policy.protectedInformation ?? "");
			setSavedMessage(
				policy.protectedInformation
					? "Information protection updated."
					: "Additional information protection cleared."
			);
		},
	});

	useEffect(() => {
		if (!policyQuery.data) {
			return;
		}
		setDraft(policyQuery.data.protectedInformation ?? "");
		setSavedMessage(null);
	}, [policyQuery.data]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!(policyQuery.isSuccess && hasChanges && !policyMutation.isPending)) {
			return;
		}
		setSavedMessage(null);
		policyMutation.mutate();
	};

	return (
		<SettingsSection
			action={
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="How Information protection works"
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<InfoIcon aria-hidden="true" />
							</Button>
						}
					/>
					<TooltipContent className="max-w-72" side="top">
						OpenMeld&apos;s built-in protections always apply. This guidance
						does not block ordinary reads or actions, and it does not add
						confirmation steps.
					</TooltipContent>
				</Tooltip>
			}
			description="Add organization-specific categories that OpenMeld should not disclose outside an appropriate private context."
			id="organization-information-protection"
			title="Information protection"
		>
			<form className="space-y-4" onSubmit={handleSubmit}>
				<div className="grid gap-2">
					<Label htmlFor="organization-protected-information">
						Additional protected information
					</Label>
					<Textarea
						disabled={policyQuery.isPending || policyMutation.isPending}
						id="organization-protected-information"
						maxLength={ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="Examples: customer contract pricing, unreleased Board forecasts, or acquisition plans."
						rows={5}
						value={draft}
					/>
					<div className="flex flex-wrap justify-between gap-2 text-muted-foreground text-xs leading-5">
						<p>
							Describe categories or document types. Do not paste passwords,
							access tokens, or the sensitive records themselves.
						</p>
						<p>
							{draft.length.toLocaleString()} /{" "}
							{ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS.toLocaleString()}
						</p>
					</div>
				</div>
				{policyQuery.isError ? (
					<div className="flex flex-wrap items-center gap-3">
						<p className="text-destructive text-xs" role="alert">
							{policyQuery.error.message}
						</p>
						<Button
							disabled={policyQuery.isRefetching}
							onClick={() => {
								policyQuery.refetch().catch((error) => {
									console.error(
										"Failed to refresh Organization information protection.",
										error
									);
								});
							}}
							size="sm"
							type="button"
							variant="outline"
						>
							Retry
						</Button>
					</div>
				) : null}
				<div className="flex flex-wrap items-center gap-3">
					<Button
						disabled={
							!(policyQuery.isSuccess && hasChanges) || policyMutation.isPending
						}
						type="submit"
						variant="outline"
					>
						{policyMutation.isPending ? "Saving" : "Save changes"}
					</Button>
					{policyMutation.isError ? (
						<p className="text-destructive text-xs" role="alert">
							{policyMutation.error.message}
						</p>
					) : null}
					{savedMessage ? (
						<p className="text-muted-foreground text-xs">{savedMessage}</p>
					) : null}
				</div>
			</form>
		</SettingsSection>
	);
}
