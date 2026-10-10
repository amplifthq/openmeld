import { SPACE_TASK_TITLE_MAX_CHARS } from "@openmeld/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { spaceTaskQueryKeys } from "#/query/spaces/space-tasks";
export function useSpaceMessageTaskAction(input: {
	disabled: boolean;
	openMeldProfileId: string;
	organizationSlug?: string;
	spaceId?: string;
}) {
	const { disabled, openMeldProfileId, organizationSlug, spaceId } = input;
	const queryClient = useQueryClient();
	const [pendingSourceSignalId, setPendingSourceSignalId] = useState<
		string | null
	>(null);
	const onAdd = useCallback(
		async (item: SpaceTimelineItem, threadId: string | null) => {
			if (disabled || !spaceId || pendingSourceSignalId) {
				return;
			}
			setPendingSourceSignalId(item.id);
			try {
				const compactText = item.text.replace(/\s+/gu, " ").trim();
				const title =
					compactText.length > SPACE_TASK_TITLE_MAX_CHARS
						? `${compactText.slice(0, SPACE_TASK_TITLE_MAX_CHARS - 1).trimEnd()}…`
						: compactText || `Follow up on ${item.actorName}'s message`;
				const taskApi = organizationSlug
					? createOrganizationScopedWebSpaceApi({
							organizationSlug,
							openMeldProfileId,
						})
					: createUnscopedWebSpaceApi({ openMeldProfileId });
				await taskApi.createTask({
					spaceId,
					body: {
						operationId: crypto.randomUUID(),
						title,
						sourceSignalId: item.id,
						threadId,
						assigneeProfileId:
							item.wakeTargetProfileIds.length === 1
								? (item.wakeTargetProfileIds[0] ?? null)
								: null,
					},
				});
				await queryClient.invalidateQueries({
					queryKey: spaceTaskQueryKeys.space(spaceId),
				});
				toast.success("Task created from this message.");
			} catch (error) {
				toast.error(
					error instanceof Error && error.message
						? error.message
						: "OpenMeld couldn't create a Task from this message."
				);
			} finally {
				setPendingSourceSignalId(null);
			}
		},
		[
			disabled,
			openMeldProfileId,
			organizationSlug,
			pendingSourceSignalId,
			queryClient,
			spaceId,
		]
	);
	return { onAdd: disabled ? undefined : onAdd, pendingSourceSignalId };
}
