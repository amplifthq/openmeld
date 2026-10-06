"use client";

import { CENTER_AGENT_ROUTINE_NAME_MAX_CHARS } from "@openmeld/schemas";
import type {
	CreateCenterAgentRoutineBody,
	SpaceFileDescriptor,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RoutineForm } from "#/components/routines/routine-form";
import { createCurrentRoutine } from "#/lib/routines/api";
import { invalidateRoutineFacts, routinesQueryOptions } from "#/query/routines";

export function SpaceFileMaintenanceDialog(input: {
	file: SpaceFileDescriptor;
	spaceId: string;
	organizationId: string;
	orgSlug: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const routines = useQuery(
		routinesQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const mutation = useMutation({
		mutationFn: async (body: CreateCenterAgentRoutineBody) =>
			await createCurrentRoutine({
				...body,
				organizationId: input.organizationId,
			}),
		onSuccess: async () => {
			await invalidateRoutineFacts({
				queryClient,
				organizationId: input.organizationId,
			});
			input.onClose();
		},
	});
	if (!routines.data) {
		return (
			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						input.onClose();
					}
				}}
				open
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create routine</DialogTitle>
					</DialogHeader>
					<p>
						{routines.isError ? "Could not load Agents." : "Loading Agents…"}
					</p>
					{routines.isError ? (
						<Button onClick={() => routines.refetch()}>Retry</Button>
					) : null}
				</DialogContent>
			</Dialog>
		);
	}
	return (
		<RoutineForm
			error={mutation.error?.message ?? null}
			executors={routines.data.executors}
			initialValues={{
				name: `Maintain ${input.file.name}`.slice(
					0,
					CENTER_AGENT_ROUTINE_NAME_MAX_CHARS
				),
				targetSpaceId: input.spaceId,
				cronExpression: "0 * * * *",
				instructions: [
					`Maintain the existing Space file ${JSON.stringify(input.file.name)} (fileId: ${input.file.id}) in Space ${input.spaceId}.`,
					"Read the current file and relevant Space discussion before making changes. Use only clearly confirmed human decisions within the scope of this file. Proposals, questions, conflicting opinions, Agent suggestions, and file-update notifications are not approved decisions.",
					"Page through relevant messages and threads since the current file revision; do not assume the first page contains all decisions. Preserve the file's existing scope and structure.",
					"Keep existing confirmed content unless a later explicit decision replaces it. For every substantive change, include a concise source reference in the file using the exact decision message link or signal ID returned by Space history. Preserve existing source references; never invent a link, ID, or timestamp. If a decision is ambiguous, leave the file unchanged and ask for clarification instead of approving it yourself.",
					"Use the existing Space Files save tool with the revision you just read as baseRevision. If someone changed the file, read the latest version and reconcile before saving; never overwrite their changes with a stale copy.",
					"If there is no new confirmed content change, do not save a new version or send an update notification. Missing source references alone do not justify a new version; add them alongside the next confirmed content change. Do not rewrite the file just to record that you checked it. After a real update, the file's configured notifications handle delivery; do not broadcast a second copy or Wake additional Agents.",
				].join("\n\n"),
			}}
			onClose={input.onClose}
			onSubmit={async (values) => {
				await mutation.mutateAsync(values);
			}}
			open
			organizationId={input.organizationId}
			pending={mutation.isPending}
			scope="team"
		/>
	);
}
