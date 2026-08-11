import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";
import { CenterAgentTasksPage } from "#/components/organizations/center-agent-tasks-page";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/tasks/"
)({
	staticData: appShellStaticData.centerAgent,
	component: CenterAgentTasksRoute,
});

function CenterAgentTasksRoute() {
	return (
		<CenterAgentSectionFrame>
			<CenterAgentTasksPage />
		</CenterAgentSectionFrame>
	);
}
