"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { CaretDownIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { SpinnerButton } from "#/components/spinner-button";
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";
import {
	AgentProfileConfigurationCards,
	CreateProfileErrorNotice,
	CreateProfileForm,
	type CreateProfileFormProps,
} from "./create-profile-form";
import {
	resolveAgentProfileConfigurationSummaries,
	resolveCreateProfileSubmitBlockReason,
} from "./create-profile-form-logic";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";
import { LocalAgentSelector } from "./local-agent-selector";

export type AgentProfileGeneratorProps = {
	form: CreateProfileFormProps;
	onCancel?: () => void;
	surface: "dialog" | "page";
};

export function AgentProfileGenerator(input: AgentProfileGeneratorProps) {
	if (input.form.profileKind !== "agent") {
		return <CreateProfileForm {...input.form} />;
	}
	return <AgentProfileGeneratorForm {...input} />;
}

function AgentProfileGeneratorForm(input: AgentProfileGeneratorProps) {
	const [configurationExpanded, setConfigurationExpanded] = useState(false);
	const submitBlockReasonId = useId();
	const form = input.form;
	const submitBlockReason = resolveCreateProfileSubmitBlockReason(form);
	return (
		<form
			className="-mx-3 flex min-h-0 min-w-0 flex-1 flex-col"
			data-testid="create-profile-panel"
			onSubmit={form.onSubmit}
		>
			<ScrollArea
				className="min-h-0 min-w-0 flex-1"
				contentClassName="px-3"
				orientation="vertical"
			>
				<div className="grid min-w-0 gap-5 pb-2">
					<LocalAgentSelector
						choices={resolveGeneratorBindingChoices(form)}
						disabled={form.isSubmitting}
						emptyState={form.localAgentEmptyState}
						isResolving={form.isResolvingLocalAgents}
						locked={form.lockLocalAgentSelection}
						onChange={
							form.onChangeAgentBindingValue ?? form.onChangeBoundAgentId
						}
						surface={input.surface}
						value={form.agentBindingValue ?? form.boundAgentId}
					/>
					{form.boundAgentId ? (
						<div className="grid min-w-0 gap-2">
							<Label htmlFor="create-profile-name-input">Agent name</Label>
							<Input
								autoComplete="off"
								disabled={form.isSubmitting}
								id="create-profile-name-input"
								onChange={(event) =>
									form.onChangeProfileName(event.target.value)
								}
								placeholder="Agent name"
								value={form.profileName}
							/>
							<p className="text-muted-foreground text-xs leading-5">
								You can rename this Agent now or later.
							</p>
						</div>
					) : null}
					<AdvancedSetup
						expanded={configurationExpanded}
						form={form}
						onExpandedChange={setConfigurationExpanded}
					/>
					<CreateProfileErrorNotice
						errorState={form.errorState}
						recoveryActionHref={form.recoveryActionHref}
					/>
				</div>
			</ScrollArea>
			<div
				className="mx-3 flex shrink-0 flex-col-reverse items-stretch justify-between gap-3 bg-background pt-2 sm:flex-row sm:items-end"
				data-testid="create-profile-actions"
			>
				{input.onCancel ? (
					<Button
						disabled={form.isSubmitting}
						onClick={input.onCancel}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
				) : (
					<span />
				)}
				<div className="grid justify-items-stretch gap-2 sm:justify-items-end">
					{submitBlockReason ? (
						<p
							className="max-w-md text-right text-muted-foreground text-xs"
							id={submitBlockReasonId}
						>
							{submitBlockReason}
						</p>
					) : null}
					{form.projectSelectionBlockReason &&
						submitBlockReason === form.projectSelectionBlockReason &&
						form.onUseManagedWorkspace && (
							<Button
								disabled={form.isSubmitting}
								onClick={form.onUseManagedWorkspace}
								type="button"
								variant="outline"
							>
								Let OpenMeld choose
							</Button>
						)}
					<SpinnerButton
						aria-describedby={
							submitBlockReason ? submitBlockReasonId : undefined
						}
						buttonState={form.isSubmitting ? "loading" : "idle"}
						disabled={submitBlockReason !== null || form.isResolvingLocalAgents}
						loadingLabel={form.submittingLabel ?? "Creating Agent…"}
						type="submit"
					>
						{form.submitLabel ?? "Create Agent"}
					</SpinnerButton>
				</div>
			</div>
		</form>
	);
}

function AdvancedSetup(input: {
	expanded: boolean;
	form: CreateProfileFormProps;
	onExpandedChange: (expanded: boolean) => void;
}) {
	if (!input.form.boundAgentId) {
		return null;
	}

	const summaries = resolveAgentProfileConfigurationSummaries(input.form);
	const disclosureSummary = [
		summaries.session,
		summaries.workingFolder,
		summaries.model,
		summaries.permission,
	].join(" · ");

	return (
		<Collapsible.Root
			className="group/agent-configuration min-w-0 pt-1"
			onOpenChange={(expanded) => input.onExpandedChange(expanded)}
			open={input.expanded}
		>
			<Collapsible.Trigger className="group/agent-configuration-trigger flex min-h-9 w-full min-w-0 items-center gap-3 border-border border-b pb-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
				<SlidersHorizontalIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<span className="shrink-0 font-medium text-sm">
					Advanced Agent Settings
				</span>
				<span
					className="min-w-0 flex-1 truncate text-right text-muted-foreground text-xs"
					title={disclosureSummary}
				>
					{disclosureSummary}
				</span>
				<CaretDownIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)] group-data-[panel-open]/agent-configuration-trigger:rotate-180 motion-reduce:transition-none"
				/>
			</Collapsible.Trigger>
			<Collapsible.Panel className="overflow-hidden transition-[height,opacity] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-[opacity] data-[open]:[height:var(--collapsible-panel-height)]">
				<div className="pt-3">
					<AgentProfileConfigurationCards input={input.form} />
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function resolveGeneratorBindingChoices(
	form: CreateProfileFormProps
): AgentProfileBindingChoice[] {
	if (form.agentBindingChoices) {
		return [...form.agentBindingChoices];
	}
	const agentIds = [...form.availableLocalAgentIds];
	if (
		form.lockLocalAgentSelection &&
		form.boundAgentId &&
		!agentIds.includes(form.boundAgentId)
	) {
		agentIds.unshift(form.boundAgentId);
	}
	return agentIds.map((agentId) => {
		const label = formatLocalAgentDisplayName(agentId);
		return {
			agentId,
			description: `${label} on this computer.`,
			label,
			value: agentId,
		};
	});
}
