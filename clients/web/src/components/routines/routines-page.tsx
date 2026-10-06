import { formatStoredRoutineSchedule } from "@openmeld/routine-schedule";
import type {
	CreateCenterAgentRoutineBody,
	RoutineManagement,
	RoutineScope,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import {
	ClockCounterClockwiseIcon,
	ClockIcon,
	DotsThreeIcon,
	PauseCircleIcon,
	PencilSimpleIcon,
	PlayCircleIcon,
	PlusIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
import { RoutineDeleteDialog } from "#/components/routines/routine-delete-dialog";
import { RoutineRunsDialog } from "#/components/routines/routine-runs-dialog";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	createCurrentRoutine,
	deleteCurrentRoutine,
	pauseCurrentRoutine,
	resolveRoutineErrorMessage,
	resumeCurrentRoutine,
	updateCurrentRoutine,
} from "#/lib/routines/api";
import { invalidateRoutineFacts, routinesQueryOptions } from "#/query/routines";
import { RoutineForm } from "./routine-form";
import { routineFormUpdate } from "./routine-form-values";
import { RoutineLastRun } from "./routine-last-run";

export function RoutinesPage(input: {
	focusRoutineId?: string;
	focusRunId?: string;
	onClearFocus?: () => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	return (
		<RoutinesContent
			key={currentOrganization.id}
			organizationId={currentOrganization.id}
			userId={currentUserId}
			{...input}
		/>
	);
}

function RoutinesContent(input: {
	organizationId: string;
	userId: string;
	focusRoutineId?: string;
	focusRunId?: string;
	onClearFocus?: () => void;
}) {
	const client = useQueryClient();
	const [scope, setScope] = useState<RoutineScope>("personal");
	const [search, setSearch] = useState("");
	const [form, setForm] = useState<RoutineManagement | "create" | null>(null);
	const [deleting, setDeleting] = useState<RoutineManagement | null>(null);
	const [history, setHistory] = useState<RoutineManagement | null>(null);
	const list = useQuery({
		...routinesQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		}),
		refetchInterval: 30_000,
		refetchOnWindowFocus: true,
	});
	const invalidate = async (routineId?: string) =>
		await invalidateRoutineFacts({
			organizationId: input.organizationId,
			queryClient: client,
			routineId,
		});
	const save = useMutation({
		mutationFn: async (body: CreateCenterAgentRoutineBody) => {
			if (!form || form === "create") {
				return await createCurrentRoutine({
					...body,
					organizationId: input.organizationId,
				});
			}
			const update = routineFormUpdate(form, body);
			if (!Object.keys(update).length) {
				return { routine: form };
			}
			return await updateCurrentRoutine({
				...update,
				organizationId: input.organizationId,
				routineId: form.id,
			});
		},
		onSuccess: async (response) => {
			await invalidate(response.routine.id);
			setForm(null);
		},
	});
	const status = useMutation({
		mutationFn: async (routine: RoutineManagement) =>
			await (routine.status === "enabled"
				? pauseCurrentRoutine
				: resumeCurrentRoutine)({
				organizationId: input.organizationId,
				routineId: routine.id,
			}),
		onSuccess: async (response) => await invalidate(response.routine.id),
	});
	const remove = useMutation({
		mutationFn: async (routine: RoutineManagement) =>
			await deleteCurrentRoutine({
				organizationId: input.organizationId,
				routineId: routine.id,
			}),
		onSuccess: async () => {
			await invalidate();
			setDeleting(null);
		},
	});
	const routines = (list.data?.routines ?? []).filter(
		(routine) =>
			routine.scope === scope &&
			`${routine.name} ${routine.executorName}`
				.toLowerCase()
				.includes(search.toLowerCase())
	);
	const focused = list.data?.routines.find(
		(routine) => routine.id === input.focusRoutineId
	);
	const runsRoutine = history ?? focused ?? null;
	const openForm = (routine: RoutineManagement | "create") => {
		save.reset();
		setForm(routine);
	};
	return (
		<div className="flex flex-1 flex-col gap-5">
			<div className="flex items-center justify-between gap-4">
				<h1 className="font-medium text-xl">Routines</h1>
				<Button onClick={() => openForm("create")} size="sm">
					<PlusIcon />
					Create routine
				</Button>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<TabsSubtle
					aria-label="Routine visibility"
					idPrefix="routines-scope"
					onSelect={(index) => setScope(index === 0 ? "personal" : "team")}
					selectedIndex={scope === "personal" ? 0 : 1}
				>
					<TabsSubtleItem index={0} label="Personal" />
					<TabsSubtleItem index={1} label="Team" />
				</TabsSubtle>
				<Input
					aria-label="Search routines"
					className="w-56"
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search routines…"
					value={search}
				/>
			</div>
			{list.isPending ? (
				<output className="py-10 text-muted-foreground text-sm">
					Loading routines…
				</output>
			) : null}
			{list.isError ? (
				<div className="text-sm" role="alert">
					<p>{resolveRoutineErrorMessage(list.error, "list")}</p>
					<Button
						onClick={async () => {
							await list.refetch();
						}}
						size="sm"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}
			{list.isSuccess && routines.length > 0 ? (
				<Table
					aria-label={`${scope === "personal" ? "Personal" : "Team"} routines`}
					className="text-sm"
				>
					<TableHeader>
						<TableRow>
							<TableHead>Routine</TableHead>
							<TableHead>Agent</TableHead>
							<TableHead>Next run</TableHead>
							<TableHead>Last run</TableHead>
							<TableHead>
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{routines.map((routine, index) => (
							<RoutineTableRow
								index={index}
								key={routine.id}
								onDelete={(routine) => {
									remove.reset();
									setDeleting(routine);
								}}
								onEdit={openForm}
								onHistory={setHistory}
								onStatus={(routine) => status.mutate(routine)}
								routine={routine}
								statusPending={status.isPending}
								userId={input.userId}
							/>
						))}
					</TableBody>
				</Table>
			) : null}
			{list.isSuccess && routines.length === 0 ? (
				<RoutineEmptyState
					onAction={() => {
						if (search) {
							setSearch("");
						} else {
							openForm("create");
						}
					}}
					scope={scope}
					search={search}
				/>
			) : null}
			{status.isError ? (
				<p className="text-destructive text-sm" role="alert">
					{resolveRoutineErrorMessage(status.error, "update")}
				</p>
			) : null}
			{input.focusRoutineId && list.isSuccess && !focused ? (
				<output className="text-muted-foreground text-sm">
					This routine is no longer available.
				</output>
			) : null}
			<RoutineEditor
				error={save.error}
				executors={list.data?.executors ?? []}
				form={form}
				onClose={() => setForm(null)}
				onSubmit={async (body) => {
					await save.mutateAsync(body);
				}}
				organizationId={input.organizationId}
				pending={save.isPending}
				scope={scope}
			/>
			<RoutineDeleteDialog
				errorMessage={
					remove.isError
						? resolveRoutineErrorMessage(remove.error, "delete")
						: null
				}
				onConfirm={() => {
					if (deleting) {
						remove.mutate(deleting);
					}
				}}
				onOpenChange={(open) => {
					if (!(open || remove.isPending)) {
						setDeleting(null);
					}
				}}
				open={Boolean(deleting)}
				routine={deleting}
				submitting={remove.isPending}
			/>
			<RoutineRunsDialog
				focusRunId={input.focusRunId}
				onOpenChange={(open) => {
					if (!open) {
						setHistory(null);
						input.onClearFocus?.();
					}
				}}
				open={Boolean(runsRoutine)}
				organizationId={input.organizationId}
				routine={runsRoutine}
			/>
		</div>
	);
}

type RoutineRowProps = {
	routine: RoutineManagement;
	index: number;
	userId: string;
	statusPending: boolean;
	onHistory: (routine: RoutineManagement) => void;
	onEdit: (routine: RoutineManagement) => void;
	onStatus: (routine: RoutineManagement) => void;
	onDelete: (routine: RoutineManagement) => void;
};
function RoutineTableRow(props: RoutineRowProps) {
	const { routine, index, onHistory } = props;
	return (
		<TableRow index={index} key={routine.id}>
			<TableCell className="max-w-sm">
				<button
					className="block max-w-full truncate text-left font-medium hover:underline"
					onClick={() => onHistory(routine)}
					type="button"
				>
					{routine.name}
				</button>
				<div className="mt-1 truncate text-muted-foreground text-xs">
					{routine.status === "paused" ? "Paused · " : ""}
					{routine.scheduleKind === "cron" &&
					routine.cronExpression &&
					routine.timezone
						? formatStoredRoutineSchedule({
								cronExpression: routine.cronExpression,
								timezone: routine.timezone,
							})
						: "Once"}
				</div>
			</TableCell>
			<TableCell>
				<div>{routine.executorName}</div>
				<div className="mt-1 text-muted-foreground text-xs">
					{routine.executorKind === "local_agent" ? "Local" : "Cloud"}
				</div>
			</TableCell>
			<TableCell className="whitespace-nowrap text-muted-foreground">
				{nextRunLabel(routine)}
			</TableCell>
			<TableCell>
				<RoutineLastRun
					onHistory={() => onHistory(routine)}
					routine={routine}
				/>
			</TableCell>
			<RoutineActions {...props} />
		</TableRow>
	);
}
function RoutineActions({
	routine,
	userId,
	statusPending,
	onHistory,
	onEdit,
	onStatus,
	onDelete,
}: RoutineRowProps) {
	return (
		<TableCell className="w-10">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Actions for ${routine.name}`}
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon className="size-5" />
				</DropdownMenuTrigger>
				<FluidDropdownMenuContent align="end" gapClick={false}>
					<FluidDropdownMenuItem index={0} onClick={() => onHistory(routine)}>
						<ClockCounterClockwiseIcon aria-hidden="true" />
						Run history
					</FluidDropdownMenuItem>
					<FluidDropdownMenuItem
						disabled={
							!routine.canManage ||
							(routine.agentProfileId !== null &&
								routine.createdByUserId !== userId)
						}
						index={1}
						onClick={() => onEdit(routine)}
					>
						<PencilSimpleIcon aria-hidden="true" />
						Edit
					</FluidDropdownMenuItem>
					<FluidDropdownMenuItem
						disabled={
							!routine.canManage ||
							routine.status === "completed" ||
							(routine.status === "paused" &&
								routine.agentProfileId !== null &&
								routine.createdByUserId !== userId) ||
							statusPending
						}
						index={2}
						onClick={() => onStatus(routine)}
					>
						{routine.status === "enabled" ? (
							<PauseCircleIcon aria-hidden="true" />
						) : (
							<PlayCircleIcon aria-hidden="true" />
						)}
						{routine.status === "enabled" ? "Pause" : "Resume"}
					</FluidDropdownMenuItem>
					<DropdownMenuSeparator />
					<FluidDropdownMenuGroup>
						<FluidDropdownMenuItem
							disabled={!routine.canManage}
							index={0}
							onClick={() => {
								onDelete(routine);
							}}
						>
							<TrashIcon aria-hidden="true" />
							Delete
						</FluidDropdownMenuItem>
					</FluidDropdownMenuGroup>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</TableCell>
	);
}
function nextRunLabel(routine: RoutineManagement) {
	if (routine.nextDueAt) {
		return new Date(routine.nextDueAt).toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	}
	return routine.status === "paused" ? "Paused" : "Finished";
}

function RoutineEmptyState({
	scope,
	search,
	onAction,
}: {
	scope: RoutineScope;
	search: string;
	onAction: () => void;
}) {
	return (
		<div className="flex flex-1 items-center justify-center py-8">
			<AppEmptyState
				actions={
					<Button onClick={onAction} size="sm" variant="outline">
						{search ? "Clear search" : "Create routine"}
					</Button>
				}
				className="w-full max-w-lg"
				description={
					search
						? "Try another search."
						: "Schedule work and find each result here."
				}
				icon={<ClockIcon className="size-5" />}
				title={search ? "No matching routines" : `No ${scope} routines yet`}
			/>
		</div>
	);
}

function RoutineEditor(input: {
	form: RoutineManagement | "create" | null;
	organizationId: string;
	scope: RoutineScope;
	executors: import("@openmeld/schemas/types").ListRoutineManagementResponse["executors"];
	pending: boolean;
	error: unknown;
	onClose: () => void;
	onSubmit: (body: CreateCenterAgentRoutineBody) => Promise<void>;
}) {
	const { form } = input;
	if (!form) {
		return null;
	}
	const routine = form === "create" ? undefined : form;
	const operation = routine ? "update" : "create";
	return (
		<RoutineForm
			key={routine?.id ?? "create"}
			{...input}
			error={
				input.error ? resolveRoutineErrorMessage(input.error, operation) : null
			}
			open
			routine={routine}
		/>
	);
}
