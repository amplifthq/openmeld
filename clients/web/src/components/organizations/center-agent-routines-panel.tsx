"use client";

import { formatStoredRoutineSchedule } from "@openmeld/routine-schedule";
import type { CenterAgentRoutineManagement } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Switch } from "@openmeld/ui/components/switch";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { CalendarDotsIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { AppEmptyState } from "#/components/app/app-empty-state";
import { AppPageHeader } from "#/components/app/app-page-header";
import { formatCenterAgentInteractionClient } from "#/lib/organizations/center-agent-interaction-source";
import { formatRoutineTimestamp } from "#/lib/organizations/center-agent-routine-presentation";
import { resolveCenterAgentRoutineErrorMessage } from "#/lib/organizations/center-agent-routines";
import { centerAgentRoutinesQueryOptions } from "#/query/organizations/center-agent-routines";
import { CenterAgentRoutineDeleteDialog } from "./center-agent-routine-delete-dialog";
import {
	CenterAgentRoutineFormDialog,
	type CenterAgentRoutineFormValues,
} from "./center-agent-routine-form-dialog";
import { RoutineRunStatusBadge } from "./center-agent-routine-presentation";
import { CenterAgentRoutineRunsDialog } from "./center-agent-routine-runs-dialog";
import { CenterAgentSelfEvolutionCard } from "./center-agent-self-evolution-card";
import {
	buildRoutineUpdate,
	useCenterAgentRoutineManagement,
} from "./use-center-agent-routine-management";

export function CenterAgentRoutinesPanel(input: {
	currentUserId: string;
	isPersonalWorkspace: boolean;
	organizationId: string;
	orgSlug: string;
}) {
	return (
		<CenterAgentRoutinesPanelContent
			currentUserId={input.currentUserId}
			isPersonalWorkspace={input.isPersonalWorkspace}
			key={input.organizationId}
			organizationId={input.organizationId}
			orgSlug={input.orgSlug}
		/>
	);
}

function CenterAgentRoutinesPanelContent(input: {
	currentUserId: string;
	isPersonalWorkspace: boolean;
	organizationId: string;
	orgSlug: string;
}) {
	const management = useCenterAgentRoutineManagement({
		organizationId: input.organizationId,
	});
	const {
		createMutation,
		deleteMutation,
		deletingRoutine,
		editingRoutine,
		isCreateOpen,
		runsRoutine,
		statusMutation,
		targetPreparationMutation,
		updateMutation,
	} = management;
	const routinesQuery = useQuery(
		centerAgentRoutinesQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const targetSpacePreparation = {
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
		onRetry: management.prepareTargetSpaces,
	};
	const createDialog = isCreateOpen ? (
		<CenterAgentRoutineFormDialog
			errorMessage={
				createMutation.isError
					? resolveCenterAgentRoutineErrorMessage(
							createMutation.error,
							"create"
						)
					: null
			}
			mode="create"
			onOpenChange={(open) => {
				if (!createMutation.isPending) {
					management.setIsCreateOpen(open);
					if (open) {
						createMutation.reset();
					}
				}
			}}
			onSubmit={(values: CenterAgentRoutineFormValues) => {
				if (!createMutation.isPending) {
					createMutation.mutate(values);
				}
			}}
			open={isCreateOpen}
			organizationId={input.organizationId}
			orgSlug={input.orgSlug}
			submitting={createMutation.isPending}
			targetSpacePreparation={targetSpacePreparation}
		/>
	) : null;
	const editDialog = editingRoutine ? (
		<CenterAgentRoutineFormDialog
			errorMessage={
				updateMutation.isError
					? resolveCenterAgentRoutineErrorMessage(
							updateMutation.error,
							"update"
						)
					: null
			}
			mode="edit"
			onOpenChange={(open) => {
				if (!(updateMutation.isPending || open)) {
					management.setEditingRoutine(null);
				}
			}}
			onSubmit={(values) => {
				if (editingRoutine && !updateMutation.isPending) {
					const changes = buildRoutineUpdate(editingRoutine, values);
					if (Object.keys(changes).length > 0) {
						updateMutation.mutate({ routine: editingRoutine, values });
					}
				}
			}}
			open={editingRoutine !== null}
			organizationId={input.organizationId}
			orgSlug={input.orgSlug}
			routine={editingRoutine ?? undefined}
			submitting={updateMutation.isPending}
			targetSpacePreparation={targetSpacePreparation}
		/>
	) : null;
	const deleteDialog = deletingRoutine ? (
		<CenterAgentRoutineDeleteDialog
			errorMessage={
				deleteMutation.isError
					? resolveCenterAgentRoutineErrorMessage(
							deleteMutation.error,
							"delete"
						)
					: null
			}
			onConfirm={() => {
				if (deletingRoutine && !deleteMutation.isPending) {
					deleteMutation.mutate({ routineId: deletingRoutine.id });
				}
			}}
			onOpenChange={(open) => {
				if (!(deleteMutation.isPending || open)) {
					management.setDeletingRoutine(null);
				}
			}}
			open={deletingRoutine !== null}
			routine={deletingRoutine}
			submitting={deleteMutation.isPending}
		/>
	) : null;
	const runsDialog = runsRoutine ? (
		<CenterAgentRoutineRunsDialog
			onOpenChange={(open) => {
				if (!open) {
					management.setRunsRoutine(null);
				}
			}}
			open={runsRoutine !== null}
			organizationId={input.organizationId}
			routine={runsRoutine}
		/>
	) : null;
	const pageHeader = (
		<CenterAgentRoutinesPageHeader
			isPersonalWorkspace={input.isPersonalWorkspace}
			isRefreshing={routinesQuery.isRefetching}
			onCreate={management.openCreate}
			onRefresh={() => {
				routinesQuery.refetch().catch((error) => {
					console.error("Failed to refresh Center Agent routines.", error);
				});
			}}
			showActions={Boolean(routinesQuery.data?.routines.length)}
		/>
	);
	if (routinesQuery.isPending) {
		return (
			<div className="flex flex-col gap-6">
				{pageHeader}
				<section aria-busy="true" aria-live="polite">
					<p className="text-muted-foreground text-sm">Loading routines.</p>
				</section>
			</div>
		);
	}

	if (routinesQuery.isError) {
		return (
			<div className="flex flex-col gap-6">
				{pageHeader}
				<section
					aria-labelledby="routines-error-title"
					className="rounded-md border border-destructive/50 bg-destructive/5 p-5"
				>
					<h2
						className="font-medium text-foreground text-sm"
						id="routines-error-title"
					>
						Could not load routines
					</h2>
					<p className="mt-2 break-words text-destructive text-sm" role="alert">
						{resolveCenterAgentRoutineErrorMessage(routinesQuery.error, "list")}
					</p>
					<Button
						className="mt-4"
						disabled={routinesQuery.isRefetching}
						onClick={() => {
							routinesQuery.refetch().catch((error) => {
								console.error(
									"Failed to refresh Center Agent routines.",
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
				</section>
			</div>
		);
	}

	if (routinesQuery.data.routines.length === 0) {
		return (
			<div className="flex flex-col gap-6">
				{pageHeader}
				<CenterAgentSelfEvolutionCard
					currentUserId={input.currentUserId}
					existingRoutines={routinesQuery.data.routines}
					isPersonalWorkspace={input.isPersonalWorkspace}
					organizationId={input.organizationId}
					orgSlug={input.orgSlug}
				/>
				<AppEmptyState
					actions={
						<Button onClick={management.openCreate} type="button">
							Create routine
						</Button>
					}
					description="Routines let your Center Agent work in a target Space on a schedule."
					icon={<CalendarDotsIcon aria-hidden="true" className="size-5" />}
					title="No routines yet"
				/>
				{createDialog}
				{editDialog}
				{deleteDialog}
				{runsDialog}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			{pageHeader}
			<CenterAgentSelfEvolutionCard
				currentUserId={input.currentUserId}
				existingRoutines={routinesQuery.data.routines}
				isPersonalWorkspace={input.isPersonalWorkspace}
				organizationId={input.organizationId}
				orgSlug={input.orgSlug}
			/>
			<section aria-labelledby="routines-title">
				<SharedLayoutGroup
					className="grid overflow-hidden rounded-md border border-border/70"
					role="list"
				>
					{routinesQuery.data.routines.map((routine) => (
						<RoutineRow
							currentUserId={routinesQuery.data.currentUserId}
							isStatusPending={
								statusMutation.isPending &&
								statusMutation.variables?.routine.id === routine.id
							}
							key={routine.id}
							onDelete={() => management.openDelete(routine)}
							onEdit={() => management.openEdit(routine)}
							onStatusChange={() => management.toggleStatus(routine)}
							onViewRuns={() => management.openRuns(routine)}
							routine={routine}
						/>
					))}
				</SharedLayoutGroup>
				{statusMutation.isError ? (
					<p className="mt-4 break-words text-destructive text-sm" role="alert">
						{resolveCenterAgentRoutineErrorMessage(
							statusMutation.error,
							statusMutation.variables?.routine.status === "enabled"
								? "pause"
								: "resume"
						)}
					</p>
				) : null}
				{createDialog}
				{editDialog}
				{deleteDialog}
				{runsDialog}
			</section>
		</div>
	);
}

function CenterAgentRoutinesPageHeader(input: {
	isPersonalWorkspace: boolean;
	isRefreshing: boolean;
	onCreate: () => void;
	onRefresh: () => void;
	showActions: boolean;
}) {
	return (
		<AppPageHeader
			action={
				input.showActions ? (
					<>
						<Button
							disabled={input.isRefreshing}
							onClick={input.onRefresh}
							type="button"
							variant="outline"
						>
							{input.isRefreshing ? "Refreshing" : "Refresh"}
						</Button>
						<Button onClick={input.onCreate} type="button">
							Create routine
						</Button>
					</>
				) : undefined
			}
			description="Schedule your Center Agent to work in a target Space."
			eyebrow={
				input.isPersonalWorkspace ? "Personal workspace" : "Organization"
			}
			id="routines-title"
			title="Routines"
		/>
	);
}

function RoutineRow(input: {
	currentUserId: string;
	isStatusPending: boolean;
	onDelete: () => void;
	onEdit: () => void;
	onStatusChange: () => void;
	onViewRuns: () => void;
	routine: CenterAgentRoutineManagement;
}) {
	const schedule = resolveRoutineScheduleLabel(input.routine);
	const statusLabel = resolveRoutineStatusLabel(input.routine.status);
	const destinationLabel = resolveRoutineDestinationLabel(input.routine);
	const creationLabel = resolveRoutineCreationLabel(
		input.routine,
		input.currentUserId
	);
	const lastRun = input.routine.lastRun;
	return (
		<SharedLayoutItem
			className="border-border/70 border-b last:border-b-0"
			itemId={input.routine.id}
			role="listitem"
		>
			<div className="grid min-w-0 gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
				<div className="min-w-0">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h3 className="min-w-0 break-words font-medium text-foreground text-sm">
							{input.routine.name}
						</h3>
						<Badge className="border-border bg-muted/40 text-muted-foreground">
							{statusLabel}
						</Badge>
					</div>
					<p className="mt-2 break-words text-foreground text-sm">{schedule}</p>
					<p className="mt-2 break-words text-muted-foreground text-xs">
						{creationLabel}
					</p>
					<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
						<span>{destinationLabel}</span>
						{input.routine.timezone ? (
							<span>{input.routine.timezone}</span>
						) : null}
						<RoutineNextRun nextDueAt={input.routine.nextDueAt} />
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<span className="text-muted-foreground text-xs">Last run</span>
						{lastRun ? (
							<RoutineRunStatusBadge status={lastRun.status} />
						) : (
							<span className="text-muted-foreground text-xs">Not run yet</span>
						)}
					</div>
					{lastRun?.status === "failed" && lastRun.failureDetail ? (
						<p className="mt-2 flex max-w-2xl items-start gap-1.5 break-words text-destructive text-xs leading-5">
							<WarningCircleIcon
								aria-hidden="true"
								className="mt-0.5 size-3.5 shrink-0"
							/>
							<span>{lastRun.failureDetail}</span>
						</p>
					) : null}
					{lastRun?.status === "skipped" && lastRun.failureDetail ? (
						<p className="mt-2 max-w-2xl break-words text-muted-foreground text-xs leading-5">
							{lastRun.failureDetail}
						</p>
					) : null}
				</div>
				<RoutineRowControls {...input} />
			</div>
		</SharedLayoutItem>
	);
}

function RoutineNextRun(input: { nextDueAt: number | null }) {
	return (
		<span>
			Next run{" "}
			{input.nextDueAt === null ? (
				"Not scheduled"
			) : (
				<time dateTime={new Date(input.nextDueAt).toISOString()}>
					{formatRoutineTimestamp(input.nextDueAt)}
				</time>
			)}
		</span>
	);
}

function RoutineRowControls(input: {
	isStatusPending: boolean;
	onDelete: () => void;
	onEdit: () => void;
	onStatusChange: () => void;
	onViewRuns: () => void;
	routine: CenterAgentRoutineManagement;
}) {
	const canChangeStatus =
		input.routine.canManage && input.routine.status !== "completed";
	const canEdit = canChangeStatus && input.routine.destinationKind === "space";
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
			{canChangeStatus ? (
				<Switch
					aria-label={`${input.routine.status === "enabled" ? "Pause" : "Resume"} ${input.routine.name}`}
					checked={input.routine.status === "enabled"}
					disabled={input.isStatusPending}
					onCheckedChange={input.onStatusChange}
				/>
			) : null}
			<Button
				aria-label={`View runs for ${input.routine.name}`}
				onClick={input.onViewRuns}
				size="sm"
				type="button"
				variant="outline"
			>
				<span aria-hidden="true" className="lg:hidden">
					View runs
				</span>
				<span aria-hidden="true" className="max-lg:hidden">
					View runs for {input.routine.name}
				</span>
			</Button>
			{canEdit ? (
				<Button
					aria-label={`Edit ${input.routine.name}`}
					onClick={input.onEdit}
					size="sm"
					type="button"
					variant="outline"
				>
					Edit
				</Button>
			) : null}
			{input.routine.canManage ? (
				<Button
					aria-label={`Delete ${input.routine.name}`}
					onClick={input.onDelete}
					size="sm"
					type="button"
					variant="ghost"
				>
					Delete
				</Button>
			) : null}
		</div>
	);
}

function resolveRoutineScheduleLabel(
	routine: CenterAgentRoutineManagement
): string {
	if (routine.scheduleKind === "once" && routine.runAtMs !== null) {
		return `Once on ${formatRoutineTimestamp(routine.runAtMs)}`;
	}
	return formatStoredRoutineSchedule({
		cronExpression: routine.cronExpression ?? "",
		timezone: routine.timezone ?? "UTC",
	});
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

function resolveRoutineDestinationLabel(
	routine: CenterAgentRoutineManagement
): string {
	if (routine.destinationKind === "slack_thread") {
		return routine.slackThreadLabel ?? "Slack thread";
	}
	return "OpenMeld Space";
}

function resolveRoutineCreationLabel(
	routine: CenterAgentRoutineManagement,
	currentUserId: string
): string {
	const creator =
		routine.createdByUserId === currentUserId
			? "you"
			: (routine.creationAttribution.displayName ?? "an organization member");
	const interactionSource = routine.creationAttribution.interactionSource;
	const source = interactionSource
		? ` via ${formatCenterAgentInteractionClient(interactionSource.client)}`
		: "";
	return `Created by ${creator}${source}`;
}
