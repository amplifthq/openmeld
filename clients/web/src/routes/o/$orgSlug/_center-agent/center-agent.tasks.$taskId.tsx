import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";
import { CenterAgentTaskDetailPage } from "#/components/organizations/center-agent-task-detail-page";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/tasks/$taskId"
)({
	staticData: appShellStaticData.centerAgent,
	component: CenterAgentTaskRoute,
});

function CenterAgentTaskRoute() {
	const { taskId } = Route.useParams();
	return (
		<CenterAgentSectionFrame>
			<CenterAgentTaskDetailPage taskId={taskId} />
		</CenterAgentSectionFrame>
	);
}
