"use client";

import {
	CENTER_AGENT_ROUTINE_CRON_EXPRESSION_MAX_CHARS,
	CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS,
	CENTER_AGENT_ROUTINE_NAME_MAX_CHARS,
	CENTER_AGENT_ROUTINE_TIMEZONE_MAX_CHARS,
} from "@openmeld/schemas/schemas";
import type { CenterAgentRoutineManagement } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Textarea } from "@openmeld/ui/components/textarea";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
	CenterAgentRoutineTargetSpaceField,
	type CenterAgentRoutineTargetSpacePreparation,
	useCenterAgentRoutineTargetSpaceFieldState,
} from "./center-agent-routine-target-space-field";
import {
	CENTER_AGENT_SELF_EVOLUTION_MARKER,
	isCenterAgentSelfEvolutionCapabilityReady,
	isCenterAgentSelfEvolutionRoutine,
	readCenterAgentSelfEvolutionSlackReportChannelName,
	updateCenterAgentSelfEvolutionSlackReport,
} from "./center-agent-self-evolution";
import {
	type RoutineScheduleValidator,
	useCenterAgentRoutineScheduleValidation,
} from "./use-center-agent-routine-schedule-validation";

const SLACK_CHANNEL_NAME_PATTERN = /^#?[^\s#\p{Cc}]{1,80}$/u;

export type CenterAgentRoutineFormValues = {
	authorizedActions?: (
		| "organization_documents.save_approved_knowledge"
		| "slack.publish_channel_report"
	)[];
	cronExpression: string | null;
	destinationKind: "space";
	externalActionPolicy?: "read_only";
	instructions: string;
	name: string;
	postSlackSummary: boolean;
	runAtMs: number | null;
	scheduleKind: "cron" | "once";
	slackChannelId: null;
	slackConversationId: null;
	slackReportChannelName: string;
	slackTeamId: null;
	slackThreadLabel: null;
	slackThreadTs: null;
	targetSpaceId: string;
	timezone: string | null;
};

export function CenterAgentRoutineFormDialog(input: {
	errorMessage: string | null;
	mode: "create" | "edit";
	onOpenChange: (open: boolean) => void;
	onSubmit: (values: CenterAgentRoutineFormValues) => void;
	open: boolean;
	organizationId: string;
	orgSlug: string;
	routine?: CenterAgentRoutineManagement;
	submitting: boolean;
	targetSpacePreparation: CenterAgentRoutineTargetSpacePreparation;
	validateSchedule?: RoutineScheduleValidator;
}) {
	const [values, setValues] = useState<CenterAgentRoutineFormValues>(() =>
		resolveInitialValues(input.routine)
	);
	const [repairRequested, setRepairRequested] = useState(false);
	const scheduleInputRef = useRef<HTMLInputElement>(null);
	const submissionLatchRef = useRef(false);
	const timezoneInputRef = useRef<HTMLInputElement>(null);
	const currentTimeMs = useCurrentTimeMs(input.open);
	const selfEvolutionFormState = resolveSelfEvolutionFormState(
		input.routine,
		values.postSlackSummary
	);
	const isSelfEvolution = selfEvolutionFormState.isSelfEvolution;
	const capabilityChangeRequested =
		repairRequested || selfEvolutionFormState.slackReportChoiceChanged;

	useEffect(() => {
		if (!input.submitting) {
			submissionLatchRef.current = false;
		}
	}, [input.submitting]);

	const scheduleValidation = useCenterAgentRoutineScheduleValidation({
		scheduleInputRef,
		timezoneInputRef,
		validateSchedule: input.validateSchedule,
		values: {
			cronExpression: values.cronExpression ?? "",
			timezone: values.timezone ?? "",
		},
	});
	const targetSpaceFieldState = useCenterAgentRoutineTargetSpaceFieldState({
		currentTargetSpaceId: input.routine?.targetSpaceId ?? undefined,
		mode: input.mode,
		organizationId: input.organizationId,
		preparation: input.targetSpacePreparation,
		targetSpaceId: values.targetSpaceId,
	});
	const { canSubmit, hasChanges, requiredFieldsComplete, scheduleValid } =
		resolveRoutineFormState({
			currentTimeMs,
			mode: input.mode,
			routine: input.routine,
			recurringScheduleValid: scheduleValidation.valid,
			submitting: input.submitting,
			targetSpaceEligible: targetSpaceFieldState.isEligibleTarget,
			targetSpacesReady: input.targetSpacePreparation.isReady,
			values,
			isSelfEvolution,
			capabilityChangeRequested,
		});
	const title = resolveRoutineFormTitle(input.mode, input.routine);
	const submitLabel = resolveSubmitLabel({
		mode: input.mode,
		submitting: input.submitting,
	});
	const targetSpacePresentation =
		resolveRoutineTargetSpacePresentation(isSelfEvolution);

	const updateField = <Key extends keyof CenterAgentRoutineFormValues>(
		key: Key,
		value: CenterAgentRoutineFormValues[Key]
	) => {
		setValues((current) => ({ ...current, [key]: value }));
	};

	const submit = (event: FormEvent<HTMLFormElement>) => {
		submitRoutineForm({
			admitRecurringSchedule: scheduleValidation.admitSchedule,
			currentTimeMs,
			event,
			hasChanges,
			onSubmit: input.onSubmit,
			requiredFieldsComplete,
			submissionLatch: submissionLatchRef,
			submitting: input.submitting,
			targetSpaceEligible: targetSpaceFieldState.isEligibleTarget,
			values,
			isSelfEvolution,
			capabilityChangeRequested,
		});
	};

	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>
						Choose when the Center Agent should work and where its result should
						appear.
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" noValidate onSubmit={submit}>
					<div className="grid gap-1.5">
						<Label htmlFor="routine-name">Name</Label>
						<Input
							autoFocus
							id="routine-name"
							maxLength={CENTER_AGENT_ROUTINE_NAME_MAX_CHARS}
							onChange={(event) => updateField("name", event.target.value)}
							required
							value={values.name}
						/>
					</div>
					<RoutineInstructionsField
						instructions={values.instructions}
						isSelfEvolution={isSelfEvolution}
						onChange={(instructions) =>
							updateField("instructions", instructions)
						}
					/>
					<fieldset className="grid gap-1.5">
						<legend className="font-medium text-sm">Frequency</legend>
						<div className="flex gap-2">
							<Button
								onClick={() => updateField("scheduleKind", "once")}
								size="sm"
								type="button"
								variant={values.scheduleKind === "once" ? "default" : "outline"}
							>
								Once
							</Button>
							<Button
								onClick={() => updateField("scheduleKind", "cron")}
								size="sm"
								type="button"
								variant={values.scheduleKind === "cron" ? "default" : "outline"}
							>
								Recurring
							</Button>
						</div>
					</fieldset>
					{values.scheduleKind === "once" ? (
						<OneTimeScheduleField
							currentTimeMs={currentTimeMs}
							onRunAtChange={(value) => updateField("runAtMs", value)}
							runAtMs={values.runAtMs}
						/>
					) : (
						<>
							<div className="grid gap-1.5">
								<Label htmlFor="routine-schedule">Schedule</Label>
								<Input
									aria-describedby="routine-schedule-help routine-schedule-preview"
									aria-errormessage={
										scheduleValidation.scheduleError
											? "routine-schedule-error"
											: undefined
									}
									aria-invalid={scheduleValidation.scheduleError !== null}
									id="routine-schedule"
									maxLength={CENTER_AGENT_ROUTINE_CRON_EXPRESSION_MAX_CHARS}
									onBlur={() => scheduleValidation.admitSchedule(false)}
									onChange={(event) =>
										updateField("cronExpression", event.target.value)
									}
									placeholder="0 9 * * *"
									ref={scheduleInputRef}
									required
									value={values.cronExpression ?? ""}
								/>
								<p
									className="text-muted-foreground text-xs"
									id="routine-schedule-help"
								>
									Use exactly five cron fields. Example: 0 9 * * * runs every
									day at 9:00 AM.
								</p>
								<output
									className="text-muted-foreground text-xs"
									id="routine-schedule-preview"
								>
									{scheduleValidation.presentation.message}
								</output>
								{scheduleValidation.scheduleError ? (
									<p
										className="text-destructive text-xs"
										id="routine-schedule-error"
										role="alert"
										tabIndex={-1}
									>
										{scheduleValidation.scheduleError.message}
									</p>
								) : null}
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="routine-timezone">Timezone</Label>
								<Input
									aria-describedby="routine-timezone-help"
									aria-errormessage={
										scheduleValidation.timezoneError
											? "routine-timezone-error"
											: undefined
									}
									aria-invalid={scheduleValidation.timezoneError !== null}
									id="routine-timezone"
									maxLength={CENTER_AGENT_ROUTINE_TIMEZONE_MAX_CHARS}
									onBlur={() => scheduleValidation.admitSchedule(false)}
									onChange={(event) =>
										updateField("timezone", event.target.value)
									}
									ref={timezoneInputRef}
									required
									value={values.timezone ?? ""}
								/>
								<p
									className="text-muted-foreground text-xs"
									id="routine-timezone-help"
								>
									Use an explicit IANA timezone, such as America/Los_Angeles.
								</p>
								{scheduleValidation.timezoneError ? (
									<p
										className="text-destructive text-xs"
										id="routine-timezone-error"
										role="alert"
										tabIndex={-1}
									>
										{scheduleValidation.timezoneError.message}
									</p>
								) : null}
							</div>
						</>
					)}
					<CenterAgentRoutineTargetSpaceField
						ariaLabel={targetSpacePresentation.ariaLabel}
						currentTargetSpaceId={input.routine?.targetSpaceId ?? undefined}
						fieldState={targetSpaceFieldState}
						helpText={targetSpacePresentation.helpText}
						label={targetSpacePresentation.label}
						onRetry={input.targetSpacePreparation.onRetry}
						onTargetSpaceChange={(spaceId) =>
							updateField("targetSpaceId", spaceId)
						}
						orgSlug={input.orgSlug}
						targetSpaceId={values.targetSpaceId}
					/>
					<SelfEvolutionReportFields
						capabilityChangesAllowed={
							selfEvolutionFormState.capabilityChangesAllowed
						}
						enabled={isSelfEvolution}
						needsCapabilityRepair={selfEvolutionFormState.needsCapabilityRepair}
						onChannelNameChange={(slackReportChannelName) =>
							updateField("slackReportChannelName", slackReportChannelName)
						}
						onEnabledChange={(postSlackSummary) =>
							updateField("postSlackSummary", postSlackSummary)
						}
						onRepairRequestedChange={setRepairRequested}
						postSlackSummary={values.postSlackSummary}
						repairRequested={repairRequested}
						slackReportChannelName={values.slackReportChannelName}
					/>
					<RoutineFormError message={input.errorMessage} />
					<RoutineFormFooter
						canSubmit={canSubmit}
						hasChanges={hasChanges}
						onCancel={() => input.onOpenChange(false)}
						requiredFieldsComplete={requiredFieldsComplete}
						scheduleValid={scheduleValid}
						submitLabel={submitLabel}
						submitting={input.submitting}
						targetSpaceEligible={targetSpaceFieldState.isEligibleTarget}
						targetSpacesReady={input.targetSpacePreparation.isReady}
					/>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function resolveSelfEvolutionFormState(
	routine: CenterAgentRoutineManagement | undefined,
	postSlackSummary: boolean
): {
	capabilityChangesAllowed: boolean;
	isSelfEvolution: boolean;
	needsCapabilityRepair: boolean;
	slackReportChoiceChanged: boolean;
} {
	if (!(routine && isCenterAgentSelfEvolutionRoutine(routine))) {
		return {
			capabilityChangesAllowed: false,
			isSelfEvolution: false,
			needsCapabilityRepair: false,
			slackReportChoiceChanged: false,
		};
	}
	const needsCapabilityRepair =
		!isCenterAgentSelfEvolutionCapabilityReady(routine);
	const initialPostSlackSummary =
		readCenterAgentSelfEvolutionSlackReportChannelName(routine.instructions) !==
		null;
	return {
		capabilityChangesAllowed:
			!needsCapabilityRepair || routine.capabilityState.canRepair,
		isSelfEvolution: true,
		needsCapabilityRepair,
		slackReportChoiceChanged: postSlackSummary !== initialPostSlackSummary,
	};
}

function RoutineInstructionsField(input: {
	instructions: string;
	isSelfEvolution: boolean;
	onChange: (instructions: string) => void;
}) {
	const markerMissing =
		input.isSelfEvolution &&
		!input.instructions.startsWith(CENTER_AGENT_SELF_EVOLUTION_MARKER);
	return (
		<div className="grid gap-1.5">
			<Label htmlFor="routine-instructions">
				{input.isSelfEvolution ? "Learning instructions" : "Instructions"}
			</Label>
			<Textarea
				className="min-h-32 resize-y"
				id="routine-instructions"
				maxLength={CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS}
				onChange={(event) => input.onChange(event.target.value)}
				required
				value={input.instructions}
			/>
			{markerMissing ? (
				<p className="text-destructive text-xs" role="alert">
					Keep the OpenMeld built-in first line so Self-Evolution stays
					recognizable and protected.
				</p>
			) : null}
		</div>
	);
}

function SelfEvolutionReportFields(input: {
	capabilityChangesAllowed: boolean;
	enabled: boolean;
	needsCapabilityRepair: boolean;
	onChannelNameChange: (channelName: string) => void;
	onEnabledChange: (enabled: boolean) => void;
	onRepairRequestedChange: (requested: boolean) => void;
	postSlackSummary: boolean;
	repairRequested: boolean;
	slackReportChannelName: string;
}) {
	if (!input.enabled) {
		return null;
	}
	return (
		<fieldset className="grid gap-3 border border-border/70 bg-muted/20 p-3">
			<legend className="px-1 font-medium text-foreground text-sm">
				Team report
			</legend>
			<label className="flex cursor-pointer items-start gap-3 text-sm">
				<input
					aria-label="Post a concise summary to Slack"
					checked={input.postSlackSummary}
					className="mt-0.5 size-4 accent-primary"
					disabled={!input.capabilityChangesAllowed}
					onChange={(event) => input.onEnabledChange(event.target.checked)}
					type="checkbox"
				/>
				<span className="min-w-0">
					<span>Post a concise summary to Slack</span>
					<span className="mt-1 block text-muted-foreground text-xs leading-5">
						Share what changed and the best opportunities without exposing the
						full learning archive.
					</span>
				</span>
			</label>
			{input.postSlackSummary ? (
				<div className="grid gap-1.5">
					<Label htmlFor="routine-slack-report-channel">Slack channel</Label>
					<Input
						aria-label="Slack channel"
						id="routine-slack-report-channel"
						onChange={(event) => input.onChannelNameChange(event.target.value)}
						placeholder="#team-updates"
						value={input.slackReportChannelName}
					/>
					<p className="text-muted-foreground text-xs leading-5">
						Team members can reply in the Slack thread and continue the
						conversation with the Center Agent.
					</p>
				</div>
			) : null}
			{input.needsCapabilityRepair && input.capabilityChangesAllowed ? (
				<label className="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
					<input
						aria-label="Repair Self-Evolution permissions when saving"
						checked={input.repairRequested}
						className="mt-0.5 size-4 accent-primary"
						onChange={(event) =>
							input.onRepairRequestedChange(event.target.checked)
						}
						type="checkbox"
					/>
					<span>
						<span>Repair Self-Evolution permissions when saving</span>
						<span className="mt-1 block text-muted-foreground text-xs leading-5">
							Restore approved-knowledge access, read-only external actions, and
							the Slack report permission shown above.
						</span>
					</span>
				</label>
			) : null}
			{input.needsCapabilityRepair && !input.capabilityChangesAllowed ? (
				<p
					className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm"
					role="alert"
				>
					An Organization owner or admin must repair Self-Evolution permissions
					before Slack reporting can be enabled or disabled.
				</p>
			) : null}
		</fieldset>
	);
}

function resolveRoutineTargetSpacePresentation(isSelfEvolution: boolean): {
	ariaLabel: string | undefined;
	helpText: string | undefined;
	label: string | undefined;
} {
	return isSelfEvolution
		? {
				ariaLabel: "Learning archive",
				helpText:
					"The complete learning record stays in this Space. A Slack team report, when enabled, contains only a concise summary.",
				label: "Learning archive",
			}
		: {
				ariaLabel: undefined,
				helpText: undefined,
				label: undefined,
			};
}

function RoutineFormError(input: { message: string | null }) {
	return input.message ? (
		<p className="break-words text-destructive text-sm" role="alert">
			{input.message}
		</p>
	) : null;
}

function RoutineFormFooter(input: {
	canSubmit: boolean;
	hasChanges: boolean;
	onCancel: () => void;
	requiredFieldsComplete: boolean;
	scheduleValid: boolean;
	submitLabel: string;
	submitting: boolean;
	targetSpaceEligible: boolean;
	targetSpacesReady: boolean;
}) {
	return (
		<DialogFooter>
			{input.canSubmit ? null : (
				<output
					className="mr-auto text-muted-foreground text-xs"
					id="routine-submit-help"
					tabIndex={-1}
				>
					{resolveSubmitHelp(input)}
				</output>
			)}
			<Button
				disabled={input.submitting}
				onClick={input.onCancel}
				type="button"
				variant="outline"
			>
				Cancel
			</Button>
			<Button
				aria-describedby={input.canSubmit ? undefined : "routine-submit-help"}
				aria-disabled={!input.canSubmit}
				disabled={input.submitting || !input.hasChanges}
				type="submit"
			>
				{input.submitLabel}
			</Button>
		</DialogFooter>
	);
}

function submitRoutineForm(input: {
	admitRecurringSchedule: (
		focusInvalidField: boolean
	) => ReturnType<RoutineScheduleValidator> | null;
	currentTimeMs: number | null;
	event: FormEvent<HTMLFormElement>;
	hasChanges: boolean;
	isSelfEvolution: boolean;
	capabilityChangeRequested: boolean;
	onSubmit: (values: CenterAgentRoutineFormValues) => void;
	requiredFieldsComplete: boolean;
	submissionLatch: { current: boolean };
	submitting: boolean;
	targetSpaceEligible: boolean;
	values: CenterAgentRoutineFormValues;
}): void {
	input.event.preventDefault();
	if (input.submitting || !input.hasChanges || input.submissionLatch.current) {
		return;
	}
	if (!input.requiredFieldsComplete) {
		focusFirstIncompleteField(input.values, input.currentTimeMs);
		return;
	}
	if (
		input.values.scheduleKind === "once" &&
		(input.values.runAtMs === null || input.values.runAtMs <= Date.now())
	) {
		document.getElementById("routine-run-at")?.focus();
		return;
	}
	if (!input.targetSpaceEligible) {
		focusTargetSpaceValidation();
		return;
	}
	const schedule =
		input.values.scheduleKind === "cron"
			? input.admitRecurringSchedule(true)
			: null;
	if (input.values.scheduleKind === "cron" && !schedule) {
		return;
	}
	input.submissionLatch.current = true;
	const slackReportChannelName = input.values.postSlackSummary
		? input.values.slackReportChannelName
		: null;
	const instructions = input.isSelfEvolution
		? updateCenterAgentSelfEvolutionSlackReport({
				instructions: input.values.instructions.trim(),
				slackReportChannelName,
			})
		: input.values.instructions.trim();
	input.onSubmit({
		...(input.isSelfEvolution && input.capabilityChangeRequested
			? {
					authorizedActions: input.values.postSlackSummary
						? [
								"organization_documents.save_approved_knowledge" as const,
								"slack.publish_channel_report" as const,
							]
						: ["organization_documents.save_approved_knowledge" as const],
					externalActionPolicy: "read_only" as const,
				}
			: {}),
		cronExpression: schedule?.cronExpression ?? null,
		destinationKind: "space",
		instructions,
		name: input.values.name.trim(),
		postSlackSummary: input.values.postSlackSummary,
		runAtMs: input.values.scheduleKind === "once" ? input.values.runAtMs : null,
		scheduleKind: input.values.scheduleKind,
		slackChannelId: null,
		slackConversationId: null,
		slackReportChannelName: input.values.slackReportChannelName,
		slackTeamId: null,
		slackThreadLabel: null,
		slackThreadTs: null,
		targetSpaceId: input.values.targetSpaceId,
		timezone: schedule?.timezone ?? null,
	});
}

function resolveRoutineFormState(input: {
	currentTimeMs: number | null;
	capabilityChangeRequested: boolean;
	isSelfEvolution: boolean;
	mode: "create" | "edit";
	recurringScheduleValid: boolean;
	routine: CenterAgentRoutineManagement | undefined;
	submitting: boolean;
	targetSpaceEligible: boolean;
	targetSpacesReady: boolean;
	values: CenterAgentRoutineFormValues;
}): {
	canSubmit: boolean;
	hasChanges: boolean;
	requiredFieldsComplete: boolean;
	scheduleValid: boolean;
} {
	const hasChanges =
		input.mode === "create" ||
		(input.routine !== undefined &&
			(hasRoutineFormChanges(input.routine, input.values) ||
				input.capabilityChangeRequested));
	const oneTimeScheduleValid =
		input.currentTimeMs !== null &&
		input.values.runAtMs !== null &&
		input.values.runAtMs > input.currentTimeMs;
	const requiredFieldsComplete =
		input.values.name.trim().length > 0 &&
		input.values.instructions.trim().length > 0 &&
		(!input.isSelfEvolution ||
			input.values.instructions.startsWith(
				CENTER_AGENT_SELF_EVOLUTION_MARKER
			)) &&
		(!input.values.postSlackSummary ||
			SLACK_CHANNEL_NAME_PATTERN.test(
				input.values.slackReportChannelName.trim()
			)) &&
		input.values.targetSpaceId.length > 0 &&
		(input.values.scheduleKind === "cron" || oneTimeScheduleValid);
	const scheduleValid =
		input.values.scheduleKind === "once"
			? oneTimeScheduleValid
			: input.recurringScheduleValid;
	return {
		canSubmit:
			!input.submitting &&
			hasChanges &&
			requiredFieldsComplete &&
			input.targetSpacesReady &&
			input.targetSpaceEligible &&
			scheduleValid,
		hasChanges,
		requiredFieldsComplete,
		scheduleValid,
	};
}

function OneTimeScheduleField(input: {
	currentTimeMs: number | null;
	onRunAtChange: (value: number | null) => void;
	runAtMs: number | null;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor="routine-run-at">Run at</Label>
			<Input
				id="routine-run-at"
				min={
					input.currentTimeMs === null
						? undefined
						: formatLocalDateTimeInput(input.currentTimeMs + 60_000)
				}
				onChange={(event) => {
					const runAtMs = new Date(event.target.value).getTime();
					input.onRunAtChange(Number.isFinite(runAtMs) ? runAtMs : null);
				}}
				required
				type="datetime-local"
				value={
					input.runAtMs === null ? "" : formatLocalDateTimeInput(input.runAtMs)
				}
			/>
			<p className="text-muted-foreground text-xs">
				This Routine runs once at the time shown in your local timezone.
			</p>
		</div>
	);
}

function resolveSubmitLabel(input: {
	mode: "create" | "edit";
	submitting: boolean;
}): string {
	if (input.submitting) {
		return input.mode === "create" ? "Creating" : "Saving";
	}
	return input.mode === "create" ? "Create routine" : "Save changes";
}

function resolveRoutineFormTitle(
	mode: "create" | "edit",
	routine: CenterAgentRoutineManagement | undefined
): string {
	return mode === "create"
		? "Create routine"
		: `Edit ${routine?.name ?? "routine"}`;
}

function hasRoutineFormChanges(
	routine: CenterAgentRoutineManagement,
	values: CenterAgentRoutineFormValues
): boolean {
	return (
		values.cronExpression !== routine.cronExpression ||
		values.instructions !== routine.instructions ||
		values.name !== routine.name ||
		values.postSlackSummary !==
			(readCenterAgentSelfEvolutionSlackReportChannelName(
				routine.instructions
			) !==
				null) ||
		values.slackReportChannelName !==
			(readCenterAgentSelfEvolutionSlackReportChannelName(
				routine.instructions
			) ?? "") ||
		values.runAtMs !== routine.runAtMs ||
		values.scheduleKind !== routine.scheduleKind ||
		values.targetSpaceId !== routine.targetSpaceId ||
		values.timezone !== routine.timezone
	);
}

function resolveInitialValues(
	routine: CenterAgentRoutineManagement | undefined
): CenterAgentRoutineFormValues {
	const slackReportChannelName = routine
		? (readCenterAgentSelfEvolutionSlackReportChannelName(
				routine.instructions
			) ?? "")
		: "";
	return routine
		? {
				cronExpression: routine.cronExpression,
				destinationKind: "space",
				instructions: routine.instructions,
				name: routine.name,
				postSlackSummary: slackReportChannelName.length > 0,
				runAtMs: routine.runAtMs,
				scheduleKind: routine.scheduleKind,
				slackChannelId: null,
				slackConversationId: null,
				slackReportChannelName,
				slackTeamId: null,
				slackThreadLabel: null,
				slackThreadTs: null,
				targetSpaceId: routine.targetSpaceId ?? "",
				timezone: routine.timezone,
			}
		: {
				cronExpression: "0 9 * * *",
				destinationKind: "space",
				instructions: "",
				name: "",
				postSlackSummary: false,
				runAtMs: null,
				scheduleKind: "cron",
				slackChannelId: null,
				slackConversationId: null,
				slackReportChannelName: "",
				slackTeamId: null,
				slackThreadLabel: null,
				slackThreadTs: null,
				targetSpaceId: "",
				timezone: resolveBrowserTimezone(),
			};
}

function resolveBrowserTimezone(): string {
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return timezone?.trim() || "UTC";
}

function useCurrentTimeMs(active: boolean): number | null {
	const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);

	useEffect(() => {
		if (!active) {
			return;
		}
		const updateCurrentTime = () => setCurrentTimeMs(Date.now());
		updateCurrentTime();
		const intervalId = window.setInterval(updateCurrentTime, 30_000);
		return () => window.clearInterval(intervalId);
	}, [active]);

	return currentTimeMs;
}

function formatLocalDateTimeInput(timestampMs: number): string {
	const date = new Date(timestampMs);
	const localTimestampMs = timestampMs - date.getTimezoneOffset() * 60_000;
	return new Date(localTimestampMs).toISOString().slice(0, 16);
}

function focusFirstIncompleteField(
	values: CenterAgentRoutineFormValues,
	currentTimeMs: number | null
): void {
	if (!values.name.trim()) {
		document.getElementById("routine-name")?.focus();
		return;
	}
	if (!values.instructions.trim()) {
		document.getElementById("routine-instructions")?.focus();
		return;
	}
	if (
		values.postSlackSummary &&
		!SLACK_CHANNEL_NAME_PATTERN.test(values.slackReportChannelName.trim())
	) {
		document.getElementById("routine-slack-report-channel")?.focus();
		return;
	}
	if (
		values.scheduleKind === "once" &&
		(currentTimeMs === null ||
			values.runAtMs === null ||
			values.runAtMs <= currentTimeMs)
	) {
		document.getElementById("routine-run-at")?.focus();
		return;
	}
	focusTargetSpaceValidation();
}

function focusTargetSpaceValidation(): void {
	const targetSpaceControl = document.getElementById("routine-target-space");
	if (targetSpaceControl) {
		targetSpaceControl.focus();
		return;
	}
	document.getElementById("routine-target-space-error")?.focus();
}

function resolveSubmitHelp(input: {
	hasChanges: boolean;
	requiredFieldsComplete: boolean;
	scheduleValid: boolean;
	submitting: boolean;
	targetSpaceEligible: boolean;
	targetSpacesReady: boolean;
}): string {
	if (input.submitting) {
		return "Wait for this routine to finish saving.";
	}
	if (!input.hasChanges) {
		return "Change at least one field before saving.";
	}
	if (!input.requiredFieldsComplete) {
		return "Complete every required field before saving.";
	}
	if (!input.targetSpacesReady) {
		return "Finish preparing eligible target Spaces before saving.";
	}
	if (!input.targetSpaceEligible) {
		return "Choose an eligible target Space before saving.";
	}
	if (!input.scheduleValid) {
		return "Fix the highlighted schedule field before saving.";
	}
	return "This routine is ready to save.";
}
