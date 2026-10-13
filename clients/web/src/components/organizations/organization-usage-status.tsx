"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	OrganizationAiBilling,
	UpdateOrganizationAiBilling,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Progress } from "@openmeld/ui/components/progress";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
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
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const byok = billing.source === "byok";
	const planLabel = billing.plan === "internal" ? "Internal" : "Free";
	return (
		<Dialog
			onOpenChange={(value) => {
				if (!saving) {
					setOpen(value);
				}
			}}
			open={open}
		>
			<AgentConfigurationGrid className="sm:grid-cols-1">
				<AgentConfigurationReadoutCard
					headerAccessory={
						<Badge variant="secondary">{byok ? "BYOK" : planLabel}</Badge>
					}
					itemId="ai-plan"
					label={byok ? "Your OpenRouter key" : "Included AI credits"}
				>
					<div className="space-y-3 text-sm">
						{byok ? (
							<ByokSummary billing={billing} />
						) : (
							<IncludedCredits billing={billing} />
						)}
						<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
							<p className="text-muted-foreground text-xs">
								{billingSummary(billing)}
							</p>
							{billing.canManage ? (
								<DialogTrigger render={<Button size="sm" variant="ghost" />}>
									{byok ? "Manage key" : "Use your own key"}
								</DialogTrigger>
							) : (
								<span className="text-muted-foreground text-xs">
									Managed by your workspace admin
								</span>
							)}
						</div>
					</div>
				</AgentConfigurationReadoutCard>
			</AgentConfigurationGrid>
			{open ? (
				<ProviderKeyDialog
					billing={billing}
					onClose={() => setOpen(false)}
					onSave={async (settings) => {
						setSaving(true);
						try {
							const updated = await updateOrganizationAiBilling({
								organizationId,
								settings,
							});
							queryClient.setQueryData(
								organizationAiBillingQueryOptions({ organizationId }).queryKey,
								updated
							);
							setOpen(false);
						} finally {
							setSaving(false);
						}
					}}
					saving={saving}
				/>
			) : null}
		</Dialog>
	);
}

function ByokSummary({ billing }: { billing: OrganizationAiBilling }) {
	return (
		<>
			<p className="font-medium tabular-nums">
				OpenRouter · ••••{billing.keySuffix}
			</p>
			{billing.status !== "available" ? (
				<p className="text-destructive text-xs" role="alert">
					This key needs attention. Check its balance or replace it.
				</p>
			) : null}
		</>
	);
}

function IncludedCredits({ billing }: { billing: OrganizationAiBilling }) {
	if (billing.plan === "internal") {
		return <p className="font-medium">No monthly credit limit</p>;
	}
	return (
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
					value={Math.min(billing.monthlyCredits, billing.remainingCredits)}
				/>
			) : null}
		</>
	);
}

function billingSummary(billing: OrganizationAiBilling) {
	if (billing.source === "byok") {
		return billing.status === "available"
			? "Your key is in use. Included credits are not used."
			: "Requests are paused. Included credits are not used.";
	}
	if (billing.status === "unavailable") {
		return "Included AI is unavailable. Try again or use your own key.";
	}
	if (billing.plan === "internal") {
		return "Shared by all agents in this workspace.";
	}
	if (billing.monthlyCredits === 0) {
		return "Free credits apply to your first workspace. Use your own key here.";
	}
	const reset = billing.resetsAt
		? new Intl.DateTimeFormat("en-US", {
				month: "short",
				day: "numeric",
				timeZone: "UTC",
			}).format(new Date(billing.resetsAt))
		: "next month";
	return billing.status === "exhausted"
		? `Credits used up. Resets ${reset} (UTC), or use your own key.`
		: `Resets ${reset} (UTC) · No rollover`;
}

function ProviderKeyDialog({
	billing,
	onSave,
	onClose,
	saving,
}: {
	billing: OrganizationAiBilling;
	onSave: (settings: UpdateOrganizationAiBilling) => Promise<void>;
	onClose: () => void;
	saving: boolean;
}) {
	const keyInputId = useId();
	const errorId = useId();
	const [apiKey, setApiKey] = useState("");
	const [error, setError] = useState<string | null>(null);
	async function save(settings: UpdateOrganizationAiBilling) {
		if (saving) {
			return;
		}
		setError(null);
		try {
			await onSave(settings);
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			setError(
				failure.status === 400
					? "OpenRouter rejected this key. Check your inference API key and try again."
					: "Could not update the key. Try again."
			);
		}
	}
	return (
		<DialogContent showCloseButton={!saving}>
			<DialogHeader>
				<DialogTitle>OpenRouter API key</DialogTitle>
				<DialogDescription>
					Use your key for Center Agent and Remote Agents in this workspace.
				</DialogDescription>
			</DialogHeader>
			<form
				className="space-y-4"
				onSubmit={async (event) => {
					event.preventDefault();
					if (apiKey.trim()) {
						await save({ source: "byok", apiKey: apiKey.trim() });
					}
				}}
			>
				{billing.keySuffix ? (
					<p className="text-muted-foreground tabular-nums">
						Saved key · ••••{billing.keySuffix}
					</p>
				) : null}
				<div className="space-y-2">
					<label htmlFor={keyInputId}>
						{billing.keySuffix ? "Replace API key" : "API key"}
					</label>
					<Input
						aria-describedby={error ? errorId : undefined}
						aria-invalid={Boolean(error)}
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
					{error ? (
						<p className="text-destructive text-xs" id={errorId} role="alert">
							{error}
						</p>
					) : null}
				</div>
				<p className="text-muted-foreground">
					Included credits stay available. If your key stops working, AI
					requests stop.
				</p>
				<DialogFooter>
					{billing.keySuffix ? (
						<Button
							className="sm:mr-auto"
							disabled={saving}
							onClick={async () => {
								await save({ source: "free" });
							}}
							type="button"
							variant="ghost"
						>
							Remove key
						</Button>
					) : null}
					<Button
						disabled={saving}
						onClick={onClose}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button disabled={saving || !apiKey.trim()} type="submit">
						{saving ? "Saving…" : "Save key"}
					</Button>
				</DialogFooter>
			</form>
		</DialogContent>
	);
}
