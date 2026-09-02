"use client";

import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowLeftIcon, DesktopTowerIcon } from "@phosphor-icons/react";
import {
	AnimatePresence,
	domAnimation,
	LazyMotion,
	m,
	useReducedMotion,
	type Variants,
} from "framer-motion";
import { useId, useState } from "react";
import { SpinnerButton } from "#/components/spinner-button";
import {
	formatAgentProfileReasoningLevel,
	resolveAgentProfileTemplateModelName,
} from "#/lib/profiles/agent-profile-template-name";
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";
import { AgentConfigurationCard } from "./agent-configuration-card";
import {
	AgentProfileConfigurationCards,
	CreateProfileErrorNotice,
	CreateProfileForm,
	type CreateProfileFormProps,
	resolveCreateProfileSubmitBlockReason,
} from "./create-profile-form";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";
import { LocalAgentSelector } from "./local-agent-selector";

const GENERATOR_STEP_TRAVEL_PX = 64;

type GeneratorStep = "configure" | "review";
type GeneratorStepDirection = -1 | 1;
type GeneratorStepMotionContext = {
	direction: GeneratorStepDirection;
	reduceMotion: boolean;
};

const GENERATOR_STEP_VARIANTS: Variants = {
	active: { opacity: 1, transform: "translateX(0px)" },
	exit: (context: GeneratorStepMotionContext) => ({
		opacity: 0,
		transform: context.reduceMotion
			? "translateX(0px)"
			: `translateX(${-context.direction * GENERATOR_STEP_TRAVEL_PX}px)`,
	}),
	initial: (context: GeneratorStepMotionContext) => ({
		opacity: 0,
		transform: context.reduceMotion
			? "translateX(0px)"
			: `translateX(${context.direction * GENERATOR_STEP_TRAVEL_PX}px)`,
	}),
};

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
	const [allowWithoutLocalAgent, setAllowWithoutLocalAgent] = useState(false);
	const [step, setStep] = useState<GeneratorStep>("configure");
	const [stepDirection, setStepDirection] = useState<GeneratorStepDirection>(1);
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
	const stepMotionContext: GeneratorStepMotionContext = {
		direction: stepDirection,
		reduceMotion,
	};
	const handleStepChange = (nextStep: GeneratorStep) => {
		setStepDirection(nextStep === "review" ? 1 : -1);
		setStep(nextStep);
	};

	return (
		<LazyMotion features={domAnimation}>
			<form
				className={cn(
					"flex min-h-0 w-full min-w-0 flex-1 flex-col",
					input.surface === "page" && "mx-auto max-w-3xl"
				)}
				data-testid="create-profile-panel"
				onSubmit={form.onSubmit}
			>
				<div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
					<AnimatePresence
						custom={stepMotionContext}
						initial={false}
						mode="popLayout"
					>
						<m.div
							animate="active"
							className="flex min-h-0 w-full min-w-0 flex-1 flex-col"
							custom={stepMotionContext}
							exit="exit"
							initial="initial"
							key={step}
							transition={
								reduceMotion
									? { duration: 0.14, ease: "easeOut" }
									: { duration: 0.28, ease: [0.32, 0.72, 0, 1] }
							}
							variants={GENERATOR_STEP_VARIANTS}
						>
							<div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-0.5 pr-1">
								<GeneratorStepContent
									allowWithoutLocalAgent={allowWithoutLocalAgent}
									bindingChoices={bindingChoices}
									form={form}
									onAllowWithoutLocalAgentChange={setAllowWithoutLocalAgent}
									selectedBinding={selectedBinding ?? null}
									selectedBindingValue={selectedBindingValue}
									step={step}
									surface={input.surface}
								/>
							</div>
							<GeneratorActions
								canContinue={canContinue}
								form={form}
								onCancel={input.onCancel}
								onStepChange={handleStepChange}
								step={step}
								submitBlockReasonId={submitBlockReasonId}
							/>
						</m.div>
					</AnimatePresence>
				</div>
			</form>
		</LazyMotion>
	);
}

function GeneratorStepContent(input: {
	allowWithoutLocalAgent: boolean;
	bindingChoices: readonly AgentProfileBindingChoice[];
	form: CreateProfileFormProps;
	onAllowWithoutLocalAgentChange: (allowed: boolean) => void;
	selectedBinding: AgentProfileBindingChoice | null;
	selectedBindingValue: string;
	surface: "dialog" | "page";
	step: GeneratorStep;
}) {
	return input.step === "configure" ? (
		<div className="grid min-w-0 gap-5 pb-5">
			<LocalAgentSelector
				choices={input.bindingChoices}
				disabled={input.form.isSubmitting}
				emptyState={input.form.localAgentEmptyState}
				isResolving={input.form.isResolvingLocalAgents}
				locked={input.form.lockLocalAgentSelection}
				onChange={(value) => {
					input.onAllowWithoutLocalAgentChange(false);
					(
						input.form.onChangeAgentBindingValue ??
						input.form.onChangeBoundAgentId
					)(value);
				}}
				surface={input.surface}
				value={input.selectedBindingValue}
			/>
			<AdvancedSetup
				allowWithoutLocalAgent={input.allowWithoutLocalAgent}
				form={input.form}
				onAllowWithoutLocalAgentChange={input.onAllowWithoutLocalAgentChange}
			/>
		</div>
	) : (
		<div className="grid min-w-0 gap-5 pb-5">
			<GeneratorReview
				form={input.form}
				selectedBinding={input.selectedBinding}
			/>
			<CreateProfileErrorNotice
				errorState={input.form.errorState}
				recoveryActionHref={input.form.recoveryActionHref}
			/>
		</div>
	);
}

function GeneratorActions(input: {
	canContinue: boolean;
	form: CreateProfileFormProps;
	onCancel?: () => void;
	onStepChange: (step: GeneratorStep) => void;
	step: GeneratorStep;
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
	onStepChange: (step: GeneratorStep) => void;
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
	onStepChange: (step: GeneratorStep) => void;
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
}) {
	return (
		<section className="grid min-w-0 gap-3 pt-1">
			<div className="grid gap-1">
				<h2 className="font-medium text-sm">Fine-tune the setup</h2>
				<p className="text-muted-foreground text-xs leading-5">
					The defaults are ready. Open a card only when you want to change it.
				</p>
			</div>
			{input.form.boundAgentId ? (
				<AgentProfileConfigurationCards input={input.form} />
			) : (
				<AgentConfigurationCard
					description="Connect a controller later from this Agent's details."
					icon={<DesktopTowerIcon aria-hidden="true" />}
					label="Runs on"
					summary={
						input.allowWithoutLocalAgent
							? "Connect later"
							: "Choose a local agent first"
					}
				>
					<div className="grid gap-3">
						<p className="text-muted-foreground text-xs leading-5">
							Create this Agent now and connect a local agent when you are
							ready.
						</p>
						<Button
							className="justify-self-start"
							onClick={() =>
								input.onAllowWithoutLocalAgentChange(
									!input.allowWithoutLocalAgent
								)
							}
							type="button"
							variant={input.allowWithoutLocalAgent ? "secondary" : "outline"}
						>
							{input.allowWithoutLocalAgent
								? "Connect later selected"
								: "Create and connect later"}
						</Button>
					</div>
				</AgentConfigurationCard>
			)}
		</section>
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
