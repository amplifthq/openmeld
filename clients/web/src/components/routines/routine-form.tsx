import { CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS } from "@openmeld/schemas";
import type {
	CreateCenterAgentRoutineBody,
	ListRoutineManagementResponse,
	RoutineManagement,
	RoutineScope,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Calendar } from "@openmeld/ui/components/calendar";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import { Textarea } from "@openmeld/ui/components/textarea";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useId, useRef, useState } from "react";
import { openCurrentCenterAgentDirectMessageSpace } from "#/lib/organizations/center-agent";
import { openCurrentDirectMessageSpace } from "#/lib/spaces/direct-message";
import { routineTargetSpacesQueryOptions } from "#/query/routines";
import {
	type RoutineRepeat,
	readRoutineScheduleFields,
} from "./routine-form-values";

type Repeat = RoutineRepeat;
const repeats: { value: Repeat; label: string }[] = [
	{ value: "daily", label: "Daily" },
	{ value: "weekdays", label: "Weekdays" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "once", label: "Once" },
	{ value: "custom", label: "Custom" },
];

export function RoutineSelect(input: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
	disabled?: boolean;
	searchPlaceholder?: string;
}) {
	const [search, setSearch] = useState("");
	const visibleOptions = input.options.filter((option) =>
		option.label.toLowerCase().includes(search.toLowerCase())
	);
	return (
		<div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
			<span className="shrink-0 text-sm">{input.label}</span>
			<div className="min-w-0 max-w-[65%]">
				<Select
					disabled={input.disabled}
					onCloseAutoFocus={() => setSearch("")}
					onValueChange={input.onChange}
					value={input.value}
				>
					<SelectTrigger
						aria-label={input.label}
						className="min-w-0 max-w-full text-sm"
						displayValue={
							input.options.find((option) => option.value === input.value)
								?.label
						}
						placeholder="Choose"
						variant="borderless"
					/>
					<SelectContent
						align="end"
						className={input.searchPlaceholder ? "min-w-64" : undefined}
						search={
							input.searchPlaceholder
								? {
										value: search,
										onValueChange: setSearch,
										placeholder: input.searchPlaceholder,
									}
								: undefined
						}
					>
						{visibleOptions.map((option, index) => (
							<SelectItem index={index} key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
						{visibleOptions.length === 0 ? (
							<p className="px-3 py-4 text-muted-foreground text-sm">
								No matches
							</p>
						) : null}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

function initialScope(
	routine: RoutineManagement | undefined,
	scope: RoutineScope
) {
	return routine?.scope ?? scope;
}

function FormRow(input: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
			<span className="text-sm">{input.label}</span>
			{input.children}
		</div>
	);
}

export function RoutineForm(input: {
	organizationId: string;
	scope: RoutineScope;
	executors: ListRoutineManagementResponse["executors"];
	routine?: RoutineManagement;
	initialValues?: Partial<CreateCenterAgentRoutineBody>;
	open: boolean;
	pending: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (body: CreateCenterAgentRoutineBody) => Promise<void>;
}) {
	const routine = input.routine;
	const submitLabel = routine ? "Save" : "Create";
	const initial = routine ?? input.initialValues;
	const submitting = useRef(false);
	const instructionsId = useId();
	const [saving, setSaving] = useState(false);
	const scheduleFields = readRoutineScheduleFields(initial);
	const [instructions, setInstructions] = useState(initial?.instructions ?? "");
	const [name, setName] = useState(initial?.name ?? "");
	const [scope, setScope] = useState<RoutineScope>(
		initialScope(routine, input.scope)
	);
	const [agent, setAgent] = useState(
		routine
			? (routine.agentProfileId ?? "center")
			: (input.executors[0]?.agentProfileId ?? "center")
	);
	const [repeat, setRepeat] = useState<Repeat>(scheduleFields.repeat);
	const [time, setTime] = useState(
		initialRoutineTime(routine?.runAtMs, scheduleFields.time)
	);
	const [day, setDay] = useState(scheduleFields.day);
	const [cron, setCron] = useState(initial?.cronExpression ?? "0 9 * * *");
	const [timezone, setTimezone] = useState(
		initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
	);
	const [date, setDate] = useState(initialRoutineDate(routine?.runAtMs));
	const [destination, setDestination] = useState(
		initial?.targetSpaceId ?? resolveInitialDestination(routine, input.scope)
	);
	const [validation, setValidation] = useState<string | null>(null);
	const spaces = useRoutineSpaces(input.organizationId, agent, input.open);
	const {
		options,
		existingChannel,
		privateChat,
		displayDestination,
		eligible,
		destinationOptions,
	} = routineDestinationOptions({
		executors: input.executors,
		routine,
		agent,
		scope,
		destination,
		spaces: spaces.data?.spaces ?? [],
	});
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || input.pending || saving)) {
					input.onClose();
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-xl">
				<form
					className="grid gap-5"
					onSubmit={async (event) => {
						event.preventDefault();
						if (input.pending || saving || submitting.current || !eligible) {
							return;
						}
						submitting.current = true;
						setSaving(true);
						setValidation(null);
						try {
							const schedule = await buildFormSchedule({
								repeat,
								time,
								day,
								cron,
								timezone,
								date,
								previousRunAtMs: routine?.runAtMs,
							});
							const target = await buildFormDestination({
								organizationId: input.organizationId,
								agent,
								destination,
								routine,
							});
							await input.onSubmit({
								name:
									name.trim() ||
									instructions
										.trim()
										.split("\n")
										.slice(0, 1)
										.join("")
										.slice(0, 120),
								instructions: instructions.trim(),
								scope,
								agentProfileId: agent === "center" ? null : agent,
								...schedule,
								...target,
							});
						} catch (error) {
							setValidation(
								error instanceof Error
									? error.message
									: "Could not save this routine."
							);
						} finally {
							submitting.current = false;
							setSaving(false);
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{routine ? "Edit routine" : "Create routine"}
						</DialogTitle>
						<DialogDescription className="sr-only">
							Choose what to do, when to run, and where to send results.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 text-sm">
						<label htmlFor={instructionsId}>Instructions</label>
						<Textarea
							autoFocus
							className="min-h-32 resize-y"
							id={instructionsId}
							maxLength={CENTER_AGENT_ROUTINE_INSTRUCTIONS_MAX_CHARS}
							onChange={(event) => setInstructions(event.target.value)}
							placeholder="Summarize new issues every morning."
							required
							value={instructions}
						/>
					</div>
					<div className="divide-y rounded-md border">
						<RoutineSelect
							disabled={Boolean(routine)}
							label="Visible to"
							onChange={(value) => {
								setScope(value as RoutineScope);
								if (destination === "__private__" && value === "team") {
									setDestination("");
								}
							}}
							options={[
								{ value: "personal", label: "Only me" },
								{ value: "team", label: "Team" },
							]}
							value={scope}
						/>
						<RoutineSelect
							disabled={Boolean(routine)}
							label="Agent"
							onChange={(value) => {
								setAgent(value);
								setDestination(scope === "personal" ? "__private__" : "");
							}}
							options={options}
							value={agent}
						/>
						<RoutineScheduleFields
							cron={cron}
							date={date}
							day={day}
							repeat={repeat}
							setCron={setCron}
							setDate={setDate}
							setDay={setDay}
							setRepeat={setRepeat}
							setTime={setTime}
							time={time}
						/>
						<RoutineSelect
							disabled={spaces.isPending}
							label="Send results to"
							onChange={setDestination}
							options={destinationOptions}
							searchPlaceholder="Search Spaces…"
							value={displayDestination}
						/>
					</div>
					<RoutineDestinationHint
						hasChat={Boolean(privateChat)}
						isPrivate={displayDestination === "__private__"}
						sharedResults={
							scope === "personal" && Boolean(destination) && !existingChannel
						}
					/>
					<RoutineDestinationStatus scope={scope} spaces={spaces} />
					<RoutineAdvancedFields
						name={name}
						repeat={repeat}
						setName={setName}
						setTimezone={setTimezone}
						timezone={timezone}
					/>
					<RoutineLocalNote agent={agent} executors={input.executors} />
					{validation || input.error ? (
						<p className="text-destructive text-sm" role="alert">
							{validation ?? input.error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							disabled={input.pending || saving}
							onClick={input.onClose}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={
								input.pending ||
								saving ||
								!instructions.trim() ||
								!eligible ||
								!options.length
							}
							type="submit"
						>
							{input.pending || saving ? "Saving…" : submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

async function buildFormSchedule(input: {
	repeat: Repeat;
	time: string;
	day: string;
	cron: string;
	timezone: string;
	date: string;
	previousRunAtMs?: number | null;
}) {
	const { repeat, time, day, cron, timezone, date } = input;
	if (repeat === "once") {
		const unchanged =
			input.previousRunAtMs != null &&
			date === initialRoutineDate(input.previousRunAtMs) &&
			time === initialRoutineTime(input.previousRunAtMs, time);
		const runAtMs =
			unchanged && input.previousRunAtMs != null
				? input.previousRunAtMs
				: new Date(`${date}T${time}`).getTime();
		if (
			!Number.isFinite(runAtMs) ||
			(runAtMs <= Date.now() && runAtMs !== input.previousRunAtMs)
		) {
			throw new Error("Choose a future date and time.");
		}
		return {
			scheduleKind: "once" as const,
			runAtMs,
			cronExpression: null,
			timezone: null,
		};
	}
	const [hour, minute] = time.split(":").map(Number);
	let weekday = "*";
	if (repeat === "weekdays") {
		weekday = "1-5";
	}
	if (repeat === "weekly") {
		weekday = day;
	}
	const expression =
		repeat === "custom"
			? cron
			: `${minute} ${hour} ${repeat === "monthly" ? day : "*"} * ${weekday}`;
	const schedule = await import("@openmeld/routine-schedule");
	schedule.validateRoutineSchedule({ cronExpression: expression, timezone });
	return {
		scheduleKind: "cron" as const,
		runAtMs: null,
		cronExpression: expression,
		timezone,
	};
}
async function buildFormDestination(input: {
	organizationId: string;
	agent: string;
	destination: string;
	routine?: RoutineManagement;
}) {
	const { organizationId, agent, destination, routine } = input;
	if (destination === "__channel__" && routine) {
		return {
			destinationKind: routine.destinationKind,
			targetSpaceId: routine.targetSpaceId,
			slackTeamId: routine.slackTeamId,
			slackChannelId: routine.slackChannelId,
			slackThreadTs: routine.slackThreadTs,
			slackConversationId: routine.slackConversationId,
			slackThreadLabel: routine.slackThreadLabel,
			...(routine.messageChannelLocator
				? { messageChannelLocator: routine.messageChannelLocator }
				: {}),
		};
	}
	let targetSpaceId = destination;
	if (destination === "__private__") {
		const chat =
			agent === "center"
				? await openCurrentCenterAgentDirectMessageSpace({ organizationId })
				: await openCurrentDirectMessageSpace({
						organizationId,
						targetProfileId: agent,
					});
		targetSpaceId = chat.spaceId;
	}
	return {
		destinationKind: "space" as const,
		targetSpaceId,
		slackTeamId: null,
		slackChannelId: null,
		slackThreadTs: null,
		slackConversationId: null,
		slackThreadLabel: null,
	};
}

function RoutineScheduleFields({
	repeat,
	setRepeat,
	day,
	setDay,
	time,
	setTime,
	date,
	setDate,
	cron,
	setCron,
}: {
	repeat: Repeat;
	setRepeat: (v: Repeat) => void;
	day: string;
	setDay: (v: string) => void;
	time: string;
	setTime: (v: string) => void;
	date: string;
	setDate: (v: string) => void;
	cron: string;
	setCron: (v: string) => void;
}) {
	return (
		<>
			{" "}
			<RoutineSelect
				label="Repeat"
				onChange={(value) => {
					setRepeat(value as Repeat);
					setDay("1");
				}}
				options={repeats}
				value={repeat}
			/>
			{repeat === "once" ? (
				<FormRow label="Date">
					<Popover>
						<PopoverTrigger
							render={
								<Button
									aria-label="Date"
									className="gap-2 font-normal"
									type="button"
									variant="ghost"
								/>
							}
						>
							{date
								? new Date(`${date}T12:00`).toLocaleDateString(undefined, {
										month: "short",
										day: "numeric",
										year: "numeric",
									})
								: "Choose"}
							<CaretDownIcon />
						</PopoverTrigger>
						<PopoverContent align="end" className="w-auto rounded-md p-0">
							<Calendar
								mode="single"
								onSelect={(value) => {
									if (value) {
										setDate(
											`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
										);
									}
								}}
								selected={date ? new Date(`${date}T12:00`) : undefined}
							/>
						</PopoverContent>
					</Popover>
				</FormRow>
			) : null}
			{repeat === "custom" ? (
				<FormRow label="Schedule">
					<Input
						aria-label="Cron schedule"
						className="w-44"
						onChange={(event) => setCron(event.target.value)}
						required
						value={cron}
					/>
				</FormRow>
			) : (
				<RoutineSelect
					label="Time"
					onChange={setTime}
					options={Array.from(
						new Set([
							time,
							...Array.from(
								{ length: 96 },
								(_, index) =>
									`${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`
							),
						])
					)
						.sort()
						.map((value) => ({
							value,
							label: value,
						}))}
					value={time}
				/>
			)}
			{repeat === "weekly" ? (
				<RoutineSelect
					label="Day"
					onChange={setDay}
					options={[
						"Sunday",
						"Monday",
						"Tuesday",
						"Wednesday",
						"Thursday",
						"Friday",
						"Saturday",
					].map((label, index) => ({ label, value: String(index) }))}
					value={day}
				/>
			) : null}
			{repeat === "monthly" ? (
				<RoutineSelect
					label="Day"
					onChange={setDay}
					options={Array.from({ length: 28 }, (_, index) => ({
						label: String(index + 1),
						value: String(index + 1),
					}))}
					value={day}
				/>
			) : null}
		</>
	);
}

function RoutineDestinationHint(input: {
	isPrivate: boolean;
	hasChat: boolean;
	sharedResults: boolean;
}) {
	let message = "";
	if (input.isPrivate) {
		message = input.hasChat
			? "Results go to your existing chat with this Agent."
			: "A chat with this Agent will be created for the results.";
	} else if (input.sharedResults) {
		message = "Space members can see the results.";
	}
	return message ? (
		<p className="text-muted-foreground text-xs">{message}</p>
	) : null;
}
function RoutineDestinationStatus({
	spaces,
	scope,
}: {
	spaces: ReturnType<typeof useRoutineSpaces>;
	scope: RoutineScope;
}) {
	if (spaces.isError) {
		return (
			<p className="text-destructive text-sm" role="alert">
				Could not load Spaces.{" "}
				<button
					className="underline"
					onClick={async () => {
						await spaces.refetch();
					}}
					type="button"
				>
					Retry
				</button>
			</p>
		);
	}
	if (scope === "team" && spaces.isSuccess && !spaces.data.spaces.length) {
		return (
			<p className="text-muted-foreground text-sm">
				Add this Agent to a Space, then reopen this form.
			</p>
		);
	}
	return null;
}
function useRoutineSpaces(
	organizationId: string,
	agent: string,
	enabled: boolean
) {
	return useQuery({
		...routineTargetSpacesQueryOptions({
			organizationId,
			agentProfileId: agent === "center" ? undefined : agent,
			enabled,
		}),
		staleTime: 0,
	});
}

function RoutineAdvancedFields({
	name,
	setName,
	repeat,
	timezone,
	setTimezone,
}: {
	name: string;
	setName: (v: string) => void;
	repeat: Repeat;
	timezone: string;
	setTimezone: (v: string) => void;
}) {
	return (
		<Accordion>
			<AccordionItem value="advanced">
				<AccordionTrigger
					className="text-muted-foreground text-sm"
					trailing={
						<span className="text-xs group-data-[open]/accordion-item:hidden">
							{repeat === "once"
								? Intl.DateTimeFormat()
										.resolvedOptions()
										.timeZone.replaceAll("_", " ")
								: timezone.replaceAll("_", " ")}
						</span>
					}
				>
					Advanced
				</AccordionTrigger>
				<AccordionContent>
					<div className="mt-3 divide-y rounded-md border">
						<FormRow label="Name">
							<Input
								aria-label="Name"
								className="w-64 max-w-[65%]"
								maxLength={120}
								onChange={(event) => setName(event.target.value)}
								placeholder="Optional"
								value={name}
							/>
						</FormRow>
						{repeat !== "once" ? (
							<RoutineSelect
								label="Time zone"
								onChange={setTimezone}
								options={Array.from(
									new Set([timezone, ...Intl.supportedValuesOf("timeZone")])
								).map((value) => ({
									value,
									label: value.replaceAll("_", " "),
								}))}
								searchPlaceholder="Search time zones…"
								value={timezone}
							/>
						) : null}
					</div>
				</AccordionContent>
			</AccordionItem>
		</Accordion>
	);
}

function resolveInitialDestination(
	routine: RoutineManagement | undefined,
	scope: RoutineScope
) {
	if (routine) {
		return "__channel__";
	}
	return scope === "personal" ? "__private__" : "";
}

function routineDestinationOptions({
	executors,
	routine,
	agent,
	scope,
	destination,
	spaces,
}: {
	executors: ListRoutineManagementResponse["executors"];
	routine?: RoutineManagement;
	agent: string;
	scope: RoutineScope;
	destination: string;
	spaces: NonNullable<ReturnType<typeof useRoutineSpaces>["data"]>["spaces"];
}) {
	const options = executors.map((executor) => ({
		value: executor.agentProfileId ?? "center",
		label:
			executor.name +
			(executor.kind === "local_agent" ? " · On your computer" : ""),
	}));
	if (routine && !options.some((option) => option.value === agent)) {
		options.push({ value: agent, label: routine.executorName });
	}
	const existingChannel = routine && routine.destinationKind !== "space";
	const privateChat = spaces.find((space) => space.kind === "center_agent_dm");
	const agentName =
		executors.find(
			(executor) => (executor.agentProfileId ?? "center") === agent
		)?.name ??
		routine?.executorName ??
		"Agent";
	const privateChatLabel = `Your chat with ${agentName}`;
	const displayDestination =
		destination === privateChat?.spaceId ? "__private__" : destination;
	const eligible =
		destination === "__private__" ||
		(destination === "__channel__" && Boolean(existingChannel)) ||
		spaces.some((space) => space.spaceId === destination) === true;
	const destinationOptions = [
		...(scope === "personal" || destination === privateChat?.spaceId
			? [{ value: "__private__", label: privateChatLabel }]
			: []),
		...(existingChannel
			? [
					{
						value: "__channel__",
						label: routine.slackThreadLabel ?? "Connected conversation",
					},
				]
			: []),
		...(spaces ?? [])
			.filter((space) => space.kind !== "center_agent_dm")
			.map((space) => ({
				value: space.spaceId,
				label: space.name,
			})),
	];
	return {
		options,
		existingChannel,
		privateChat,
		displayDestination,
		eligible,
		destinationOptions,
	};
}

function initialRoutineTime(
	timestamp: number | null | undefined,
	fallback: string
) {
	if (!timestamp) {
		return fallback;
	}
	const date = new Date(timestamp);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function initialRoutineDate(timestamp: number | null | undefined) {
	if (!timestamp) {
		return "";
	}
	return new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 10);
}
function RoutineLocalNote({
	executors,
	agent,
}: {
	executors: ListRoutineManagementResponse["executors"];
	agent: string;
}) {
	if (
		executors.find(
			(executor) => (executor.agentProfileId ?? "center") === agent
		)?.kind !== "local_agent"
	) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-xs">
			Your computer must be awake and connected.
		</p>
	);
}
