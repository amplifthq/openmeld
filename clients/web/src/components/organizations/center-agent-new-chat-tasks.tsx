import { createCenterAgentApi } from "@openmeld/api-client";
import type {
	CreateSpaceTaskBody,
	SpaceTaskPhase,
} from "@openmeld/schemas/types";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { SpaceTaskCreateDialog } from "#/components/spaces/space-task-create-dialog";
import type { TaskDraftMember } from "#/components/spaces/space-task-draft-fields";
import {
	EmptyTasksBoard,
	TaskBoardHeader,
} from "#/components/spaces/space-tasks-panel";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";

export function CenterAgentNewChatTasks({
	members,
	profileId,
}: {
	members: readonly TaskDraftMember[];
	profileId?: string;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [phase, setPhase] = useState<SpaceTaskPhase>();
	const create = async (body: CreateSpaceTaskBody) => {
		try {
			const session = await createCenterAgentApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: organization.id,
				})
			).createSession({ creationId: body.operationId });
			await createOrganizationScopedWebSpaceApi({
				organizationSlug: organization.slug,
				openMeldProfileId: profileId,
			}).createTask({ spaceId: session.spaceId, body });
			await queryClient.invalidateQueries({
				queryKey: [
					"center-agent",
					organization.id,
					profileId ?? "",
					"sessions",
				],
			});
			await navigate({
				to: buildOrganizationCenterAgentChatPath(organization.slug, {
					session: session.spaceId,
					view: "tasks",
				}),
				replace: true,
			});
			return true;
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Couldn't create task. Try again."
			);
			return false;
		}
	};
	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="mx-auto max-w-[1600px] p-4 sm:p-6">
				<TaskBoardHeader
					onCreateTask={profileId ? () => setCreating(true) : undefined}
					onPhaseChange={setPhase}
					phase={phase}
					tasks={[]}
					truncated={false}
				/>
				<EmptyTasksBoard phase={phase} />
				{creating && (
					<SpaceTaskCreateDialog
						members={members}
						onClose={() => setCreating(false)}
						onCreate={create}
					/>
				)}
			</div>
		</ScrollArea>
	);
}
