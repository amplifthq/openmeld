"use client";

import type {
	CenterAgentRoutineManagement,
	Project,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	ArrowRightIcon,
	BookOpenTextIcon,
	SparkleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	createCurrentCenterAgentRoutine,
	resolveCenterAgentRoutineErrorMessage,
} from "#/lib/organizations/center-agent-routines";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { organizationAppConnectionCatalogQueryOptions } from "#/query/organizations/app-connections";
import {
	invalidateCenterAgentRoutineFacts,
	prepareCenterAgentRoutineTargetSpaces,
} from "#/query/organizations/center-agent-routines";
import { messageChannelListQueryOptions } from "#/query/organizations/message-channels";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { projectsQueryOptions } from "#/query/organizations/projects";
import {
	CenterAgentRoutineTargetSpaceField,
	type CenterAgentRoutineTargetSpacePreparation,
	useCenterAgentRoutineTargetSpaceFieldState,
} from "./center-agent-routine-target-space-field";
import {
	buildCenterAgentSelfEvolutionRoutineBody,
	buildCenterAgentSelfEvolutionSources,
	CENTER_AGENT_SELF_EVOLUTION_DEFAULT_FOCUS,
	CENTER_AGENT_SELF_EVOLUTION_NAME,
	type CenterAgentSelfEvolutionSource,
	isCenterAgentSelfEvolutionCapabilityReady,
	isCenterAgentSelfEvolutionRoutine,
} from "./center-agent-self-evolution";
import { useCenterAgentRoutineScheduleValidation } from "./use-center-agent-routine-schedule-validation";

type Frequency = "custom" | "daily" | "weekly";

const ALL_PROJECTS_VALUE = "all-projects";
const DEFAULT_TIME = "09:00";
const DEFAULT_WEEKDAY = "1";
const LEADING_SLACK_CHANNEL_MARKERS_PATTERN = /^#+/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const WEEKDAYS = [
	{ label: "Monday", value: "1" },
	{ label: "Tuesday", value: "2" },
	{ label: "Wednesday", value: "3" },
	{ label: "Thursday", value: "4" },
	{ label: "Friday", value: "5" },
	{ label: "Saturday", value: "6" },
	{ label: "Sunday", value: "0" },
] as const;

export function CenterAgentSelfEvolutionCard(input: {
	currentUserId: string;
	existingRoutines: readonly CenterAgentRoutineManagement[];
	isPersonalWorkspace: boolean;
	organizationId: string;
	orgSlug: string;
}) {
	const queryClient = useQueryClient();
	const appConnectionsQuery = useQuery(
		organizationAppConnectionCatalogQueryOptions({
			organizationId: input.organizationId,
			queryClient,
		})
	);
	const messageChannelsQuery = useQuery(
		messageChannelListQueryOptions({
			organizationId: input.organizationId,
		})
	);
	const projectsQuery = useQuery(
		projectsQueryOptions({
			organizationId: input.organizationId,
		})
	);
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !input.isPersonalWorkspace,
			organizationId: input.organizationId,
			userId: input.currentUserId,
		})
	);
	const sources = useMemo(
		() =>
			buildCenterAgentSelfEvolutionSources({
				appConnections: appConnectionsQuery.data?.connections ?? [],
				currentUserId: input.currentUserId,
				messageChannels: messageChannelsQuery.data?.connections ?? [],
			}),
		[appConnectionsQuery.data, input.currentUserId, messageChannelsQuery.data]
	);
	const existingRoutine = input.existingRoutines.find(
		isCenterAgentSelfEvolutionRoutine
	);
	const canSaveApprovedKnowledge = canManageOrganizationArea(roleQuery.data, {
		organizationDocuments: ["saveApprovedKnowledge"],
	});
	const sourceCheckPending =
		appConnectionsQuery.isPending || messageChannelsQuery.isPending;
	const sourceIdentityMismatch =
		(appConnectionsQuery.data !== undefined &&
			(appConnectionsQuery.data.organizationId !== input.organizationId ||
				appConnectionsQuery.data.currentUserId !== input.currentUserId)) ||
		(messageChannelsQuery.data !== undefined &&
			messageChannelsQuery.data.organizationId !== input.organizationId);
	const sourceCheckFailed =
		appConnectionsQuery.isError ||
		messageChannelsQuery.isError ||
		sourceIdentityMismatch;

	if (input.isPersonalWorkspace) {
		return null;
	}
	if (existingRoutine) {
		return <ConfiguredSelfEvolutionCard routine={existingRoutine} />;
	}
	if (sourceCheckPending) {
		return null;
	}
	if (sourceCheckFailed) {
		return (
			<section
				aria-labelledby="self-evolution-source-error-title"
				className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
			>
				<h2
					className="font-medium text-foreground text-sm"
					id="self-evolution-source-error-title"
				>
					Self-Evolution setup is unavailable
				</h2>
				<p className="mt-1 text-destructive text-sm">
					OpenMeld could not check the Organization’s connected sources. Refresh
					the page to try again.
				</p>
			</section>
		);
	}
	if (sources.length === 0) {
		return null;
	}

	return (
		<SelfEvolutionRecommendation
			canSaveApprovedKnowledge={canSaveApprovedKnowledge}
			organizationId={input.organizationId}
			orgSlug={input.orgSlug}
			permissionCheckFailed={roleQuery.isError}
			permissionCheckPending={roleQuery.isPending}
			projects={projectsQuery.data?.projects ?? []}
			projectsFailed={projectsQuery.isError}
			projectsPending={projectsQuery.isPending}
			sources={sources}
		/>
	);
}

function ConfiguredSelfEvolutionCard(input: {
	routine: CenterAgentRoutineManagement;
}) {
	const capabilityReady = isCenterAgentSelfEvolutionCapabilityReady(
		input.routine
	);
	const statusLabel = capabilityReady
		? resolveRoutineStatusLabel(input.routine.status)
		: "Needs repair";
	return (
		<section
			aria-labelledby="self-evolution-title"
			className="relative overflow-hidden rounded-md border border-border/80 bg-card/60 px-5 py-5"
		>
			<div
				aria-hidden="true"
				className="absolute inset-y-0 left-0 w-1 bg-primary"
			/>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<SparkleIcon aria-hidden="true" className="size-4 text-primary" />
						<p className="font-medium text-muted-foreground text-xs">
							Continuous learning
						</p>
						<Badge variant="outline">{statusLabel}</Badge>
					</div>
					<h2
						className="mt-2 font-medium text-foreground text-lg"
						id="self-evolution-title"
					>
						{CENTER_AGENT_SELF_EVOLUTION_NAME}
					</h2>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
						{capabilityReady
							? "Your Center Agent can learn from connected Organization signals, keep shared knowledge current, and surface useful opportunities."
							: "This Routine is recognizable as Self-Evolution, but its saved permissions do not match its learning and Slack report settings."}
					</p>
				</div>
				<p className="max-w-xs text-muted-foreground text-xs leading-5 sm:text-right">
					{capabilityReady
						? "Manage its schedule, learning archive, optional Slack team report, status, and run history in the Routine below."
						: resolveSelfEvolutionRepairGuidance(input.routine)}
				</p>
			</div>
		</section>
	);
}

function resolveSelfEvolutionRepairGuidance(
	routine: CenterAgentRoutineManagement
): string {
	if (!routine.canManage) {
		return "Ask the Routine creator or an Organization owner or admin to repair its permissions.";
	}
	if (!routine.capabilityState.canRepair) {
		return "Ask an Organization owner or admin to repair its permissions.";
	}
	return "Open Edit below and choose Repair permissions before relying on this Routine.";
}

function SelfEvolutionRecommendation(input: {
	canSaveApprovedKnowledge: boolean;
	organizationId: string;
	orgSlug: string;
	permissionCheckFailed: boolean;
	permissionCheckPending: boolean;
	projects: readonly Project[];
	projectsFailed: boolean;
	projectsPending: boolean;
	sources: readonly CenterAgentSelfEvolutionSource[];
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<section
				aria-labelledby="self-evolution-title"
				className="relative overflow-hidden rounded-md border border-border/80 bg-card/60 px-5 py-5"
			>
				<div
					aria-hidden="true"
					className="absolute inset-y-0 left-0 w-1 bg-primary"
				/>
				<div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<SparkleIcon aria-hidden="true" className="size-4 text-primary" />
							<Badge variant="outline">Recommended</Badge>
						</div>
						<h2
							className="mt-2 font-medium text-foreground text-lg"
							id="self-evolution-title"
						>
							{CENTER_AGENT_SELF_EVOLUTION_NAME}
						</h2>
						<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
							Let your Center Agent learn how this Organization works, keep
							shared knowledge current, and surface evidence-backed
							opportunities.
						</p>
						<div className="mt-3 flex flex-wrap gap-2">
							{input.sources.map((source) => (
								<span
									className="rounded-sm border border-border/70 bg-background px-2 py-1 text-foreground text-xs"
									key={source.id}
								>
									{source.label}
								</span>
							))}
						</div>
					</div>
					<div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
						{input.permissionCheckFailed ? (
							<p className="max-w-xs text-destructive text-xs leading-5">
								OpenMeld could not check who can approve shared knowledge.
								Refresh the page to try again.
							</p>
						) : null}
						{input.permissionCheckFailed ||
						input.permissionCheckPending ||
						input.canSaveApprovedKnowledge ? null : (
							<p className="max-w-xs text-muted-foreground text-xs leading-5">
								An Organization owner or admin must enable Self-Evolution
								because it maintains approved shared knowledge.
							</p>
						)}
						<Button
							disabled={
								input.permissionCheckPending ||
								input.permissionCheckFailed ||
								!input.canSaveApprovedKnowledge
							}
							onClick={() => setOpen(true)}
							type="button"
						>
							{input.permissionCheckPending
								? "Checking access"
								: "Set up Self-Evolution"}
							{input.permissionCheckPending ? null : (
								<ArrowRightIcon aria-hidden="true" className="size-4" />
							)}
						</Button>
					</div>
				</div>
			</section>
			{open ? (
				<SelfEvolutionSetupDialog
					onOpenChange={setOpen}
					open={open}
					organizationId={input.organizationId}
					orgSlug={input.orgSlug}
					projects={input.projects}
					projectsFailed={input.projectsFailed}
					projectsPending={input.projectsPending}
					sources={input.sources}
				/>
			) : null}
		</>
	);
}

function SelfEvolutionSetupDialog(input: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organizationId: string;
	orgSlug: string;
	projects: readonly Project[];
	projectsFailed: boolean;
	projectsPending: boolean;
	sources: readonly CenterAgentSelfEvolutionSource[];
}) {
	const queryClient = useQueryClient();
	const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
		() => new Set(input.sources.map((source) => source.id))
	);
	const [selectedProjectId, setSelectedProjectId] =
		useState(ALL_PROJECTS_VALUE);
	const [frequency, setFrequency] = useState<Frequency>("daily");
	const [time, setTime] = useState(DEFAULT_TIME);
	const [weekday, setWeekday] = useState(DEFAULT_WEEKDAY);
	const [customSchedule, setCustomSchedule] = useState("0 9 * * *");
	const [timezone, setTimezone] = useState(resolveBrowserTimezone);
	const [targetSpaceId, setTargetSpaceId] = useState("");
	const [postSlackSummary, setPostSlackSummary] = useState(false);
	const [slackReportChannelName, setSlackReportChannelName] = useState("");
	const [focus, setFocus] = useState(CENTER_AGENT_SELF_EVOLUTION_DEFAULT_FOCUS);
	const scheduleInputRef = useRef<HTMLInputElement>(null);
	const timezoneInputRef = useRef<HTMLInputElement>(null);
	const submissionLatchRef = useRef(false);
	const cronExpression = buildSchedule({
		customSchedule,
		frequency,
		time,
		weekday,
	});
	const selectedSources = input.sources.filter((source) =>
		selectedSourceIds.has(source.id)
	);
	const selectedProject =
		input.projects.find((project) => project.id === selectedProjectId) ?? null;
	const scheduleValidation = useCenterAgentRoutineScheduleValidation({
		scheduleInputRef,
		timezoneInputRef,
		values: { cronExpression, timezone },
	});
	const targetPreparationMutation = useMutation({
		mutationFn: async () =>
			await prepareCenterAgentRoutineTargetSpaces({
				organizationId: input.organizationId,
				queryClient,
			}),
	});
	const targetPreparation: CenterAgentRoutineTargetSpacePreparation = {
		errorMessage: targetPreparationMutation.isError
			? resolveCenterAgentRoutineErrorMessage(
					targetPreparationMutation.error,
					"target_spaces"
				)
			: null,
		isPending:
			targetPreparationMutation.isPending ||
			targetPreparationMutation.status === "idle",
		isReady: targetPreparationMutation.isSuccess,
		onRetry: () => targetPreparationMutation.mutate(),
	};
	const targetSpaceFieldState = useCenterAgentRoutineTargetSpaceFieldState({
		mode: "create",
		organizationId: input.organizationId,
		preparation: targetPreparation,
		targetSpaceId,
	});
	const createMutation = useMutation({
		mutationFn: async () => {
			const admittedSchedule = scheduleValidation.admitSchedule(true);
			if (!admittedSchedule) {
				throw new FormAdmissionError();
			}
			return await createCurrentCenterAgentRoutine({
				...buildCenterAgentSelfEvolutionRoutineBody({
					cronExpression: admittedSchedule.cronExpression,
					focus,
					project: selectedProject,
					slackReportChannelName: postSlackSummary
						? slackReportChannelName
						: null,
					sources: selectedSources,
					targetSpaceId,
					timezone: admittedSchedule.timezone,
				}),
				organizationId: input.organizationId,
			});
		},
		onError: (error) => {
			submissionLatchRef.current = false;
			if (error instanceof FormAdmissionError) {
				return;
			}
		},
		onSuccess: async () => {
			await invalidateCenterAgentRoutineFacts({
				organizationId: input.organizationId,
				queryClient,
			});
			submissionLatchRef.current = false;
			input.onOpenChange(false);
			toast.success("Center Agent Self-Evolution is enabled.");
		},
	});

	useEffect(() => {
		targetPreparationMutation.mutate();
	}, [targetPreparationMutation.mutate]);

	useEffect(() => {
		if (targetSpaceId || targetSpaceFieldState.spaces.length === 0) {
			return;
		}
		setTargetSpaceId(targetSpaceFieldState.spaces[0]?.spaceId ?? "");
	}, [targetSpaceFieldState.spaces, targetSpaceId]);

	const canSubmit =
		selectedSources.length > 0 &&
		targetSpaceFieldState.isEligibleTarget &&
		(!postSlackSummary ||
			slackReportChannelName
				.trim()
				.replace(LEADING_SLACK_CHANNEL_MARKERS_PATTERN, "").length > 0) &&
		scheduleValidation.valid &&
		!input.projectsFailed &&
		!input.projectsPending &&
		!createMutation.isPending;

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit || submissionLatchRef.current) {
			if (selectedSources.length === 0) {
				return;
			}
			scheduleValidation.admitSchedule(true);
			return;
		}
		submissionLatchRef.current = true;
		createMutation.mutate();
	};

	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="max-h-[min(90vh,780px)] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Set up Center Agent Self-Evolution</DialogTitle>
					<DialogDescription>
						Choose what your Center Agent should learn from, how often it should
						learn, and where it should report.
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-5" noValidate onSubmit={submit}>
					<fieldset className="grid gap-2">
						<legend className="font-medium text-foreground text-sm">
							Sources
						</legend>
						<p className="text-muted-foreground text-xs leading-5">
							Your selection guides the learning scope. Existing App and Channel
							permissions still control access. Self-Evolution never writes back
							to a selected source.
						</p>
						<p className="text-muted-foreground text-xs leading-5">
							A selected Slack Channel can use only the channel, member, and
							history data its existing connection permits.
						</p>
						<div className="grid gap-2 sm:grid-cols-2">
							{input.sources.map((source) => (
								<label
									className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
									key={source.id}
								>
									<input
										aria-label={source.label}
										checked={selectedSourceIds.has(source.id)}
										className="size-4 accent-primary"
										onChange={(event) => {
											setSelectedSourceIds((current) => {
												const next = new Set(current);
												if (event.target.checked) {
													next.add(source.id);
												} else {
													next.delete(source.id);
												}
												return next;
											});
										}}
										type="checkbox"
									/>
									<span>{source.label}</span>
								</label>
							))}
						</div>
						{selectedSources.length === 0 ? (
							<p className="text-destructive text-xs" role="alert">
								Select at least one connected source.
							</p>
						) : null}
					</fieldset>

					<div className="grid gap-1.5">
						<Label htmlFor="self-evolution-project">Target Project</Label>
						{input.projectsPending ? (
							<output className="text-muted-foreground text-xs">
								Loading Projects.
							</output>
						) : null}
						{input.projectsFailed ? (
							<p className="text-destructive text-xs" role="alert">
								OpenMeld could not load Projects. Close this setup and try
								again.
							</p>
						) : (
							<Select
								onValueChange={setSelectedProjectId}
								value={selectedProjectId}
							>
								<SelectTrigger
									aria-label="Target Project"
									displayValue={
										selectedProject?.name ?? "All Organization Projects"
									}
									id="self-evolution-project"
								/>
								<SelectContent>
									<SelectItem index={0} value={ALL_PROJECTS_VALUE}>
										All Organization Projects
									</SelectItem>
									{input.projects.map((project, index) => (
										<SelectItem
											index={index + 1}
											key={project.id}
											value={project.id}
										>
											{project.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
						<p className="text-muted-foreground text-xs">
							Choose one Project when the learning should stay focused.
						</p>
					</div>

					<div className="grid gap-3">
						<fieldset className="grid gap-1.5">
							<legend className="font-medium text-foreground text-sm">
								Frequency
							</legend>
							<div className="flex flex-wrap gap-2">
								{(
									[
										["daily", "Daily"],
										["weekly", "Weekly"],
										["custom", "Custom"],
									] as const
								).map(([value, label]) => (
									<Button
										key={value}
										onClick={() => setFrequency(value)}
										size="sm"
										type="button"
										variant={frequency === value ? "default" : "outline"}
									>
										{label}
									</Button>
								))}
							</div>
						</fieldset>
						{frequency === "weekly" ? (
							<div className="grid gap-1.5">
								<Label htmlFor="self-evolution-weekday">Day</Label>
								<Select onValueChange={setWeekday} value={weekday}>
									<SelectTrigger
										aria-label="Day"
										displayValue={
											WEEKDAYS.find((day) => day.value === weekday)?.label
										}
										id="self-evolution-weekday"
									/>
									<SelectContent>
										{WEEKDAYS.map((day, index) => (
											<SelectItem
												index={index}
												key={day.value}
												value={day.value}
											>
												{day.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}
						{frequency === "custom" ? (
							<div className="grid gap-1.5">
								<Label htmlFor="self-evolution-custom-schedule">
									Custom schedule
								</Label>
								<Input
									aria-invalid={scheduleValidation.scheduleError !== null}
									id="self-evolution-custom-schedule"
									onBlur={() => scheduleValidation.admitSchedule(false)}
									onChange={(event) => setCustomSchedule(event.target.value)}
									placeholder="0 9 * * *"
									ref={scheduleInputRef}
									value={customSchedule}
								/>
								<p className="text-muted-foreground text-xs">
									Use exactly five cron fields.
								</p>
							</div>
						) : (
							<div className="grid gap-1.5">
								<Label htmlFor="self-evolution-time">Time</Label>
								<Input
									id="self-evolution-time"
									onChange={(event) => setTime(event.target.value)}
									ref={scheduleInputRef}
									type="time"
									value={time}
								/>
							</div>
						)}
						<div className="grid gap-1.5">
							<Label htmlFor="self-evolution-timezone">Timezone</Label>
							<Input
								aria-invalid={scheduleValidation.timezoneError !== null}
								id="self-evolution-timezone"
								onBlur={() => scheduleValidation.admitSchedule(false)}
								onChange={(event) => setTimezone(event.target.value)}
								ref={timezoneInputRef}
								value={timezone}
							/>
						</div>
						<output className="text-muted-foreground text-xs">
							{scheduleValidation.presentation.message}
						</output>
						{scheduleValidation.scheduleError ? (
							<p className="text-destructive text-xs" role="alert">
								{scheduleValidation.scheduleError.message}
							</p>
						) : null}
						{scheduleValidation.timezoneError ? (
							<p className="text-destructive text-xs" role="alert">
								{scheduleValidation.timezoneError.message}
							</p>
						) : null}
					</div>

					<CenterAgentRoutineTargetSpaceField
						ariaLabel="Learning archive"
						fieldState={targetSpaceFieldState}
						helpText="The complete learning record stays in this Space. You can also send a short team summary to Slack."
						label="Learning archive"
						onRetry={targetPreparation.onRetry}
						onTargetSpaceChange={setTargetSpaceId}
						orgSlug={input.orgSlug}
						targetSpaceId={targetSpaceId}
					/>

					{input.sources.some((source) => source.kind === "slack") ? (
						<fieldset className="grid gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
							<legend className="px-1 font-medium text-foreground text-sm">
								Team report
							</legend>
							<label className="flex cursor-pointer items-start gap-3 text-sm">
								<input
									aria-label="Post a concise summary to Slack"
									checked={postSlackSummary}
									className="mt-0.5 size-4 accent-primary"
									onChange={(event) =>
										setPostSlackSummary(event.target.checked)
									}
									type="checkbox"
								/>
								<span className="min-w-0">
									<span className="flex flex-wrap items-center gap-2">
										<span>Post a concise summary to Slack</span>
										<Badge variant="outline">Recommended</Badge>
									</span>
									<span className="mt-1 block text-muted-foreground text-xs leading-5">
										Share what changed and the best opportunities without
										exposing the full learning archive.
									</span>
								</span>
							</label>
							{postSlackSummary ? (
								<div className="grid gap-1.5">
									<Label htmlFor="self-evolution-slack-channel">
										Slack channel
									</Label>
									<Input
										aria-label="Slack channel"
										id="self-evolution-slack-channel"
										onChange={(event) =>
											setSlackReportChannelName(event.target.value)
										}
										placeholder="#team-updates"
										value={slackReportChannelName}
									/>
									<p className="text-muted-foreground text-xs leading-5">
										Team members can reply in the Slack thread and continue the
										conversation with the Center Agent.
									</p>
								</div>
							) : null}
						</fieldset>
					) : null}

					<div className="grid gap-1.5">
						<Label htmlFor="self-evolution-focus">Learning focus</Label>
						<Textarea
							className="min-h-24 resize-y"
							id="self-evolution-focus"
							onChange={(event) => setFocus(event.target.value)}
							value={focus}
						/>
						<p className="text-muted-foreground text-xs leading-5">
							Adjust what deserves extra attention. Core safety, evidence,
							document, and reporting behavior stays in place.
						</p>
					</div>

					<div className="flex gap-3 rounded-md border border-border/70 bg-muted/20 p-3">
						<BookOpenTextIcon
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-muted-foreground"
						/>
						<p className="text-muted-foreground text-xs leading-5">
							Self-Evolution maintains Organization Understanding, Opportunity
							Ledger, and a monthly Learning Log in a dedicated Organization
							Documents folder.
						</p>
					</div>

					{createMutation.isError &&
					!(createMutation.error instanceof FormAdmissionError) ? (
						<p className="text-destructive text-sm" role="alert">
							{resolveCenterAgentRoutineErrorMessage(
								createMutation.error,
								"create"
							)}
						</p>
					) : null}
					<DialogFooter>
						<Button
							disabled={createMutation.isPending}
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Keep Self-Evolution off
						</Button>
						<Button disabled={!canSubmit} type="submit">
							{createMutation.isPending
								? "Enabling Self-Evolution"
								: "Enable Self-Evolution"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

class FormAdmissionError extends Error {}

function buildSchedule(input: {
	customSchedule: string;
	frequency: Frequency;
	time: string;
	weekday: string;
}): string {
	if (input.frequency === "custom") {
		return input.customSchedule;
	}
	const match = TIME_PATTERN.exec(input.time);
	if (!match) {
		return "";
	}
	const [, hour, minute] = match;
	return input.frequency === "daily"
		? `${Number(minute)} ${Number(hour)} * * *`
		: `${Number(minute)} ${Number(hour)} * * ${input.weekday}`;
}

function resolveBrowserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function resolveRoutineStatusLabel(
	status: CenterAgentRoutineManagement["status"]
): string {
	if (status === "enabled") {
		return "Enabled";
	}
	if (status === "paused") {
		return "Paused";
	}
	return "Completed";
}
