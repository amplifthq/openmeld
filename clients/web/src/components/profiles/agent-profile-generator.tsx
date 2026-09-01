"use client";

import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowLeftIcon,
	CaretDownIcon,
	DesktopTowerIcon,
	SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, useState } from "react";
import { SpinnerButton } from "#/components/spinner-button";
import {
	formatAgentProfileReasoningLevel,
	resolveAgentProfileTemplateModelName,
} from "#/lib/profiles/agent-profile-template-name";
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";
import {
	AgentProfileAdvancedFields,
	CreateProfileErrorNotice,
	CreateProfileForm,
	type CreateProfileFormProps,
	resolveCreateProfileSubmitBlockReason,
} from "./create-profile-form";
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
	const reduceMotion = useReducedMotion() === true;
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [allowWithoutLocalAgent, setAllowWithoutLocalAgent] = useState(false);
	const [step, setStep] = useState<"configure" | "review">("configure");
	const advancedPanelId = useId();
	const submitBlockReasonId = useId();
	const form = input.form;
	const bindingChoices = resolveGeneratorBindingChoices(form);
	const selectedBindingValue = form.agentBindingValue ?? form.boundAgentId;
	const selectedBinding = bindingChoices.find(
		(choice) => choice.value === selectedBindingValue
	);
	const canContinue =
		Boolean(form.boundAgentId) ||
		allowWithoutLocalAgent ||
		form.lockLocalAgentSelection === true;

	return (
		<form
			className={cn(
				"flex min-h-0 w-full min-w-0 flex-1 flex-col",
				input.surface === "page" && "mx-auto max-w-3xl"
			)}
			data-testid="create-profile-panel"
			onSubmit={form.onSubmit}
		>
			<div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-0.5 pr-1">
				<GeneratorStepContent
					advancedOpen={advancedOpen}
					advancedPanelId={advancedPanelId}
					allowWithoutLocalAgent={allowWithoutLocalAgent}
					bindingChoices={bindingChoices}
					form={form}
					onAdvancedOpenChange={setAdvancedOpen}
					onAllowWithoutLocalAgentChange={setAllowWithoutLocalAgent}
					reduceMotion={reduceMotion}
					selectedBinding={selectedBinding ?? null}
					selectedBindingValue={selectedBindingValue}
					step={step}
				/>
			</div>
			<GeneratorActions
				canContinue={canContinue}
				form={form}
				onCancel={input.onCancel}
				onStepChange={setStep}
				step={step}
				submitBlockReasonId={submitBlockReasonId}
			/>
		</form>
	);
}

function GeneratorStepContent(input: {
	advancedOpen: boolean;
	advancedPanelId: string;
	allowWithoutLocalAgent: boolean;
	bindingChoices: readonly AgentProfileBindingChoice[];
	form: CreateProfileFormProps;
	onAdvancedOpenChange: (open: boolean) => void;
	onAllowWithoutLocalAgentChange: (allowed: boolean) => void;
	reduceMotion: boolean;
	selectedBinding: AgentProfileBindingChoice | null;
	selectedBindingValue: string;
	step: "configure" | "review";
}) {
	return (
		<AnimatePresence initial={false} mode="wait">
			{input.step === "configure" ? (
				<motion.div
					animate={{ opacity: 1, x: 0 }}
					className="grid min-w-0 gap-5 pb-5"
					exit={input.reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
					initial={input.reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
					key="configure"
					transition={{ duration: input.reduceMotion ? 0 : 0.16 }}
				>
					<LocalAgentSelector
						choices={input.bindingChoices}
						disabled={input.form.isSubmitting}
						isResolving={input.form.isResolvingLocalAgents}
						locked={input.form.lockLocalAgentSelection}
						onChange={(value) => {
							input.onAllowWithoutLocalAgentChange(false);
							(
								input.form.onChangeAgentBindingValue ??
								input.form.onChangeBoundAgentId
							)(value);
						}}
						value={input.selectedBindingValue}
					/>
					<AdvancedSetup
						allowWithoutLocalAgent={input.allowWithoutLocalAgent}
						form={input.form}
						onAllowWithoutLocalAgentChange={
							input.onAllowWithoutLocalAgentChange
						}
						onOpenChange={input.onAdvancedOpenChange}
						open={input.advancedOpen}
						panelId={input.advancedPanelId}
						reduceMotion={input.reduceMotion}
					/>
				</motion.div>
			) : (
				<motion.div
					animate={{ opacity: 1, x: 0 }}
					className="grid min-w-0 gap-5 pb-5"
					exit={input.reduceMotion ? { opacity: 0 } : { opacity: 0, x: 12 }}
					initial={input.reduceMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
					key="review"
					transition={{ duration: input.reduceMotion ? 0 : 0.16 }}
				>
					<GeneratorReview
						form={input.form}
						selectedBinding={input.selectedBinding}
					/>
					<CreateProfileErrorNotice
						errorState={input.form.errorState}
						recoveryActionHref={input.form.recoveryActionHref}
					/>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

function GeneratorActions(input: {
	canContinue: boolean;
	form: CreateProfileFormProps;
	onCancel?: () => void;
	onStepChange: (step: "configure" | "review") => void;
	step: "configure" | "review";
	submitBlockReasonId: string;
}) {
	return (
		<div
			className="shrink-0 border-border border-t bg-background pt-4"
			data-testid="create-profile-actions"
		>
			{input.step === "configure" ? (
				<GeneratorConfigureActions {...input} />
			) : (
				<GeneratorReviewActions {...input} />
			)}
		</div>
	);
}

function GeneratorConfigureActions(input: {
	canContinue: boolean;
	form: CreateProfileFormProps;
	onCancel?: () => void;
	onStepChange: (step: "configure" | "review") => void;
}) {
	return (
		<div className="flex flex-col-reverse items-stretch justify-between gap-2 sm:flex-row sm:items-center">
			{input.onCancel ? (
				<Button onClick={input.onCancel} type="button" variant="ghost">
					Cancel
				</Button>
			) : (
				<span />
			)}
			<div className="grid justify-items-stretch gap-1.5 sm:justify-items-end">
				<Button
					disabled={!input.canContinue || input.form.isResolvingLocalAgents}
					onClick={() => input.onStepChange("review")}
					type="button"
				>
					Continue
				</Button>
				{input.canContinue || input.form.isResolvingLocalAgents ? null : (
					<p className="text-muted-foreground text-xs">
						Choose a local agent to continue.
					</p>
				)}
			</div>
		</div>
	);
}

function GeneratorReviewActions(input: {
	form: CreateProfileFormProps;
	onStepChange: (step: "configure" | "review") => void;
	submitBlockReasonId: string;
}) {
	const submitBlockReason = resolveCreateProfileSubmitBlockReason(input.form);
	return (
		<div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-end">
			<Button
				className="gap-2"
				disabled={input.form.isSubmitting}
				onClick={() => input.onStepChange("configure")}
				type="button"
				variant="ghost"
			>
				<ArrowLeftIcon aria-hidden="true" />
				Back
			</Button>
			<div className="grid justify-items-stretch gap-2 sm:justify-items-end">
				{submitBlockReason ? (
					<p
						className="max-w-md text-right text-muted-foreground text-xs"
						id={input.submitBlockReasonId}
					>
						{submitBlockReason}
					</p>
				) : null}
				<SpinnerButton
					aria-describedby={
						submitBlockReason ? input.submitBlockReasonId : undefined
					}
					buttonState={input.form.isSubmitting ? "loading" : "idle"}
					disabled={submitBlockReason !== null}
					loadingLabel={input.form.submittingLabel ?? "Creating Agent…"}
					type="submit"
				>
					{input.form.submitLabel ?? "Create Agent"}
				</SpinnerButton>
			</div>
		</div>
	);
}

function AdvancedSetup(input: {
	allowWithoutLocalAgent: boolean;
	form: CreateProfileFormProps;
	onAllowWithoutLocalAgentChange: (allowed: boolean) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	panelId: string;
	reduceMotion: boolean;
}) {
	const summary = resolveAdvancedSummary(input.form);
	return (
		<div className="grid min-w-0 gap-2">
			<SharedLayoutGroup>
				<SharedLayoutItem
					indicatorClassName="rounded-xl bg-muted/60"
					itemId="advanced-agent-profile-setup"
				>
					<button
						aria-controls={input.panelId}
						aria-expanded={input.open}
						className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl border border-border/70 px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
						onClick={() => input.onOpenChange(!input.open)}
						type="button"
					>
						<SlidersHorizontalIcon
							aria-hidden="true"
							className="size-4 shrink-0 text-muted-foreground"
						/>
						<span className="min-w-0 flex-1">
							<span className="block font-medium text-sm">Advanced</span>
							<span className="block truncate text-muted-foreground text-xs">
								{summary}
							</span>
						</span>
						<CaretDownIcon
							aria-hidden="true"
							className={cn(
								"size-4 shrink-0 text-muted-foreground transition-transform duration-150",
								input.open && "rotate-180",
								input.reduceMotion && "transition-none"
							)}
						/>
					</button>
				</SharedLayoutItem>
			</SharedLayoutGroup>

			<AnimatePresence initial={false}>
				{input.open ? (
					<motion.div
						animate={{ height: "auto", opacity: 1 }}
						className="overflow-hidden"
						exit={{ height: 0, opacity: 0 }}
						id={input.panelId}
						initial={{ height: 0, opacity: 0 }}
						transition={{ duration: input.reduceMotion ? 0 : 0.16 }}
					>
						<div className="grid min-w-0 gap-5 rounded-xl border border-border/70 bg-muted/15 p-4">
							{input.form.agentOwnershipSlot}
							{input.form.agentSessionSlot}
							{input.form.boundAgentId ? (
								<AgentProfileAdvancedFields input={input.form} />
							) : (
								<div className="grid gap-2">
									<p className="font-medium text-sm">Local agent</p>
									<p className="text-muted-foreground text-xs leading-5">
										You can create the Agent now and connect a local agent
										later.
									</p>
									<Button
										className="justify-self-start"
										onClick={() =>
											input.onAllowWithoutLocalAgentChange(
												!input.allowWithoutLocalAgent
											)
										}
										type="button"
										variant={
											input.allowWithoutLocalAgent ? "secondary" : "outline"
										}
									>
										{input.allowWithoutLocalAgent
											? "Creating without a local agent"
											: "Create without a local agent"}
									</Button>
								</div>
							)}
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

function GeneratorReview(input: {
	form: CreateProfileFormProps;
	selectedBinding: AgentProfileBindingChoice | null;
}) {
	const modelName = resolveAgentProfileTemplateModelName({
		agentId: input.form.boundAgentId,
		modelCatalog: input.form.modelCatalog,
		modelId: input.form.boundModelId,
	});
	const reasoningName = formatAgentProfileReasoningLevel(
		input.form.boundReasoningLevel
	);
	return (
		<div className="grid gap-5">
			<div className="grid gap-1">
				<h2 className="font-medium text-lg">Ready to create</h2>
				<p className="text-pretty text-muted-foreground text-sm leading-5">
					Review the setup and change the suggested name if you want.
				</p>
			</div>

			<div className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
				<span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border/70 bg-background">
					{input.form.boundAgentId ? (
						<LocalAgentLogo
							agentId={input.form.boundAgentId}
							className="size-7 overflow-hidden rounded-[22%]"
							size="md"
						/>
					) : (
						<DesktopTowerIcon
							aria-hidden="true"
							className="size-5 text-muted-foreground"
						/>
					)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">
						{input.selectedBinding?.label ?? "Connect a local agent later"}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						{[modelName, reasoningName]
							.filter((part): part is string => Boolean(part))
							.join(" · ") || "Default setup"}
					</p>
				</div>
			</div>

			<div className="grid min-w-0 gap-2">
				<Label htmlFor="create-profile-name-input">Agent name</Label>
				<Input
					autoComplete="off"
					disabled={input.form.isSubmitting}
					id="create-profile-name-input"
					onChange={(event) =>
						input.form.onChangeProfileName(event.target.value)
					}
					placeholder="Agent name"
					value={input.form.profileName}
				/>
				<p className="text-muted-foreground text-xs leading-5">
					OpenMeld suggests this from the owner, local agent, model, and
					reasoning. You can rename it now or later.
				</p>
			</div>
		</div>
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

function resolveAdvancedSummary(form: CreateProfileFormProps): string {
	const modelName = resolveAgentProfileTemplateModelName({
		agentId: form.boundAgentId,
		modelCatalog: form.modelCatalog,
		modelId: form.boundModelId,
	});
	const reasoningName = formatAgentProfileReasoningLevel(
		form.boundReasoningLevel
	);
	const parts = [modelName, reasoningName].filter((part): part is string =>
		Boolean(part)
	);
	return parts.length > 0
		? parts.join(" · ")
		: "Owner, Session, Project, model, and permissions";
}
