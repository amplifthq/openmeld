"use client";

import type {
	CenterAgentRoutineManagement,
	UpdateCenterAgentRoutineBody,
} from "@openmeld/schemas/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	createCurrentCenterAgentRoutine,
	deleteCurrentCenterAgentRoutine,
	pauseCurrentCenterAgentRoutine,
	resumeCurrentCenterAgentRoutine,
	updateCurrentCenterAgentRoutine,
} from "#/lib/organizations/center-agent-routines";
import {
	invalidateCenterAgentRoutineFacts,
	prepareCenterAgentRoutineTargetSpaces,
} from "#/query/organizations/center-agent-routines";
import type { CenterAgentRoutineFormValues } from "./center-agent-routine-form-dialog";

export function useCenterAgentRoutineManagement(input: {
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [editingRoutine, setEditingRoutine] =
		useState<CenterAgentRoutineManagement | null>(null);
	const [deletingRoutine, setDeletingRoutine] =
		useState<CenterAgentRoutineManagement | null>(null);
	const [runsRoutine, setRunsRoutine] =
		useState<CenterAgentRoutineManagement | null>(null);
	const statusMutationLatchRef = useRef(false);
	const targetPreparationLatchRef = useRef(false);

	const createMutation = useMutation({
		mutationFn: async (values: CenterAgentRoutineFormValues) => {
			const {
				postSlackSummary: _postSlackSummary,
				slackReportChannelName: _slackReportChannelName,
				...routineValues
			} = values;
			return await createCurrentCenterAgentRoutine({
				...routineValues,
				organizationId: input.organizationId,
			});
		},
		onSuccess: async () => {
			await invalidateCenterAgentRoutineFacts({
				organizationId: input.organizationId,
				queryClient,
			});
			setIsCreateOpen(false);
			toast.success("Routine created.");
		},
	});
	const updateMutation = useMutation({
		mutationFn: async (variables: {
			routine: CenterAgentRoutineManagement;
			values: CenterAgentRoutineFormValues;
		}) =>
			await updateCurrentCenterAgentRoutine({
				...buildRoutineUpdate(variables.routine, variables.values),
				organizationId: input.organizationId,
				routineId: variables.routine.id,
			}),
		onSuccess: async (_response, variables) => {
			await invalidateCenterAgentRoutineFacts({
				organizationId: input.organizationId,
				queryClient,
				routineId: variables.routine.id,
			});
			setEditingRoutine(null);
			toast.success("Routine updated.");
		},
	});
	const statusMutation = useMutation({
		mutationFn: async (variables: { routine: CenterAgentRoutineManagement }) =>
			variables.routine.status === "enabled"
				? await pauseCurrentCenterAgentRoutine({
						organizationId: input.organizationId,
						routineId: variables.routine.id,
					})
				: await resumeCurrentCenterAgentRoutine({
						organizationId: input.organizationId,
						routineId: variables.routine.id,
					}),
		onSuccess: async (_response, variables) => {
			await invalidateCenterAgentRoutineFacts({
				organizationId: input.organizationId,
				queryClient,
				routineId: variables.routine.id,
			});
			toast.success(
				variables.routine.status === "enabled"
					? "Routine paused."
					: "Routine resumed."
			);
		},
		onSettled: () => {
			statusMutationLatchRef.current = false;
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async (variables: { routineId: string }) =>
			await deleteCurrentCenterAgentRoutine({
				organizationId: input.organizationId,
				routineId: variables.routineId,
			}),
		onSuccess: async (_response, variables) => {
			await invalidateCenterAgentRoutineFacts({
				organizationId: input.organizationId,
				queryClient,
				routineId: variables.routineId,
			});
			setDeletingRoutine(null);
			toast.success("Routine deleted.");
		},
	});
	const targetPreparationMutation = useMutation({
		mutationFn: async () =>
			await prepareCenterAgentRoutineTargetSpaces({
				organizationId: input.organizationId,
				queryClient,
			}),
		onSettled: () => {
			targetPreparationLatchRef.current = false;
		},
	});

	const prepareTargetSpaces = () => {
		if (
			targetPreparationMutation.isPending ||
			targetPreparationLatchRef.current
		) {
			return;
		}
		targetPreparationLatchRef.current = true;
		targetPreparationMutation.reset();
		targetPreparationMutation.mutate();
	};

	return {
		createMutation,
		deleteMutation,
		deletingRoutine,
		editingRoutine,
		isCreateOpen,
		openCreate: () => {
			createMutation.reset();
			setIsCreateOpen(true);
			prepareTargetSpaces();
		},
		openDelete: (routine: CenterAgentRoutineManagement) => {
			deleteMutation.reset();
			setDeletingRoutine(routine);
		},
		openEdit: (routine: CenterAgentRoutineManagement) => {
			updateMutation.reset();
			setEditingRoutine(routine);
			prepareTargetSpaces();
		},
		openRuns: setRunsRoutine,
		runsRoutine,
		setDeletingRoutine,
		setEditingRoutine,
		setIsCreateOpen,
		setRunsRoutine,
		statusMutation,
		prepareTargetSpaces,
		targetPreparationMutation,
		toggleStatus: (routine: CenterAgentRoutineManagement) => {
			if (routine.status === "completed") {
				return;
			}
			if (!(statusMutation.isPending || statusMutationLatchRef.current)) {
				statusMutationLatchRef.current = true;
				statusMutation.mutate({ routine });
			}
		},
		updateMutation,
	};
}

export function buildRoutineUpdate(
	routine: CenterAgentRoutineManagement,
	values: CenterAgentRoutineFormValues
): UpdateCenterAgentRoutineBody {
	const scheduleChanged =
		values.scheduleKind !== routine.scheduleKind ||
		values.cronExpression !== routine.cronExpression ||
		values.runAtMs !== routine.runAtMs ||
		values.timezone !== routine.timezone;
	return {
		...(values.authorizedActions
			? { authorizedActions: values.authorizedActions }
			: {}),
		...(values.externalActionPolicy
			? { externalActionPolicy: values.externalActionPolicy }
			: {}),
		...(scheduleChanged
			? {
					cronExpression: values.cronExpression,
					runAtMs: values.runAtMs,
					scheduleKind: values.scheduleKind,
					timezone: values.timezone,
				}
			: {}),
		...(values.instructions === routine.instructions
			? {}
			: { instructions: values.instructions }),
		...(values.name === routine.name ? {} : { name: values.name }),
		...(values.targetSpaceId === routine.targetSpaceId
			? {}
			: { targetSpaceId: values.targetSpaceId }),
	};
}
