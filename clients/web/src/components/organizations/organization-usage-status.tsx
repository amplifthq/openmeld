"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	OrganizationAiBilling,
	UpdateOrganizationAiBilling,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Progress } from "@openmeld/ui/components/progress";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import {
	AgentConfigurationGrid,
	AgentConfigurationReadoutCard,
} from "#/components/profiles/agent-configuration-card";
import { updateOrganizationAiBilling } from "#/lib/organizations/organization-usage";
import { organizationAiBillingQueryOptions } from "#/query/organizations/organization-usage";

export function OrganizationUsageStatus(input: { organizationId: string }) {
	const query = useQuery(organizationAiBillingQueryOptions(input));
	if (query.isPending) {
		return (
			<p aria-live="polite" className="text-muted-foreground text-sm">
				Loading AI plan…
			</p>
		);
	}
	if (!query.data) {
		return (
			<div className="space-y-2">
				<p className="text-sm" role="alert">
					Could not load your AI plan.
				</p>
				<Button
					disabled={query.isFetching}
					onClick={async () => {
						await query.refetch();
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</div>
		);
	}
	return (
		<BillingSettings
			billing={query.data}
			key={input.organizationId}
			organizationId={input.organizationId}
		/>
	);
}

function BillingSettings({
	organizationId,
	billing,
}: {
	organizationId: string;
	billing: OrganizationAiBilling;
}) {
	const queryClient = useQueryClient();
	const keyInputId = useId();
	const [apiKey, setApiKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [feedback, setFeedback] = useState<{
		message: string;
		failed: boolean;
	} | null>(null);
	async function save(settings: UpdateOrganizationAiBilling) {
		setSaving(true);
		setFeedback(null);
		try {
			const updated = await updateOrganizationAiBilling({
				organizationId,
				settings,
			});
			setApiKey("");
			queryClient.setQueryData(
				organizationAiBillingQueryOptions({ organizationId }).queryKey,
				updated
			);
			setFeedback({
				failed: false,
				message:
					settings.source === "byok"
						? "OpenRouter key saved. New AI requests will use this key."
						: "Key removed. New AI requests will use your included plan.",
			});
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setFeedback({
				failed: true,
				message:
					failure.status === 400
						? "OpenRouter could not accept this key. Use an inference API key, then try again."
						: "Could not update the provider key. Try again. If this continues, ask your workspace admin to check the connection.",
			});
		} finally {
			setSaving(false);
		}
	}
	return (
		<AgentConfigurationGrid>
			<IncludedCredits billing={billing} />
			<AgentConfigurationReadoutCard
				headerAccessory={
					billing.source === "byok" ? (
						<Badge variant="secondary">
							{billing.status === "available" ? "In use" : "Needs attention"}
						</Badge>
					) : undefined
				}
				itemId="ai-provider-key"
				label="Your OpenRouter key"
			>
				<div className="space-y-3 text-sm">
					<p className="text-muted-foreground text-xs">
						Use your OpenRouter balance for all AI requests in this workspace.
						Your included credits will stay available.
					</p>
					{billing.keySuffix ? (
						<p className="tabular-nums">Saved key: ••••{billing.keySuffix}</p>
					) : null}
					{billing.source === "byok" ? (
						<p className="text-muted-foreground text-xs">
							If this key stops working, requests stop until you replace or
							remove it.
						</p>
					) : null}
					{billing.source === "byok" && billing.status !== "available" ? (
						<p className="text-sm" role="alert">
							OpenRouter could not use this key. Check its balance and status,
							or replace or remove it. Included credits will not be used.
						</p>
					) : null}
					{billing.canManage ? (
						<form
							className="space-y-2"
							onSubmit={async (event) => {
								event.preventDefault();
								await save({ source: "byok", apiKey: apiKey.trim() });
							}}
						>
							<label className="text-xs" htmlFor={keyInputId}>
								{billing.keySuffix ? "Replace API key" : "OpenRouter API key"}
							</label>
							<Input
								autoComplete="off"
								disabled={saving}
								id={keyInputId}
								maxLength={512}
								onChange={(event) => setApiKey(event.target.value)}
								placeholder="sk-or-…"
								spellCheck={false}
								type="password"
								value={apiKey}
							/>
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={saving || !apiKey.trim()}
									size="sm"
									type="submit"
									variant="outline"
								>
									{saving ? "Saving…" : "Save key"}
								</Button>
								{billing.keySuffix ? (
									<Button
										disabled={saving}
										onClick={async () => {
											await save({ source: "free" });
										}}
										size="sm"
										type="button"
										variant="ghost"
									>
										Remove key
									</Button>
								) : null}
							</div>
						</form>
					) : (
						<p className="text-muted-foreground text-xs">
							A workspace owner or admin can manage this key.
						</p>
					)}
					{feedback ? (
						<p
							className={
								feedback.failed
									? "text-destructive text-xs"
									: "text-muted-foreground text-xs"
							}
							role={feedback.failed ? "alert" : "status"}
						>
							{feedback.message}
						</p>
					) : null}
				</div>
			</AgentConfigurationReadoutCard>
		</AgentConfigurationGrid>
	);
}

function IncludedCredits({ billing }: { billing: OrganizationAiBilling }) {
	return (
		<AgentConfigurationReadoutCard
			headerAccessory={
				<Badge variant="secondary">
					{billing.plan === "internal" ? "Internal" : "Free"}
				</Badge>
			}
			itemId="ai-plan"
			label="Included AI credits"
		>
			<div className="space-y-3 text-sm">
				{billing.plan === "internal" ? (
					<p>Internal workspace. No Free plan limit.</p>
				) : (
					<>
						<p className="font-medium tabular-nums">
							{billing.remainingCredits === null
								? "Balance unavailable"
								: `${Math.floor(billing.remainingCredits).toLocaleString("en-US")} / ${billing.monthlyCredits?.toLocaleString("en-US")} credits left`}
						</p>
						{billing.monthlyCredits && billing.remainingCredits !== null ? (
							<Progress
								aria-label="Included AI credits remaining"
								max={billing.monthlyCredits}
								value={Math.min(
									billing.monthlyCredits,
									billing.remainingCredits
								)}
							/>
						) : null}
						<p className="text-muted-foreground text-xs">
							{billing.monthlyCredits === 0
								? "Included credits are available in the first workspace created by your account. Add your own key to use AI here."
								: `Renews ${billing.resetsAt?.slice(0, 10)} at 00:00 UTC. Unused credits do not roll over.`}
						</p>
						<p className="text-muted-foreground text-xs">
							1 credit covers $0.001 of model usage. Token counts vary by model.
						</p>
					</>
				)}
				<p className="text-muted-foreground text-xs">
					Shared by Center Agent and Remote Agents in this workspace.
				</p>
				{billing.source !== "byok" &&
				billing.status === "exhausted" &&
				billing.monthlyCredits !== 0 ? (
					<p aria-live="polite">
						You have used your included credits. Add your own key or wait for
						the monthly reset.
					</p>
				) : null}
				{billing.source !== "byok" && billing.status === "unavailable" ? (
					<p aria-live="polite">
						Included AI is temporarily unavailable. Try again later or add your
						own key.
					</p>
				) : null}
			</div>
		</AgentConfigurationReadoutCard>
	);
}
